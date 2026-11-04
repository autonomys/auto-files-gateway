import { Router } from 'express'
import { dsnFetcher } from '../../services/dsnFetcher.js'
import { asyncSafeHandler, toSerializable } from '../../utils/express.js'
import { safeIPLDDecode } from '../../utils/dagData.js'
import { abortWhenClientGone } from '../../utils/http.js'

const nodeRouter = Router()

nodeRouter.get(
  '/:cid',
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid
    const node = await dsnFetcher.fetchNode(
      cid,
      [],
      abortWhenClientGone(res),
    )

    res.json(node)
  }),
)

nodeRouter.get(
  '/:cid/ipld',
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid
    const node = await dsnFetcher.fetchNode(
      cid,
      [],
      abortWhenClientGone(res),
    )

    const ipldNode = safeIPLDDecode(node)

    res.json(toSerializable(ipldNode))
  }),
)

export { nodeRouter }
