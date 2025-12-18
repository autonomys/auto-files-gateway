# DAG Indexer

SubQuery-based indexer for DAG-PB nodes from the Autonomys blockchain.

For architecture and data model documentation, see [docs/dag-indexer.md](../../docs/dag-indexer.md).

## Configuration

Configuration is defined in `project.ts`:

```typescript
{
  runner: {
    node: { name: '@subql/node', version: '>=5.2.9' },
    query: { name: '@subql/query', version: '*' }
  },
  network: {
    chainId: process.env.CHAIN_ID,
    endpoint: process.env.RPC_ENDPOINTS?.split(',')
  },
  dataSources: [{
    kind: 'substrate/Runtime',
    startBlock: parseInt(process.env.START_BLOCK) || 0,
    handlers: [
      { handler: 'handleCall', filter: { module: 'system', method: 'remark' } },
      { handler: 'handleCall', filter: { module: 'system', method: 'remarkWithEvent' } }
    ]
  }]
}
```

## Environment Variables

| Variable        | Required | Default | Description                         |
| --------------- | -------- | ------- | ----------------------------------- |
| `CHAIN_ID`      | Yes      | -       | Genesis hash of the network         |
| `RPC_ENDPOINTS` | Yes      | -       | Comma-separated RPC WebSocket URLs  |
| `START_BLOCK`   | No       | `0`     | Block height to start indexing from |
| `DB_USER`       | Yes      | -       | PostgreSQL username                 |
| `DB_PASS`       | Yes      | -       | PostgreSQL password                 |
| `DB_DATABASE`   | Yes      | -       | PostgreSQL database name            |
| `DB_HOST`       | Yes      | -       | PostgreSQL host                     |
| `DB_PORT`       | Yes      | -       | PostgreSQL port                     |

## Running

**Development:**

```bash
yarn build
yarn start
```

**Docker:**

```bash
docker-compose -f docker/dag-indexer/docker-compose.yml up
```

The Docker setup runs with these SubQuery node options:

- `--db-schema=dag-indexer` — PostgreSQL schema name
- `--workers=1` — Number of worker threads
- `--batch-size=125` — Blocks per batch
- `--scale-batch-size` — Auto-scale batch size
- `--unfinalized-blocks=true` — Process unfinalized blocks
- `--finalized-depth=100` — Finalization depth threshold

## Health Check

The SubQuery node exposes a health endpoint:

```
GET http://localhost:3000/ready
```

Returns 200 OK when the indexer is ready to serve queries.

## Mapping Logic

The `handleCall` handler in `src/mappings/handleCall.ts`:

1. Skip failed extrinsics (`success === false`)
2. Extract remark hex data from extrinsic args
3. Decode to `PBNode` using `@autonomys/auto-dag-data`
4. Derive `cid`, `links[]`, and `blake3Hash`
5. Decode `IPLDNodeData` for `type`, `size`, `name`, `linkDepth`, `uploadOptions`
6. Persist as `Node` entity

## Project Structure

```
services/dag-indexer/
├── project.ts           # SubQuery project configuration
├── schema.graphql       # GraphQL schema defining Node entity
├── src/
│   ├── index.ts         # Entry point, exports handlers
│   └── mappings/
│       ├── handleCall.ts  # Main extrinsic handler
│       └── utils.ts       # Helper functions
└── libs/
    └── index.ts         # Shared library exports
```
