import { FileResponse } from '../models/file.js'
import { Keyv } from 'keyv'
import { dsnFetcher } from './dsnFetcher.js'
import { createFileCache } from './fileCache/index.js'
import { LRUCache } from 'lru-cache'
import { forkAsyncIterable } from '../utils/stream.js'
import { stringify } from '@autonomys/auto-utils'
import path from 'path'
import KeyvSqlite from '@keyvhq/sqlite'
import { config } from '../config.js'
import { logger } from '../drivers/logger.js'
import { ensureDirectoryExists } from '../utils/fs.js'

const cache = createFileCache({
  cacheDir: ensureDirectoryExists(path.join(config.cacheDir, 'files')),
  pathPartitions: 3,
  stores: [
    new Keyv({
      serialize: stringify,
      store: new LRUCache<string, string>({
        maxSize: config.cacheMaxSize,
        maxEntrySize: Number.MAX_SAFE_INTEGER,
        sizeCalculation: (value) => {
          const { value: parsedValue } = JSON.parse(value)
          return Number(parsedValue?.size ?? 0)
        },
      }),
    }),
    new Keyv({
      store: new KeyvSqlite({
        uri: path.join(ensureDirectoryExists(config.cacheDir), 'files.sqlite'),
      }),
      ttl: config.cacheTtl,
      serialize: stringify,
    }),
  ],
})

const get = async (
  cid: string,
): Promise<[fromCache: boolean, FileResponse]> => {
  const cachedFile = await cache.get(cid)
  if (cachedFile) {
    logger.debug(`Cache hit for file ${cid}`)
    return [true, cachedFile]
  }

  let start = performance.now()
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
