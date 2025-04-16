import http from 'k6/http'
import { group } from 'k6'
import { taurusFiles } from './files/taurus.js'
import { loadEnv } from './utils/loadEnv.js'

loadEnv()

export default async function () {
  const originControl = __ENV.ORIGIN_CONTROL ?? 'allow-cache'
  group('Concurrent Requests', function () {
    return http.batch(
      taurusFiles.map((file) => ({
        url: `${global.TAURUS_FILES_GATEWAY_URL}/files/${file}?api_key=${global.TAURUS_FILES_GATEWAY_API_KEY}&originControl=${originControl}`,
        params: {
          timeout: '1h',
        },
      })),
    )
  })
}

export const options = {
  batchPerHost: taurusFiles.length,
  batch: taurusFiles.length,
}
