import {
  blake3HashFromCid,
  cidOfNode,
  cidToString,
  createFileChunkIpldNode,
  encodeNode,
  MetadataType,
} from '@autonomys/auto-dag-data'
import { ByteRange } from '@autonomys/file-server'
import { ObjectMapping } from '@auto-files/models'
import { jest } from '@jest/globals'
import axios, { AxiosResponse } from 'axios'
import { randomBytes } from 'crypto'
import { Readable } from 'stream'
import { nodeCache } from '../src/services/cache.js'
import { dsnFetcher } from '../src/services/dsnFetcher.js'
import { objectMappingIndexer } from '../src/services/objectMappingIndexer.js'

const CHUNK_SIZE = 100
const CHUNK_COUNT = 1000
const CHUNKS_PER_PIECE = 8
const PIECE_COUNT = Math.ceil(CHUNK_COUNT / CHUNKS_PER_PIECE)
const LOOKUP_WINDOW = 64
const file = randomBytes(CHUNK_SIZE * CHUNK_COUNT)
const indexed = {
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

const nodes = Array.from({ length: CHUNK_COUNT }, (_, i) =>
  createFileChunkIpldNode(file.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)),
)
const cids = nodes.map((node) => cidToString(cidOfNode(node)))
const hashes = nodes.map((node) =>
  Buffer.from(blake3HashFromCid(cidOfNode(node))).toString('hex'),
)
const encodedByHash = new Map(
  hashes.map((hash, i) => [hash, Buffer.from(encodeNode(nodes[i]))]),
)
const mappings = hashes.map(
  (hash, i): ObjectMapping => [
    hash,
    Math.floor(i / CHUNKS_PER_PIECE),
    (i % CHUNKS_PER_PIECE) * 1000,
  ],
)
const mappingByHash = new Map(mappings.map((mapping) => [mapping[0], mapping]))

const collect = async (stream: Readable): Promise<Buffer> => {
  const parts: Buffer[] = []
  for await (const part of stream) parts.push(Buffer.from(part))
  return Buffer.concat(parts)
}

describe('object mapping lookups while fetching file nodes', () => {
  let lookups: string[][]
  let fetches: ObjectMapping[][]

  beforeEach(() => {
    lookups = []
    fetches = []
    jest.spyOn(dsnFetcher, 'fetchNodeMetadata').mockResolvedValue({
      ...indexed,
      cid: 'root',
      type: MetadataType.File,
      name: 'file.bin',
      size: BigInt(file.length),
    })
    jest.spyOn(dsnFetcher, 'getFileChunks').mockResolvedValue(
      cids.map((cid) => ({
        ...indexed,
        cid,
        type: MetadataType.FileChunk,
        size: BigInt(CHUNK_SIZE),
      })),
    )
    jest
      .spyOn(objectMappingIndexer, 'get_object_mappings')
      .mockImplementation(async ({ hashes }) => {
        lookups.push(hashes)
        return hashes.map((hash) => mappingByHash.get(hash)!)
      })
    jest.spyOn(axios, 'post').mockImplementation(async (_, body) => {
      const { id, params } = body as {
        id: number
        params: { mappings: { v0: { objects: ObjectMapping[] } } }
      }
      const objects = params.mappings.v0.objects
      fetches.push(objects)
      return {
        status: 200,
        data: {
          jsonrpc: '2.0',
          id,
          result: objects.map(([hash]) =>
            encodedByHash.get(hash)!.toString('hex'),
          ),
        },
      } as AxiosResponse
    })

    const cached = new Map<string, Promise<Buffer>>()
    jest
      .spyOn(nodeCache, 'has')
      .mockImplementation(async (cid) => cached.has(cid))
    jest.spyOn(nodeCache, 'get').mockImplementation(async (cid) => {
      const buffer = await cached.get(cid)
      return buffer ? { data: Readable.from([buffer]) } : null
    })
    jest.spyOn(nodeCache, 'set').mockImplementation(async (cid, { data }) => {
      cached.set(cid, collect(data))
    })
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('looks up only the chunk a single-byte range covers', async () => {
    const { data } = await dsnFetcher.fetchFile('root', { byteRange: [0, 0] })

    expect(await collect(data)).toEqual(file.subarray(0, 1))
    expect(lookups).toEqual([[hashes[0]]])
    expect(fetches).toEqual([[mappings[0]]])
  })

  it.each<[string, ByteRange | undefined, number]>([
    ['the whole file', undefined, 0],
    ['an open-ended range', [CHUNK_SIZE * 100 + 5, undefined], 100],
  ])(
    'looks up a bounded window of chunks for %s and fetches each piece once',
    async (_, byteRange, firstChunk) => {
      const { data } = await dsnFetcher.fetchFile('root', { byteRange })

      expect(await collect(data)).toEqual(file.subarray(byteRange?.[0] ?? 0))
      expect(lookups.length).toBeGreaterThan(0)
      for (const lookup of lookups) {
        const first = hashes.indexOf(lookup[0])
        expect(lookup).toEqual(hashes.slice(first, first + LOOKUP_WINDOW))
      }
      expect(fetches).toHaveLength(
        PIECE_COUNT - Math.floor(firstChunk / CHUNKS_PER_PIECE),
      )
    },
  )

  it('looks up a window starting at the requested chunk for a partial download', async () => {
    const chunk = await dsnFetcher.getPartial('root', 20)

    expect(chunk).toEqual(file.subarray(20 * CHUNK_SIZE, 21 * CHUNK_SIZE))
    expect(lookups).toEqual([hashes.slice(20, 20 + LOOKUP_WINDOW)])
    expect(fetches).toEqual([mappings.slice(20, 3 * CHUNKS_PER_PIECE)])
  })
})
