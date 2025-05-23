import http from 'k6/http'
import { group } from 'k6'
import { taurusFiles } from './files/taurus.js'
import { loadEnv } from './utils/loadEnv.js'
import {
  mainnetObjectMappings,
  singleObjectMappings,
} from './objectMappings/mainnet.js'

loadEnv()

export default async function () {
  const runBigBatch =
    typeof __ENV.BIG_BATCH === 'string' ? __ENV.BIG_BATCH === 'true' : true
  if (runBigBatch) {
    group('Mainnet Object Mappings', function () {
      // Run requests in sequence instead of batch
      const responses = []
      for (const objects of mainnetObjectMappings) {
        const response = http.post(
          global.SUBSPACE_MAINNET_FILES_GATEWAY_URL,
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'subspace_fetchObject',
            params: {
              mappings: {
                v0: {
                  objects,
                },
              },
            },
            id: 1,
          }),
          {
            timeout: '1h',
            headers: { 'Content-Type': 'application/json' },
          },
        )
        responses.push(response)
      }
      return responses
    })
  }

  const runSingleObjectMapping =
    typeof __ENV.SINGLE_OBJECT_MAPPING === 'string'
      ? __ENV.SINGLE_OBJECT_MAPPING === 'true'
      : true
  if (runSingleObjectMapping) {
    group('Single Object Mapping', function () {
      return http.batch(
        singleObjectMappings.map((objects) => ({
          method: 'POST',
          url: global.SUBSPACE_MAINNET_FILES_GATEWAY_URL,
          params: {
            timeout: '1h',
            headers: { 'Content-Type': 'application/json' },
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'subspace_fetchObject',
            params: {
              mappings: {
                v0: { objects },
              },
            },
            id: 1,
          }),
        })),
      )
    })
  }
}

export const options = {
  batchPerHost: taurusFiles.length,
  batch: taurusFiles.length,
}
