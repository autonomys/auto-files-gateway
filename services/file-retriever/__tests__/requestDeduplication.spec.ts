import { jest } from '@jest/globals'
import {
  MetadataType,
  IPLDNodeData,
  cidOfNode,
  cidToString,
  blake3HashFromCid,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { dsnFetcher } from '../src/services/dsnFetcher.js'
import { objectMappingService } from '../src/services/objectMappingService.js'
import { dagIndexerRepository } from '../src/repositories/dag-indexer.js'
import { nodeCache } from '../src/services/cache.js'
import { PBNode } from '@ipld/dag-pb'

describe('Request and Mapping Deduplication', () => {
  const node0: PBNode = {
    Data: IPLDNodeData.encode({
      type: MetadataType.File,
      data: Buffer.from('chunk0'),
    }),
    Links: [],
  }
  const cid0 = cidToString(cidOfNode(node0))
  const hash0 = Buffer.from(blake3HashFromCid(stringToCid(cid0))).toString('hex')

  const node1: PBNode = {
    Data: IPLDNodeData.encode({
      type: MetadataType.File,
      data: Buffer.from('chunk1'),
    }),
    Links: [],
  }
  const cid1 = cidToString(cidOfNode(node1))
  const hash1 = Buffer.from(blake3HashFromCid(stringToCid(cid1))).toString('hex')

  beforeEach(() => {
    dsnFetcher.clearCaches()
    jest.clearAllMocks()
  })

  afterEach(() => {
    dsnFetcher.clearCaches()
    jest.clearAllMocks()
  })

  describe('fetchNode deduplication', () => {
    it('should coalesce concurrent fetchNode requests for the same node CID so fetchObjects is called once', async () => {
      jest.spyOn(objectMappingService, 'getObjectMappings').mockResolvedValue([
        [hash0, 10, 0],
      ])

      let resolveFetch!: (nodes: PBNode[]) => void
      const fetchPromise = new Promise<PBNode[]>((resolve) => {
        resolveFetch = resolve
      })

      const fetchObjectsSpy = jest
        .spyOn(dsnFetcher, 'fetchObjects')
        .mockReturnValue(fetchPromise)

      jest.spyOn(nodeCache, 'has').mockResolvedValue(false)
      const nodeCacheSetSpy = jest
        .spyOn(nodeCache, 'set')
        .mockResolvedValue(undefined as unknown as void)

      // Two users trigger download of the same chunk concurrently
      const req1 = dsnFetcher.fetchNode(cid0, [])
      const req2 = dsnFetcher.fetchNode(cid0, [])

      // Allow async pipeline to progress to fetchObjects
      await new Promise((r) => setImmediate(r))

      expect(fetchObjectsSpy).toHaveBeenCalledTimes(1)

      // Resolve the gateway piece fetch
      resolveFetch([node0])

      const [res1, res2] = await Promise.all([req1, req2])
      expect(res1.Data).toEqual(node0.Data)
      expect(res2.Data).toEqual(node0.Data)
      expect(fetchObjectsSpy).toHaveBeenCalledTimes(1)
      expect(nodeCacheSetSpy).toHaveBeenCalled()
    })

    it('should coalesce concurrent fetchNode requests for sibling chunks residing in the same piece', async () => {
      // Both chunks are in piece 42
      jest.spyOn(objectMappingService, 'getObjectMappings').mockResolvedValue([
        [hash0, 42, 0],
        [hash1, 42, 100],
      ])

      let resolveFetch!: (nodes: PBNode[]) => void
      const fetchPromise = new Promise<PBNode[]>((resolve) => {
        resolveFetch = resolve
      })

      const fetchObjectsSpy = jest
        .spyOn(dsnFetcher, 'fetchObjects')
        .mockReturnValue(fetchPromise)

      jest.spyOn(nodeCache, 'has').mockResolvedValue(false)
      jest
        .spyOn(nodeCache, 'set')
        .mockResolvedValue(undefined as unknown as void)

      // User 1 requests chunk 0, User 2 requests chunk 1 (both in piece 42)
      const req1 = dsnFetcher.fetchNode(cid0, [cid1])
      const req2 = dsnFetcher.fetchNode(cid1, [cid0])

      // Allow async pipeline to progress to fetchObjects
      await new Promise((r) => setImmediate(r))

      // Gateway fetchObjects should only be invoked ONCE for the piece
      expect(fetchObjectsSpy).toHaveBeenCalledTimes(1)

      resolveFetch([node0, node1])

      const [res1, res2] = await Promise.all([req1, req2])
      expect(res1.Data).toEqual(node0.Data)
      expect(res2.Data).toEqual(node1.Data)
      expect(fetchObjectsSpy).toHaveBeenCalledTimes(1)
    })

    it('should fetch missing objects when a concurrent request targets an unrelated node in the same piece', async () => {
      jest
        .spyOn(objectMappingService, 'getObjectMappings')
        .mockImplementation(async (hashes) => {
          const result: [string, number, number][] = []
          if (hashes.includes(hash0)) result.push([hash0, 42, 0])
          if (hashes.includes(hash1)) result.push([hash1, 42, 100])
          return result
        })

      let resolveFetch0!: (nodes: PBNode[]) => void
      const fetchPromise0 = new Promise<PBNode[]>((resolve) => {
        resolveFetch0 = resolve
      })

      let resolveFetch1!: (nodes: PBNode[]) => void
      const fetchPromise1 = new Promise<PBNode[]>((resolve) => {
        resolveFetch1 = resolve
      })

      const fetchObjectsSpy = jest
        .spyOn(dsnFetcher, 'fetchObjects')
        .mockReturnValueOnce(fetchPromise0)
        .mockReturnValueOnce(fetchPromise1)

      jest.spyOn(nodeCache, 'has').mockResolvedValue(false)
      jest.spyOn(nodeCache, 'get').mockResolvedValue(null)
      jest
        .spyOn(nodeCache, 'set')
        .mockResolvedValue(undefined as unknown as void)

      // Request 1 only asks for cid0 (no siblings); Request 2 asks for cid1 (no siblings) in the same piece 42
      const req1 = dsnFetcher.fetchNode(cid0, [])
      const req2 = dsnFetcher.fetchNode(cid1, [])

      await new Promise((r) => setImmediate(r))

      expect(fetchObjectsSpy).toHaveBeenCalledTimes(2)

      resolveFetch0([node0])
      resolveFetch1([node1])

      const [res1, res2] = await Promise.all([req1, req2])
      expect(res1.Data).toEqual(node0.Data)
      expect(res2.Data).toEqual(node1.Data)
    })
  })

  describe('getFileChunks and metadata caching', () => {
    it('should cache getFileChunks results to avoid redundant database queries', async () => {
      const fileCid = cid0
      const mockChunks = [
        {
          cid: cid0,
          links: [],
          type: MetadataType.File,
          linkDepth: 0,
          blockHeight: 0,
          blockHash: '',
          extrinsicId: '',
          extrinsicHash: '',
          indexInBlock: 0,
          blake3Hash: '',
          timestamp: new Date(),
        },
      ]

      const getDagNodeSpy = jest
        .spyOn(dagIndexerRepository, 'getDagNode')
        .mockResolvedValue({
          cid: fileCid,
          type: MetadataType.File,
          size: BigInt(1024),
          name: 'test.bin',
          links: [],
          linkDepth: 0,
          blockHeight: 0,
          blockHash: '',
          extrinsicId: '',
          extrinsicHash: '',
          indexInBlock: 0,
          blake3Hash: '',
          timestamp: new Date(),
        })

      const getSortedChunksSpy = jest
        .spyOn(dagIndexerRepository, 'getSortedChunksByCid')
        .mockResolvedValue(mockChunks)

      // First call: queries DB
      const chunks1 = await dsnFetcher.getFileChunks(fileCid)
      expect(chunks1).toEqual(mockChunks)
      expect(getSortedChunksSpy).toHaveBeenCalledTimes(1)

      // Second call: served from memory cache
      const chunks2 = await dsnFetcher.getFileChunks(fileCid)
      expect(chunks2).toEqual(mockChunks)
      expect(getSortedChunksSpy).toHaveBeenCalledTimes(1)
      expect(getDagNodeSpy).toHaveBeenCalledTimes(1)
    })

    it('should cache fetchNodeMetadata results to avoid redundant database queries', async () => {
      const mockMeta = {
        cid: cid0,
        type: MetadataType.File,
        size: BigInt(2048),
        name: 'meta.txt',
        links: [],
        linkDepth: 0,
        blockHeight: 0,
        blockHash: '',
        extrinsicId: '',
        extrinsicHash: '',
        indexInBlock: 0,
        blake3Hash: '',
        timestamp: new Date(),
      }

      const getDagNodeSpy = jest
        .spyOn(dagIndexerRepository, 'getDagNode')
        .mockResolvedValue(mockMeta)

      const meta1 = await dsnFetcher.fetchNodeMetadata(cid0)
      expect(meta1).toEqual(mockMeta)
      expect(getDagNodeSpy).toHaveBeenCalledTimes(1)

      const meta2 = await dsnFetcher.fetchNodeMetadata(cid0)
      expect(meta2).toEqual(mockMeta)
      expect(getDagNodeSpy).toHaveBeenCalledTimes(1)
    })
  })
})
