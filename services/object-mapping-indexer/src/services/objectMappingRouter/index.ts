import { v4 } from 'uuid'
import Websocket from 'websocket'
import { ObjectMappingListEntry } from '../../models/mapping.js'
import { objectMappingUseCase } from '../../useCases/objectMapping.js'
import { config } from '../../config.js'
import { logger } from '../../drivers/logger.js'
import { objectMappingRepository } from '../../repositories/objectMapping.js'

type RouterState = {
  objectMappingsSubscriptions: Map<string, Websocket.connection>
  recoverObjectMappingsSubscriptions: Map<
    string,
    { connection: Websocket.connection; blockNumber: number }
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
  connection: Websocket.connection,
  subscriptionId: string = v4(),
) => {
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
        connection.sendUTF(
          JSON.stringify({
            subscriptionId,
            result: event,
          }),
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
  connection: Websocket.connection,
  blockNumber: number,
) => {
  throw new Error('Not implemented: Update to use pieceIndex')
  logger.info(
    `IP (${connection.remoteAddress}) subscribing to recover object mappings`,
  )
  const subscriptionId = v4()
  state.recoverObjectMappingsSubscriptions.set(subscriptionId, {
    connection,
    blockNumber: blockNumber - 1,
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
    async ([subscriptionId, { connection, blockNumber }]) => {
      logger.debug(`Emitting recover object mappings for ${subscriptionId}`)
      const result = await objectMappingUseCase.getObjectByBlock(blockNumber)

      state.recoverObjectMappingsSubscriptions.set(subscriptionId, {
        connection,
        blockNumber: blockNumber + 1,
      })

      if (blockNumber >= state.lastRealtimeBlockNumber) {
        unsubscribeRecoverObjectMappings(subscriptionId)
        subscribeObjectMappings(connection, subscriptionId)
      }

      connection.sendUTF(JSON.stringify({ subscriptionId, result }))
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
