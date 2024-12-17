import 'dotenv/config'
import express, { Application } from 'express'
import cors from 'cors'
import { fileRouter } from './http/controllers/file.js'
import { nodeRouter } from './http/controllers/node.js'
import { config } from './config.js'
import { logger } from './drivers/logger.js'

const app: Application = express()

if (config.corsOrigin) {
  app.use(cors({ origin: config.corsOrigin }))
}

app.use('/files', fileRouter)
app.use('/nodes', nodeRouter)

const port = Number(config.port)

app.listen(port, () => {
  logger.info(`File retriever service is running on port ${port}`)
})
