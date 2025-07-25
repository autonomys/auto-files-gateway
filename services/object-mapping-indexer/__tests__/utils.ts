import Websocket from 'websocket'
import { jest } from '@jest/globals'

export const createMockConnection = (connected = true): Websocket.connection =>
  ({
    connected,
    remoteAddress: 'mock',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: jest.fn() as (...args: any[]) => void,
  }) as Websocket.connection
