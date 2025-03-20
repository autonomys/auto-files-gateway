import { logger } from '../../drivers/logger.js'
import { createSubstrateEventListener } from '../../drivers/substrateEvents.js'
import { ObjectMappingListEntrySchema } from '../../models/mapping.js'
import { objectMappingUseCase } from '../../useCases/objectMapping.js'
import { ObjectMappingListener } from './types.js'

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
      const reboot = async () => {
        substrateListener.wipe()
        for (const [event, handler] of Object.entries(events)) {
          substrateListener.subscribe(event, handler)
        }
      }

      const substrateListener = createSubstrateEventListener({
        onReconnection: reboot,
      })

      reboot()
    },
  }
}
