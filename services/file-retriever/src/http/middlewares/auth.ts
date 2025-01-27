import { Handler, NextFunction, Request, Response } from 'express'
import { config } from '../../config.js'
import { asyncSafeHandler } from '../../utils/express.js'

export const authMiddleware: Handler = asyncSafeHandler((
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const header = req.headers.authorization

  let token: string | undefined
  if (header) {
    // Extract 'Bearer $token'
    const token = header.split(' ')[1]
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
  } else {
    token = req.query.api_key as string | undefined
  }

  if (!token || token !== config.apiSecret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  next()
})
