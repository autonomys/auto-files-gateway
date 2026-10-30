import { ErrorRequestHandler, NextFunction, Request, Response } from 'express'
import { STATUS_CODES } from 'http'
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

  // Express and its parsers flag client errors with `status` rather than
  // throwing HttpError - a malformed %-escape in a route param becomes a
  // URIError with status 400, raised before authMiddleware runs. Those are the
  // client's fault, so answer with their status and keep them out of the
  // error log, which anyone could otherwise fill without an API key.
  const clientStatus = clientErrorStatus(error)
  if (clientStatus) {
    logger.warn(`${route} -> ${clientStatus}: ${error.name}: ${error.message}`)
    res
      .status(clientStatus)
      .json({ error: STATUS_CODES[clientStatus] ?? 'Bad Request' })
    return
  }

  logger.error(
    `${route} -> 500: ${error.stack ?? `${error.name}: ${error.message}`}`,
  )
  res.status(500).send('Internal Server Error')
}

const clientErrorStatus = (error: Error): number | undefined => {
  const { status, statusCode } = error as {
    status?: unknown
    statusCode?: unknown
  }
  const candidate = typeof status === 'number' ? status : statusCode
  return typeof candidate === 'number' && candidate >= 400 && candidate < 500
    ? candidate
    : undefined
}
