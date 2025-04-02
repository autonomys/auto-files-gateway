import 'dotenv/config.js'
import { server } from './rpc/server.js'
import { config } from './config.js'
import { logger } from './drivers/logger.js'

server.listen(config.port, () => {
  logger.info(`Server is running on port ${config.port}`)
})
