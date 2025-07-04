import { SubspaceObjectListenerAPI } from '@auto-files/rpc-apis'
import { config } from '../config.js'
import { logger } from '../drivers/logger.js'

const getLastSegment = async () => {
  const client = SubspaceObjectListenerAPI.createHttpClient(
    config.nodeRpcUrl.replace('ws', 'http'),
  )

  const lastSegmentsResult = await client.subspace_lastSegmentHeaders([1])

  if (lastSegmentsResult.length === 0 || lastSegmentsResult[0] === undefined) {
    logger.error(
      `No last segment found: ${lastSegmentsResult ? JSON.stringify(lastSegmentsResult) : '<undefined>'}`,
    )
    throw new Error('No last segment found')
  }

  logger.debug(`Last segment index: ${lastSegmentsResult[0].v0.segmentIndex}`)

  return lastSegmentsResult[0].v0.segmentIndex
}

const subscribeToArchivedSegmentHeader = async (
  onArchivedSegmentHeader?: (segmentIndex: number) => void,
) => {
  const client = SubspaceObjectListenerAPI.createClient({
    endpoint: config.nodeRpcUrl,
    callbacks: {
      onEveryOpen: async () => {
        const lastSegmentIndex = await getLastSegment()
        // emit the last segment index just in case during a reconnection
        // a segment was archived, client should ignore duplicates
        onArchivedSegmentHeader?.(lastSegmentIndex)

        logger.info(
          `Subscribing to archived segment headers (lastSegmentIndex=${lastSegmentIndex})`,
        )
        // triggers a new subscription to archived segment headers
        // ignores subscriptionId and processed events by name
        // using client.onNotification('subspace_archived_segment_header')
        client.api.subspace_subscribeArchivedSegmentHeader()
        client.onNotification('subspace_archived_segment_header', (event) => {
          logger.info(
            `Processing archived segment header (segmentIndex=${event.v0.segmentIndex})`,
          )
          logger.debug(`Archived segment header: ${JSON.stringify(event)}`)
          onArchivedSegmentHeader?.(event.v0.segmentIndex)
        })
      },
    },
  })
}

const getSegmentByPieceIndex = (pieceIndex: number) => {
  const RAW_RECORDS = 128
  const ERASURE_ENCODE_FACTOR = 2
  return Math.floor(pieceIndex / (RAW_RECORDS * ERASURE_ENCODE_FACTOR))
}

const getPieceIndexRangeBySegment = (segmentIndex: number) => {
  const RAW_RECORDS = 128
  const ERASURE_ENCODE_FACTOR = 2
  return [
    segmentIndex * RAW_RECORDS * ERASURE_ENCODE_FACTOR,
    (segmentIndex + 1) * RAW_RECORDS * ERASURE_ENCODE_FACTOR - 1,
  ]
}

export const segmentUseCase = {
  getLastSegment,
  subscribeToArchivedSegmentHeader,
  getSegmentByPieceIndex,
  getPieceIndexRangeBySegment,
}
