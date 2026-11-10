import { streamToBuffer } from '@autonomys/asynchronous'
import {
  blake3HashFromCid,
  cidOfNode,
  cidToString,
  createFileChunkIpldNode,
  encodeNode,
  MetadataType,
} from '@autonomys/auto-dag-data'
import { FileResponse } from '@autonomys/file-server'
import { ObjectMapping } from '@auto-files/models'
import { jest } from '@jest/globals'
import axios, { AxiosResponse } from 'axios'
import { randomBytes } from 'crypto'
import express from 'express'
import http from 'http'
import { AddressInfo } from 'net'
import { Readable } from 'stream'
import request from 'supertest'
import { config } from '../src/config.js'
import { logger } from '../src/drivers/logger.js'
import { fileRouter } from '../src/http/controllers/file.js'
import { fileCache, nodeCache } from '../src/services/cache.js'
import { dsnFetcher } from '../src/services/dsnFetcher.js'
import { moderationService } from '../src/services/moderation.js'
import { objectMappingIndexer } from '../src/services/objectMappingIndexer.js'

// Large enough that a client that stops reading fills its socket buffers
// long before the whole file has been sent.
const CHUNK_SIZE = 64 * 1000
const CHUNKS_PER_PIECE = 16
const PIECE_COUNT = 4
const CHUNK_COUNT = CHUNKS_PER_PIECE * PIECE_COUNT
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
const mappingByHash = new Map(
  hashes.map((hash, i): [string, ObjectMapping] => [
    hash,
    [hash, Math.floor(i / CHUNKS_PER_PIECE), (i % CHUNKS_PER_PIECE) * 1000],
  ]),
)
const CID = cidToString(
  cidOfNode(createFileChunkIpldNode(Buffer.from('cache fill root'))),
)

const app = express()
app.use('/files', fileRouter)

const download = () =>
  request(app)
    .get(`/files/${CID}`)
    .set('Authorization', `Bearer ${config.apiSecret}`)
    .timeout({ deadline: 4000 })
    .buffer(true)
    .parse((res, callback) => {
      const parts: Buffer[] = []
      res.on('data', (part: Buffer) => parts.push(part))
      res.on('end', () => callback(null, Buffer.concat(parts)))
    })

const cachedFile = async () => {
  const cached = await fileCache.get(CID)
  return cached ? streamToBuffer(cached.data) : null
}

const within = <T>(work: Promise<T>, ms: number) =>
  Promise.race([
    work.then(() => 'settled'),
    new Promise((resolve) => setTimeout(() => resolve('timed out'), ms)),
  ])

describe('GET /files/:cid cache fills', () => {
  let pieceFetches: number
  let dsnReady: Promise<void>
  let cacheWrite: jest.SpiedFunction<typeof fileCache.set>
  const cacheWrites = () =>
    cacheWrite.mock.results.map(({ value }) => value as Promise<void>)

  beforeEach(async () => {
    await fileCache.remove(CID)
    pieceFetches = 0
    dsnReady = Promise.resolve()

    jest.spyOn(moderationService, 'isFileBanned').mockResolvedValue(false)
    jest.spyOn(dsnFetcher, 'fetchNodeMetadata').mockResolvedValue({
      ...indexed,
      cid: CID,
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
      .mockImplementation(async ({ hashes }) =>
        hashes.map((hash) => mappingByHash.get(hash)!),
      )
    jest.spyOn(axios, 'post').mockImplementation(async (_, body) => {
      const { id, params } = body as {
        id: number
        params: { mappings: { v0: { objects: ObjectMapping[] } } }
      }
      pieceFetches++
      await dsnReady
      return {
        status: 200,
        data: {
          jsonrpc: '2.0',
          id,
          result: params.mappings.v0.objects.map(([hash]) =>
            encodedByHash.get(hash)!.toString('hex'),
          ),
        },
      } as AxiosResponse
    })

    const cachedNodes = new Map<string, Promise<Buffer>>()
    jest
      .spyOn(nodeCache, 'has')
      .mockImplementation(async (cid) => cachedNodes.has(cid))
    jest.spyOn(nodeCache, 'get').mockImplementation(async (cid) => {
      const buffer = await cachedNodes.get(cid)
      return buffer ? { data: Readable.from([buffer]) } : null
    })
    jest.spyOn(nodeCache, 'set').mockImplementation(async (cid, { data }) => {
      cachedNodes.set(cid, streamToBuffer(data))
    })

    cacheWrite = jest.spyOn(fileCache, 'set')
  })
  afterEach(async () => {
    await Promise.allSettled(cacheWrites())
    jest.restoreAllMocks()
    await fileCache.remove(CID)
  })

  it('runs one cache fill for concurrent downloads of an uncached file', async () => {
    const downloads = 5
    // The DSN answers once every download has missed the cache, so none of
    // them can find the file already cached.
    let misses = 0
    const getCached = fileCache.get
    dsnReady = new Promise((resolve) => {
      jest.spyOn(fileCache, 'get').mockImplementation(async (...args) => {
        const cached = await getCached(...args)
        if (!cached && ++misses === downloads) {
          resolve()
        }
        return cached
      })
    })

    const responses = await Promise.all(
      Array.from({ length: downloads }, download),
    )

    for (const response of responses) {
      expect(response.status).toBe(200)
      expect(response.body.equals(file)).toBe(true)
    }
    expect(cacheWrite).toHaveBeenCalledTimes(1)
    await cacheWrites()[0]
    expect((await cachedFile())?.equals(file)).toBe(true)
    expect(pieceFetches).toBe(PIECE_COUNT)
  })

  it('fills the cache while a client that stopped reading keeps its connection open', async () => {
    jest.spyOn(logger, 'error').mockResolvedValue()
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const client = http.get({
      host: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      path: `/files/${CID}`,
      headers: { Authorization: `Bearer ${config.apiSecret}` },
      agent: false,
    })

    try {
      const response = await new Promise<http.IncomingMessage>(
        (resolve, reject) => {
          client.once('response', resolve)
          client.once('error', reject)
        },
      )

      expect(cacheWrite).toHaveBeenCalledTimes(1)
      expect(await within(cacheWrites()[0], 2000)).toBe('settled')
      expect((await cachedFile())?.equals(file)).toBe(true)
      expect((await streamToBuffer(response)).equals(file)).toBe(true)
    } finally {
      client.destroy()
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it.each<[string, (cid: string, file: FileResponse) => Promise<void>]>([
    [
      'before reading the file',
      async () => {
        throw new Error('EMFILE: too many open files')
      },
    ],
    [
      'partway through the file',
      async (_cid, { data }) => {
        await new Promise((resolve) => data.once('data', resolve))
        throw new Error('ENOSPC: no space left on device')
      },
    ],
  ])(
    'fills the cache on the next download after a fill fails %s',
    async (_, failingWrite) => {
      jest.spyOn(logger, 'error').mockResolvedValue()
      cacheWrite.mockImplementationOnce(failingWrite)

      const first = await download()

      expect(first.status).toBe(200)
      expect(first.body.equals(file)).toBe(true)
      await expect(cacheWrites()[0]).rejects.toThrow()
      expect(cacheWrite.mock.calls[0][1].data.destroyed).toBe(true)

      const second = await download()

      expect(second.status).toBe(200)
      expect(second.body.equals(file)).toBe(true)
      expect(cacheWrite).toHaveBeenCalledTimes(2)
      await cacheWrites()[1]
      expect((await cachedFile())?.equals(file)).toBe(true)
    },
  )
})
