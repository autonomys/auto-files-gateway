import { logger } from '../../drivers/logger.js'
import { objectMappingUseCase } from '../../useCases/objectMapping.js'
import { ObjectMappingListener } from './types.js'
import { SubspaceRPCApi } from '@auto-files/rpc-apis'
import { config } from '../../config.js'

export const createObjectMappingListener = (): ObjectMappingListener => {
  return {
    start: () => {
      const init = async () => {
        logger.info('Subscribing to object mappings')
        await client.api.subspace_subscribeObjectMappings()

        client.onNotification('subspace_object_mappings', async (event) => {
          logger.info(
            `Processing object mapping (blockNumber=${event.result.v0})`,
          )
          logger.debug(`Object mapping: ${JSON.stringify(event)}`)
          await objectMappingUseCase.processObjectMapping(event.result)
        })
      }

      const client = SubspaceRPCApi.createClient({
        endpoint: config.nodeRpcUrl,
        reconnectInterval: 60_000,
        callbacks: {
          onEveryOpen: init,
          onReconnection: () => {
            logger.warn('Reconnecting to object mapping indexer')
          },
        },
      })
    },
  }
}
