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
  const route = `${req.method} ${req.originalUrl}`

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
    `${route} -> 500: ${error.name}: ${error.message}${
      error.stack ? `\n${error.stack}` : ''
    }`,
  )
  res.status(500).send('Internal Server Error')
}
