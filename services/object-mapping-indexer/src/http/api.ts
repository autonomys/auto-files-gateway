import { healthController } from './controllers/health.js'
import express, { Request, Response } from 'express'
import { objectsController } from './controllers/objects.js'
import { config } from '../config.js'
import cors from 'cors'

export const expressApp = express()

// Increase the limit to 10MB (adjust as needed)
expressApp.use(express.json({ limit: config.requestSizeLimit }))
expressApp.use(
  express.urlencoded({ limit: config.requestSizeLimit, extended: true }),
)
if (config.corsAllowOrigins) {
  expressApp.use(cors({ origin: config.corsAllowOrigins }))
}

expressApp.use('/objects', objectsController)
expressApp.use('/health', healthController)

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type, @typescript-eslint/no-unused-vars
expressApp.use((err: unknown, _: Request, res: Response, __: Function) => {
  console.error(err)
  res.status(500).send('Internal Server Error')
})
