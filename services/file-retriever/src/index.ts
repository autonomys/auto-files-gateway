import 'dotenv/config'
import express, { Application } from 'express'
import cors from 'cors'
import { fileRouter } from './http/controllers/file.js'
import { nodeRouter } from './http/controllers/node.js'
import { config } from './config.js'
import { logger } from './drivers/logger.js'
import { errorMiddleware } from './http/middlewares/error.js'
import { healthController } from './http/controllers/health.js'
import { bandwidthTracker } from './http/middlewares/bandwidthMonitor.js'
import { moderationRouter } from './http/controllers/moderation.js'

const app: Application = express()

if (config.corsOrigin) {
  app.use(cors({ origin: config.corsOrigin }))
}

if (config.monitoring.active) {
  app.use(bandwidthTracker)
}

app.use('/files', fileRouter)
app.use('/moderation', moderationRouter)
app.use('/nodes', nodeRouter)
app.use('/health', healthController)

app.use(errorMiddleware)

const port = Number(config.port)

app.listen(port, () => {
  logger.info(`File retriever service is running on port ${port}`)
})
