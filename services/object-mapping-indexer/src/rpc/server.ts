import http from 'http'
import { objectMappingRouter } from '../services/objectMappingRouter'
import { ObjectMappingIndexerRPCApi } from '@auto-files/rpc-apis'

export const createObjectMappingsRPCServer = (app: Express.Application) => {
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
        { pieceIndex },
        { connection },
      ) => {
        const subscriptionId =
          objectMappingRouter.subscribeRecoverObjectMappings(
            connection,
            pieceIndex,
          )

        return { success: true, subscriptionId }
      },
      unsubscribe_recover_object_mappings: async ({ subscriptionId }) => {
        objectMappingRouter.unsubscribeRecoverObjectMappings(subscriptionId)

        return { success: true }
      },
    },
    {
      server: {
        httpServer: http.createServer(app),
        callbacks: {},
      },
    },
  )
}
