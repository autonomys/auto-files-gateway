import { v4 } from 'uuid'
import Websocket from 'websocket'
import { ObjectMappingListEntry } from '@auto-files/models'
import { objectMappingUseCase } from '../../useCases/objectMapping.js'
import { config } from '../../config.js'
import { logger } from '../../drivers/logger.js'
import { objectMappingRepository } from '../../repositories/objectMapping.js'
import { server } from '../../rpc/server.js'

type RouterState = {
  objectMappingsSubscriptions: Map<string, Websocket.connection>
  recoverObjectMappingsSubscriptions: Map<
    string,
    { connection: Websocket.connection; pieceIndex: number; step: number }
  >
  lastRealtimeBlockNumber: number
}

const state: RouterState = {
  objectMappingsSubscriptions: new Map(),
  recoverObjectMappingsSubscriptions: new Map(),
  lastRealtimeBlockNumber: 0,
}

const init = async () => {
  const latestBlockNumber = await objectMappingRepository.getLatestBlockNumber()
  state.lastRealtimeBlockNumber = latestBlockNumber.blockNumber
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

const emitObjectMappings = (event: ObjectMappingListEntry) => {
  state.lastRealtimeBlockNumber = event.blockNumber
  Array.from(state.objectMappingsSubscriptions.entries()).forEach(
    ([subscriptionId, connection]) => {
      if (connection.socket.readyState === 'open') {
        server.notificationClient.object_mapping_list(
          connection,
          event.v0.objects,
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

const emitRecoverObjectMappings = async () => {
  const recovering = Array.from(
    state.recoverObjectMappingsSubscriptions.entries(),
  )

  const promises = recovering.map(
    async ([subscriptionId, { connection, pieceIndex, step }]) => {
      const result = await objectMappingUseCase.getObjectByPieceIndexAndStep(
        pieceIndex,
        step,
      )

      state.recoverObjectMappingsSubscriptions.set(subscriptionId, {
        connection,
        pieceIndex: pieceIndex + step,
        step,
      })

      if (pieceIndex >= state.lastRealtimeBlockNumber) {
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
