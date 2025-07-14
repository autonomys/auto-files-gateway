/* eslint-disable camelcase */
import { jest } from '@jest/globals'
import { SubspaceRPCApi } from '@auto-files/rpc-apis'
import { logger } from '../src/drivers/logger.js'
import { createObjectMappingListener } from '../src/services/objectMappingListener/index.js'
import { createMockConnection } from './utils.js'
import { objectMappingUseCase } from '../src/useCases/objectMapping.js'

let client: ReturnType<typeof SubspaceRPCApi.createMockServerClient> | undefined

describe('Object Mapping Listener', () => {
  it('should save received object mappings', async () => {
    jest.spyOn(SubspaceRPCApi, 'createClient').mockImplementation((params) => {
      logger.info(
        'Creating Subspace RPC client (mocked for object mapping listener)',
      )
      logger.info(`Callbacks: onEveryOpen=${!!params.callbacks?.onEveryOpen}`)
      logger.info(
        `Callbacks: onReconnection=${!!params.callbacks?.onReconnection}`,
      )
      client = SubspaceRPCApi.createMockServerClient({
        handlers: {
          subspace_subscribeObjectMappings: () => '123',
          subspace_subscribeArchivedSegmentHeader: () => '456',
          subspace_lastSegmentHeaders: () => [],
        },
        callbacks: {
          onEveryOpen: params.callbacks?.onEveryOpen,
          onReconnection: params.callbacks?.onReconnection,
        },
      })

      return client
    })

    const processObjectMappingSpy = jest.spyOn(
      objectMappingUseCase,
      'processObjectMapping',
    )

    const objectMappingListener = createObjectMappingListener()
    objectMappingListener.start()

    await new Promise((resolve) => setTimeout(resolve, 100))

    if (!client) {
      throw new Error('Client not initialized')
    }

    client.notificationClient.subspace_object_mappings(createMockConnection(), {
      result: {
        v0: {
          objects: [['0x123', 1, 2]],
        },
        blockNumber: 0,
      },
      subscriptionId: '123',
    })

    expect(processObjectMappingSpy).toHaveBeenCalledWith({
      blockNumber: 0,
      v0: {
        objects: [['0x123', 1, 2]],
      },
    })
  })
})
