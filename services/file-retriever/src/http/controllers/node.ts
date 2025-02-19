import { Router } from 'express'
import { dsnFetcher } from '../../services/dsnFetcher.js'
import { asyncSafeHandler } from '../../utils/express.js'
import { safeIPLDDecode } from '../../utils/dagData.js'

const nodeRouter = Router()

nodeRouter.get(
  '/:cid',
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid
    const node = await dsnFetcher.fetchNode(cid)

    res.json(node)
  }),
)

nodeRouter.get(
  '/:cid/ipld',
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid
    const node = await dsnFetcher.fetchNode(cid)

    const ipldNode = safeIPLDDecode(node)

    res.json(ipldNode)
  }),
)

export { nodeRouter }
