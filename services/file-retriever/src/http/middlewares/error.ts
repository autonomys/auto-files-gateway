import { ErrorRequestHandler, NextFunction, Request, Response } from 'express'

export interface HttpErrorOptions {
  reason?: string
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

export const errorMiddleware: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) => {
  if (err instanceof HttpError) {
    if (err.headers) {
      for (const [header, value] of Object.entries(err.headers)) {
        res.setHeader(header, value)
      }
    }
    res.status(err.statusCode).json({
      error: err.name,
      message: err.message,
      ...(err.reason ? { reason: err.reason } : {}),
    })
    return
  }

  res.status(500).json({
    error: 'unknown error',
    message: err instanceof Error ? err.message : String(err),
  })
}
