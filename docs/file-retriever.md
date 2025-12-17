# File Retriever

The File Retriever serves content from the Autonomys DSN by composing IPLD DAG-PB chunks into streamable files. It validates access, enforces moderation, queries the DAG Indexer for metadata and chunk ordering, and fetches raw objects via the Subspace Gateway using Object Mapping Indexer hints.

## Request Flow

1. Request arrives at `GET /files/:cid` with API authentication
2. Validate CID format and optional byte range; check moderation ban list
3. **Check cache**: If file is cached and not bypassed (via `originControl=no-cache`), return from cache
4. Fetch node metadata from DAG Indexer (size, filename, mime type, encoding)
5. Resolve object mappings (piece index + offset) via Object Mapping Indexer
6. Batch-fetch nodes from Subspace Gateway
7. Stream file (DFS traversal over chunks) or partial range; cache full responses

## Endpoints

### Health

- `GET /health` — Returns 200 OK

### File Operations

- `GET /files/:cid` — Stream the file

  - Query params:
    - `raw=true` — Disable `Content-Encoding` header
    - `originControl=no-cache` — Bypass cache
  - Headers:
    - `Range: bytes=N-M` — Request byte range (returns 206)
    - `x-origin-control: no-cache` — Bypass cache

- `GET /files/:cid/metadata` — Returns IPLD metadata for the node

- `GET /files/:cid/status` — Returns `{ isCached: boolean }`

- `GET /files/:cid/partial?chunk=N` — Returns raw bytes for chunk N (204 if missing)

### Moderation

All moderation endpoints require API authentication.

- `POST /moderation/:cid/ban` — Ban a CID
- `POST /moderation/:cid/unban` — Unban a CID
- `GET /moderation/:cid/status` — Returns `{ isBanned: boolean }`
- `GET /moderation/banned?page=N&limit=M` — Paginated list of banned CIDs

### Node Inspection

- `GET /nodes/:cid` — Raw DAG-PB node bytes (decoded to PBNode)
- `GET /nodes/:cid/ipld` — Decoded IPLD node with metadata

## Authentication

All `/files/*` and `/moderation/*` endpoints require authentication:

- Header: `Authorization: Bearer <API_SECRET>`
- Query param: `?api_key=<API_SECRET>`

## Caching

Two-tier caching system using LRU (Least Recently Used) eviction:

- **In-memory LRU cache**: Fast metadata lookups, evicts oldest entries when `CACHE_MAX_SIZE` is reached
- **SQLite persistence**: Metadata stored in `$CACHE_DIR/files/files.sqlite` with TTL-based expiration
- **File storage**: Complete files stored on disk at `$CACHE_DIR/files/` with partitioned directory structure

Partial range responses (206) are not cached.

**Bypass cache**: Use query param `originControl=no-cache` or header `x-origin-control: no-cache`.

## Partial Content (Range Requests)

- Supports standard HTTP Range headers
- Determines affected chunks and slices the stream precisely
- Returns `206 Partial Content` with `Content-Range` header
- For chunk-level access, use `GET /files/:cid/partial?chunk=N`

## Response Headers

| Header                | Description                                        |
| --------------------- | -------------------------------------------------- |
| `Content-Type`        | Inferred from filename (when not encrypted)        |
| `Content-Disposition` | `filename="<name>"` when filename is available     |
| `Content-Encoding`    | `deflate` for compressed files (unless `raw=true`) |
| `Accept-Ranges`       | `bytes` (advertises range support)                 |
| `x-file-origin`       | `cache` or `gateway` (indicates data source)       |

## Environment Variables

### Required

| Variable                     | Description                                           |
| ---------------------------- | ----------------------------------------------------- |
| `API_SECRET`                 | API authentication token                              |
| `SUBSPACE_GATEWAY_URLS`      | Comma-separated gateway URLs                          |
| `OBJECT_MAPPING_INDEXER_URL` | Object Mapping Indexer endpoint                       |
| `DATABASE_URL`               | PostgreSQL connection (DAG Indexer DB + banned files) |

### Optional

| Variable              | Default | Description          |
| --------------------- | ------- | -------------------- |
| `FILE_RETRIEVER_PORT` | `8090`  | HTTP server port     |
| `LOG_LEVEL`           | `info`  | Logging verbosity    |
| `CORS_ORIGIN`         | `*`     | CORS allowed origins |

### Caching

| Variable         | Default       | Description                          |
| ---------------- | ------------- | ------------------------------------ |
| `CACHE_DIR`      | `./.cache`    | File cache directory                 |
| `CACHE_MAX_SIZE` | `10737418240` | Max cache size in bytes (10 GB)      |
| `CACHE_TTL`      | `86400000`    | Cache TTL in milliseconds (24 hours) |

### Object Fetching

| Variable                   | Default  | Description                     |
| -------------------------- | -------- | ------------------------------- |
| `MAX_OBJECTS_PER_FETCH`    | `100`    | Max objects per gateway request |
| `MAX_SIMULTANEOUS_FETCHES` | `10`     | Concurrent fetch limit          |
| `FETCH_TIMEOUT`            | `180000` | Fetch timeout in milliseconds   |

### Monitoring (Optional)

| Variable                 | Description                     |
| ------------------------ | ------------------------------- |
| `VICTORIA_ACTIVE`        | Enable metrics (`true`/`false`) |
| `VICTORIA_ENDPOINT`      | VictoriaMetrics endpoint        |
| `VICTORIA_USERNAME`      | Auth username                   |
| `VICTORIA_PASSWORD`      | Auth password                   |
| `METRIC_ENVIRONMENT_TAG` | Environment tag for metrics     |

## Dependencies

| Service                  | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| DAG Indexer (PostgreSQL) | Node metadata, chunk ordering, file structure        |
| Object Mapping Indexer   | Piece index + offset for batch fetching              |
| Subspace Gateway         | `subspace_fetchObject` RPC to retrieve encoded nodes |

## Error Responses

| Status | Condition                                                                  |
| ------ | -------------------------------------------------------------------------- |
| `400`  | Invalid CID or non-streamable node type (only `File` nodes are streamable) |
| `401`  | Missing or invalid authentication                                          |
| `451`  | File is banned (Unavailable For Legal Reasons)                             |
| `404`  | File not found                                                             |
