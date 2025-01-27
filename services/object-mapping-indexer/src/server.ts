import 'dotenv/config.js'
import express, { Request, Response } from 'express'
import cors from 'cors'
import { config } from './config.js'
import { objectsController } from './controllers/objects.js'
import { createWsServer } from './drivers/ws/server.js'
import { rpcServer } from './drivers/rpcServer/index.js'
import { createObjectMappingListener } from './services/objectMappingListener/index.js'
import { healthController } from './controllers/health.js'

const createServer = () => {
  const app = express()

  // Increase the limit to 10MB (adjust as needed)
  app.use(express.json({ limit: config.requestSizeLimit }))
  app.use(
    express.urlencoded({ limit: config.requestSizeLimit, extended: true }),
  )
  if (config.corsAllowOrigins) {
    app.use(cors({ origin: config.corsAllowOrigins }))
  }

  app.use('/objects', objectsController)
  app.use('/health', healthController)

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type, @typescript-eslint/no-unused-vars
  app.use((err: unknown, _: Request, res: Response, __: Function) => {
    console.error(err)
    res.status(500).send('Internal Server Error')
  })

  return app
}

const expressServer = createServer()
const objectMappingListener = createObjectMappingListener()
const websocketServer = createWsServer(expressServer)

objectMappingListener.start()
rpcServer.init(websocketServer)
