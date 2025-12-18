# Object Mapping Indexer

The Object Mapping Indexer tracks where objects are located within the DSN (piece index + offset). It subscribes to the Autonomys Node for object mapping events emitted during archiving, persists them to PostgreSQL, and provides HTTP and WebSocket APIs for lookups.

## How It Works

1. Subscribes to `subspace_subscribeObjectMappings` on the Autonomys Node
2. On each notification, persists `[hash, pieceIndex, pieceOffset, blockNumber]` to the database
3. Exposes HTTP API for lookups by hash, CID, block number, or piece index
4. Provides WebSocket RPC for real-time streaming and recovery (catch-up) subscriptions

## HTTP Endpoints

### Health

- `GET /health` — Returns 200 OK

### Object Lookups

- `GET /objects/:hash` — Returns `GlobalObjectMapping` for a BLAKE3 hash
- `GET /objects/by-cid/:cid` — Returns `[hash, pieceIndex, pieceOffset]` for a CID
- `GET /objects/by-block/:blockNumber` — Returns array of mappings for a block
- `GET /objects/by-piece-index/:pieceIndex` — Returns array of mappings for a piece

### DAG Node Lookups

Queries the DAG Indexer database for IPLD node metadata:

- `GET /ipld-nodes/by-block-height-range?fromBlock=N&toBlock=M` — Returns DAG nodes indexed within the block range (limited by `MAX_BLOCK_HEIGHT_RANGE`)

## WebSocket RPC (JSON-RPC)

### Real-time Subscriptions

- `subscribe_object_mappings` → Returns `{ subscriptionId }`
  - Server emits `object_mapping_list([...])` batches as new mappings arrive
- `unsubscribe_object_mappings({ subscriptionId })` → Returns `{ success }`

### Recovery (Catch-up) Subscriptions

For clients that need to catch up from a specific point:

- `subscribe_recover_object_mappings({ pieceIndex, step })` → Returns `{ subscriptionId }`
  - Streams historical mappings starting from `pieceIndex`
  - Automatically switches to real-time when caught up
- `unsubscribe_recover_object_mappings({ subscriptionId })` → Returns `{ success }`

### Batch Lookups

- `get_object_mappings({ hashes })` → Returns ordered array of mappings matching input hash order

## Data Model

Each object mapping record contains:

| Field         | Type   | Description                     |
| ------------- | ------ | ------------------------------- |
| `hash`        | string | BLAKE3 hash (32 bytes, hex)     |
| `pieceIndex`  | number | Global piece index in DSN       |
| `pieceOffset` | number | Byte offset within the piece    |
| `blockNumber` | number | Block where mapping was emitted |

## Environment Variables

### Required

| Variable       | Description                  |
| -------------- | ---------------------------- |
| `NODE_RPC_URL` | Autonomys Node WebSocket URL |
| `DATABASE_URL` | PostgreSQL connection string |

### Optional

| Variable                      | Default                       | Description                |
| ----------------------------- | ----------------------------- | -------------------------- |
| `OBJECT_MAPPING_INDEXER_PORT` | `3000`                        | HTTP/WebSocket server port |
| `LOG_LEVEL`                   | `info` (prod) / `debug` (dev) | Logging verbosity          |
| `REQUEST_SIZE_LIMIT`          | `200mb`                       | Max request body size      |
| `CORS_ALLOW_ORIGINS`          | —                             | Allowed CORS origins       |

### Recovery

| Variable            | Default | Description                            |
| ------------------- | ------- | -------------------------------------- |
| `RECOVERY_INTERVAL` | `1000`  | Interval between recovery batches (ms) |
| `MAX_RECOVERY_STEP` | `1000`  | Max mappings per recovery batch        |

### Distribution (WebSocket)

| Variable                  | Default | Description                             |
| ------------------------- | ------- | --------------------------------------- |
| `MAX_OBJECTS_PER_MESSAGE` | `1000`  | Max mappings per WebSocket message      |
| `TIME_BETWEEN_MESSAGES`   | `1000`  | Throttle interval between messages (ms) |

### DAG Node API

| Variable                 | Default | Description                           |
| ------------------------ | ------- | ------------------------------------- |
| `MAX_BLOCK_HEIGHT_RANGE` | `1000`  | Max block range for IPLD node queries |

## Notes

- Uses BLAKE3 hash derived from CID when querying by CID
- Recovery subscriptions respect archived segment boundaries
- Only mappings from archived segments are distributed
