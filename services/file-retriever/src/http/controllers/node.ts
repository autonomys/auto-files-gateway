import { Router } from 'express'
import { dsnFetcher } from '../../services/dsnFetcher.js'
import { cidToString } from '@autonomys/auto-dag-data'
import { safeIPLDDecode } from '../../utils/dagData.js'
import { asyncSafeHandler } from '../../utils/express.js'

const nodeRouter = Router()

nodeRouter.get(
  '/:cid',
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid
    const node = await dsnFetcher.fetchNode(cid, true)

    const ipldNode = safeIPLDDecode(node)

    res.json({
      links: node.Links.map((l) => cidToString(l.Hash)),
      data: Buffer.from(ipldNode!.data ?? '').toString('base64'),
      size: (ipldNode?.size ?? BigInt(0)).toString(),
      filename: ipldNode?.name,
    })
  }),
)

export { nodeRouter }
