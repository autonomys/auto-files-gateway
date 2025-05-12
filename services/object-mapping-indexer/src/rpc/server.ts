/* eslint-disable camelcase */
import { objectMappingRouter } from '../services/objectMappingRouter/index.js'
import { ObjectMappingIndexerRPCApi } from '@auto-files/rpc-apis'
import { expressApp } from '../http/api.js'
import { Application } from 'express'
import { config } from '../config.js'
import { logger } from '../drivers/logger.js'
import { objectMappingUseCase } from '../useCases/objectMapping.js'

const createObjectMappingsRPCServer = (app: Application) => {
  return ObjectMappingIndexerRPCApi.createServer(
    {
      subscribe_object_mappings: async (_, { connection }) => {
        const subscriptionId =
          objectMappingRouter.subscribeObjectMappings(connection)

        return {
          subscriptionId,
        }
      },
      unsubscribe_object_mappings: async ({ subscriptionId }) => {
        objectMappingRouter.unsubscribeObjectMappings(subscriptionId)
        return {
          success: true,
        }
      },
      subscribe_recover_object_mappings: async (
        { pieceIndex, step },
        { connection },
      ) => {
        const subscriptionId =
          objectMappingRouter.subscribeRecoverObjectMappings(
            connection,
            pieceIndex,
            step,
          )

        return { success: true, subscriptionId }
      },
      unsubscribe_recover_object_mappings: async ({ subscriptionId }) => {
        objectMappingRouter.unsubscribeRecoverObjectMappings(subscriptionId)

        return { success: true }
      },
      get_object_mappings: async ({ hashes }) => {
        return objectMappingUseCase.getObjectMappings(hashes)
      },
    },
    {
      server: {
        httpServer: app.listen(config.port, () => {
          logger.info(`Server is running on port ${config.port}`)
        }),
        callbacks: {},
      },
    },
  )
}

export const server = createObjectMappingsRPCServer(expressApp)
