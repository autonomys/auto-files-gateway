import { RpcHandler } from '@autonomys/rpc'
import z from 'zod'
import { objectMappingRouter } from '../../services/objectMappingRouter/index.js'

export const objectsRPCHandlers: RpcHandler[] = []

objectsRPCHandlers.push({
  method: 'subscribe_object_mappings',
  handler: async (params, { connection, messageId }) => {
    const { data } = z.object({ blockNumber: z.number() }).safeParse(params)
    if (!data) {
      return {
        jsonrpc: '2.0',
        error: {
          code: 1,
          message: 'Missing blockNumber',
        },
        success: false,
      }
    }

    try {
      const subscriptionId =
        objectMappingRouter.subscribeObjectMappings(connection)

      return {
        jsonrpc: '2.0',
        success: true,
        id: messageId,
        subscriptionId,
      }
    } catch {
      return {
        jsonrpc: '2.0',
        success: false,
      }
    }
  },
})

objectsRPCHandlers.push({
  method: 'unsubscribe_object_mappings',
  handler: async (params) => {
    const { data } = z.object({ subscriptionId: z.string() }).safeParse(params)
    if (!data) {
      return {
        jsonrpc: '2.0',
        error: {
          code: 1,
          message: 'Missing subscriptionId',
        },
        success: false,
      }
    }

    try {
      objectMappingRouter.unsubscribeObjectMappings(data.subscriptionId)
      return {
        jsonrpc: '2.0',
        success: true,
      }
    } catch {
      return {
        jsonrpc: '2.0',
        error: {
          code: 1,
          message: 'Invalid subscriptionId',
        },
        success: false,
      }
    }
  },
})

objectsRPCHandlers.push({
  method: 'subscribe_recover_object_mappings',
  handler: async (params, { connection }) => {
    const { data } = z.object({ blockNumber: z.number() }).safeParse(params)
    if (!data) {
      return {
        jsonrpc: '2.0',
        error: {
          code: 1,
          message: 'Missing blockNumber',
        },
        success: false,
      }
    }
    try {
      const subscriptionId = objectMappingRouter.subscribeRecoverObjectMappings(
        connection,
        data.blockNumber,
      )

      return { success: true, subscriptionId }
    } catch {
      return {
        jsonrpc: '2.0',
        error: {
          code: 1,
          message: 'Failed to subscribe to recover object mappings',
        },
        success: false,
      }
    }
  },
})

objectsRPCHandlers.push({
  method: 'unsubscribe_recover_object_mappings',
  handler: async (params, { connection, messageId }) => {
    const { data } = z.object({ subscriptionId: z.string() }).safeParse(params)
    if (!data) {
      return {
        jsonrpc: '2.0',
        error: {
          code: 1,
          message: 'Missing subscriptionId',
        },
        success: false,
      }
    }

    try {
      objectMappingRouter.unsubscribeRecoverObjectMappings(data.subscriptionId)
      connection.sendUTF(JSON.stringify({ success: true, id: messageId }))
    } catch {
      return {
        jsonrpc: '2.0',
        error: {
          code: 1,
          message: 'Invalid subscriptionId',
        },
        success: false,
        id: messageId,
      }
    }
  },
})
