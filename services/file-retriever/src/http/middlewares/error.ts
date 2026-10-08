import { ErrorRequestHandler, NextFunction, Request, Response } from 'express'

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
  next: NextFunction,
) => {
  console.error(err)
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      error: err.name,
      message: err.message,
    })
    return
  }

  res.status(500).json({
    error: 'Internal Server Error',
    message: err instanceof Error ? err.message : 'unknown error',
  })
}
