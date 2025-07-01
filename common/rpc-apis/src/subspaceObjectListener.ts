/* eslint-disable camelcase */
import { ObjectMappingListEntry } from '@auto-files/models'
import { z } from 'zod'
import { createApiDefinition, defineUnvalidatedType } from '@autonomys/rpc'

type SubscriptionResult<T> = {
  subscriptionId: string
  result: T
}

const ArchivedSegmentHeaderValidator = z.object({
  v0: z.object({
    segmentIndex: z.number(),
    segmentCommitment: z.string(),
    prevSegmentHeaderHash: z.string(),
    lastArchivedBlock: z.object({
      number: z.number(),
      archivedProgress: z.object({
        partial: z.number(),
      }),
    }),
  }),
})

export const SubspaceRPCApi = createApiDefinition({
  methods: {
    subspace_subscribeObjectMappings: {
      params: defineUnvalidatedType<void>(),
      returns: defineUnvalidatedType<string>(),
    },
    subspace_subscribeArchivedSegmentHeader: {
      params: defineUnvalidatedType<void>(),
      returns: defineUnvalidatedType<string>(),
    },
    subspace_lastSegmentHeaders: {
      params: defineUnvalidatedType<[number]>(),
      returns: z.array(ArchivedSegmentHeaderValidator),
    },
  },
  notifications: {
    subspace_object_mappings: {
      content:
        defineUnvalidatedType<SubscriptionResult<ObjectMappingListEntry>>(),
    },
    subspace_archived_segment_header: {
      content: ArchivedSegmentHeaderValidator,
    },
  },
})
