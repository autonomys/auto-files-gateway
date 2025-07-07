/* eslint-disable camelcase */
import { defineUnvalidatedType, createApiDefinition } from '@autonomys/rpc'
import { ObjectMapping } from '@auto-files/models'

export const ObjectMappingIndexerRPCApi = createApiDefinition({
  methods: {
    // Subscribes to live object mappings
    subscribe_object_mappings: {
      params: defineUnvalidatedType<void>(),
      returns: defineUnvalidatedType<{ subscriptionId: string }>(),
    },
    // Unsubscribes from live object mappings
    unsubscribe_object_mappings: {
      params: defineUnvalidatedType<{ subscriptionId: string }>(),
      returns: defineUnvalidatedType<{ success: boolean }>(),
    },
    // Subscribes to past object mappings
    subscribe_recover_object_mappings: {
      params: defineUnvalidatedType<{ pieceIndex: number; step?: number }>(),
      returns: defineUnvalidatedType<{ subscriptionId: string }>(),
    },
    // Unsubscribes from the recover object mappings
    unsubscribe_recover_object_mappings: {
      params: defineUnvalidatedType<{ subscriptionId: string }>(),
      returns: defineUnvalidatedType<{ success: boolean }>(),
    },
    // Retrieves the object mappings for the given hashes
    get_object_mappings: {
      params: defineUnvalidatedType<{ hashes: string[] }>(),
      returns: defineUnvalidatedType<Array<[string, number, number]>>(),
    },
  },
  notifications: {
    object_mapping_list: {
      content: defineUnvalidatedType<ObjectMapping[]>(),
    },
  },
})
