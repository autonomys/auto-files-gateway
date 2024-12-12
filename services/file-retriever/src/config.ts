import { env } from './utils/env.js'

const TEN_GB = 10 * 1024 ** 3
const ONE_DAY = 24 * 60 * 60 * 1000

export const config = {
  // Required
  apiSecret: env('API_SECRET'),
  subspaceGatewayUrl: env('SUBSPACE_GATEWAY_URL'),
  // Optional
  port: Number(env('FILE_RETRIEVER_PORT', { defaultValue: 8090 })),
  corsOrigin: env('CORS_ORIGIN', { defaultValue: '*' }),
  maxSimultaneousFetches: Number(
    env('MAX_SIMULTANEOUS_FETCHES', {
      defaultValue: 10,
    }),
  ),
  cacheDir: env('CACHE_DIR', { defaultValue: './.cache' }),
  cacheMaxSize: Number(
    env('CACHE_MAX_SIZE', {
      defaultValue: TEN_GB,
    }),
  ),
  cacheTtl: Number(env('CACHE_TTL', { defaultValue: ONE_DAY })),
}
