import { Request } from 'express'

export const uniqueHeaderValue = (header: Request['headers'][string]) => {
  if (!header) {
    return null
  }

  return Array.isArray(header) ? header[0] : header
}
