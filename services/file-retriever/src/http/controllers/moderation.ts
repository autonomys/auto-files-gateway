import { Router } from 'express'
import { authMiddleware } from '../middlewares/auth.js'
import { asyncSafeHandler } from '../../utils/express.js'
import { moderationService } from '../../services/moderation.js'
import { isValidCID } from '../../utils/dagData.js'
import { HttpError } from '../middlewares/error.js'

export const moderationRouter = Router()

moderationRouter.post(
  '/:cid/ban',
  authMiddleware,
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid

    if (!isValidCID(cid)) {
      throw new HttpError(400, 'Invalid CID')
    }

    await moderationService.banFile(cid)

    res.status(200).json({
      success: true,
      message: `File ${cid} has been banned successfully`,
    })
  }),
)

moderationRouter.post(
  '/:cid/unban',
  authMiddleware,
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid
    if (!isValidCID(cid)) {
      throw new HttpError(400, 'Invalid CID')
    }

    await moderationService.unbanFile(cid)

    res.status(200).json({
      success: true,
      message: `File ${cid} has been unbanned successfully`,
    })
  }),
)

moderationRouter.get(
  '/banned',
  authMiddleware,
  asyncSafeHandler(async (req, res) => {
    const page = parseInt(req.query.page as string)
    const limit = parseInt(req.query.limit as string)

    const bannedFiles = await moderationService.getAllBannedFiles(page, limit)

    res.status(200).json({
      bannedFiles,
    })
  }),
)

moderationRouter.get(
  '/:cid/status',
  authMiddleware,
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid

    const isBanned = await moderationService.isFileBanned(cid)

    res.status(200).json({
      isBanned,
    })
  }),
)
