import { Router } from 'express'
import { dsnFetcher } from '../../services/dsnFetcher.js'
import { asyncSafeHandler, toSerializable } from '../../utils/express.js'
import { isValidCID, safeIPLDDecode } from '../../utils/dagData.js'
import { HttpError } from '../../types/http.js'

const nodeRouter = Router()

nodeRouter.get(
  '/:cid',
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid

    if (!isValidCID(cid)) {
      throw new HttpError(400, 'Invalid CID')
    }

    const node = await dsnFetcher.fetchNode(cid, [])

    res.json(node)
  }),
)

nodeRouter.get(
  '/:cid/ipld',
  asyncSafeHandler(async (req, res) => {
    const cid = req.params.cid

    if (!isValidCID(cid)) {
      throw new HttpError(400, 'Invalid CID')
    }

    const node = await dsnFetcher.fetchNode(cid, [])

    const ipldNode = safeIPLDDecode(node)

    res.json(toSerializable(ipldNode))
  }),
)

export { nodeRouter }
