import path from 'path'
import { env } from './utils/env.js'

const TEN_GB = 10 * 1024 ** 3
const ONE_DAY = 24 * 60 * 60 * 1000

export const config = {
  // Required
  apiSecret: env('API_SECRET'),
  subspaceGatewayUrls: env<string>('SUBSPACE_GATEWAY_URLS'),
  // Optional
  logLevel: env('LOG_LEVEL', { defaultValue: 'info' }),
  port: Number(env('FILE_RETRIEVER_PORT', { defaultValue: 8090 })),
  corsOrigin: env('CORS_ORIGIN', { defaultValue: '*' }),
  objectFetching: {
    maxObjectsPerFetch: Number(
      env('MAX_OBJECTS_PER_FETCH', {
        defaultValue: 100,
      }),
    ),
    maxSimultaneousFetches: Number(
      env('MAX_SIMULTANEOUS_FETCHES', {
        defaultValue: 10,
      }),
    ),
    fetchTimeout: Number(
      env('FETCH_TIMEOUT', {
        defaultValue: 180_000,
      }),
    ),
  },
  // The DAG Indexer is the fast path for node metadata and chunk ordering, but
  // it trails the chain: freshly uploaded (or skipped) nodes have no row, and a
  // hard miss used to make the file unservable. These knobs bound the DSN
  // fallback that reconstructs the same information from object mappings.
  dagIndexerFallback: {
    enabled:
      env('DAG_INDEXER_FALLBACK_ENABLED', { defaultValue: 'true' }) === 'true',
    // Upper bound on nodes walked to rebuild one file's chunk list, so an
    // unindexed multi-GB DAG can't tie up a request indefinitely.
    maxNodes: Number(
      env('DAG_INDEXER_FALLBACK_MAX_NODES', { defaultValue: 5000 }),
    ),
    chunkListCacheSize: Number(
      env('DAG_INDEXER_FALLBACK_CHUNK_LIST_CACHE_SIZE', { defaultValue: 500 }),
    ),
    // Total chunk entries held across all cached chunk lists. Entry count alone
    // is a poor bound because one entry can hold up to `maxNodes` chunks, so a
    // cache of 500 large files is three orders of magnitude bigger than 500
    // small ones. 100_000 chunks is roughly 50 MB of metadata objects.
    chunkListCacheMaxChunks: Number(
      env('DAG_INDEXER_FALLBACK_CHUNK_LIST_CACHE_MAX_CHUNKS', {
        defaultValue: 100_000,
      }),
    ),
    chunkListCacheTtl: Number(
      env('DAG_INDEXER_FALLBACK_CHUNK_LIST_CACHE_TTL', {
        defaultValue: 10 * 60 * 1000,
      }),
    ),
    // Wall-clock budget for one reconstruction. A node fetch may take up to
    // FETCH_TIMEOUT (180s) and is retried three times, so an unbounded rebuild
    // can outlive any caller: auto-drive gives the gateway 60s
    // (FILES_GATEWAY_FETCH_TIMEOUT_MS) before abandoning the request. Failing
    // inside the caller's window turns a two-minute hang into an actionable
    // 503 + Retry-After, and stops us doing work nobody is waiting for.
    deadlineMs: Number(
      env('DAG_INDEXER_FALLBACK_DEADLINE_MS', { defaultValue: 45_000 }),
    ),
    // Blocks behind chain head at which `/health/dag-indexer` reports degraded.
    // Some lag is normal (the indexer trails by design); days of it is not.
    lagAlertBlocks: Number(
      env('DAG_INDEXER_LAG_ALERT_BLOCKS', { defaultValue: 1_000 }),
    ),
    // Advertised in `Retry-After` when an object is known to the DSN but not
    // retrievable yet.
    retryAfterSeconds: Number(
      env('UNAVAILABLE_RETRY_AFTER_SECONDS', { defaultValue: 60 }),
    ),
  },
  cacheDir: path.join(
    process.cwd(),
    env('CACHE_DIR', { defaultValue: './.cache' }),
  ),
  cacheMaxSize: Number(
    env('CACHE_MAX_SIZE', {
      defaultValue: TEN_GB,
    }),
  ),
  cacheTtl: Number(env('CACHE_TTL', { defaultValue: ONE_DAY })),
  objectMappingIndexerUrl: env<string>('OBJECT_MAPPING_INDEXER_URL'),
  databaseUrl: env<string>('DATABASE_URL'),
  monitoring: {
    active: env('VICTORIA_ACTIVE', { defaultValue: 'false' }) === 'true',
    victoriaEndpoint: env<string>('VICTORIA_ENDPOINT'),
    auth: {
      username: env<string>('VICTORIA_USERNAME'),
      password: env<string>('VICTORIA_PASSWORD'),
    },
    metricEnvironmentTag: env<string>('METRIC_ENVIRONMENT_TAG', {
      defaultValue: 'chain=unknown',
    }),
  },
}
