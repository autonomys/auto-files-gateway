import { streamToBuffer } from '@autonomys/asynchronous'
import {
  CompressionAlgorithm,
  IPLDNodeData,
  MetadataType,
} from '@autonomys/auto-dag-data'
import { jest } from '@jest/globals'
import express from 'express'
import { Readable } from 'stream'
import request from 'supertest'
import { deflateSync } from 'zlib'
import { config } from '../src/config.js'
import { logger } from '../src/drivers/logger.js'
import { fileRouter } from '../src/http/controllers/file.js'
import { fileCache } from '../src/services/cache.js'
import { dsnFetcher } from '../src/services/dsnFetcher.js'
import { moderationService } from '../src/services/moderation.js'

const CID = 'bafkr6idz7htrqhks6xyntulrqfyevx3k5qrhptbmgoxlmbss65yi3u25ym'
const CHUNK_SIZE = 1000
const CHUNK_COUNT = 8
const file = Buffer.from(
  Array.from({ length: CHUNK_SIZE * CHUNK_COUNT }, (_, i) => i % 251),
)
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
const chunks = Array.from({ length: CHUNK_COUNT }, (_, i) => ({
  ...indexed,
  cid: `chunk${i}`,
  type: MetadataType.FileChunk,
  size: BigInt(CHUNK_SIZE),
}))

const app = express()
app.use('/files', fileRouter)

const download = (range: string, headers: Record<string, string> = {}) =>
  request(app)
    .get(`/files/${CID}`)
    .set('Authorization', `Bearer ${config.apiSecret}`)
    .set('X-Origin-Control', 'no-cache')
    .set('Range', range)
    .set(headers)
    .buffer(true)
    .parse((res, callback) => {
      const parts: Buffer[] = []
      res.on('data', (data: Buffer) => parts.push(data))
      res.on('end', () => callback(null, Buffer.concat(parts)))
    })

describe('GET /files/:cid with a Range header', () => {
  beforeEach(() => {
    jest.spyOn(moderationService, 'isFileBanned').mockResolvedValue(false)
    jest.spyOn(dsnFetcher, 'fetchNodeMetadata').mockResolvedValue({
      ...indexed,
      cid: CID,
      type: MetadataType.File,
      name: 'file.bin',
      size: BigInt(file.length),
    })
    jest.spyOn(dsnFetcher, 'getFileChunks').mockResolvedValue(chunks)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const mockFetchNode = () =>
    jest.spyOn(dsnFetcher, 'fetchNode').mockImplementation(async (cid) => {
      const i = Number(cid.slice('chunk'.length))
      return {
        Data: IPLDNodeData.encode({
          type: MetadataType.FileChunk,
          linkDepth: 0,
          data: file.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        }),
        Links: [],
      }
    })

  it.each<[string, number, number, number]>([
    ['bytes=0-0', 0, 0, 1],
    ['bytes=1100-1500', 1100, 1500, 1],
    ['bytes=999-1000', 999, 1000, 2],
    ['bytes=1500-', 1500, 7999, 7],
    ['bytes=-10', 7990, 7999, 1],
    ['bytes=7997-9000', 7997, 7999, 1],
  ])(
    'serves %s with 206, fetching only the chunks it covers',
    async (range, start, end, fetches) => {
      const fetchNode = mockFetchNode()

      const response = await download(range)

      expect(response.status).toBe(206)
      expect(response.headers['content-range']).toBe(
        `bytes ${start}-${end}/${file.length}`,
      )
      expect(response.body).toEqual(file.subarray(start, end + 1))
      expect(fetchNode).toHaveBeenCalledTimes(fetches)
    },
  )

  const mockCacheWrites = () => {
    const writes: Promise<Buffer>[] = []
    jest.spyOn(fileCache, 'set').mockImplementation(async (_cid, { data }) => {
      writes.push(streamToBuffer(data))
    })
    return writes
  }

  it.each([
    'bytes=0-',
    `bytes=0-${file.length - 1}`,
    'bytes=0-9000',
    `bytes=-${file.length}`,
  ])('caches the whole file for %s and still answers 206', async (range) => {
    mockFetchNode()
    const writes = mockCacheWrites()
    const fetchFile = jest.spyOn(dsnFetcher, 'fetchFile')

    const response = await download(range)

    expect(response.status).toBe(206)
    expect(response.headers['content-range']).toBe(
      `bytes 0-${file.length - 1}/${file.length}`,
    )
    expect(response.headers['content-length']).toBe(String(file.length))
    expect(response.body).toEqual(file)
    expect(fetchFile).toHaveBeenCalledWith(CID, {
      ignoreCache: true,
      byteRange: undefined,
      signal: expect.any(AbortSignal),
    })
    expect(writes).toHaveLength(1)
    expect(await writes[0]).toEqual(file)
  })

  it.each(['bytes=1-', `bytes=0-${file.length - 2}`])(
    'does not cache %s, which leaves out part of the file',
    async (range) => {
      mockFetchNode()
      const writes = mockCacheWrites()

      const response = await download(range)

      expect(response.status).toBe(206)
      expect(writes).toHaveLength(0)
    },
  )

  it('serves a range covering the whole file from the cache with 206', async () => {
    const fetchNode = mockFetchNode()
    const cacheGet = jest.spyOn(fileCache, 'get').mockResolvedValue({
      data: Readable.from([file]),
      size: BigInt(file.length),
    })

    const response = await download('bytes=0-', {
      'X-Origin-Control': 'cache',
    })

    expect(response.status).toBe(206)
    expect(response.headers['x-file-origin']).toBe('cache')
    expect(response.headers['content-range']).toBe(
      `bytes 0-${file.length - 1}/${file.length}`,
    )
    expect(response.body).toEqual(file)
    expect(cacheGet).toHaveBeenCalledWith(CID, {
      ignoreCache: false,
      byteRange: undefined,
      signal: expect.any(AbortSignal),
    })
    expect(fetchNode).not.toHaveBeenCalled()
  })

  it('still caches the whole file when the client disconnects before the first node arrives', async () => {
    const fetchNode = mockFetchNode()
    const fetchChunk = fetchNode.getMockImplementation()!
    // The controller logs this once it has given up on the client.
    const serverGaveUp = new Promise<void>((resolve) => {
      jest.spyOn(logger, 'error').mockImplementation(async () => resolve())
    })
    fetchNode.mockImplementation(async (cid, siblings, signal, options) => {
      if (cid === 'chunk0') {
        // As the real fetchNode does, give up once the request's signal aborts.
        await new Promise((resolve, reject) => {
          serverGaveUp.then(resolve)
          signal?.addEventListener('abort', () => reject(signal.reason))
        })
      }
      return fetchChunk(cid, siblings, signal, options)
    })
    const writes = mockCacheWrites()

    await expect(
      download('bytes=0-').timeout({ response: 50 }),
    ).rejects.toThrow('Response timeout')

    expect(writes).toHaveLength(1)
    expect(await writes[0]).toEqual(file)
  })

  it('answers 416 for a range starting at the end of the file', async () => {
    const fetchNode = mockFetchNode()

    const response = await download(`bytes=${file.length}-`)

    expect(response.status).toBe(416)
    expect(response.headers['content-range']).toBe(`bytes */${file.length}`)
    expect(fetchNode).not.toHaveBeenCalled()
  })

  it('serves a compressed file whole, ignoring the range', async () => {
    const original = Buffer.from('the quick brown fox '.repeat(100))
    const compressed = deflateSync(original)
    jest.spyOn(dsnFetcher, 'fetchNodeMetadata').mockResolvedValue({
      ...indexed,
      cid: CID,
      type: MetadataType.File,
      name: 'file.txt',
      size: BigInt(compressed.length),
      uploadOptions: { compression: { algorithm: CompressionAlgorithm.ZLIB } },
    })
    jest.spyOn(dsnFetcher, 'isActuallyCompressed').mockResolvedValue(true)
    jest.spyOn(fileCache, 'set').mockResolvedValue()
    const fetchFile = jest
      .spyOn(dsnFetcher, 'fetchFile')
      .mockImplementation(async () => ({ data: Readable.from([compressed]) }))

    const response = await download('bytes=5-10', {
      'Accept-Encoding': 'identity',
    })

    expect(response.status).toBe(200)
    expect(response.body).toEqual(original)
    expect(fetchFile).toHaveBeenCalledWith(CID, {
      ignoreCache: true,
      byteRange: undefined,
      signal: expect.any(AbortSignal),
    })
  })

  it('refuses a banned compressed file before fetching anything from the DSN', async () => {
    jest.spyOn(moderationService, 'isFileBanned').mockResolvedValue(true)
    jest.spyOn(dsnFetcher, 'fetchNodeMetadata').mockResolvedValue({
      ...indexed,
      cid: CID,
      type: MetadataType.File,
      name: 'file.txt',
      size: BigInt(file.length),
      uploadOptions: { compression: { algorithm: CompressionAlgorithm.ZLIB } },
    })
    const fetchNode = mockFetchNode()

    const response = await download(`bytes=${file.length}-`)

    expect(response.status).toBe(451)
    expect(response.headers['content-range']).toBeUndefined()
    expect(fetchNode).not.toHaveBeenCalled()
  })
})
