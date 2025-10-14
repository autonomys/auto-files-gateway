### Object Mapping Indexer — Service Overview

Indexes and serves DSN object mappings that locate objects within archived pieces. Provides HTTP APIs for lookups and a JSON-RPC/WebSocket interface for realtime and recovery distribution of mappings to consumers (e.g., File Retriever).

### Flow

- Listener subscribes to Subspace RPC (`subspace_subscribeObjectMappings`).
- On notification, persist `[hash, pieceIndex, pieceOffset]` with `blockNumber`.
- HTTP API exposes lookups by hash, CID, block number, and piece index.
- RPC server streams mappings to subscribers in batches and supports catch-up (recovery) from a given `pieceIndex`.

### HTTP Endpoints

- `GET /health` — 200 OK.
- `GET /objects/:hash` — Returns `GlobalObjectMapping` for a BLAKE3 `hash`.
- `GET /objects/by-cid/:cid` — Returns `[hash, pieceIndex, pieceOffset]` for a CID.
- `GET /objects/by-block/:blockNumber` — Returns array of `[hash, pieceIndex, pieceOffset]`.
- `GET /objects/by-piece-index/:pieceIndex` — Returns array of `[hash, pieceIndex, pieceOffset]`.
- `GET /ipld-nodes/by-block-height-range?fromBlock&toBlock` — Returns DAG nodes indexed within the range (size-limited by config).

### RPC (JSON-RPC over WebSocket)

- `subscribe_object_mappings` → `{ subscriptionId }` then server emits `object_mapping_list([...])` batches.
- `unsubscribe_object_mappings({ subscriptionId })` → `{ success }`.
- `subscribe_recover_object_mappings({ pieceIndex, step })` → `{ subscriptionId }` for bounded catch-up; auto-switches to realtime when caught up.
- `unsubscribe_recover_object_mappings({ subscriptionId })` → `{ success }`.
- `get_object_mappings({ hashes })` → ordered array of mappings matching input hash order.

Batching and throttling are controlled to avoid overwhelming clients; only archived segments are distributed.

### Persistence

- Stores mappings with `hash`, `pieceIndex`, `pieceOffset`, `blockNumber`.
- Lookup helpers provide ordering and ranges for efficient streaming.

### Key Environment Variables

- `OBJECT_MAPPING_INDEXER_PORT` (default: 3000)
- `REQUEST_SIZE_LIMIT` (default: `200mb`)
- `CORS_ALLOW_ORIGINS`
- `NODE_RPC_URL` (required)
- `RECOVERY_INTERVAL` (ms, default: 1000)
- `MAX_RECOVERY_STEP` (default: 1000)
- `LOG_LEVEL` (default: `debug` in dev, `info` in prod)
- `DATABASE_URL` (required)
- Distribution: `MAX_OBJECTS_PER_MESSAGE` (1000), `TIME_BETWEEN_MESSAGES` (ms, default: 1000)
- IPLD Nodes API: `MAX_BLOCK_HEIGHT_RANGE` (default: 1000)

### Notes

- Uses BLAKE3 hash derived from CID when querying by CID.
- Recovery subscription respects latest archived segment boundaries.
