import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import { fileComposer } from '../../services/fileComposer.js'
import { pipeline } from 'stream'
import { logger } from '../../drivers/logger.js'
import { asyncSafeHandler } from '../../utils/express.js'

const fileRouter = Router()

fileRouter.get(
  '/:cid',
  authMiddleware,
  asyncSafeHandler(async (req, res) => {
    logger.debug(`Fetching file ${req.params.cid} from ${req.ip}`)

    const cid = req.params.cid

    const file = await fileComposer.get(cid)

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
    if (file.encoding) {
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

export { fileRouter }
