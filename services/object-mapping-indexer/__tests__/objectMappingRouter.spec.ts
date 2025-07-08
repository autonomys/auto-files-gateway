/* eslint-disable camelcase */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest } from '@jest/globals'
import { createMockConnection } from './utils.js'
import { logger } from '../src/drivers/logger.js'
import { objectMappingRouter } from '../src/services/objectMappingRouter/index.js'
import { segmentUseCase } from '../src/useCases/segment.js'
import { SubspaceRPCApi } from '@auto-files/rpc-apis'
import { objectMappingUseCase } from '../src/useCases/objectMapping.js'
import { config } from '../src/config.js'
import { ObjectMapping } from '@auto-files/models'

let client: ReturnType<typeof SubspaceRPCApi.createMockServerClient>

const mockSubscribeToArchivedSegmentHeader = () => {
  jest
    .spyOn(segmentUseCase, 'subscribeToArchivedSegmentHeader')
    .mockImplementation(async (onArchivedSegmentHeader) => {
      client = SubspaceRPCApi.createMockServerClient({
        callbacks: {
          onEveryOpen: async () => {
            const lastSegmentIndex = await segmentUseCase.getLastSegment()
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
            client.onNotification(
              'subspace_archived_segment_header',
              (event) => {
                logger.info(
                  `Processing archived segment header (segmentIndex=${event.v0.segmentIndex})`,
                )
                logger.debug(
                  `Archived segment header: ${JSON.stringify(event)}`,
                )
                onArchivedSegmentHeader?.(event.v0.segmentIndex)
              },
            )
          },
        },
        handlers: {
          subspace_lastSegmentHeaders: async () => [],
          subspace_subscribeObjectMappings: () => '123',
          subspace_subscribeArchivedSegmentHeader: () => '456',
        },
      })
    })
}

jest.mock('../src/rpc/server.js', () => ({
  server: { notificationClient: { object_mapping_list: jest.fn() } },
}))

describe('Object Mapping Router', () => {
  afterEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    objectMappingRouter.close()
  })

  it('should be initialized correctly', async () => {
    jest.spyOn(segmentUseCase, 'getLastSegment').mockResolvedValue(-1)
    mockSubscribeToArchivedSegmentHeader()

    await objectMappingRouter.init()

    expect(objectMappingRouter.getState().lastRealtimeSegmentIndex).toBe(-1)
  })

  it('should fetch object mappings for last segment', async () => {
    jest.spyOn(segmentUseCase, 'getLastSegment').mockResolvedValue(-1)
    const dispatchObjectsSpy = jest
      .spyOn(objectMappingRouter, 'dispatchObjectMappings')
      .mockResolvedValue(undefined)
    mockSubscribeToArchivedSegmentHeader()

    await objectMappingRouter.init()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(objectMappingRouter.getState().lastRealtimeSegmentIndex).toBe(-1)

    const connection = createMockConnection()

    client.notificationClient.subspace_archived_segment_header(connection, {
      v0: {
        segmentIndex: 0,
        segmentCommitment: '0x123',
        prevSegmentHeaderHash: '0x456',
        lastArchivedBlock: {
          number: 0,
          archivedProgress: { partial: 0 },
        },
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(objectMappingRouter.getState().lastRealtimeSegmentIndex).toBe(0)
    expect(dispatchObjectsSpy).toHaveBeenCalledWith([], 0, 255)
  })

  it('should fetch object mappings for last two segments when event is missed', async () => {
    jest.spyOn(segmentUseCase, 'getLastSegment').mockResolvedValue(-1)
    const dispatchObjectsSpy = jest
      .spyOn(objectMappingRouter, 'dispatchObjectMappings')
      .mockResolvedValue(undefined)
    mockSubscribeToArchivedSegmentHeader()

    await objectMappingRouter.init()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(objectMappingRouter.getState().lastRealtimeSegmentIndex).toBe(-1)

    const connection = createMockConnection()

    client.notificationClient.subspace_archived_segment_header(connection, {
      v0: {
        segmentIndex: 1,
        segmentCommitment: '0x123',
        prevSegmentHeaderHash: '0x456',
        lastArchivedBlock: {
          number: 0,
          archivedProgress: { partial: 0 },
        },
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(objectMappingRouter.getState().lastRealtimeSegmentIndex).toBe(1)
    expect(dispatchObjectsSpy).toHaveBeenCalledWith([], 0, 511)
  })

  it('should dispatch object mappings respecting the limit', async () => {
    jest.spyOn(segmentUseCase, 'getLastSegment').mockResolvedValue(-1)
    const objectMappings: ObjectMapping[] = Array.from(
      { length: config.objectMappingDistribution.maxObjectsPerMessage },
      (_, i) => [`0x${i.toString(16).padStart(64, '0')}`, i, i],
    )
    mockSubscribeToArchivedSegmentHeader()

    const getObjectsAfterObjectWithinLimitsSpy = jest
      .spyOn(objectMappingUseCase, 'getObjectsAfterObjectWithinLimits')
      .mockImplementation(async (objectMapping, endPieceIndex, limit) => {
        if (objectMapping[1] === 0 && objectMapping[2] === -1) {
          return objectMappings.slice(0, limit)
        }
        return []
      })

    await objectMappingRouter.init()

    await objectMappingRouter.dispatchObjectMappings(
      [['123', createMockConnection()]],
      0,
      1000,
    )

    expect(getObjectsAfterObjectWithinLimitsSpy).toHaveBeenCalledWith(
      [expect.any(String), 0, -1],
      1000,
      config.objectMappingDistribution.maxObjectsPerMessage,
    )
    expect(getObjectsAfterObjectWithinLimitsSpy).toHaveBeenCalledWith(
      [
        expect.any(String),
        objectMappings.length - 1,
        objectMappings.length - 1,
      ],
      1000,
      config.objectMappingDistribution.maxObjectsPerMessage,
    )
  })
})
