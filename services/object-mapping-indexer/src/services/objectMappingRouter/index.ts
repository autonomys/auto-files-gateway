import { v4 } from 'uuid'
import Websocket from 'websocket'
import { objectMappingUseCase } from '../../useCases/objectMapping.js'
import { config } from '../../config.js'
import { logger } from '../../drivers/logger.js'
import { server } from '../../rpc/server.js'
import { segmentUseCase } from '../../useCases/segment.js'
import { ObjectMapping } from '@auto-files/models'

type RouterState = {
  objectMappingsSubscriptions: Map<string, Websocket.connection>
  recoverObjectMappingsSubscriptions: Map<
    string,
    { connection: Websocket.connection; pieceIndex: number; step: number }
  >
  lastRealtimeSegmentIndex: number
  recoveryLoop: NodeJS.Timeout | null
}

const state: RouterState = {
  objectMappingsSubscriptions: new Map(),
  recoverObjectMappingsSubscriptions: new Map(),
  lastRealtimeSegmentIndex: 0,
  recoveryLoop: null,
}

const init = async () => {
  const latestSegmentIndex = await segmentUseCase.getLastSegment()
  state.lastRealtimeSegmentIndex = latestSegmentIndex
  await segmentUseCase.subscribeToArchivedSegmentHeader(emitObjectMappings)
  state.recoveryLoop = setTimeout(recoveryLoop, 0)
}

const subscribeObjectMappings = (
  connection: Websocket.connection | undefined,
  subscriptionId: string = v4(),
) => {
  if (!connection) {
    throw new Error('Subscribe object mappings is not supported over http')
  }
  logger.info(`IP (${connection.remoteAddress}) subscribing to object mappings`)
  state.objectMappingsSubscriptions.set(subscriptionId, connection)
  return subscriptionId
}

const unsubscribeObjectMappings = (subscriptionId: string) => {
  const connection = state.objectMappingsSubscriptions.get(subscriptionId)
  if (connection) {
    logger.info(
      `IP (${connection.remoteAddress}) unsubscribing from object mappings: ${subscriptionId}`,
    )
    state.objectMappingsSubscriptions.delete(subscriptionId)
  }
}

const dispatchObjectMappings = async (
  connections: [string, Websocket.connection][],
  startPieceIndex: number,
  endPieceIndex: number,
) => {
  // Early-exit if the requested range is invalid
  if (startPieceIndex > endPieceIndex || connections.length === 0) {
    return
  }

  const { maxObjectsPerMessage, timeBetweenMessages } =
    config.objectMappingDistribution

  let lastBatchObjectCount = maxObjectsPerMessage
  // initialise the pointer to the first object mapping
  let lastObjectMapping: ObjectMapping = ['', startPieceIndex, -1]

  // if the last batch has the maximum number of objects, we need to fetch more
  while (lastBatchObjectCount === maxObjectsPerMessage) {
    const objectMappings =
      await objectMappingUseCase.getObjectsAfterObjectWithinLimits(
        lastObjectMapping,
        endPieceIndex,
        maxObjectsPerMessage,
      )

    // If the query returned nothing, we are done
    if (objectMappings.length === 0) {
      break
    }

    // Send the batch to every still-connected subscriber
    connections.forEach(([subscriptionId, connection]) => {
      if (connection?.connected) {
        server.notificationClient.object_mapping_list(
          connection,
          objectMappings,
        )
      } else {
        unsubscribeObjectMappings(subscriptionId)
      }
    })

    // Move the cursor past the last pieceIndex we just sent
    lastObjectMapping = objectMappings[objectMappings.length - 1]
    lastBatchObjectCount = objectMappings.length

    // Throttle so we don’t overwhelm clients
    await new Promise((resolve) => setTimeout(resolve, timeBetweenMessages))
  }
}

const emitObjectMappings = async (segmentIndex: number) => {
  // avoid emitting object mappings for segments that are already processed
  if (segmentIndex <= state.lastRealtimeSegmentIndex) {
    return
  }
  const UPPER_LIMIT_RANGE_INDEX = 1
  const lastUpperLimit = segmentUseCase.getPieceIndexRangeBySegment(
    state.lastRealtimeSegmentIndex,
  )[UPPER_LIMIT_RANGE_INDEX]
  const upperLimit =
    segmentUseCase.getPieceIndexRangeBySegment(segmentIndex)[
      UPPER_LIMIT_RANGE_INDEX
    ]

  await objectMappingRouter.dispatchObjectMappings(
    Array.from(state.objectMappingsSubscriptions.entries()),
    lastUpperLimit + 1,
    upperLimit,
  )

  state.lastRealtimeSegmentIndex = segmentIndex
}

const subscribeRecoverObjectMappings = (
  connection: Websocket.connection | undefined,
  startingPieceIndex: number,
  step: number = 1,
) => {
  if (!connection) {
    throw new Error('Subscribe object mappings is not supported over http')
  }
  logger.info(
    `IP (${connection.remoteAddress}) subscribing to recover object mappings`,
  )
  const subscriptionId = v4()
  const pieceIndex = startingPieceIndex - 1
  state.recoverObjectMappingsSubscriptions.set(subscriptionId, {
    connection,
    pieceIndex,
    step,
  })

  return subscriptionId
}

const unsubscribeRecoverObjectMappings = (subscriptionId: string) => {
  const wasSubscribed =
    state.recoverObjectMappingsSubscriptions.has(subscriptionId)
  if (wasSubscribed) {
    const { connection } =
      state.recoverObjectMappingsSubscriptions.get(subscriptionId)!
    logger.info(
      `IP (${connection.remoteAddress}) unsubscribing from recover object mappings: ${subscriptionId}`,
    )
    state.recoverObjectMappingsSubscriptions.delete(subscriptionId)
  }
}

// Limits the maximum piece index to the already archived segments
// avoiding to distribute pieces that are not yet archived
const getUpperLimit = (pieceIndex: number) => {
  const segmentIndex = segmentUseCase.getSegmentByPieceIndex(pieceIndex)
  if (segmentIndex >= state.lastRealtimeSegmentIndex) {
    const UPPER_LIMIT_RANGE_INDEX = 1
    return segmentUseCase.getPieceIndexRangeBySegment(
      state.lastRealtimeSegmentIndex,
    )[UPPER_LIMIT_RANGE_INDEX]
  }
  return pieceIndex
}

const emitRecoverObjectMappings = async () => {
  const recovering = Array.from(
    state.recoverObjectMappingsSubscriptions.entries(),
  )

  const promises = recovering.map(
    async ([subscriptionId, { connection, pieceIndex, step }]) => {
      const upperPieceIndex = pieceIndex + step
      const upperLimit = getUpperLimit(upperPieceIndex)

      state.recoverObjectMappingsSubscriptions.set(subscriptionId, {
        connection,
        pieceIndex: upperLimit,
        step,
      })

      const hasReachedLastSegment = upperPieceIndex > upperLimit
      if (hasReachedLastSegment) {
        unsubscribeRecoverObjectMappings(subscriptionId)
        subscribeObjectMappings(connection, subscriptionId)
      }

      objectMappingRouter.dispatchObjectMappings(
        [[subscriptionId, connection]],
        pieceIndex,
        upperLimit,
      )
    },
  )

  await Promise.all(promises)
}

const recoveryLoop = async () => {
  await emitRecoverObjectMappings()
  state.recoveryLoop = setTimeout(recoveryLoop, config.recoveryInterval)
}

export const objectMappingRouter = {
  getState: (): Readonly<RouterState> => state,
  subscribeObjectMappings,
  unsubscribeObjectMappings,
  emitObjectMappings,
  subscribeRecoverObjectMappings,
  unsubscribeRecoverObjectMappings,
  init,
  dispatchObjectMappings,
  close: () => {
    state.objectMappingsSubscriptions.clear()
    state.recoverObjectMappingsSubscriptions.clear()
    if (state.recoveryLoop) {
      clearTimeout(state.recoveryLoop)
    }
    segmentUseCase.unsubscribeFromArchivedSegmentHeader()
  },
}
