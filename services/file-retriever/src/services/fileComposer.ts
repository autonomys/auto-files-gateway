import { dsnFetcher } from './dsnFetcher.js'
import { forkStream } from '@autonomys/asynchronous'
import { logger } from '../drivers/logger.js'
import { FileCacheOptions, FileResponse } from '@autonomys/file-server'
import { fileCache } from './cache.js'

interface DownloadOptions extends FileCacheOptions {
  ignoreCache?: boolean
  signal?: AbortSignal
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

  let start = performance.now()
  logger.debug(`Fetching file from DSN ${cid}`)
  const file = await dsnFetcher.fetchFile(cid, options)
  let end = performance.now()
  logger.debug(`Fetching file from DSN ${cid} took ${end - start}ms`)

  // Do not cache partial responses unless the range covers the entire file
  // (e.g. `Range: bytes=0-` resolving to `[0, size - 1]`), which fetches all bytes
  // from the DSN and should populate the cache while still returning 206 to the client (#199).
  const byteRange = options.byteRange
  const isFullFetch =
    byteRange == null ||
    (byteRange[0] === 0 &&
      (byteRange[1] == null ||
        (file.size != null &&
          BigInt(byteRange[1]) === BigInt(file.size) - 1n)))

  if (!isFullFetch) {
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
