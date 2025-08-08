import { dsnFetcher } from './dsnFetcher.js'
import { forkStream } from '@autonomys/asynchronous'
import { logger } from '../drivers/logger.js'
import { FileCacheOptions, FileResponse } from '@autonomys/file-caching'
import { fileCache } from './cache.js'
import { moderationService } from './moderation.js'
import { HttpError } from '../http/middlewares/error.js'

interface DownloadOptions extends FileCacheOptions {
  ignoreCache?: boolean
}

const get = async (
  cid: string,
  options: DownloadOptions = {},
): Promise<[fromCache: boolean, FileResponse]> => {
  const isPartialRequest = options.byteRange != null
  const isBanned = await moderationService.isFileBanned(cid)
  if (isBanned) {
    logger.warn(`File download blocked: ${cid}`)
    throw new HttpError(451, 'Unavailable for legal reasons')
  }

  if (!options.ignoreCache) {
    const cachedFile = await fileCache.get(cid, options)
    if (cachedFile) {
      logger.debug(`Cache hit for file ${cid}`)
      return [true, cachedFile]
    }
  }

  let start = performance.now()
  logger.debug(`Fetching file from DSN ${cid}`)
  const file = await dsnFetcher.fetchFile(cid, options)
  let end = performance.now()
  logger.debug(`Fetching file from DSN ${cid} took ${end - start}ms`)

  // Do not cache partial responses
  if (isPartialRequest) {
    return [false, file]
  }

  start = performance.now()
  const [data, cachingStream] = await forkStream(file.data)
  end = performance.now()
  logger.debug(`Forking file ${cid} took ${end - start}ms`)

  fileCache
    .set(cid, {
      ...file,
      data: cachingStream,
    })
    .catch((e) => {
      console.error('Error caching file', e)
    })

  return [false, { ...file, data }]
}

export const fileComposer = {
  get,
}
