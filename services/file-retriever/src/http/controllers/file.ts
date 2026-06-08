import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import { fileComposer } from '../../services/fileComposer.js'
import { pipeline, Readable } from 'stream'
import { createInflate } from 'zlib'
import { logger } from '../../drivers/logger.js'
import { asyncSafeHandler } from '../../utils/express.js'
import { uniqueHeaderValue } from '../../utils/http.js'
import { HttpError } from '../middlewares/error.js'
import { dsnFetcher } from '../../services/dsnFetcher.js'
import { safeIPLDDecode } from '../../utils/dagData.js'
import { fileCache } from '../../services/cache.js'

// Read the first chunk of a stream without losing it, so we can inspect the
// data before committing to a decompression pipeline.
const readFirstChunk = (stream: Readable): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.removeListener('data', onData)
      stream.removeListener('error', onError)
      stream.removeListener('end', onEnd)
    }
    const onData = (chunk: Buffer) => {
      cleanup()
      stream.pause()
      resolve(Buffer.from(chunk))
    }
    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }
    const onEnd = () => {
      cleanup()
      resolve(Buffer.alloc(0))
    }
    stream.on('data', onData)
    stream.on('error', onError)
    stream.on('end', onEnd)
    stream.resume()
  })

// Validate a ZLIB header (RFC 1950): CMF low nibble is method 8 (deflate) and
// (CMF * 256 + FLG) is divisible by 31. fflate's Zlib (used on upload) always
// produces this wrapper, so genuinely-compressed data passes while raw bytes
// (a PNG flagged as compressed due to upload-side metadata mismatch) do not.
const isValidZlibHeader = (chunk: Buffer): boolean =>
  chunk.length >= 2 &&
  (chunk[0] & 0x0f) === 8 &&
  (chunk[0] * 256 + chunk[1]) % 31 === 0

// Re-emit an already-read first chunk followed by the rest of the stream.
const prependChunk = async function* (
  first: Buffer,
  rest: Readable,
): AsyncGenerator<Buffer> {
  if (first.length > 0) yield first
  yield* rest
}

const fileRouter = Router()

fileRouter.get(
  '/:cid/metadata',
  authMiddleware,
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid

    const file = await dsnFetcher.fetchNode(cid, [])
    if (file) {
      const metadata = safeIPLDDecode(file)

      res.status(200).json({
        ...metadata,
        size: metadata?.size?.toString(10),
      })
    } else {
      res.sendStatus(404)
    }
  }),
)

fileRouter.get(
  '/:cid/status',
  authMiddleware,
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid

    const isCached = await fileCache.has(cid)

    res.status(200).json({
      isCached,
    })
  }),
)

fileRouter.get(
  '/:cid',
  authMiddleware,
  asyncSafeHandler(async (req, res) => {
    logger.debug(`Fetching file ${req.params.cid} from ${req.ip}`)

    const cid = req.params.cid
    const rawMode = req.query.raw === 'true'
    const ignoreCache =
      req.query.originControl === 'no-cache' ||
      uniqueHeaderValue(req.headers['x-origin-control'])?.toLowerCase() ===
        'no-cache'

    const [fromCache, file] = await fileComposer.get(cid, ignoreCache)
    if (fromCache) {
      res.setHeader('x-file-origin', 'cache')
    } else {
      res.setHeader('x-file-origin', 'gateway')
    }

    if (file.mimeType) {
      res.set('Content-Type', file.mimeType)
    }
    if (file.filename) {
      res.set(
        'Content-Disposition',
        `filename="${encodeURIComponent(file.filename)}"`,
      )
    }

    const onStreamError = (err: NodeJS.ErrnoException | null) => {
      if (!err) return
      logger.error(`Error streaming data for cid=${cid}: ${err.message}`)
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.status(500).json({
        error: 'Failed to stream data',
        details: err.message,
      })
    }

    // Compressed (non-encrypted) files are tagged with encoding 'deflate'.
    // For non-raw requests we decompress server-side and serve plain bytes:
    // relying on the browser to auto-decompress via `Content-Encoding: deflate`
    // is unreliable (intermediary proxies can decompress the body while leaving
    // the header, and the `deflate` encoding is ambiguous), which breaks
    // <img>/fetch previews. Raw mode preserves the stored bytes verbatim for
    // callers (e.g. the backend) that handle decompression themselves.
    const shouldDecompress = !rawMode && file.encoding === 'deflate'

    if (shouldDecompress) {
      // Don't advertise Content-Length: the stored size is the compressed size,
      // not the decompressed size we're about to stream. Validate the ZLIB
      // header on the first chunk so files whose stored bytes are actually
      // uncompressed (despite compression metadata) still serve as raw bytes.
      logger.debug(`Decompressing file ${cid} for ${req.ip}`)
      const firstChunk = await readFirstChunk(file.data)
      const combinedStream = Readable.from(prependChunk(firstChunk, file.data))

      if (isValidZlibHeader(firstChunk)) {
        pipeline(combinedStream, createInflate(), res, onStreamError)
      } else {
        logger.warn(
          `Stored data for cid=${cid} is not valid zlib despite compression ` +
            'metadata — serving raw bytes',
        )
        pipeline(combinedStream, res, onStreamError)
      }
      return
    }

    if (file.size) {
      res.set('Content-Length', file.size.toString())
    }

    logger.debug(
      `Streaming file ${req.params.cid} to ${req.ip} with ${file.size} bytes`,
    )

    pipeline(file.data, res, onStreamError)
  }),
)

fileRouter.get(
  '/:cid/partial',
  authMiddleware,
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid
    const chunk = parseInt(req.query.chunk as string)
    if (isNaN(chunk)) {
      throw new HttpError(400, 'Invalid chunk')
    }

    const fileData = await dsnFetcher.getPartial(cid, chunk)
    if (fileData) {
      res.set('Content-Type', 'application/octet-stream')
      res.set('Content-Length', fileData.length.toString())
      res.send(fileData)
    } else {
      res.sendStatus(204)
    }
  }),
)

export { fileRouter }
