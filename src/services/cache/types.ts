import { Stream } from 'stream'
import { Keyv } from 'keyv'
export interface BaseCacheConfig {
  targetFilesCount: number
  cacheDir: string
  maxFilesPerDirectory: number
  stores: Keyv[]
}

export interface FileCache {
  get: (cid: string) => Promise<Buffer | Stream | null>
  set: (cid: string, data: Buffer | Stream) => Promise<void>
  remove: (cid: string) => Promise<void>
}
