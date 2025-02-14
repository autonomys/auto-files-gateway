import http from 'k6/http'
import { group } from 'k6'
import { taurusFiles } from './files/taurus.js'

export default async function () {
  group('Concurrent Requests', function () {
    return http.batch(
      taurusFiles.map((file) => ({
        url: `https://gateway.taurus.autonomys.xyz/files/${file}?api_key=28592507e0de9a9bde5b45dbe3ecb7fd`,
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
