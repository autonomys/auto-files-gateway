import { ErrorRequestHandler, NextFunction, Request, Response } from 'express'
import { logger } from '../../drivers/logger.js'

export interface HttpErrorOptions {
  /**
   * Machine-readable reason code, echoed in the response body so callers can
   * branch on the cause instead of parsing the message.
   */
  reason?: string
  /**
   * Extra response headers, e.g. `Retry-After` on a retryable failure.
   */
  headers?: Record<string, string>
}

export class HttpError extends Error {
  public readonly reason?: string
  public readonly headers?: Record<string, string>

  constructor(
    public statusCode: number,
    message: string,
    options: HttpErrorOptions = {},
  ) {
    super(message)
    this.name = 'HttpError'
    this.reason = options.reason
    this.headers = options.headers
  }
}

export const applyHttpErrorHeaders = (err: HttpError, res: Response) => {
  for (const [header, value] of Object.entries(err.headers ?? {})) {
    res.setHeader(header, value)
  }
}

/**
 * The service's only error handler.
 *
 * The body shape is the one the service has always served — `error` carries the
 * message — rather than this middleware's previous, never-reached shape, which
 * put `err.name` in `error` and the message in a separate field. This handler was
 * exported but never registered, so the shape it described was fiction; changing
 * live responses to match dead code would have been a gratuitous API break.
 *
 * `_next` is declared but unused *deliberately*: Express identifies an error
 * handler by arity (`Layer.prototype.handle_error` bails with `fn.length !== 4`),
 * so dropping the parameter does not merely lose a feature — it demotes this to
 * ordinary middleware. Errors then skip it entirely and fall through to
 * finalhandler, which answers HTML and drops `reason`, while unmatched routes get
 * routed *into* it with `(req, res, next)` and die on `res.status is not a
 * function`. `errorMiddleware.length === 4` is load-bearing; see the registration
 * test in `__tests__/errorMiddleware.spec.ts`.
 */
export const errorMiddleware: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) => {
  logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err))

  if (err instanceof HttpError) {
    applyHttpErrorHeaders(err, res)
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.reason ? { reason: err.reason } : {}),
    })
    return
  }

  res.status(500).send('Internal Server Error')
}
