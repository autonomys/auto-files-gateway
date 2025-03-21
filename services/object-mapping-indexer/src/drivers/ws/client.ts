import Websocket from 'websocket'
import { logger } from '../logger.js'
import { schedule } from '../../utils/timeout.js'
import { unresolvablePromise } from '../../utils/promise.js'

type RPCMessage = {
  jsonrpc: string
  method: string
  params: unknown
  id: number
}

export type WS = {
  send: (message: Omit<RPCMessage, 'id'>) => Promise<unknown>
  on: (callback: (event: RPCMessage) => void) => void
  off: (callback: (event: RPCMessage) => void) => void
}

export const createWS = ({
  endpoint,
  onReconnection,
  reconnectInterval = 10_000,
}: {
  endpoint: string
  onReconnection?: () => void
  reconnectInterval?: number
}): WS => {
  let ws: Websocket.w3cwebsocket
  let onMessageCallbacks: ((event: RPCMessage) => void)[] = []
  let connected: Promise<void> = unresolvablePromise

  const handleConnection = () => {
    ws = new Websocket.w3cwebsocket(endpoint)
    connected = new Promise((resolve) => {
      ws.onopen = () => {
        logger.info(`Connected to RPC Web Socket (${endpoint})`)
        resolve()
      }
    })

    const handleErrorOrClose = () => {
      schedule(() => {
        logger.info(`Reconnecting to RPC Web Socket (${endpoint})`)
        handleConnection()
        if (onReconnection) {
          onReconnection()
        }
      }, reconnectInterval)
    }

    ws.onerror = (event) => {
      const errorDetails = {
        readyState: ws.readyState,
        url: endpoint,
        message: event.message || 'Unknown error',
      }
      logger.error(
        `WebSocket connection error: ${JSON.stringify(errorDetails)}`,
      )
      handleErrorOrClose()
    }

    ws.onmessage = (event) => {
      logger.debug(`Received message from WebSocket (${endpoint})`)
      onMessageCallbacks.forEach((callback) =>
        callback(JSON.parse(event.data.toString())),
      )
    }

    ws.onclose = (event) => {
      logger.info(
        `WebSocket connection closed (${event.code}) due to ${event.reason}.`,
      )
      handleErrorOrClose
    }
  }

  handleConnection()

  const send = async (message: Omit<RPCMessage, 'id'>) => {
    await connected

    const id = Math.floor(Math.random() * 65546)
    const messageWithID = { ...message, id }

    return new Promise((resolve, reject) => {
      const cb = (event: RPCMessage) => {
        try {
          if (event.id === id) {
            off(cb)
            resolve(event)
          }
        } catch (error) {
          reject(error)
        }
      }
      on(cb)

      ws.send(JSON.stringify(messageWithID))
    })
  }

  const on = (callback: (event: RPCMessage) => void) => {
    onMessageCallbacks.push(callback)
  }
  const off = (callback: (event: RPCMessage) => void) => {
    onMessageCallbacks = onMessageCallbacks.filter((cb) => cb !== callback)
  }

  return { send, on, off }
}
