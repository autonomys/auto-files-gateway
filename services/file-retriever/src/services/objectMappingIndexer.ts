import { ObjectMappingIndexerRPCApi } from '@auto-files/rpc-apis'
import { config } from '../config.js'

export const objectMappingIndexer = ObjectMappingIndexerRPCApi.createHttpClient(
  config.objectMappingIndexerUrl,
)
