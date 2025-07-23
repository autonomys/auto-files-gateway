import {
  createFileCache,
  defaultMemoryAndSqliteConfig,
  ensureDirectoryExists,
  FileResponse,
} from '@autonomys/file-caching'
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
    get: (cid: string) => cache.get(`${namespace}:${cid}`),
    set: (cid: string, fileResponse: FileResponse) =>
      cache.set(`${namespace}:${cid}`, fileResponse),
    has: (cid: string) => cache.has(`${namespace}:${cid}`),
    remove: (cid: string) => cache.remove(`${namespace}:${cid}`),
  }
}

export const fileCache = cacheWithNamespace('file')
export const nodeCache = cacheWithNamespace('node')
