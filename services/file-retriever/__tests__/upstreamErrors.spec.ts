import { AxiosError, AxiosHeaders } from 'axios'
import {
  classifyUpstreamError,
  describeUpstreamFailure,
  UpstreamRpcError,
} from '../src/utils/upstreamErrors.js'
import { HttpError } from '../src/http/middlewares/error.js'

const axiosErrorWithCode = (code: string, message = 'boom') =>
  new AxiosError(message, code)

const axiosErrorWithStatus = (status: number) => {
  const headers = new AxiosHeaders()
  const config = { headers }
  return new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    config,
    {},
    {
      status,
      statusText: '',
      headers,
      config,
      data: {},
    },
  )
}

describe('classifyUpstreamError', () => {
  it('maps the axios client timeout to a 504', () => {
    const failure = classifyUpstreamError(
      axiosErrorWithCode('ECONNABORTED', 'timeout of 180000ms exceeded'),
    )

    expect(failure.kind).toBe('upstream-timeout')
    expect(failure.statusCode).toBe(504)
    expect(failure.code).toBe('ECONNABORTED')
    expect(failure.detail).toBe('timeout of 180000ms exceeded')
  })

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH'])(
    'maps %s to an unreachable gateway',
    (code) => {
      const failure = classifyUpstreamError(axiosErrorWithCode(code))

      expect(failure.kind).toBe('upstream-unreachable')
      expect(failure.statusCode).toBe(502)
    },
  )

  it('treats ETIMEDOUT as unreachable, not as a gateway that went quiet', () => {
    // axios surfaces its own `timeout` as ECONNABORTED while
    // transitional.clarifyTimeoutError is false, so ETIMEDOUT is a socket
    // connect timeout: the gateway was never reached.
    const failure = classifyUpstreamError(axiosErrorWithCode('ETIMEDOUT'))

    expect(failure.kind).toBe('upstream-unreachable')
    expect(failure.statusCode).toBe(502)
  })

  it.each(['ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'])(
    'maps %s to a lost connection rather than an unreachable gateway',
    (code) => {
      const failure = classifyUpstreamError(axiosErrorWithCode(code))

      expect(failure.kind).toBe('upstream-disconnected')
      expect(failure.statusCode).toBe(502)
    },
  )

  it('maps an error status from the gateway to a 502 carrying that status', () => {
    const failure = classifyUpstreamError(axiosErrorWithStatus(503))

    expect(failure.kind).toBe('upstream-status')
    expect(failure.statusCode).toBe(502)
    expect(failure.upstreamStatus).toBe(503)
  })

  it('keeps an uncategorised axios failure out of the unreachable bucket', () => {
    const failure = classifyUpstreamError(axiosErrorWithCode('ERR_SOMETHING'))

    expect(failure.kind).toBe('upstream-error')
    expect(failure.statusCode).toBe(502)
    expect(failure.code).toBe('ERR_SOMETHING')
  })

  it('reports a JSON-RPC error answer with the code the gateway gave', () => {
    const failure = classifyUpstreamError(
      new UpstreamRpcError(-32000, 'Object mapping not found'),
    )

    expect(failure.kind).toBe('rpc-error')
    expect(failure.statusCode).toBe(502)
    expect(failure.detail).toContain('Object mapping not found')
    expect(failure.code).toBe('-32000')
  })

  it('passes an HttpError through with its own status', () => {
    const failure = classifyUpstreamError(
      new HttpError(502, 'Bad gateway: Failed to parse fetch nodes response'),
    )

    expect(failure.kind).toBe('invalid-response')
    expect(failure.statusCode).toBe(502)
    expect(failure.clientMessage).toBe(
      'Bad gateway: Failed to parse fetch nodes response',
    )
  })

  it('falls back to 500 for anything else', () => {
    const failure = classifyUpstreamError(new Error('something else'))

    expect(failure.kind).toBe('unknown')
    expect(failure.statusCode).toBe(500)
    expect(failure.detail).toBe('something else')
  })

  it('handles a thrown non-error', () => {
    expect(classifyUpstreamError('nope').detail).toBe('nope')
  })
})

describe('describeUpstreamFailure', () => {
  it('renders a single log-friendly line', () => {
    const line = describeUpstreamFailure(
      classifyUpstreamError(
        axiosErrorWithCode('ECONNABORTED', 'timeout of 180000ms exceeded'),
      ),
    )

    expect(line).toBe(
      'kind=upstream-timeout code=ECONNABORTED detail="timeout of 180000ms exceeded"',
    )
  })

  it('includes the upstream status when there is one', () => {
    const line = describeUpstreamFailure(
      classifyUpstreamError(axiosErrorWithStatus(503)),
    )

    expect(line).toContain('upstreamStatus=503')
  })
})
