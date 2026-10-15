import { jest } from '@jest/globals'
import {
  ObjectMappingService,
  ObjectMappingIndexerClient,
} from '../src/services/objectMappingService.js'
import { ObjectMapping } from '@auto-files/models'

describe('ObjectMappingService', () => {
  let mockIndexer: {
    get_object_mappings: ReturnType<typeof jest.fn<ObjectMappingIndexerClient['get_object_mappings']>>
  }
  let service: ObjectMappingService

  beforeEach(() => {
    mockIndexer = {
      get_object_mappings: jest.fn<ObjectMappingIndexerClient['get_object_mappings']>(),
    }
    service = new ObjectMappingService(mockIndexer, {
      maxSize: 1000,
      ttl: 60_000,
    })
  })

  afterEach(() => {
    service.clear()
    jest.clearAllMocks()
  })

  it('should return empty array for empty hashes input', async () => {
    const result = await service.getObjectMappings([])
    expect(result).toEqual([])
    expect(mockIndexer.get_object_mappings).not.toHaveBeenCalled()
  })

  it('should fetch mappings from indexer on cache miss and cache them', async () => {
    const mapping1: ObjectMapping = ['hash1', 10, 0]
    const mapping2: ObjectMapping = ['hash2', 10, 100]

    mockIndexer.get_object_mappings.mockResolvedValue([mapping1, mapping2])

    const result1 = await service.getObjectMappings(['hash1', 'hash2'])
    expect(result1).toEqual([mapping1, mapping2])
    expect(mockIndexer.get_object_mappings).toHaveBeenCalledTimes(1)
    expect(mockIndexer.get_object_mappings).toHaveBeenCalledWith({
      hashes: ['hash1', 'hash2'],
    })

    // Second call with same hashes should hit the cache and NOT call the indexer
    const result2 = await service.getObjectMappings(['hash1', 'hash2'])
    expect(result2).toEqual([mapping1, mapping2])
    expect(mockIndexer.get_object_mappings).toHaveBeenCalledTimes(1)
  })

  it('should deduplicate concurrent in-flight requests for the same hashes', async () => {
    const mapping1: ObjectMapping = ['hash1', 42, 50]

    let resolvePromise!: (val: ObjectMapping[]) => void
    const pendingPromise = new Promise<ObjectMapping[]>((resolve) => {
      resolvePromise = resolve
    })
    mockIndexer.get_object_mappings.mockReturnValue(pendingPromise)

    // Trigger two concurrent requests for the same hash before the first settles
    const call1 = service.getObjectMappings(['hash1'])
    const call2 = service.getObjectMappings(['hash1'])

    expect(service.inFlightCount).toBe(1)
    expect(mockIndexer.get_object_mappings).toHaveBeenCalledTimes(1)

    // Resolve the pending fetch
    resolvePromise([mapping1])

    const [res1, res2] = await Promise.all([call1, call2])
    expect(res1).toEqual([mapping1])
    expect(res2).toEqual([mapping1])
    expect(mockIndexer.get_object_mappings).toHaveBeenCalledTimes(1)
    expect(service.inFlightCount).toBe(0)
  })

  it('should coalesce overlapping concurrent requests, fetching only missing hashes', async () => {
    const mapping1: ObjectMapping = ['hash1', 1, 0]
    const mapping2: ObjectMapping = ['hash2', 1, 50]
    const mapping3: ObjectMapping = ['hash3', 2, 0]

    let resolveFirst!: (val: ObjectMapping[]) => void
    const firstPromise = new Promise<ObjectMapping[]>((resolve) => {
      resolveFirst = resolve
    })

    let resolveSecond!: (val: ObjectMapping[]) => void
    const secondPromise = new Promise<ObjectMapping[]>((resolve) => {
      resolveSecond = resolve
    })

    mockIndexer.get_object_mappings
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise)

    // Call 1 requests ['hash1', 'hash2']
    const call1 = service.getObjectMappings(['hash1', 'hash2'])
    expect(mockIndexer.get_object_mappings).toHaveBeenCalledWith({
      hashes: ['hash1', 'hash2'],
    })

    // Call 2 requests ['hash2', 'hash3'] while Call 1 is in-flight
    // 'hash2' is already in-flight, so only 'hash3' should be fetched
    const call2 = service.getObjectMappings(['hash2', 'hash3'])
    expect(mockIndexer.get_object_mappings).toHaveBeenCalledWith({
      hashes: ['hash3'],
    })
    expect(mockIndexer.get_object_mappings).toHaveBeenCalledTimes(2)

    // Settle both fetches
    resolveFirst([mapping1, mapping2])
    resolveSecond([mapping3])

    const [res1, res2] = await Promise.all([call1, call2])
    expect(res1).toEqual([mapping1, mapping2])
    expect(res2).toEqual([mapping2, mapping3])
    expect(service.inFlightCount).toBe(0)
  })

  it('should clean up in-flight entries on error so subsequent requests can retry', async () => {
    mockIndexer.get_object_mappings.mockRejectedValueOnce(
      new Error('Network error connecting to indexer'),
    )

    await expect(service.getObjectMappings(['hashFail'])).rejects.toThrow(
      'Network error connecting to indexer',
    )
    expect(service.inFlightCount).toBe(0)

    // Retry should be allowed and should call indexer again
    const successMapping: ObjectMapping = ['hashFail', 99, 0]
    mockIndexer.get_object_mappings.mockResolvedValueOnce([successMapping])

    const retryResult = await service.getObjectMappings(['hashFail'])
    expect(retryResult).toEqual([successMapping])
    expect(mockIndexer.get_object_mappings).toHaveBeenCalledTimes(2)
  })

  it('should support manual set, has, get, clear, and size inspection', () => {
    const mapping: ObjectMapping = ['manualHash', 5, 20]
    expect(service.has('manualHash')).toBe(false)

    service.set('manualHash', mapping)
    expect(service.has('manualHash')).toBe(true)
    expect(service.get('manualHash')).toEqual(mapping)
    expect(service.size).toBe(1)

    service.clear()
    expect(service.has('manualHash')).toBe(false)
    expect(service.size).toBe(0)
  })
})
