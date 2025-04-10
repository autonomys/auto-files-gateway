import { group } from 'k6'
import { mainnetFiles } from './files/mainnet.js'
import { loadEnv } from './utils/loadEnv.js'
import http from 'k6/http'

loadEnv()

export default async function () {
  group('Concurrent Requests', function () {
    return http.batch(
      mainnetFiles.map((file) => ({
        url: `${global.MAINNET_FILES_GATEWAY_URL}/files/${file}?api_key=${global.MAINNET_FILES_GATEWAY_API_KEY}`,
      })),
    )
  })

  group('Big files', function () {
    return http.batch(
      mainnetFiles.map((file) => ({
        url: `${global.MAINNET_FILES_GATEWAY_URL}/files/${file}?api_key=${global.MAINNET_FILES_GATEWAY_API_KEY}`,
      })),
    )
  })
}

export const options = {
  batchPerHost: mainnetFiles.length,
  batch: mainnetFiles.length,
}
