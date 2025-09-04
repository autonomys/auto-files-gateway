import express from 'express'
import { objectMappingUseCase } from '../../useCases/objectMapping.js'
import { stringify } from '@autonomys/auto-utils'

export const objectsController = express.Router()

objectsController.get('/:hash', async (req, res, next) => {
  try {
    const { hash } = req.params

    if (!hash) {
      res.status(400).json({ error: 'Missing hash' })
      return
    }

    const object = await objectMappingUseCase.getObject(hash)

    if (!object) {
      res.status(404).json({ error: 'Object not found' })
      return
    }

    res
      .set('Content-Type', 'application/json')
      .send(stringify(object))
      .sendStatus(200)

    return
  } catch (err) {
    next(err)
  }
})

objectsController.get('/by-cid/:cid', async (req, res, next) => {
  try {
    const { cid } = req.params

    const object = await objectMappingUseCase.getObjectByCid(cid)

    res.json(object)
  } catch (err) {
    next(err)
  }
})

objectsController.get('/by-block/:blockNumber', async (req, res, next) => {
  try {
    const { blockNumber } = req.params

    const parsedBlockNumber = parseInt(blockNumber)
    if (!blockNumber || isNaN(parsedBlockNumber)) {
      res.status(400).json({ error: 'Missing or invalid blockNumber' })
      return
    }

    const objects =
      await objectMappingUseCase.getObjectByBlock(parsedBlockNumber)

    res.json(objects)
  } catch (err) {
    next(err)
  }
})

objectsController.get('/by-piece-index/:pieceIndex', async (req, res, next) => {
  try {
    const { pieceIndex } = req.params

    const parsedPieceIndex = parseInt(pieceIndex)
    if (!pieceIndex || isNaN(parsedPieceIndex)) {
      res.status(400).json({ error: 'Missing or invalid pieceIndex' })
      return
    }

    const objects =
      await objectMappingUseCase.getObjectByPieceIndex(parsedPieceIndex)

    res.json(objects)
  } catch (err) {
    next(err)
  }
})
