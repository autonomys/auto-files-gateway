import http from 'node:http'
import { AddressInfo, Socket } from 'node:net'
import axios from 'axios'
import { classifyUpstreamError } from '../src/utils/upstreamErrors.js'

// The phase check reads the socket through follow-redirects' internals, so
// these drive real axios requests rather than hand-built error shapes: an
// axios or follow-redirects upgrade that moves the socket would otherwise
// leave every test green while production quietly lost the distinction.

const TIMEOUT_MS = 200

const failureOf = async (request: Promise<unknown>) => {
  try {
    await request
  } catch (error) {
    return classifyUpstreamError(error)
  }
  throw new Error('expected the request to fail')
}

describe('classifyUpstreamError against real sockets', () => {
  const sockets = new Set<Socket>()
  let server: http.Server
  let baseUrl: string

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.end('{}')
      }
      // Anything else is accepted and never answered, like a gateway stuck
      // retrieving a piece from the DSN.
    })
    server.on('connection', (socket) => sockets.add(socket))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    sockets.forEach((socket) => socket.destroy())
    await new Promise((resolve) => server.close(resolve))
  })

  it('reports a gateway that accepted the request and went quiet as a timeout', async () => {
    const failure = await failureOf(
      axios.post(`${baseUrl}/stall`, {}, { timeout: TIMEOUT_MS }),
    )

    expect(failure.kind).toBe('upstream-timeout')
    expect(failure.statusCode).toBe(504)
    expect(failure.detail).not.toContain('phase unknown')
  })

  it('reads the phase on a reused keep-alive socket too', async () => {
    await axios.post(`${baseUrl}/ok`, {}, { timeout: TIMEOUT_MS })

    const failure = await failureOf(
      axios.post(`${baseUrl}/stall`, {}, { timeout: TIMEOUT_MS }),
    )

    expect(failure.kind).toBe('upstream-timeout')
    expect(failure.detail).not.toContain('phase unknown')
  })

  it('reports a timeout before DNS completes as unreachable', async () => {
    const failure = await failureOf(
      axios.post(
        'http://never-resolves.test',
        {},
        { timeout: TIMEOUT_MS, lookup: () => {} },
      ),
    )

    expect(failure.kind).toBe('upstream-unreachable')
    expect(failure.statusCode).toBe(502)
    expect(failure.detail).toContain(
      'timed out before the connection was established',
    )
  })

  it('reports a refused connection as unreachable', async () => {
    const closed = http.createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const { port } = closed.address() as AddressInfo
    await new Promise((resolve) => closed.close(resolve))

    const failure = await failureOf(
      axios.post(`http://127.0.0.1:${port}`, {}, { timeout: TIMEOUT_MS }),
    )

    expect(failure.kind).toBe('upstream-unreachable')
    expect(failure.code).toBe('ECONNREFUSED')
  })
})
