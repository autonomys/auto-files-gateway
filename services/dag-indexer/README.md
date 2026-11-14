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

## Docker Image

CI builds `ghcr.io/autonomys/dag-indexer` from `Dockerfile` with the other gateway images and the same tags: `latest` and the short commit SHA for each commit on `main`, or the branch name and `snapshot-<short SHA>` for a prerelease. It is the SubQuery node image `subql-node-substrate:v0.3.1` with the built project in `/app`:

- `dist/index.js` and `schema.graphql`, shared by every network
- `project.mainnet.yaml` and `project.chronos.yaml`, which differ only in `chainId`. Both start at block 1 and carry no RPC endpoint.

Pull it by digest. Choose the network with `-f` and give the RPC endpoint with `--network-endpoint`:

```bash
docker run -d --name dag-indexer -p 127.0.0.1:30001:3000 \
  -e DB_HOST=<host> -e DB_PORT=5432 -e DB_USER=<user> -e DB_PASS=<password> -e DB_DATABASE=<database> \
  ghcr.io/autonomys/dag-indexer:<tag>@sha256:<digest> \
  -f /app/project.chronos.yaml \
  --network-endpoint=wss://rpc-0.chronos.autonomys.xyz/ws \
  --db-schema=dag-indexer --workers=1 --unsafe --batch-size=125 --scale-batch-size \
  --unfinalized-blocks=true --disable-historical=false --finalized-depth=100
```

- `-f` and `--network-endpoint` are both required. The image's default command, `-f /app`, finds no manifest there, and without an endpoint the node cannot connect. Either way it exits.
- `--network-endpoint` replaces any endpoint in the manifest, and the manifest's `chainId` must match the endpoint's chain, or the node exits.
- `CHAIN_ID`, `RPC_ENDPOINTS` and `START_BLOCK` are build inputs and have no effect on this image.
- The manifest sets `historical: false`, so unfinalized blocks stay off whatever `--unfinalized-blocks` says.

To see which mapping an image holds, hash its bundle:

```bash
docker run --rm --entrypoint sha256sum ghcr.io/autonomys/dag-indexer:<tag>@sha256:<digest> /app/dist/index.js
```

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
