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

    handleDownloadResponseHeaders(
      req,
      res,
      DownloadMetadataFactory.fromIPLDData(metadata),
      {
        byteRange,
        rawMode,
      },
    )

    logger.debug(
      `Streaming file ${req.params.cid} to ${req.ip} with ${file.size} bytes`,
    )

    pipeline(file.data, res, (err) => {
      if (err) {
        if (res.headersSent) return
        console.error('Error streaming data:', err)
        res.status(500).json({
          error: 'Failed to stream data',
          details: err.message,
        })
      }
    })
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
