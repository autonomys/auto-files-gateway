import { logger } from '../../drivers/logger.js'
import { createSubstrateEventListener } from '../../drivers/substrateEvents.js'
import { ObjectMappingListEntrySchema } from '@auto-files/models'
import { objectMappingUseCase } from '../../useCases/objectMapping.js'
import { ObjectMappingListener } from './types.js'
import { SubspaceObjectListenerAPI } from '@auto-files/rpc-apis'
import { config } from '../../config.js'

const events: Record<string, (event: unknown) => void> = {
  subspace_subscribeObjectMappings: async (event: unknown) => {
    const parsed = ObjectMappingListEntrySchema.safeParse(event)
    if (!parsed.success) {
      logger.error(`Invalid event: ${JSON.stringify(event)}`)
      return
    }
    logger.debug(`Processing object mapping: ${JSON.stringify(parsed.data)}`)
    await objectMappingUseCase.processObjectMapping(parsed.data)
  },
}

export const createObjectMappingListener = (): ObjectMappingListener => {
  return {
    start: () => {
      const init = async () => {
        await client.api.subspace_subscribeObjectMappings()

        client.onNotification('subspace_object_mappings', async (event) => {
          await objectMappingUseCase.processObjectMapping(event)
        })
      }

      const client = SubspaceObjectListenerAPI.createClient({
        endpoint: config.nodeRpcUrl,
        callbacks: {
          onOpen: init,
          onReconnection: init,
        },
      })
    },
  }
}
