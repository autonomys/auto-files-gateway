/* eslint-disable camelcase */
import { ObjectMappingListEntry } from '@auto-files/models'
import { createApiDefinition, defineUnvalidatedType } from '@autonomys/rpc'

type SubscriptionResult<T> = {
  subscriptionId: string
  result: T
}

type ArchivedSegmentHeader = {
  v0: {
    segmentIndex: number
    segmentCommitment: string
    prevSegmentHeaderHash: string
    lastArchivedBlock: {
      number: number
      archivedProgress: { partial: number }
    }
  }
}

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
      returns: defineUnvalidatedType<ArchivedSegmentHeader[]>(),
    },
    subspace_acknowledgeArchivedSegmentHeader: {
      params: defineUnvalidatedType<[number]>(),
      returns: defineUnvalidatedType<void>(),
    },
  },
  notifications: {
    subspace_object_mappings: {
      content:
        defineUnvalidatedType<SubscriptionResult<ObjectMappingListEntry>>(),
    },
    subspace_archived_segment_header: {
      content: defineUnvalidatedType<ArchivedSegmentHeader>(),
    },
  },
})
