import fsPromises from 'fs/promises'
import fs from 'fs'
import path from 'path'
import { createCache } from 'cache-manager'
import { writeFile } from '../../utils/fs.js'
import { BaseCacheConfig } from './types.js'
import { FileResponse } from '../../models/file.js'
import { logger } from '../../drivers/logger.js'

const CHARS_PER_PARTITION = 2

type FileCacheEntry = Omit<FileResponse, 'data'>

type UncheckedFileCacheEntry = FileCacheEntry | null | undefined

export const createFileCache = (config: BaseCacheConfig) => {
  const cidToFilePath = (cid: string) => {
    const partitions = config.pathPartitions

    let filePath = ''
    let head = cid
    for (let i = 0; i < partitions; i++) {
      filePath = path.join(filePath, `${head.slice(-CHARS_PER_PARTITION)}/`)
      head = head.slice(0, -CHARS_PER_PARTITION)
    }
    filePath = path.join(filePath, head)

    return path.join(config.cacheDir, filePath)
  }

  const filepathCache = createCache({
    stores: config.stores,
  })

  const deserialize = (data: Omit<FileResponse, 'data'> | null) => {
    if (!data) {
      return null
    }

    return {
      ...data,
      size: BigInt(data.size ?? 0),
    }
  }

  const get = async (cid: string): Promise<FileResponse | null> => {
    const start = performance.now()
    const data: UncheckedFileCacheEntry = deserialize(
      await filepathCache.get(cid),
    )
    const end = performance.now()
    if (!data) {
      return null
    }
    logger.debug(`Getting file cache entry for ${cid} took ${end - start}ms`)

    const path = cidToFilePath(cid)

    return {
      ...data,
      data: fs.createReadStream(path),
    }
  }

  const set = async (cid: string, fileResponse: FileResponse) => {
    const filePath = cidToFilePath(cid)

    const { data, ...rest } = fileResponse

    const start = performance.now()
    await writeFile(filePath, data)
    const end = performance.now()
    logger.debug(`Writing file to cache for ${cid} took ${end - start}ms`)

    const start2 = performance.now()
    await filepathCache.set(cid, {
      ...rest,
    })
    const end2 = performance.now()
    logger.debug(`Caching file for ${cid} took ${end2 - start2}ms`)
  }

  const remove = async (cid: string) => {
    const data: UncheckedFileCacheEntry = deserialize(
      await filepathCache.get(cid),
    )
    if (!data) {
      return
    }

    const path = cidToFilePath(cid)
    await Promise.all([filepathCache.del(cid), fsPromises.rm(path)])
  }

  filepathCache.on('del', async ({ key, error }) => {
    if (error) {
      console.error(`Error deleting file cache entry for ${key}: ${error}`)
    } else {
      await fsPromises.rm(cidToFilePath(key))
    }
  })

  const cache = {
    get,
    set,
    remove,
  }

  return cache
}
