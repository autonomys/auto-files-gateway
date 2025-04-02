import { ObjectMappingListEntry } from '@auto-files/models'
import { createApiDefinition, defineUnvalidatedType } from '@autonomys/rpc'

type SubscriptionResult<T> = {
  subscriptionId: string
  result: T
}

export const SubspaceObjectListenerAPI = createApiDefinition({
  methods: {
    subspace_subscribeObjectMappings: {
      params: defineUnvalidatedType<void>(),
      returns: defineUnvalidatedType<string>(),
    },
  },
  notifications: {
    subspace_object_mappings: {
      content:
        defineUnvalidatedType<SubscriptionResult<ObjectMappingListEntry>>(),
    },
  },
})
