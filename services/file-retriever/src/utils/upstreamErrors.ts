import axios, { AxiosError } from 'axios'
import { HttpError } from '../http/middlewares/error.js'

export type UpstreamFailureKind =
  | 'upstream-timeout'
  | 'upstream-unreachable'
  | 'upstream-disconnected'
  | 'upstream-status'
  | 'rpc-error'
  | 'upstream-error'
  | 'invalid-response'
  | 'unknown'

export type UpstreamFailure = {
  kind: UpstreamFailureKind
  /** Status this service should answer its own clients with. */
  statusCode: number
  /** Message safe to hand back to our clients. */
  clientMessage: string
  /** Underlying error message, for logs only. */
  detail: string
  code?: string
  upstreamStatus?: number
}

/**
 * A JSON-RPC error answer, which arrives as HTTP 200 with an `error` member
 * and therefore cannot be told from a malformed body by status alone.
 */
export class UpstreamRpcError extends Error {
  constructor(
    public rpcCode: number,
    public rpcMessage: string,
  ) {
    super(`JSON-RPC error ${rpcCode}: ${rpcMessage}`)
    this.name = 'UpstreamRpcError'
  }
}

/**
 * Whether the socket had finished connecting when the request timed out.
 *
 * axios' `timeout` covers the whole exchange, so it fires just the same while
 * DNS is still resolving or the SYN is going unanswered - a blackholed host
 * reaches the deadline as ECONNABORTED exactly like a gateway that accepted
 * the request and then went quiet. `net.Socket.connecting` tells the two
 * apart. The path to the socket runs through follow-redirects' internals, so
 * treat an unreadable one as unknown rather than guessing.
 */
type TimeoutPhase = 'connecting' | 'sent' | 'unknown'

type MaybeSocketCarrier = {
  socket?: { connecting?: boolean }
  _currentRequest?: { socket?: { connecting?: boolean } }
}

const timeoutPhase = (error: AxiosError): TimeoutPhase => {
  try {
    const request = error.request as MaybeSocketCarrier | undefined
    const socket = request?._currentRequest?.socket ?? request?.socket
    if (typeof socket?.connecting !== 'boolean') {
      return 'unknown'
    }
    return socket.connecting ? 'connecting' : 'sent'
  } catch {
    return 'unknown'
  }
}

/** The gateway was never reached: nothing was listening, or no route to it. */
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  // axios reports its own `timeout` as ECONNABORTED unless
  // transitional.clarifyTimeoutError is set, so an ETIMEDOUT here comes from
  // the socket: a connect timeout, not a gateway that went quiet.
  'ETIMEDOUT',
])

/** The gateway was reached and then the connection went away mid-exchange. */
const DISCONNECTED_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ERR_BAD_RESPONSE',
  'ERR_STREAM_PREMATURE_CLOSE',
])

/**
 * Maps a failure of an upstream call onto a distinguishable kind.
 *
 * Without this every upstream problem reaches the logs and the client as a bare
 * 500, so a gateway that took the request and went quiet (the DSN could not
 * retrieve the piece) is indistinguishable from one that was never reached, one
 * that dropped the connection, one that answered with an error status, one that
 * answered with a JSON-RPC error and one that answered with something we could
 * not parse. Those are different operational problems.
 */
export const classifyUpstreamError = (error: unknown): UpstreamFailure => {
  if (error instanceof UpstreamRpcError) {
    return {
      kind: 'rpc-error',
      statusCode: 502,
      clientMessage:
        'Bad gateway: the subspace gateway rejected the object request',
      detail: error.message,
      code: String(error.rpcCode),
    }
  }

  if (axios.isAxiosError(error)) {
    const code = error.code

    if (code === 'ECONNABORTED') {
      const phase = timeoutPhase(error)

      if (phase === 'connecting') {
        return {
          kind: 'upstream-unreachable',
          statusCode: 502,
          clientMessage:
            'Bad gateway: the subspace gateway could not be reached',
          detail: `${error.message} (timed out before the connection was established)`,
          code,
        }
      }

      return {
        kind: 'upstream-timeout',
        statusCode: 504,
        clientMessage:
          'Gateway timeout: the object could not be retrieved in time',
        detail:
          phase === 'sent'
            ? error.message
            : `${error.message} (connection phase unknown)`,
        code,
      }
    }

    if (error.response) {
      return {
        kind: 'upstream-status',
        statusCode: 502,
        clientMessage:
          'Bad gateway: the subspace gateway returned an unexpected status',
        detail: error.message,
        code,
        upstreamStatus: error.response.status,
      }
    }

    if (code && UNREACHABLE_CODES.has(code)) {
      return {
        kind: 'upstream-unreachable',
        statusCode: 502,
        clientMessage: 'Bad gateway: the subspace gateway could not be reached',
        detail: error.message,
        code,
      }
    }

    if (code && DISCONNECTED_CODES.has(code)) {
      return {
        kind: 'upstream-disconnected',
        statusCode: 502,
        clientMessage:
          'Bad gateway: the connection to the subspace gateway was lost',
        detail: error.message,
        code,
      }
    }

    return {
      kind: 'upstream-error',
      statusCode: 502,
      clientMessage: 'Bad gateway: the object request failed',
      detail: error.message,
      code,
    }
  }

  if (error instanceof HttpError) {
    return {
      kind: 'invalid-response',
      statusCode: error.statusCode,
      clientMessage: error.message,
      detail: error.message,
    }
  }

  return {
    kind: 'unknown',
    statusCode: 500,
    clientMessage: 'Internal server error: Failed to fetch objects',
    detail: error instanceof Error ? error.message : String(error),
  }
}

export const describeUpstreamFailure = (failure: UpstreamFailure): string =>
  [
    `kind=${failure.kind}`,
    failure.code ? `code=${failure.code}` : null,
    failure.upstreamStatus ? `upstreamStatus=${failure.upstreamStatus}` : null,
    `detail="${failure.detail}"`,
  ]
    .filter(Boolean)
    .join(' ')
