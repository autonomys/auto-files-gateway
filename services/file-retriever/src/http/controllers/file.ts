import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import { fileComposer } from '../../services/fileComposer.js'
import { pipeline } from 'stream'
import { logger } from '../../drivers/logger.js'
import { asyncSafeHandler, toSerializable } from '../../utils/express.js'
import { uniqueHeaderValue } from '../../utils/http.js'
import { HttpError } from '../middlewares/error.js'
import { dsnFetcher } from '../../services/dsnFetcher.js'
import { isValidCID } from '../../utils/dagData.js'
import { fileCache } from '../../services/cache.js'
import {
  DownloadMetadataFactory,
  handleDownloadResponseHeaders,
  createResponseBodyTransform,
  getByteRange,
} from '@autonomys/file-server'

const fileRouter = Router()

fileRouter.get(
  '/:cid/metadata',
  authMiddleware,
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid

    if (!isValidCID(cid)) {
      throw new HttpError(400, 'Invalid CID')
    }

    const metadata = await dsnFetcher.fetchNodeMetadata(cid)
    res.status(200).json(toSerializable(metadata))
  }),
)

fileRouter.get(
  '/:cid/status',
  authMiddleware,
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid
    if (!isValidCID(cid)) {
      throw new HttpError(400, 'Invalid CID')
    }

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
    if (!isValidCID(cid)) {
      throw new HttpError(400, 'Invalid CID')
    }

    const rawMode = req.query.raw === 'true'
    const byteRange = getByteRange(req)
    const ignoreCache =
      req.query.originControl === 'no-cache' ||
      uniqueHeaderValue(req.headers['x-origin-control'])?.toLowerCase() ===
        'no-cache'

    const metadata = await dsnFetcher.fetchNodeMetadata(cid)
    if (byteRange) {
      if (byteRange[0] > Number(metadata.size)) {
        res.set('Content-Range', `bytes */${metadata.size}`)
        res.sendStatus(416)
        return
      }
    }

    const [fromCache, file] = await fileComposer.get(cid, {
      ignoreCache,
      byteRange,
    })
    res.setHeader('x-file-origin', fromCache ? 'cache' : 'gateway')

    const downloadMetadata = DownloadMetadataFactory.fromIPLDData(metadata)

    // Some stored objects are flagged `compression: ZLIB` in their metadata while
    // their actual node bytes are uncompressed (autonomys/auto-files-gateway#169).
    // Trusting the flag makes the gateway advertise `Content-Encoding: deflate`
    // (full-body path) or attempt a server-side inflate (range path) over plaintext,
    // breaking the response for any client that honors the encoding. Verify against
    // the real bytes and serve as uncompressed when the flag doesn't match. This
    // runs for both full-body and range responses since both flow through here.
    if (downloadMetadata.isCompressed && !downloadMetadata.isEncrypted) {
      downloadMetadata.isCompressed = await dsnFetcher.isActuallyCompressed(cid)
    }

    const downloadResult = handleDownloadResponseHeaders(
      req,
      res,
      downloadMetadata,
      {
        byteRange,
        rawMode,
      },
    )

    logger.debug(
      `Streaming file ${req.params.cid} to ${req.ip} with ${file.size} bytes`,
    )

    pipeline(
      file.data,
      createResponseBodyTransform(downloadResult),
      res,
      (err) => {
        if (err) {
          logger.error(
            `Error streaming data for cid=${req.params.cid}: ${err.message}`,
          )
          if (res.headersSent) {
            res.destroy()
            return
          }
          res.status(500).json({
            error: 'Failed to stream data',
            details: err.message,
          })
        }
      },
    )
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

    if (!isValidCID(cid)) {
      throw new HttpError(400, 'Invalid CID')
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
