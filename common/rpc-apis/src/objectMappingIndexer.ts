import { defineUnvalidatedType, createApiDefinition } from '@autonomys/rpc'
import { z } from 'zod'
import { ObjectMapping } from '@auto-files/models'

export const ObjectMappingIndexerRPCApi = createApiDefinition({
  methods: {
    subscribe_object_mappings: {
      params: defineUnvalidatedType<void>(),
      returns: z.object({
        subscriptionId: z.string(),
      }),
    },
    unsubscribe_object_mappings: {
      params: z.object({
        subscriptionId: z.string(),
      }),
      returns: z.object({
        success: z.boolean(),
      }),
    },
    subscribe_recover_object_mappings: {
      params: z.object({
        pieceIndex: z.number(),
        step: z.number().optional(),
      }),
      returns: z.object({
        subscriptionId: z.string(),
      }),
    },
    unsubscribe_recover_object_mappings: {
      params: z.object({
        subscriptionId: z.string(),
      }),
      returns: z.object({
        success: z.boolean(),
      }),
    },
  },
  notifications: {
    object_mapping_list: {
      content: defineUnvalidatedType<ObjectMapping[]>(),
    },
  },
})
