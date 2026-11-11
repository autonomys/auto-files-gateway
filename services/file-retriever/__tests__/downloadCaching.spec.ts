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

const app = express()
app.use('/files', fileRouter)

describe('GET /files/:cid caching', () => {
  beforeEach(() => {
    jest.spyOn(moderationService, 'isFileBanned').mockResolvedValue(false)
    jest.spyOn(dsnFetcher, 'fetchNodeMetadata').mockResolvedValue({
      cid: CID,
      type: MetadataType.File,
      name: 'file.bin',
      size: BigInt(file.length),
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

  it('caches the whole file and returns 206 Partial Content when requested with a full-span range (bytes=0-)', async () => {
    jest.spyOn(dsnFetcher, 'fetchFile').mockImplementation(async () => ({
      data: Readable.from(file),
      size: BigInt(file.length),
    }))
    const cacheWrite = jest.spyOn(fileCache, 'set')

    const res = await request(app)
      .get(`/files/${CID}`)
      .set('Authorization', `Bearer ${config.apiSecret}`)
      .set('Range', 'bytes=0-')

    expect(res.status).toBe(206)
    expect(res.headers['content-range']).toBe(
      `bytes 0-${file.length - 1}/${file.length}`,
    )
    expect(cacheWrite).toHaveBeenCalledTimes(1)
    await cacheWrite.mock.results[0].value
    const cached = await fileCache.get(CID)
    expect(await streamToBuffer(cached!.data)).toEqual(file)
  })

  it('does not cache when range is genuinely partial (e.g. bytes=0-100)', async () => {
    jest.spyOn(dsnFetcher, 'fetchFile').mockImplementation(async () => ({
      data: Readable.from(file.subarray(0, 101)),
      size: BigInt(file.length),
    }))
    const cacheWrite = jest.spyOn(fileCache, 'set')

    const res = await request(app)
      .get(`/files/${CID}`)
      .set('Authorization', `Bearer ${config.apiSecret}`)
      .set('Range', 'bytes=0-100')

    expect(res.status).toBe(206)
    expect(res.headers['content-range']).toBe(`bytes 0-100/${file.length}`)
    expect(cacheWrite).not.toHaveBeenCalled()
  })
})
