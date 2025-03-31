import express from 'express'
import { objectMappingUseCase } from '../useCases/objectMapping.js'

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

    res.json(object)

    return
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
