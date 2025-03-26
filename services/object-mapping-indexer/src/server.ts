import 'dotenv/config.js'
import express, { Request, Response } from 'express'
import cors from 'cors'
import { config } from './config.js'
import { objectsController } from './controllers/objects/http.js'
import { createObjectMappingListener } from './services/objectMappingListener/index.js'
import { healthController } from './controllers/health.js'
import { createRpcServer, createWsServer } from '@autonomys/rpc'
import http from 'http'
import { objectsRPCHandlers } from './controllers/objects/rpc.js'

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

objectMappingListener.start()

const httpServer = http.createServer(expressServer)
export const rpcServer = createRpcServer({
  server: createWsServer({
    httpServer,
    callbacks: {},
  }),
  initialHandlers: objectsRPCHandlers,
})

httpServer.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`)
})
