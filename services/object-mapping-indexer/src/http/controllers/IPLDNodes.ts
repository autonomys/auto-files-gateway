import { Router } from 'express'
import { ipldNodesRepository } from '../../repositories/IPLDNodes.js'
import { config } from '../../config.js'
import { stringify } from '@autonomys/auto-utils'

export const ipldNodesController = Router()

ipldNodesController.get('/by-block-height-range', async (req, res, next) => {
  try {
    const { fromBlock, toBlock } = req.query

    const parsedFromBlock = parseInt(fromBlock as string)
    const parsedToBlock = parseInt(toBlock as string)

    if (isNaN(parsedFromBlock) || isNaN(parsedToBlock)) {
      res.status(400).json({ error: 'Invalid block height range' })
      return
    }

    if (parsedFromBlock > parsedToBlock) {
      res.status(400).json({ error: 'Invalid block height range' })
      return
    }

    if (
      parsedToBlock - parsedFromBlock >
      config.ipldNodesAPI.maxBlockHeightRange
    ) {
      res.status(400).json({ error: 'Block height range is too large' })
      return
    }

    try {
      const objects = await ipldNodesRepository.getDagNodesByBlockHeightRange(
        parsedFromBlock,
        parsedToBlock,
      )

      res.json(stringify(objects))
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Internal server error',
      })
    }
  } catch (error) {
    next(error)
  }
})
