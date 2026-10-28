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
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) => {
  // Not originalUrl: authMiddleware accepts the API secret as ?api_key=,
  // and these logs are shipped off the host.
  const route = `${req.method} ${req.path}`

  if (err instanceof HttpError) {
    const message = `${route} -> ${err.statusCode}: ${err.message}`
    if (err.statusCode >= 500) {
      logger.error(message)
    } else {
      logger.warn(message)
    }
    res.status(err.statusCode).json({ error: err.message })
    return
  }

  const error = err instanceof Error ? err : new Error(String(err))
  logger.error(
    `${route} -> 500: ${error.stack ?? `${error.name}: ${error.message}`}`,
  )
  res.status(500).send('Internal Server Error')
}
