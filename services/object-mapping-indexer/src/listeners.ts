import { createObjectMappingListener } from './services/objectMappingListener/index.js'
import { objectMappingRouter } from './services/objectMappingRouter/index.js'

objectMappingRouter.init()
createObjectMappingListener().start()
