import { logger } from '../../drivers/logger.js'
import { createSubstrateEventListener } from '../../drivers/substrateEvents.js'
import { ObjectMappingListEntrySchema } from '../../models/mapping.js'
import { objectMappingUseCase } from '../../useCases/objectMapping.js'
import { ObjectMappingListener } from './types.js'

const events: Record<string, (event: unknown) => void> = {
  // eslint-disable-next-line camelcase
  subspace_subscribeObjectMappings: async (event: unknown) => {
    const parsed = ObjectMappingListEntrySchema.safeParse(event)
    if (!parsed.success) {
      logger.error(`Invalid event: ${JSON.stringify(event)}`)
      return
    }
    await objectMappingUseCase.processObjectMapping(parsed.data)
  },
}

export const createObjectMappingListener = (): ObjectMappingListener => {
  return {
    start: () => {
      const substrateListener = createSubstrateEventListener()

      for (const [event, handler] of Object.entries(events)) {
        substrateListener.subscribe(event, handler)
      }
    },
  }
}
