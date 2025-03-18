import { Stream } from 'stream'
import { Keyv } from 'keyv'
import { FileResponse } from '../../models/file.js'

export interface BaseCacheConfig {
  pathPartitions: number
  cacheDir: string
  stores: Keyv<FileResponse>[]
}

export interface FileCache {
  get: (cid: string) => Promise<Buffer | Stream | null>
  set: (cid: string, data: Buffer | Stream) => Promise<void>
  remove: (cid: string) => Promise<void>
}
