import { MetadataType } from '@autonomys/auto-dag-data'
import { jest } from '@jest/globals'
import express from 'express'
import { Readable } from 'stream'
import request from 'supertest'
import { config } from '../src/config.js'
import { fileRouter } from '../src/http/controllers/file.js'
import { moderationRouter } from '../src/http/controllers/moderation.js'
import { bannedFilesRepository } from '../src/repositories/banned-files.js'
import { fileCache } from '../src/services/cache.js'
import { dsnFetcher } from '../src/services/dsnFetcher.js'
import { moderationService } from '../src/services/moderation.js'

const CID = 'bafkr6idz7htrqhks6xyntulrqfyevx3k5qrhptbmgoxlmbss65yi3u25ym'

const app = express()
app.use('/files', fileRouter)
app.use('/moderation', moderationRouter)

const get = (path: string, headers: Record<string, string> = {}) =>
  request(app)
    .get(path)
    .set('Authorization', `Bearer ${config.apiSecret}`)
    .set(headers)

describe('banned files', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each<[string, string, Record<string, string>]>([
    ['metadata', `/files/${CID}/metadata`, {}],
    ['download', `/files/${CID}`, {}],
    ['ranged download', `/files/${CID}`, { Range: 'bytes=0-0' }],
    ['partial', `/files/${CID}/partial?chunk=0`, {}],
  ])(
    'refuses the %s route without touching the DSN',
    async (_, path, headers) => {
      jest.spyOn(moderationService, 'isFileBanned').mockResolvedValue(true)
      const dsnCalls = [
        jest.spyOn(dsnFetcher, 'fetchNodeMetadata'),
        jest.spyOn(dsnFetcher, 'getFileChunks'),
        jest.spyOn(dsnFetcher, 'fetchNode'),
        jest.spyOn(dsnFetcher, 'getPartial'),
      ]

      const response = await get(path, headers)

      expect(response.status).toBe(451)
      for (const call of dsnCalls) expect(call).not.toHaveBeenCalled()
    },
  )

  it('still serves metadata for files that are not banned', async () => {
    jest.spyOn(moderationService, 'isFileBanned').mockResolvedValue(false)
    jest.spyOn(dsnFetcher, 'fetchNodeMetadata').mockResolvedValue({
      cid: CID,
      type: MetadataType.File,
      name: 'file.bin',
      size: BigInt(10),
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

    const response = await get(`/files/${CID}/metadata`)

    expect(response.status).toBe(200)
    expect(response.body.name).toBe('file.bin')
  })

  it('removes a file from the cache when it is banned', async () => {
    jest.spyOn(bannedFilesRepository, 'addBannedFile').mockResolvedValue()
    await fileCache.set(CID, {
      data: Readable.from([Buffer.from('file contents')]),
      size: BigInt(13),
    })
    expect(await fileCache.has(CID)).toBe(true)

    const response = await request(app)
      .post(`/moderation/${CID}/ban`)
      .set('Authorization', `Bearer ${config.apiSecret}`)

    expect(response.status).toBe(200)
    expect(await fileCache.has(CID)).toBe(false)
  })
})
