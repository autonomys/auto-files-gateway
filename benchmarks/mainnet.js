import { group } from 'k6'
import { bigFiles as mainnetBigFiles, mainnetFiles } from './files/mainnet.js'
import { loadEnv } from './utils/loadEnv.js'
import http from 'k6/http'

loadEnv()

export default async function () {
  if (__ENV.SMALL_FILES ?? true) {
    group('small-files', function () {
      return http.batch(
        mainnetFiles.map((file) => ({
          url: `${global.MAINNET_FILES_GATEWAY_URL}/files/${file}?api_key=${global.MAINNET_FILES_GATEWAY_API_KEY}`,
        })),
      )
    })
  }

  if (__ENV.BIG_FILES ?? true) {
    group('big-files', function () {
      return http.batch(
        mainnetBigFiles.map((file) => ({
          url: `${global.MAINNET_FILES_GATEWAY_URL}/files/${file}?api_key=${global.MAINNET_FILES_GATEWAY_API_KEY}`,
        })),
      )
    })
  }
}

export const options = {
  batchPerHost: mainnetFiles.length,
  batch: mainnetFiles.length,
}
