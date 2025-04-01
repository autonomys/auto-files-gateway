import { ObjectMappingListEntry } from '@auto-files/models'
import { createApiDefinition, defineUnvalidatedType } from '@autonomys/rpc'

export const SubspaceObjectListenerAPI = createApiDefinition({
  methods: {
    subspace_subscribeObjectMappings: {
      params: defineUnvalidatedType<void>(),
      returns: defineUnvalidatedType<string>(),
    },
  },
  notifications: {
    subspace_object_mappings: {
      content: defineUnvalidatedType<ObjectMappingListEntry>(),
    },
  },
})
