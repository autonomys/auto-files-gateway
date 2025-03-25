import express from 'express'
import { rpcServer } from '../server.js'
import { objectMappingUseCase } from '../useCases/objectMapping.js'
import z from 'zod'
import { objectMappingRouter } from '../services/objectMappingRouter/index.js'

export const objectsController = express.Router()

objectsController.get('/:hash', async (req, res, next) => {
  try {
    const { hash } = req.params

    if (!hash) {
      res.status(400).json({ error: 'Missing hash' })
      return
    }

    const object = await objectMappingUseCase.getObject(hash)

    if (!object) {
      res.status(404).json({ error: 'Object not found' })
      return
    }

    res.json(object)

    return
  } catch (err) {
    next(err)
  }
})

objectsController.get('/by-block/:blockNumber', async (req, res, next) => {
  try {
    const { blockNumber } = req.params

    const parsedBlockNumber = parseInt(blockNumber)
    if (!blockNumber || isNaN(parsedBlockNumber)) {
      res.status(400).json({ error: 'Missing or invalid blockNumber' })
      return
    }

    const objects =
      await objectMappingUseCase.getObjectByBlock(parsedBlockNumber)

    res.json(objects)
  } catch (err) {
    next(err)
  }
})

rpcServer.addRpcHandler({
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

rpcServer.addRpcHandler({
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

rpcServer.addRpcHandler({
  method: 'subscribe_recover_object_mappings',
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

rpcServer.addRpcHandler({
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
