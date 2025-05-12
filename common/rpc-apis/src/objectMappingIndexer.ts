/* eslint-disable camelcase */
import { defineUnvalidatedType, createApiDefinition } from '@autonomys/rpc'
import { z } from 'zod'
import { ObjectMapping } from '@auto-files/models'

export const ObjectMappingIndexerRPCApi = createApiDefinition({
  methods: {
    // Subscribes to live object mappings
    subscribe_object_mappings: {
      params: defineUnvalidatedType<void>(),
      returns: z.object({
        subscriptionId: z.string(),
      }),
    },
    // Unsubscribes from live object mappings
    unsubscribe_object_mappings: {
      params: z.object({
        subscriptionId: z.string(),
      }),
      returns: z.object({
        success: z.boolean(),
      }),
    },
    // Subscribes to past object mappings
    subscribe_recover_object_mappings: {
      params: z.object({
        pieceIndex: z.number(),
        step: z.number().optional(),
      }),
      returns: z.object({
        subscriptionId: z.string(),
      }),
    },
    // Unsubscribes from the recover object mappings
    unsubscribe_recover_object_mappings: {
      params: z.object({
        subscriptionId: z.string(),
      }),
      returns: z.object({
        success: z.boolean(),
      }),
    },
    // Retrieves the object mappings for the given hashes
    get_object_mappings: {
      params: z.object({
        hashes: z.array(z.string()),
      }),
      returns: z.array(z.tuple([z.string(), z.number(), z.number()])),
    },
  },
  notifications: {
    object_mapping_list: {
      content: defineUnvalidatedType<ObjectMapping[]>(),
    },
  },
})
