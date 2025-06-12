import { dsnFetcher } from './dsnFetcher.js'
import { forkStream } from '@autonomys/asynchronous'
import { logger } from '../drivers/logger.js'
import { FileResponse } from '@autonomys/file-caching'
import { cache } from './cache.js'

const get = async (
  cid: string,
  ignoreCache = false,
): Promise<[fromCache: boolean, FileResponse]> => {
  if (!ignoreCache) {
    const cachedFile = await cache.get(cid)
    if (cachedFile) {
      logger.debug(`Cache hit for file ${cid}`)
      return [true, cachedFile]
    }
  }

  let start = performance.now()
  logger.debug(`Fetching file from DSN ${cid}`)
  const file = await dsnFetcher.fetchFile(cid)
  let end = performance.now()
  logger.debug(`Fetching file from DSN ${cid} took ${end - start}ms`)

  start = performance.now()
  const [data, cachingStream] = await forkStream(file.data)
  end = performance.now()
  logger.debug(`Forking file ${cid} took ${end - start}ms`)

  cache
    .set(cid, {
      ...file,
      data: cachingStream,
    })
    .catch((e) => {
      console.error('Error caching file', e)
    })

  return [
    false,
    {
      ...file,
      data,
    },
  ]
}

export const fileComposer = {
  get,
}
