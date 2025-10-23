import {
  createFileCache,
  defaultMemoryAndSqliteConfig,
  ensureDirectoryExists,
  FileCacheOptions,
  FileResponse,
} from '@autonomys/file-server'
import path from 'path'
import { config } from '../config.js'

export const cache = createFileCache(
  defaultMemoryAndSqliteConfig({
    dirname: ensureDirectoryExists(path.join(config.cacheDir, 'files')),
    cacheMaxSize: config.cacheMaxSize,
    cacheTtl: config.cacheTtl,
  }),
)

const cacheWithNamespace = (namespace: string) => {
  return {
    get: (cid: string, options?: FileCacheOptions) =>
      cache.get(`${namespace}:${cid}`, options),
    set: (cid: string, fileResponse: FileResponse) =>
      cache.set(`${namespace}:${cid}`, fileResponse),
    has: (cid: string) => cache.has(`${namespace}:${cid}`),
    remove: (cid: string) => cache.remove(`${namespace}:${cid}`),
  }
}

export const fileCache = cacheWithNamespace('file')
export const nodeCache = cacheWithNamespace('node')
