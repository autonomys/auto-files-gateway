import { jest } from '@jest/globals'
import { dsnFetcher } from '../src/services/dsnFetcher.js'
import { nodeCache } from '../src/services/cache.js'
import { objectMappingIndexer } from '../src/services/objectMappingIndexer.js'

const CID = 'bafkr6idz7htrqhks6xyntulrqfyevx3k5qrhptbmgoxlmbss65yi3u25ym'

const deferred = <T>() => {
  let reject!: (error: Error) => void
  const promise = new Promise<T>((_, rej) => {
    reject = rej
  })
  return { promise, reject }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

describe('fetchNode in-flight deduplication', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('shares one fetch between concurrent callers for the same cid', async () => {
    jest.spyOn(nodeCache, 'has').mockResolvedValue(false)
    const lookup = deferred<never>()
    const getMappings = jest
      .spyOn(objectMappingIndexer, 'get_object_mappings')
      .mockReturnValue(lookup.promise)

    const first = dsnFetcher.fetchNode(CID, [CID])
    const second = dsnFetcher.fetchNode(CID, [CID])
    await settle()

    expect(getMappings).toHaveBeenCalledTimes(1)

    const failure = new Error('indexer unavailable')
    lookup.reject(failure)

    await expect(first).rejects.toBe(failure)
    await expect(second).rejects.toBe(failure)
  })

  it('starts a fresh fetch for a caller arriving after the join window', async () => {
    // A client retrying after a stall must not join the stalled retry chain.
    let clock = 1_000
    jest.spyOn(performance, 'now').mockImplementation(() => clock)
    jest.spyOn(nodeCache, 'has').mockResolvedValue(false)
    const stalled = deferred<never>()
    const fresh = deferred<never>()
    const getMappings = jest
      .spyOn(objectMappingIndexer, 'get_object_mappings')
      // Without a default, a call past the planned ones falls through to the
      // real indexer client and makes a network request.
      .mockRejectedValue(new Error('unexpected extra fetch'))
      .mockReturnValueOnce(stalled.promise)
      .mockReturnValueOnce(fresh.promise)

    const original = dsnFetcher.fetchNode(CID, [CID])
    await settle()

    clock += 60_000
    const retry = dsnFetcher.fetchNode(CID, [CID])
    await settle()

    expect(getMappings).toHaveBeenCalledTimes(2)

    stalled.reject(new Error('stalled'))
    fresh.reject(new Error('fresh'))
    await expect(original).rejects.toThrow('stalled')
    await expect(retry).rejects.toThrow('fresh')
  })

  it('does not let a superseded fetch evict the one that replaced it', async () => {
    let clock = 1_000
    jest.spyOn(performance, 'now').mockImplementation(() => clock)
    jest.spyOn(nodeCache, 'has').mockResolvedValue(false)
    const stalled = deferred<never>()
    const fresh = deferred<never>()
    const getMappings = jest
      .spyOn(objectMappingIndexer, 'get_object_mappings')
      // Without a default, a call past the planned ones falls through to the
      // real indexer client and makes a network request.
      .mockRejectedValue(new Error('unexpected extra fetch'))
      .mockReturnValueOnce(stalled.promise)
      .mockReturnValueOnce(fresh.promise)

    const original = dsnFetcher.fetchNode(CID, [CID])
    await settle()
    clock += 60_000
    const retry = dsnFetcher.fetchNode(CID, [CID])
    await settle()

    stalled.reject(new Error('stalled'))
    await expect(original).rejects.toThrow('stalled')

    clock += 100
    const joiner = dsnFetcher.fetchNode(CID, [CID])
    await settle()

    expect(getMappings).toHaveBeenCalledTimes(2)

    fresh.reject(new Error('fresh'))
    await expect(retry).rejects.toThrow('fresh')
    await expect(joiner).rejects.toThrow('fresh')
  })

  it('does not leave a failed fetch behind to poison later requests', async () => {
    jest.spyOn(nodeCache, 'has').mockResolvedValue(false)
    const getMappings = jest
      .spyOn(objectMappingIndexer, 'get_object_mappings')
      .mockRejectedValue(new Error('indexer unavailable'))

    await expect(dsnFetcher.fetchNode(CID, [CID])).rejects.toThrow()
    await expect(dsnFetcher.fetchNode(CID, [CID])).rejects.toThrow()

    expect(getMappings).toHaveBeenCalledTimes(2)
  })
})
