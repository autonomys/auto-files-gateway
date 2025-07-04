import { v4 } from 'uuid'
import Websocket from 'websocket'
import { objectMappingUseCase } from '../../useCases/objectMapping.js'
import { config } from '../../config.js'
import { logger } from '../../drivers/logger.js'
import { server } from '../../rpc/server.js'
import { segmentUseCase } from '../../useCases/segment.js'

type RouterState = {
  objectMappingsSubscriptions: Map<string, Websocket.connection>
  recoverObjectMappingsSubscriptions: Map<
    string,
    { connection: Websocket.connection; pieceIndex: number; step: number }
  >
  lastRealtimeSegmentIndex: number
}

const state: RouterState = {
  objectMappingsSubscriptions: new Map(),
  recoverObjectMappingsSubscriptions: new Map(),
  lastRealtimeSegmentIndex: 0,
}

const init = async () => {
  const latestSegmentIndex = await segmentUseCase.getLastSegment()
  state.lastRealtimeSegmentIndex = latestSegmentIndex
  segmentUseCase.subscribeToArchivedSegmentHeader(emitObjectMappings)
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

const emitObjectMappings = async (segmentIndex: number) => {
  // avoid emitting object mappings for segments that are already processed
  if (segmentIndex <= state.lastRealtimeSegmentIndex) {
    return
  }
  state.lastRealtimeSegmentIndex = segmentIndex
  const [lowerLimit, upperLimit] =
    segmentUseCase.getPieceIndexRangeBySegment(segmentIndex)
  const objectMappings = await objectMappingUseCase.getObjectByPieceIndexRange(
    lowerLimit,
    upperLimit,
  )

  Array.from(state.objectMappingsSubscriptions.entries()).forEach(
    ([subscriptionId, connection]) => {
      if (connection.socket.readyState === 'open') {
        server.notificationClient.object_mapping_list(
          connection,
          objectMappings,
        )
      } else {
        logger.warn(
          `IP (${connection.remoteAddress}) object mappings subscription ${subscriptionId} socket is ${connection.socket.readyState}`,
        )
        logger.debug(
          `Removing subscription ${subscriptionId} from object mappings`,
        )
        unsubscribeObjectMappings(subscriptionId)
      }
    },
  )
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
      const result = await objectMappingUseCase.getObjectByPieceIndexRange(
        pieceIndex,
        upperLimit,
      )

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

      server.notificationClient.object_mapping_list(connection, result)
    },
  )

  await Promise.all(promises)
}

const recoveryLoop = async () => {
  await emitRecoverObjectMappings()
  setTimeout(recoveryLoop, config.recoveryInterval)
}

export const objectMappingRouter = {
  subscribeObjectMappings,
  unsubscribeObjectMappings,
  emitObjectMappings,
  subscribeRecoverObjectMappings,
  unsubscribeRecoverObjectMappings,
  init,
}

setTimeout(init, 1000)
setTimeout(recoveryLoop)
