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
    'SubQuery indexer for indexing DAG nodes from Substrate blockchain',
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
    chainId:
      '0x66455a580aabff303720aa83adbe6c44502922251c03ba73686d5245da9e21bd',

    // Multiple endpoints for load balancing and fallback
    endpoint: ['https://rpc-0.mainnet.subspace.network'],
    // @ts-ignore
    types: {
      Solution: {
        public_key: 'AccountId32',
        reward_address: 'AccountId32',
      },
      SubPreDigest: {
        slot: 'u64',
        solution: 'Solution',
      },
    },
  },
  dataSources: [
    {
      kind: SubstrateDatasourceKind.Runtime,
      startBlock: 3167587,
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
