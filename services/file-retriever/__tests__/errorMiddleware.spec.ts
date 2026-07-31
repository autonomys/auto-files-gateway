import express, { NextFunction, Request, Response } from 'express'
import { AddressInfo } from 'net'
import { HttpError, errorMiddleware } from '../src/http/middlewares/error.js'
import { asyncSafeHandler } from '../src/utils/express.js'

const fakeResponse = () => {
  const headers: Record<string, string> = {}
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: (name: string, value: string) => {
      headers[name] = value
    },
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
    send(payload: unknown) {
      res.body = payload
      return res
    },
  }

  return { res, headers }
}

const handle = (error: unknown) => {
  const { res, headers } = fakeResponse()
  errorMiddleware(
    error,
    {} as Request,
    res as unknown as Response,
    (() => undefined) as NextFunction,
  )
  return {
    statusCode: res.statusCode,
    body: res.body as Record<string, unknown>,
    headers,
  }
}

describe('errorMiddleware', () => {
  it('passes an HttpError status and message through', () => {
    const { statusCode, body } = handle(new HttpError(400, 'Invalid CID'))

    expect(statusCode).toBe(400)
    // `error` carries the message: this is the shape the service has always
    // served, and these assertions now cover the handler that is registered.
    expect(body).toEqual({ error: 'Invalid CID' })
  })

  it('surfaces the reason code so callers can branch without parsing messages', () => {
    const { body } = handle(
      new HttpError(404, 'Not found', { reason: 'object_not_found' }),
    )

    expect(body.reason).toBe('object_not_found')
  })

  it('omits reason when the error carries none', () => {
    const { body } = handle(new HttpError(451, 'Unavailable for legal reasons'))

    expect(body).not.toHaveProperty('reason')
  })

  it('applies headers such as Retry-After on a retryable failure', () => {
    const { statusCode, headers } = handle(
      new HttpError(503, 'Object not retrievable yet', {
        reason: 'object_not_retrievable_yet',
        headers: { 'Retry-After': '60' },
      }),
    )

    expect(statusCode).toBe(503)
    expect(headers['Retry-After']).toBe('60')
  })

  it('reports unexpected errors as 500 without leaking the message', () => {
    const { statusCode, body } = handle(new Error('kaboom'))

    expect(statusCode).toBe(500)
    expect(body).toBe('Internal Server Error')
  })

  // The handler is registered as Express error middleware, which receives
  // whatever was thrown — not necessarily an Error.
  it('survives a thrown non-Error', () => {
    const { statusCode, body } = handle('just a string')

    expect(statusCode).toBe(500)
    expect(body).toBe('Internal Server Error')
  })
})

/**
 * Calling the handler directly (above) cannot tell whether Express will ever
 * route an error *to* it: Express decides that by arity alone, and a
 * three-parameter handler is silently demoted to ordinary middleware. Every
 * assertion above passed while the registered handler was unreachable and the
 * service answered HTML with no `reason`. These tests go through a real app so
 * the wiring is covered, not just the function.
 */
describe('errorMiddleware registration', () => {
  const withApp = async (
    register: (app: express.Application) => void,
    path: string,
  ) => {
    const app = express()
    register(app)
    app.use(errorMiddleware)

    const server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    try {
      const { port } = server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      const text = await response.text()

      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        retryAfter: response.headers.get('retry-after'),
        text,
      }
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }

  // Guards the arity: Express's `Layer.prototype.handle_error` bails out with
  // `fn.length !== 4`, so this is the single fact the wiring depends on.
  it('declares the four parameters Express requires of an error handler', () => {
    expect(errorMiddleware.length).toBe(4)
  })

  it('answers a thrown HttpError as JSON, with its reason and headers', async () => {
    const response = await withApp((app) => {
      app.get('/boom', () => {
        throw new HttpError(503, 'Object not retrievable yet', {
          reason: 'object_not_retrievable_yet',
          headers: { 'Retry-After': '60' },
        })
      })
    }, '/boom')

    expect(response.status).toBe(503)
    expect(response.contentType).toContain('application/json')
    expect(response.retryAfter).toBe('60')
    expect(JSON.parse(response.text)).toEqual({
      error: 'Object not retrievable yet',
      reason: 'object_not_retrievable_yet',
    })
  })

  // Async handlers reach the middleware via `next(err)` rather than a throw,
  // which is how every route in this service actually reports failures.
  it('answers an HttpError passed to next() from an async handler', async () => {
    const response = await withApp((app) => {
      app.get(
        '/boom',
        asyncSafeHandler(async () => {
          throw new HttpError(404, 'Not found', { reason: 'object_not_found' })
        }),
      )
    }, '/boom')

    expect(response.status).toBe(404)
    expect(JSON.parse(response.text)).toEqual({
      error: 'Not found',
      reason: 'object_not_found',
    })
  })

  // Registered as plain middleware, the handler was invoked for unmatched
  // requests with `(req, res, next)` and died on `res.status is not a function`,
  // turning every 404 into a 500.
  it('leaves unmatched routes as 404s instead of erroring on them', async () => {
    const response = await withApp(() => undefined, '/no-such-route')

    expect(response.status).toBe(404)
    expect(response.text).not.toContain('res.status is not a function')
  })
})
