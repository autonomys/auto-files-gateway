import { WsServer } from '../ws/types.js'
import { RpcHandler } from './types.js'
import { logger } from '../logger.js'

const serverState: {
  wsServer: WsServer | null
  handlers: RpcHandler[]
} = {
  wsServer: null,
  handlers: [],
}

const init = (broadcastServer: WsServer) => {
  serverState.wsServer = broadcastServer

  serverState.wsServer.onMessage((msg, { connection }) => {
    const handler = serverState.handlers.find(
      (handler) => msg.method === handler.method,
    )
    if (handler) {
      logger.debug(`Passing message to handler: ${msg.method}`)
      handler.handler(msg.params, { connection, messageId: msg.id })
    } else {
      logger.debug(`Received message with unknown method: ${msg.method}`)
      connection.sendUTF(JSON.stringify({ error: 'Method not found' }))
    }
  })
}

export const addRpcHandler = (handler: RpcHandler) => {
  serverState.handlers.push(handler)
}

export const rpcServer = {
  init,
  addRpcHandler,
}
