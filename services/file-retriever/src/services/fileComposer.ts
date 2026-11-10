import { dsnFetcher } from './dsnFetcher.js'
import { logger } from '../drivers/logger.js'
import { FileCacheOptions, FileResponse } from '@autonomys/file-server'
import { fileCache } from './cache.js'

interface DownloadOptions extends FileCacheOptions {
  ignoreCache?: boolean
  signal?: AbortSignal
}

const fillsInProgress = new Set<string>()

/**
 * Writes the file to the cache from a node stream of its own, so the fill
 * reads at DSN pace rather than a client's and runs to the end after every
 * client has gone. Downloads reading the same nodes share its piece fetches.
 */
const fillCache = (cid: string) => {
  if (fillsInProgress.has(cid)) {
    return
  }
  fillsInProgress.add(cid)

  dsnFetcher
    .fetchFile(cid)
    .then(async (file) => {
      try {
        await fileCache.set(cid, file)
      } catch (error) {
        file.data.destroy()
        throw error
      }
    })
    .catch((error) => {
      logger.error(`Failed to cache file (cid=${cid}): ${error}`)
    })
    .finally(() => fillsInProgress.delete(cid))
}

const get = async (
  cid: string,
  options: DownloadOptions = {},
): Promise<[fromCache: boolean, FileResponse]> => {
  const isPartialRequest = options.byteRange != null

  if (!options.ignoreCache) {
    const cachedFile = await fileCache.get(cid, options)
    if (cachedFile) {
      logger.debug(`Cache hit for file ${cid}`)
      return [true, cachedFile]
    }
  }

  const start = performance.now()
  logger.debug(`Fetching file from DSN ${cid}`)
  const file = await dsnFetcher.fetchFile(cid, options)
  const end = performance.now()
  logger.debug(`Fetching file from DSN ${cid} took ${end - start}ms`)

  // Do not cache partial responses
  if (!isPartialRequest) {
    fillCache(cid)
  }

  return [false, file]
}

export const fileComposer = {
  get,
}
