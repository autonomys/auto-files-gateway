import { streamToBuffer } from '@autonomys/asynchronous'
import { MetadataType } from '@autonomys/auto-dag-data'
import { jest } from '@jest/globals'
import express from 'express'
import { Readable } from 'stream'
import request from 'supertest'
import { config } from '../src/config.js'
import { logger } from '../src/drivers/logger.js'
import { fileRouter } from '../src/http/controllers/file.js'
import { fileCache } from '../src/services/cache.js'
import { dsnFetcher } from '../src/services/dsnFetcher.js'
import { moderationService } from '../src/services/moderation.js'

const CID = 'bafkr6idz7htrqhks6xyntulrqfyevx3k5qrhptbmgoxlmbss65yi3u25ym'
const file = Buffer.from(Array.from({ length: 8000 }, (_, i) => i % 251))
const metadata = {
  cid: CID,
  type: MetadataType.File,
  name: 'file.bin',
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

const app = express()
app.use('/files', fileRouter)

describe('GET /files/:cid caching', () => {
  beforeEach(() => {
    jest.spyOn(moderationService, 'isFileBanned').mockResolvedValue(false)
    jest
      .spyOn(dsnFetcher, 'fetchNodeMetadata')
      .mockResolvedValue({ ...metadata, size: BigInt(file.length) })
  })
  afterEach(async () => {
    jest.restoreAllMocks()
    await fileCache.remove(CID)
  })

  it.each([
    ['before the first byte', 0],
    ['partway through', file.length / 2],
  ])(
    'caches the whole file when the client disconnects %s',
    async (_, bytesSentBeforeDisconnect) => {
      // The controller logs this once it has given up on the client.
      const serverGaveUp = new Promise<void>((resolve) => {
        jest.spyOn(logger, 'error').mockImplementation(async () => resolve())
      })
      jest.spyOn(dsnFetcher, 'fetchFile').mockImplementation(async () => ({
        data: Readable.from(
          (async function* () {
            if (bytesSentBeforeDisconnect > 0) {
              yield file.subarray(0, bytesSentBeforeDisconnect)
            }
            await serverGaveUp
            yield file.subarray(bytesSentBeforeDisconnect)
          })(),
        ),
        size: BigInt(file.length),
      }))
      const cacheWrite = jest.spyOn(fileCache, 'set')

      await expect(
        request(app)
          .get(`/files/${CID}`)
          .set('Authorization', `Bearer ${config.apiSecret}`)
          .set('X-Origin-Control', 'no-cache')
          .timeout({ deadline: 50 }),
      ).rejects.toThrow('Timeout of 50ms exceeded')

      expect(cacheWrite).toHaveBeenCalledTimes(1)
      await cacheWrite.mock.results[0].value
      const cached = await fileCache.get(CID)
      expect(await streamToBuffer(cached!.data)).toEqual(file)
    },
  )

  it.each([
    ['bytes=0-', 206],
    ['none', 200],
  ])(
    'serves the whole file when the cache write fails before reading it (Range: %s)',
    async (range, status) => {
      // More than the fork's buffers hold, so an unread cache branch stalls it
      const chunkSize = 64 * 1024
      const large = Buffer.alloc(16 * chunkSize, 7)
      jest
        .spyOn(dsnFetcher, 'fetchNodeMetadata')
        .mockResolvedValue({ ...metadata, size: BigInt(large.length) })
      jest.spyOn(dsnFetcher, 'fetchFile').mockImplementation(async () => ({
        data: Readable.from(
          Array.from({ length: 16 }, (_, i) =>
            large.subarray(i * chunkSize, (i + 1) * chunkSize),
          ),
        ),
        size: BigInt(large.length),
      }))
      jest
        .spyOn(fileCache, 'set')
        .mockRejectedValue(new Error('EMFILE: too many open files'))
      jest.spyOn(console, 'error').mockImplementation(() => {})

      const response = await request(app)
        .get(`/files/${CID}`)
        .set('Authorization', `Bearer ${config.apiSecret}`)
        .set('X-Origin-Control', 'no-cache')
        .set(range === 'none' ? {} : { Range: range })
        .timeout({ deadline: 2000 })
        .buffer(true)
        .parse((res, callback) => {
          const parts: Buffer[] = []
          res.on('data', (part: Buffer) => parts.push(part))
          res.on('end', () => callback(null, Buffer.concat(parts)))
        })

      expect(response.status).toBe(status)
      expect(response.body.equals(large)).toBe(true)
    },
  )
})
