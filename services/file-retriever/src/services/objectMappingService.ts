import { ObjectMapping } from '@auto-files/models'
import { LRUCache } from 'lru-cache'
import { config } from '../config.js'
import { objectMappingIndexer } from './objectMappingIndexer.js'
import { logger } from '../drivers/logger.js'

export interface ObjectMappingIndexerClient {
  get_object_mappings(params: { hashes: string[] }): Promise<ObjectMapping[]>
}

export interface ObjectMappingServiceOptions {
  maxSize?: number
  ttl?: number
}

export class ObjectMappingService {
  private cache: LRUCache<string, ObjectMapping>
  private inFlightHashes: Map<string, Promise<ObjectMapping | undefined>>
  private indexer: ObjectMappingIndexerClient

  constructor(
    indexer: ObjectMappingIndexerClient = objectMappingIndexer,
    options?: ObjectMappingServiceOptions,
  ) {
    this.indexer = indexer
    this.cache = new LRUCache<string, ObjectMapping>({
      max: options?.maxSize ?? config.mappingCache.maxSize,
      ttl: options?.ttl ?? config.mappingCache.ttl,
    })
    this.inFlightHashes = new Map()
  }

  /**
   * Retrieves object mappings for the given hashes, deduplicating in-flight requests
   * and caching results to prevent redundant calls to the object mapping indexer.
   */
  async getObjectMappings(hashes: string[]): Promise<ObjectMapping[]> {
    if (!hashes || hashes.length === 0) {
      return []
    }

    const uniqueHashes = Array.from(new Set(hashes))
    const result: ObjectMapping[] = []
    const missingHashes: string[] = []

    for (const hash of uniqueHashes) {
      const cached = this.cache.get(hash)
      if (cached) {
        result.push(cached)
      } else {
        missingHashes.push(hash)
      }
    }

    if (missingHashes.length === 0) {
      return result
    }

    // Identify which missing hashes need a new network fetch vs which are already in flight
    const hashesToFetch = missingHashes.filter((h) => !this.inFlightHashes.has(h))

    if (hashesToFetch.length > 0) {
      logger.debug(
        `Fetching ${hashesToFetch.length} missing object mappings (total requested: ${uniqueHashes.length})`,
      )

      const batchPromise = this.indexer
        .get_object_mappings({ hashes: hashesToFetch })
        .then((mappings) => {
          for (const mapping of mappings) {
            this.cache.set(mapping[0], mapping)
          }
          return mappings
        })
        .catch((error) => {
          logger.error(`Error fetching object mappings: ${error}`)
          throw error
        })

      for (const hash of hashesToFetch) {
        const singleHashPromise = batchPromise
          .then((mappings) => mappings.find((m) => m[0] === hash))
          .finally(() => {
            this.inFlightHashes.delete(hash)
          })

        this.inFlightHashes.set(hash, singleHashPromise)
      }
    }

    // Await all in-flight promises for missing hashes
    const fetchedResults = await Promise.all(
      missingHashes.map((h) => this.inFlightHashes.get(h)!),
    )

    for (const mapping of fetchedResults) {
      if (mapping) {
        result.push(mapping)
      }
    }

    return result
  }

  has(hash: string): boolean {
    return this.cache.has(hash)
  }

  get(hash: string): ObjectMapping | undefined {
    return this.cache.get(hash)
  }

  set(hash: string, mapping: ObjectMapping): void {
    this.cache.set(hash, mapping)
  }

  clear(): void {
    this.cache.clear()
    this.inFlightHashes.clear()
  }

  get size(): number {
    return this.cache.size
  }

  get inFlightCount(): number {
    return this.inFlightHashes.size
  }
}

export const objectMappingService = new ObjectMappingService()
