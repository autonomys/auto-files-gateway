/* eslint-disable camelcase */
import { jest } from '@jest/globals'
import { createMockConnection } from './utils.js'
import { logger } from '../src/drivers/logger.js'
import { objectMappingRouter } from '../src/services/objectMappingRouter/index.js'
import { segmentUseCase } from '../src/useCases/segment.js'
import { SubspaceRPCApi } from '@auto-files/rpc-apis'
import { objectMappingUseCase } from '../src/useCases/objectMapping.js'
import Websocket from 'websocket'
import { ObjectMapping } from '@auto-files/models'
import { config } from '../src/config.js'

let client: ReturnType<typeof SubspaceRPCApi.createMockServerClient> | null =
  null

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
            client?.api.subspace_subscribeArchivedSegmentHeader()
            client?.onNotification(
              'subspace_archived_segment_header',
              async (event: {
                v0: {
                  segmentIndex: number
                  segmentCommitment: string
                  prevSegmentHeaderHash: string
                  lastArchivedBlock: {
                    number: number
                    archivedProgress: { partial: number }
                  }
                }
              }) => {
                const segmentIndex = event.v0.segmentIndex
                logger.info(
                  `Processing archived segment header (segmentIndex=${segmentIndex})`,
                )
                logger.debug(
                  `Archived segment header: ${JSON.stringify(event)}`,
                )

                // Acknowledge receipt of the segment header to the node
                try {
                  await client?.api.subspace_acknowledgeArchivedSegmentHeader([
                    segmentIndex,
                  ])
                } catch (error) {
                  logger.error(
                    `Failed to acknowledge archived segment header (segmentIndex=${segmentIndex}): ${error}`,
                  )
                }

                onArchivedSegmentHeader?.(segmentIndex)
              },
            )
          },
        },
        handlers: {
          subspace_lastSegmentHeaders: async () => [],
          subspace_subscribeObjectMappings: () => '123',
          subspace_subscribeArchivedSegmentHeader: () => '456',
          subspace_acknowledgeArchivedSegmentHeader: () => undefined,
        },
      })
    })
}

jest.mock('../src/config.js', () => ({
  config: {
    objectMappingDistribution: {
      maxObjectsPerMessage: 2,
      timeBetweenMessages: 0,
    },
  },
}))

describe('Object Mapping Router', () => {
  afterEach(async () => {
    // Wait a bit to ensure all async operations are complete
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Clean up the mock client first
    if (client) {
      client.close()
      client = null
    }

    objectMappingRouter.close()
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  it('should be initialized correctly', async () => {
    jest.spyOn(segmentUseCase, 'getLastSegment').mockResolvedValue(-1)
    mockSubscribeToArchivedSegmentHeader()

    await objectMappingRouter.init()

    expect(objectMappingRouter.getState().lastRealtimeSegmentIndex).toBe(-1)
  })

  describe('Event routing', () => {
    it('should call emitObjectMappings when router is initialized', async () => {
      jest.spyOn(segmentUseCase, 'getLastSegment').mockResolvedValue(0)
      const emitObjectMappingsSpy = jest
        .spyOn(objectMappingRouter, 'emitObjectMappings')
        .mockResolvedValue(undefined)
      mockSubscribeToArchivedSegmentHeader()

      await objectMappingRouter.init()
      await new Promise((resolve) => setTimeout(resolve, 1000))
      expect(objectMappingRouter.getState().lastRealtimeSegmentIndex).toBe(0)

      expect(emitObjectMappingsSpy).toHaveBeenCalledWith(0)
    })

    // test for segmentIndex 1 and 3
    for (const segmentIndex of [1, 3]) {
      it(`should call 'emitObjectMappings' when router receives a new segment (segmentIndex=${segmentIndex})`, async () => {
        jest.spyOn(segmentUseCase, 'getLastSegment').mockResolvedValue(0)
        const emitObjectMappingsSpy = jest
          .spyOn(objectMappingRouter, 'emitObjectMappings')
          .mockResolvedValue(undefined)
        mockSubscribeToArchivedSegmentHeader()

        await objectMappingRouter.init()
        await new Promise((resolve) => setTimeout(resolve, 100))

        const connection = createMockConnection()

        client?.notificationClient.subspace_archived_segment_header(
          connection,
          {
            v0: {
              segmentIndex,
              segmentCommitment: '',
              prevSegmentHeaderHash: '',
              lastArchivedBlock: {
                number: 0,
                archivedProgress: {
                  partial: 0,
                },
              },
            },
          },
        )

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(emitObjectMappingsSpy).toHaveBeenCalledWith(segmentIndex)
      })
    }
  })

  describe('emitObjectMappings', () => {
    it('should emit object mappings for the last segment', async () => {
      jest.spyOn(segmentUseCase, 'getLastSegment').mockResolvedValue(0)
      const dispatchObjectMappingsSpy = jest
        .spyOn(objectMappingRouter, 'dispatchObjectMappings')
        .mockResolvedValue(undefined)

      await objectMappingRouter.emitObjectMappings(0)

      expect(dispatchObjectMappingsSpy).not.toHaveBeenCalled()
    })

    it('should emit object mappings for the next segment', async () => {
      jest.spyOn(segmentUseCase, 'getLastSegment').mockResolvedValue(0)
      const dispatchObjectMappingsSpy = jest
        .spyOn(objectMappingRouter, 'dispatchObjectMappings')
        .mockResolvedValue(undefined)

      await objectMappingRouter.emitObjectMappings(1)

      expect(dispatchObjectMappingsSpy).toHaveBeenCalledWith(
        Array.from(
          objectMappingRouter.getState().objectMappingsSubscriptions.entries(),
        ),
        256,
        511,
      )
    })

    it('should emit object mappings for the next two segments', async () => {
      jest.spyOn(segmentUseCase, 'getLastSegment').mockResolvedValue(1)
      const dispatchObjectMappingsSpy = jest
        .spyOn(objectMappingRouter, 'dispatchObjectMappings')
        .mockResolvedValue(undefined)

      await objectMappingRouter.emitObjectMappings(3)

      expect(dispatchObjectMappingsSpy).toHaveBeenCalledWith(
        Array.from(
          objectMappingRouter.getState().objectMappingsSubscriptions.entries(),
        ),
        512,
        1023,
      )
    })
  })

  describe('dispatchObjectMappings', () => {
    it('should not do anything if no connections', async () => {
      const getSpy = jest
        .spyOn(objectMappingUseCase, 'getObjectsAfterObjectWithinLimits')
        .mockResolvedValue([])

      await objectMappingRouter.dispatchObjectMappings([], 1, 10)

      expect(getSpy).not.toHaveBeenCalled()
    })

    it('should not do anything if invalid range', async () => {
      const getSpy = jest
        .spyOn(objectMappingUseCase, 'getObjectsAfterObjectWithinLimits')
        .mockResolvedValue([])

      const connection = createMockConnection(true)
      const connections: [string, Websocket.connection][] = [
        ['sub1', connection],
      ]

      await objectMappingRouter.dispatchObjectMappings(connections, 10, 5)

      expect(getSpy).not.toHaveBeenCalled()
    })

    it('should fetch and send one batch', async () => {
      config.objectMappingDistribution.maxObjectsPerMessage = 3
      const batch: ObjectMapping[] = [
        ['hash1', 1, 100],
        ['hash2', 2, 200],
      ]
      const getSpy = jest
        .spyOn(objectMappingUseCase, 'getObjectsAfterObjectWithinLimits')
        .mockResolvedValueOnce(batch)
        .mockResolvedValueOnce([])

      const connection = createMockConnection(true)
      const connections: [string, Websocket.connection][] = [
        ['sub1', connection],
      ]

      await objectMappingRouter.dispatchObjectMappings(connections, 1, 10)

      expect(getSpy).toHaveBeenCalledTimes(1)
    })

    it('should fetch and send multiple batches', async () => {
      config.objectMappingDistribution.maxObjectsPerMessage = 2
      const batch1: ObjectMapping[] = [
        ['hash1', 1, 100],
        ['hash2', 2, 200],
      ]
      const batch2: ObjectMapping[] = [
        ['hash3', 3, 300],
        ['hash4', 4, 400],
      ]
      const batch3: ObjectMapping[] = [['hash5', 5, 500]]
      const getSpy = jest
        .spyOn(objectMappingUseCase, 'getObjectsAfterObjectWithinLimits')
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce(batch3)
        .mockResolvedValueOnce([])

      const connection = createMockConnection(true)
      const connections: [string, Websocket.connection][] = [
        ['sub1', connection],
      ]

      await objectMappingRouter.dispatchObjectMappings(connections, 1, 10)

      expect(getSpy).toHaveBeenCalledTimes(3)
      expect(getSpy).toHaveBeenNthCalledWith(1, ['', 1, -1], 10, 2)
      expect(getSpy).toHaveBeenNthCalledWith(2, ['hash2', 2, 200], 10, 2)
      expect(getSpy).toHaveBeenNthCalledWith(3, ['hash4', 4, 400], 10, 2)
    })

    it('should unsubscribe disconnected connections', async () => {
      const batch: ObjectMapping[] = [['hash1', 1, 100]]
      jest
        .spyOn(objectMappingUseCase, 'getObjectsAfterObjectWithinLimits')
        .mockResolvedValueOnce(batch)
        .mockResolvedValueOnce([])

      const connection = createMockConnection(false)
      const connections: [string, Websocket.connection][] = [
        ['sub1', connection],
      ]

      const unsubscribeSpy = jest.spyOn(
        objectMappingRouter,
        'unsubscribeObjectMappings',
      )

      await objectMappingRouter.dispatchObjectMappings(connections, 1, 10)

      expect(unsubscribeSpy).toHaveBeenCalledWith('sub1')
    })
  })

  describe('emitRecoverObjectMappings', () => {
    it('should emit object mappings for the interval [pieceIndex, pieceIndex + step]', async () => {
      jest.spyOn(segmentUseCase, 'getLastSegment').mockResolvedValue(10)
      const dispatchObjectMappingsSpy = jest
        .spyOn(objectMappingRouter, 'dispatchObjectMappings')
        .mockResolvedValue(undefined)
      mockSubscribeToArchivedSegmentHeader()

      const connection = createMockConnection(true)
      const subscriptionId = 'sub1'
      const connections: [string, Websocket.connection][] = [
        ['sub1', connection],
      ]

      await objectMappingRouter.init()
      await new Promise((resolve) => setTimeout(resolve, 100))
      // Clear the recovery loop to mock the recovery loop
      const recoveryLoop = objectMappingRouter.getState().recoveryLoop
      if (recoveryLoop) {
        clearTimeout(recoveryLoop)
      }

      // pre-condition: lastRealtimeSegmentIndex is 10
      expect(objectMappingRouter.getState().lastRealtimeSegmentIndex).toBe(10)

      const startingPieceIndex = 0
      const step = 10

      // Initialize the subscription
      objectMappingRouter.subscribeRecoverObjectMappings(
        connection,
        startingPieceIndex,
        step,
        subscriptionId,
      )

      await objectMappingRouter.emitRecoverObjectMappings()

      expect(dispatchObjectMappingsSpy).toHaveBeenCalledWith(
        connections,
        startingPieceIndex,
        startingPieceIndex + step,
      )

      // Clean up any remaining recovery subscriptions
      objectMappingRouter.unsubscribeRecoverObjectMappings(subscriptionId)
    })

    it('should emit object mappings for the interval [pieceIndex, latestArchivedSegmentIndexUpperPieceIndex]', async () => {
      const latestArchivedSegmentIndex = 10
      jest
        .spyOn(segmentUseCase, 'getLastSegment')
        .mockResolvedValue(latestArchivedSegmentIndex)
      const dispatchObjectMappingsSpy = jest
        .spyOn(objectMappingRouter, 'dispatchObjectMappings')
        .mockResolvedValue(undefined)
      mockSubscribeToArchivedSegmentHeader()

      const connection = createMockConnection(true)
      const subscriptionId = 'sub1'
      const connections: [string, Websocket.connection][] = [
        ['sub1', connection],
      ]

      await objectMappingRouter.init()
      await new Promise((resolve) => setTimeout(resolve, 100))
      // Clear the recovery loop to mock the recovery loop
      const recoveryLoop = objectMappingRouter.getState().recoveryLoop
      if (recoveryLoop) {
        clearTimeout(recoveryLoop)
      }

      // pre-condition: lastRealtimeSegmentIndex is 10
      expect(objectMappingRouter.getState().lastRealtimeSegmentIndex).toBe(
        latestArchivedSegmentIndex,
      )

      const startingPieceIndex = 2000
      const step = 1000

      // Initialize the subscription
      objectMappingRouter.subscribeRecoverObjectMappings(
        connection,
        startingPieceIndex,
        step,
        subscriptionId,
      )

      await objectMappingRouter.emitRecoverObjectMappings()

      // capped limit is the last piece index of the latest archived segment
      const cappedLimit = (latestArchivedSegmentIndex + 1) * 256 - 1
      expect(dispatchObjectMappingsSpy).toHaveBeenCalledWith(
        connections,
        startingPieceIndex,
        cappedLimit,
      )

      // expect the subscription to be updated
      expect(
        objectMappingRouter
          .getState()
          .recoverObjectMappingsSubscriptions.get(subscriptionId),
      ).toBeUndefined()
      expect(
        objectMappingRouter
          .getState()
          .objectMappingsSubscriptions.get(subscriptionId),
      ).toBeDefined()
    })
  })
})
