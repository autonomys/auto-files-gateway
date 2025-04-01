import express from 'express'

export const healthController = express.Router()

healthController.get('/', (_, res) => {
  res.sendStatus(200)
})
