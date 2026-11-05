import { Request, Response } from 'express'
import { HttpError } from '../http/middlewares/error.js'

export const uniqueHeaderValue = (header: Request['headers'][string]) => {
  if (!header) {
    return null
  }

  return Array.isArray(header) ? header[0] : header
}

/** Aborts when the connection closes before the response has been sent. */
export const abortWhenClientGone = (res: Response): AbortSignal => {
  const controller = new AbortController()
  res.once('close', () => {
    if (!res.writableFinished) {
      controller.abort(new HttpError(499, 'Client closed request'))
    }
  })
  return controller.signal
}
