import { ObjectMappingIndexerRPCApi } from '@auto-files/rpc-apis'
import { config } from '../config'

export const objectMappingIndexer = ObjectMappingIndexerRPCApi.createHttpClient(
  config.objectMappingIndexerUrl,
)
