import { check, group } from 'k6'
import { bigFiles as mainnetBigFiles, mainnetFiles } from './files/mainnet.js'
import { loadEnv } from './utils/loadEnv.js'
import http from 'k6/http'

loadEnv()

export default async function () {
  const originControl = __ENV.ORIGIN_CONTROL ?? 'allow-cache'
  const runSmallFiles =
    typeof __ENV.SMALL_FILES === 'string' ? __ENV.SMALL_FILES === 'true' : true
  if (runSmallFiles) {
    group('small-files', function () {
      const batch = http.batch(
        mainnetFiles.map((file) => ({
          url: `${global.MAINNET_FILES_GATEWAY_URL}/files/${file}?api_key=${global.MAINNET_FILES_GATEWAY_API_KEY}&originControl=${originControl}`,
          params: {
            timeout: '1h',
          },
        })),
      )

      batch.map((response) => {
        check(response, {
          'status is 200': (r) => r.status === 200,
        })
      })
    })
  }

  const runBigFiles =
    typeof __ENV.BIG_FILES === 'string' ? __ENV.BIG_FILES === 'true' : true
  if (runBigFiles) {
    group('big-files', function () {
      const batch = http.batch(
        mainnetBigFiles.map((file) => ({
          url: `${global.MAINNET_FILES_GATEWAY_URL}/files/${file}?api_key=${global.MAINNET_FILES_GATEWAY_API_KEY}&originControl=${originControl}`,
          params: {
            timeout: '1h',
          },
        })),
      )

      batch.map((response) => {
        check(response, {
          'status is 200': (r) => r.status === 200,
        })
      })
    })
  }
}

export const options = {
  batchPerHost: mainnetFiles.length,
  batch: mainnetFiles.length,
}
