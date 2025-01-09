import express from 'express'
import { rpcServer } from '../drivers/rpcServer/index.js'
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
      connection.sendUTF(
        JSON.stringify({
          error: 'Missing blockNumber',
          success: false,
          id: messageId,
        }),
      )
      return
    }

    try {
      const subscriptionId =
        objectMappingRouter.subscribeObjectMappings(connection)

      connection.sendUTF(
        JSON.stringify({ success: true, id: messageId, subscriptionId }),
      )
    } catch {
      connection.sendUTF(
        JSON.stringify({
          error: 'Failed to subscribe to object mappings',
          success: false,
          id: messageId,
        }),
      )
    }
  },
})

rpcServer.addRpcHandler({
  method: 'unsubscribe_object_mappings',
  handler: async (params, { connection, messageId }) => {
    const { data } = z.object({ subscriptionId: z.string() }).safeParse(params)
    if (!data) {
      connection.sendUTF(
        JSON.stringify({
          error: 'Missing subscriptionId',
          success: false,
          id: messageId,
        }),
      )
      return
    }

    try {
      objectMappingRouter.unsubscribeObjectMappings(data.subscriptionId)
      connection.sendUTF(JSON.stringify({ success: true, id: messageId }))
    } catch {
      connection.sendUTF(
        JSON.stringify({
          error: 'Invalid subscriptionId',
          success: false,
          id: messageId,
        }),
      )
    }
  },
})

rpcServer.addRpcHandler({
  method: 'subscribe_recover_object_mappings',
  handler: async (params, { connection, messageId }) => {
    const { data } = z.object({ blockNumber: z.number() }).safeParse(params)
    if (!data) {
      connection.sendUTF(
        JSON.stringify({
          error: 'Missing blockNumber',
          success: false,
          id: messageId,
        }),
      )
      return
    }
    try {
      const subscriptionId = objectMappingRouter.subscribeRecoverObjectMappings(
        connection,
        data.blockNumber,
      )

      connection.sendUTF(
        JSON.stringify({ success: true, id: messageId, subscriptionId }),
      )
    } catch {
      connection.sendUTF(
        JSON.stringify({
          error: 'Failed to subscribe to recover object mappings',
          success: false,
          id: messageId,
        }),
      )
    }
  },
})

rpcServer.addRpcHandler({
  method: 'unsubscribe_recover_object_mappings',
  handler: async (params, { connection, messageId }) => {
    const { data } = z.object({ subscriptionId: z.string() }).safeParse(params)
    if (!data) {
      connection.sendUTF(
        JSON.stringify({
          error: 'Missing subscriptionId',
          success: false,
          id: messageId,
        }),
      )
      return
    }

    try {
      objectMappingRouter.unsubscribeRecoverObjectMappings(data.subscriptionId)
      connection.sendUTF(JSON.stringify({ success: true, id: messageId }))
    } catch {
      connection.sendUTF(
        JSON.stringify({
          error: 'Invalid subscriptionId',
          success: false,
          id: messageId,
        }),
      )
    }
  },
})
