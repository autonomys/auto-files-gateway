import http from 'k6/http'
import { group } from 'k6'
import { taurusFiles } from './files/taurus.js'

export default async function () {
  group('Concurrent Requests', function () {
    return http.batch(
      taurusFiles.map((file) => ({
        url: `http://localhost:8090/files/${file}?api_key=random-secret`,
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
