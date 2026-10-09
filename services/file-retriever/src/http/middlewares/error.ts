import { ErrorRequestHandler, NextFunction, Request, Response } from 'express'
import { logger } from '../../drivers/logger.js'

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const errorMiddleware: ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) => {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      error: err.name,
      message: err.message,
    })
    return
  }

  logger.error(
    `Unhandled error in request ${req.method} ${req.originalUrl || req.url}: ${err.stack || err.message}`,
  )

  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected internal server error occurred',
  })
}
