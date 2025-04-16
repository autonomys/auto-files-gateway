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
