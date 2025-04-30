import { createObjectMappingListener } from './services/objectMappingListener/index.js'
import { createObjectMappingRetriever } from './services/objectMappingRetriever/index.js'

createObjectMappingListener().start()
createObjectMappingRetriever().start()
