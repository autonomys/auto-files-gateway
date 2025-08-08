import { ByteRange } from '@autonomys/file-caching'
import { Request } from 'express'

export const uniqueHeaderValue = (header: Request['headers'][string]) => {
  if (!header) {
    return null
  }

  return Array.isArray(header) ? header[0] : header
}

export const getByteRange = (req: Request): ByteRange | undefined => {
  const byteRange = req.headers['range']
  if (byteRange == null) {
    return undefined
  }
  const header = 'bytes '

  const [start, end] = byteRange.slice(header.length).split('-')
  const startNumber = Number(start)
  const endNumber = end && end !== '*' ? Number(end) : undefined

  if (
    startNumber < 0 ||
    (endNumber && endNumber < 0) ||
    (endNumber && startNumber > endNumber)
  ) {
    return undefined
  }

  return [startNumber, endNumber]
}
