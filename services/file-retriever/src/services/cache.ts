import {
  createFileCache,
  defaultMemoryAndSqliteConfig,
  ensureDirectoryExists,
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
