import { Message } from '../../models/message.js'
import Websocket from 'websocket'
import { Serializable } from '../../utils/types.js'

export interface WsServer {
  broadcastMessage: (message: Serializable) => void
  onMessage: (cb: MessageCallback) => void
}

export type MessageCallback = (
  message: Message,
  connection: { connection: Websocket.connection },
) => void
