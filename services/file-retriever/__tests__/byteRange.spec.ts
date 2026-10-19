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
    })
  })
})
