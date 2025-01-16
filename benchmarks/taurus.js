/* eslint-disable no-undef */
import http from 'k6/http'
import { group } from 'k6'
import { taurusFiles } from './files/taurus.js'

const base_url = __ENV.BASE_URL || 'http://localhost:8090'
const api_key = __ENV.API_KEY || 'random-secret'

export default async function () {
  group('Concurrent Requests', function () {
    return http.batch(
      taurusFiles.map((file) => ({
        url: `${base_url}/files/${file}?api_key=${api_key}`,
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
