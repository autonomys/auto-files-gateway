import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import { fileComposer } from '../../services/fileComposer.js'
import { pipeline } from 'stream'
import { logger } from '../../drivers/logger.js'
import { asyncSafeHandler } from '../../utils/express.js'
import { uniqueHeaderValue } from '../../utils/http.js'
import { HttpError } from '../middlewares/error.js'
import { dsnFetcher } from '../../services/dsnFetcher.js'

const fileRouter = Router()

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
    if (file.size) {
      res.set('Content-Length', file.size.toString())
    }
    if (file.encoding && !rawMode) {
      res.set('Content-Encoding', file.encoding)
    }

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
