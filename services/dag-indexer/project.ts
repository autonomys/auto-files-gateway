import path from 'path'
import {
  SubstrateDatasourceKind,
  SubstrateHandlerKind,
  SubstrateProject,
} from '@subql/types'
import dotenv from 'dotenv'

// Load environment variables from .env file
const envPath = path.resolve(__dirname, '../../.env')
dotenv.config({ path: envPath })

// Can expand the Datasource processor types via the genreic param
const project: SubstrateProject = {
  specVersion: '1.0.0',
  version: '0.0.1',
  name: 'dag-indexer',
  description:
    'SubQuery indexer for indexing DAG nodes from Autonomys blockchain',
  runner: {
    node: {
      name: '@subql/node',
      version: '>=5.2.9',
      options: {
        unsafe: true,
        historical: false,
        unfinalizedBlocks: false,
      },
    },
    query: {
      name: '@subql/query',
      version: '*',
    },
  },
  schema: {
    file: './schema.graphql',
  },
  network: {
    /* The genesis hash of the network (hash of block 0) */
    chainId: process.env.CHAIN_ID ?? '',

    // Multiple endpoints for load balancing and fallback
    endpoint: process.env.RPC_ENDPOINTS?.split(',') ?? [],
  },
  dataSources: [
    {
      kind: SubstrateDatasourceKind.Runtime,
      startBlock: process.env.START_BLOCK
        ? parseInt(process.env.START_BLOCK)
        : 0,
      mapping: {
        file: './dist/index.js',
        handlers: [
          {
            kind: SubstrateHandlerKind.Call,
            handler: 'handleCall',
            filter: {
              module: 'system',
              method: 'remark',
            },
          },
        ],
      },
    },
  ],
}

// Must set default to the project instance
export default project
