import axios from 'axios'
import { HttpError } from '../http/middlewares/error.js'

export type UpstreamFailureKind =
  | 'upstream-timeout'
  | 'upstream-unreachable'
  | 'upstream-status'
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
 * Maps a failure of an upstream call onto a distinguishable kind.
 *
 * Without this every upstream problem reaches the logs and the client as a bare
 * 500, so a gateway that accepted the request and went quiet (the DSN could not
 * retrieve the piece) is indistinguishable from one that is down, one that
 * answered with an error status, and one that answered with something we could
 * not parse. Those are four different operational problems.
 */
export const classifyUpstreamError = (error: unknown): UpstreamFailure => {
  if (axios.isAxiosError(error)) {
    const code = error.code

    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return {
        kind: 'upstream-timeout',
        statusCode: 504,
        clientMessage:
          'Gateway timeout: the object could not be retrieved in time',
        detail: error.message,
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

    return {
      kind: 'upstream-unreachable',
      statusCode: 502,
      clientMessage: 'Bad gateway: the subspace gateway could not be reached',
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
