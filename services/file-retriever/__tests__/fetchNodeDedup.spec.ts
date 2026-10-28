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
