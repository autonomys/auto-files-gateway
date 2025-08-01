import 'dotenv/config'
import express, { Application, Request, Response } from 'express'
import cors from 'cors'
import { fileRouter } from './http/controllers/file.js'
import { nodeRouter } from './http/controllers/node.js'
import { config } from './config.js'
import { logger } from './drivers/logger.js'
import { HttpError } from './http/middlewares/error.js'
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-function-type
app.use((err: unknown, _: Request, res: Response, __: Function) => {
  console.error(err)
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: err.message })
  } else {
    res.status(500).send('Internal Server Error')
  }
})

const port = Number(config.port)

app.listen(port, () => {
  logger.info(`File retriever service is running on port ${port}`)
})
