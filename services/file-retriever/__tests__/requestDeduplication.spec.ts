import { jest } from '@jest/globals'
import axios from 'axios'
import {
  MetadataType,
  IPLDNodeData,
  cidOfNode,
  cidToString,
  blake3HashFromCid,
  stringToCid,
  encodeNode,
} from '@autonomys/auto-dag-data'
import { dsnFetcher } from '../src/services/dsnFetcher.js'
import { objectMappingIndexer } from '../src/services/objectMappingIndexer.js'
import { dagIndexerRepository } from '../src/repositories/dag-indexer.js'
import { nodeCache } from '../src/services/cache.js'
import { PBNode } from '@ipld/dag-pb'
import { ObjectMapping } from '@auto-files/models'

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

    // Mock axios.post for Subspace gateway fetches
    jest.spyOn(axios, 'post').mockImplementation(
      async (_url: string, body: unknown) => {
        const payload = body as {
          params?: { mappings?: { v0?: { objects?: ObjectMapping[] } } }
        }
        const objects = payload?.params?.mappings?.v0?.objects ?? []
        const hexNodes = objects.map(([hash]) => {
          if (hash === hash0) {
            return Buffer.from(encodeNode(node0)).toString('hex')
          }
          if (hash === hash1) {
            return Buffer.from(encodeNode(node1)).toString('hex')
          }
          return Buffer.from(encodeNode(node0)).toString('hex')
        })
        return {
          status: 200,
          data: {
            jsonrpc: '2.0',
            id: 1,
            result: hexNodes,
          },
        }
      },
    )
  })

  afterEach(() => {
    dsnFetcher.clearCaches()
    jest.clearAllMocks()
  })

  describe('object mapping deduplication in fetchNode', () => {
    it('should deduplicate concurrent object mapping queries via objectMappingService', async () => {
      let resolveIndexer!: (mappings: ObjectMapping[]) => void
      const indexerPromise = new Promise<ObjectMapping[]>((resolve) => {
        resolveIndexer = resolve
      })

      const indexerSpy = jest
        .spyOn(objectMappingIndexer, 'get_object_mappings')
        .mockReturnValue(indexerPromise)

      jest.spyOn(nodeCache, 'has').mockResolvedValue(false)
      jest.spyOn(nodeCache, 'get').mockResolvedValue(null)
      jest
        .spyOn(nodeCache, 'set')
        .mockResolvedValue(undefined as unknown as void)

      // Concurrent fetchNode calls for the same chunk
      const req1 = dsnFetcher.fetchNode(cid0, [])
      const req2 = dsnFetcher.fetchNode(cid0, [])

      await new Promise((r) => setImmediate(r))

      // The object mapping indexer should only have been called ONCE
      expect(indexerSpy).toHaveBeenCalledTimes(1)

      resolveIndexer([[hash0, 10, 0]])

      const [res1, res2] = await Promise.all([req1, req2])
      expect(Buffer.from(res1.Data!)).toEqual(Buffer.from(node0.Data!))
      expect(Buffer.from(res2.Data!)).toEqual(Buffer.from(node0.Data!))
      expect(indexerSpy).toHaveBeenCalledTimes(1)
    })

    it('should serve subsequent object mapping lookups from cache', async () => {
      const indexerSpy = jest
        .spyOn(objectMappingIndexer, 'get_object_mappings')
        .mockResolvedValue([[hash0, 10, 0]])

      jest.spyOn(nodeCache, 'has').mockResolvedValue(false)
      jest.spyOn(nodeCache, 'get').mockResolvedValue(null)
      jest
        .spyOn(nodeCache, 'set')
        .mockResolvedValue(undefined as unknown as void)

      // First fetch queries indexer
      await dsnFetcher.fetchNode(cid0, [])
      expect(indexerSpy).toHaveBeenCalledTimes(1)

      // Clear nodeCache to force dsnFetcher to look up mappings again
      jest.spyOn(nodeCache, 'has').mockResolvedValue(false)
      jest.spyOn(nodeCache, 'get').mockResolvedValue(null)

      // Second fetch uses cached object mapping without calling indexer again
      await dsnFetcher.fetchNode(cid0, [])
      expect(indexerSpy).toHaveBeenCalledTimes(1)
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
