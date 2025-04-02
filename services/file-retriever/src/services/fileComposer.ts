import { FileResponse } from '../models/file.js'
import { dsnFetcher } from './dsnFetcher.js'
import { forkAsyncIterable } from '../utils/stream.js'
import { logger } from '../drivers/logger.js'
import {
  createFileCache,
  defaultMemoryAndSqliteConfig,
  ensureDirectoryExists,
} from '@autonomys/file-caching'
import path from 'path'
import { config } from '../config.js'

const cache = createFileCache(
  defaultMemoryAndSqliteConfig({
    dirname: ensureDirectoryExists(path.join(config.cacheDir, 'files')),
    cacheMaxSize: config.cacheMaxSize,
    cacheTtl: config.cacheTtl,
  }),
)

const get = async (
  cid: string,
): Promise<[fromCache: boolean, FileResponse]> => {
  const cachedFile = await cache.get(cid)
  if (cachedFile) {
    logger.debug(`Cache hit for file ${cid}`)
    return [true, cachedFile]
  }

  let start = performance.now()
  logger.debug(`Fetching file from DSN ${cid}`)
  const file = await dsnFetcher.fetchFile(cid)
  let end = performance.now()
  logger.debug(`Fetching file from DSN ${cid} took ${end - start}ms`)

  start = performance.now()
  const [data, cachingStream] = await forkAsyncIterable(file.data)
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
