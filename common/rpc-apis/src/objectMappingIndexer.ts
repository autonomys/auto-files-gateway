import { defineUnvalidatedType, createApiDefinition } from '@autonomys/rpc'
import { z } from 'zod'

export const ObjectMappingIndexerRPCApi = createApiDefinition({
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
})
