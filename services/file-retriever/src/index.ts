import 'dotenv/config'
import express, { Application, Request, Response } from 'express'
import cors from 'cors'
import { fileRouter } from './http/controllers/file.js'
import { nodeRouter } from './http/controllers/node.js'
import { config } from './config.js'
import { logger } from './drivers/logger.js'
import { HttpError } from './http/middlewares/error.js'

const app: Application = express()

if (config.corsOrigin) {
  app.use(cors({ origin: config.corsOrigin }))
}

app.use('/files', fileRouter)
app.use('/nodes', nodeRouter)

// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-function-type
app.use((err: unknown, _: Request, res: Response, __: Function) => {
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
