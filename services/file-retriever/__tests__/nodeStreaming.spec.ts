import { IPLDNodeData, MetadataType } from '@autonomys/auto-dag-data'
import { ByteRange } from '@autonomys/file-server'
import { jest } from '@jest/globals'
import express from 'express'
import { Readable } from 'stream'
import request from 'supertest'
import { config } from '../src/config.js'
import { fileRouter } from '../src/http/controllers/file.js'
import { fileCache } from '../src/services/cache.js'
import { dsnFetcher } from '../src/services/dsnFetcher.js'
import { moderationService } from '../src/services/moderation.js'

// Real nodes hold about 64 KB, so each stream buffer along the way holds about
// one of them.
const CHUNK_SIZE = 64 * 1024
const CHUNK_COUNT = 50
const file = Buffer.alloc(CHUNK_SIZE * CHUNK_COUNT)
for (let i = 0; i < file.length; i++) file[i] = i % 251
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

const collect = async (stream: Readable): Promise<Buffer> => {
  const parts: Buffer[] = []
  for await (const part of stream) parts.push(Buffer.from(part))
  return Buffer.concat(parts)
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('streaming file nodes from the DSN', () => {
  let fetchNode: ReturnType<typeof jest.spyOn>

  beforeEach(() => {
    jest.spyOn(dsnFetcher, 'fetchNodeMetadata').mockResolvedValue({
      ...indexed,
      cid: 'root',
      type: MetadataType.File,
      name: 'file.bin',
      size: BigInt(file.length),
    })
    jest.spyOn(dsnFetcher, 'getFileChunks').mockResolvedValue(
      Array.from({ length: CHUNK_COUNT }, (_, i) => ({
        ...indexed,
        cid: `chunk${i}`,
        type: MetadataType.FileChunk,
        size: BigInt(CHUNK_SIZE),
      })),
    )
    fetchNode = jest
      .spyOn(dsnFetcher, 'fetchNode')
      .mockImplementation(async (cid) => {
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
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each<[string, ByteRange | undefined]>([
    ['the whole file', undefined],
    ['an open-ended range', [0, undefined]],
  ])('fetches nodes for %s only as the client reads', async (_, byteRange) => {
    const { data } = await dsnFetcher.fetchFile('root', { byteRange })
    await settle()

    expect(fetchNode.mock.calls.length).toBeLessThan(5)
    expect((await collect(data)).equals(file)).toBe(true)
    expect(fetchNode).toHaveBeenCalledTimes(CHUNK_COUNT)
  })

  it('stops fetching nodes when the client goes away', async () => {
    const { data } = await dsnFetcher.fetchFile('root', {
      byteRange: [0, undefined],
    })

    for await (const part of data) {
      expect(part.length).toBeGreaterThan(0)
      break
    }
    await settle()

    expect(fetchNode.mock.calls.length).toBeLessThan(5)
  })

  it('serves the whole file through the download route while caching it', async () => {
    jest.spyOn(moderationService, 'isFileBanned').mockResolvedValue(false)
    const cached: Buffer[] = []
    jest.spyOn(fileCache, 'set').mockImplementation(async (_, response) => {
      cached.push(await collect(response.data))
    })
    const app = express()
    app.use('/files', fileRouter)

    const response = await request(app)
      .get('/files/bafkr6idz7htrqhks6xyntulrqfyevx3k5qrhptbmgoxlmbss65yi3u25ym')
      .set('Authorization', `Bearer ${config.apiSecret}`)
      .set('X-Origin-Control', 'no-cache')
      .buffer(true)
      .parse((res, callback) => {
        const parts: Buffer[] = []
        res.on('data', (part: Buffer) => parts.push(part))
        res.on('end', () => callback(null, Buffer.concat(parts)))
      })

    expect(response.status).toBe(200)
    expect((response.body as Buffer).equals(file)).toBe(true)
    expect(cached).toHaveLength(1)
    expect(cached[0].equals(file)).toBe(true)
  })
})
