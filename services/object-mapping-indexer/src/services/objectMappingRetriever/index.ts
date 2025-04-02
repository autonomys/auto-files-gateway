import { ObjectMappingIndexerRPCApi } from '@auto-files/rpc-apis'
import { config } from '../../config'
import { logger } from '../../drivers/logger'
import { objectMappingRepository } from '../../repositories/objectMapping'

export const createObjectMappingRetriever = () => {
  if (
    !config.recoverObjectMappings.active ||
    !config.recoverObjectMappings.endpoint
  ) {
    logger.warn('Recover object mappings are not active')
    return
  }

  const start = async () => {
    const pieceIndex = await objectMappingRepository.getLastPieceIndex()
    await objectMappingListener.api.subscribe_recover_object_mappings({
      pieceIndex,
    })

    objectMappingListener.onNotification('object_mapping_list', (params) => {
      objectMappingRepository.saveObjectMappings(
        params.map((e) => ({
          hash: e[0],
          pieceIndex: e[1],
          pieceOffset: e[2],
          // TODO: get block number
          blockNumber: 0,
        })),
      )
    })
  }

  const objectMappingListener = ObjectMappingIndexerRPCApi.createClient({
    endpoint: config.recoverObjectMappings.endpoint,
    callbacks: {
      onOpen: start,
      onReconnection: start,
    },
  })

  return { start }
}
