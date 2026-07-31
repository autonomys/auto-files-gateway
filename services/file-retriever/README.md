# File Retriever

HTTP service that composes and serves files from the Autonomys DSN. Streams IPLD DAG-PB chunks into complete files with support for byte-range requests, caching, and content moderation.

For architecture and API documentation, see [docs/file-retriever.md](../../docs/file-retriever.md).

## Environment Variables

### Required

| Variable                     | Description                                           |
| ---------------------------- | ----------------------------------------------------- |
| `API_SECRET`                 | API authentication token                              |
| `SUBSPACE_GATEWAY_URLS`      | Comma-separated Subspace Gateway URLs                 |
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

### DAG Indexer Fallback

Node metadata and chunk ordering normally come from the DAG Indexer. When it has
no row for a CID (it trails the chain, and a failed mapping leaves a permanent
gap), the service reconstructs both from the DSN instead of reporting the file as
missing.

| Variable                                           | Default   | Description                                                       |
| -------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| `DAG_INDEXER_FALLBACK_ENABLED`                     | `true`    | Reconstruct metadata/chunks from the DSN on indexer miss           |
| `DAG_INDEXER_FALLBACK_MAX_NODES`                   | `5000`    | Max nodes walked to rebuild one file's chunk list                  |
| `DAG_INDEXER_FALLBACK_CHUNK_LIST_CACHE_SIZE`       | `500`     | Rebuilt chunk lists kept in memory (entry count)                   |
| `DAG_INDEXER_FALLBACK_CHUNK_LIST_CACHE_MAX_CHUNKS` | `100000`  | Total chunk records across all cached lists — the real memory cap  |
| `DAG_INDEXER_FALLBACK_CHUNK_LIST_CACHE_TTL`        | `600000`  | Chunk list cache idle TTL in milliseconds (10 minutes)             |
| `DAG_INDEXER_FALLBACK_DEADLINE_MS`                 | `45000`   | Wall-clock budget for one reconstruction (`0` disables)            |
| `DAG_INDEXER_LAG_ALERT_BLOCKS`                     | `1000`    | Lag at which `/health/dag-indexer` reports degraded                |
| `UNAVAILABLE_RETRY_AFTER_SECONDS`                  | `60`      | `Retry-After` advertised on a `503`                                |

Keep `DEADLINE_MS` below the caller's own timeout — auto-drive allows the
gateway 60s via `FILES_GATEWAY_FETCH_TIMEOUT_MS`. A single node fetch may take
`FETCH_TIMEOUT` (180s) and is retried three times, so without this budget one
slow reconstruction can far outlive the request that asked for it.

`..._CACHE_SIZE` bounds how many files are cached; `..._CACHE_MAX_CHUNKS`
bounds how much memory they can occupy between them. Keep `MAX_CHUNKS`
comfortably above `MAX_NODES`, since a list larger than the whole budget is
silently not cached (each affected request then re-walks the DAG).

### Monitoring (Optional)

| Variable                 | Description                     |
| ------------------------ | ------------------------------- |
| `VICTORIA_ACTIVE`        | Enable metrics (`true`/`false`) |
| `VICTORIA_ENDPOINT`      | VictoriaMetrics endpoint        |
| `VICTORIA_USERNAME`      | Auth username                   |
| `VICTORIA_PASSWORD`      | Auth password                   |
| `METRIC_ENVIRONMENT_TAG` | Environment tag for metrics     |

## Running

**Development:**

```bash
# From repository root
make file-retriever
yarn file-retriever start
```

**Docker:**

```bash
docker-compose -f docker/file-retriever/docker-compose.yml up
```

## Health Check

```
GET http://localhost:8090/health             # liveness
GET http://localhost:8090/health/dag-indexer # DAG Indexer frontier
```

`/health` returns 200 OK when the service is running. It ignores DAG Indexer lag
on purpose — the service can still serve cached files and reconstruct unindexed
ones, so failing liveness would remove the only component still able to serve
them. `/health/dag-indexer` reports the frontier and returns `503` once the lag
exceeds `DAG_INDEXER_LAG_ALERT_BLOCKS`; alert on that one.

## API Endpoints

All `/files/*` and `/moderation/*` endpoints require authentication via:

- Header: `Authorization: Bearer <API_SECRET>`
- Query param: `?api_key=<API_SECRET>`

### File Operations

- `GET /files/:cid` — Stream file content
- `GET /files/:cid/metadata` — Get IPLD metadata
- `GET /files/:cid/status` — Check cache status
- `GET /files/:cid/partial?chunk=N` — Get specific chunk

### Moderation

- `POST /moderation/:cid/ban` — Ban a CID
- `POST /moderation/:cid/unban` — Unban a CID
- `GET /moderation/:cid/status` — Check ban status
- `GET /moderation/banned` — List banned CIDs

### Node Inspection

- `GET /nodes/:cid` — Raw DAG-PB node
- `GET /nodes/:cid/ipld` — Decoded IPLD node

## Project Structure

```
services/file-retriever/
├── src/
│   ├── index.ts              # Entry point
│   ├── config.ts             # Environment configuration
│   ├── drivers/
│   │   ├── logger.ts         # Winston logger
│   │   ├── metrics.ts        # VictoriaMetrics client
│   │   └── pg.ts             # PostgreSQL client
│   ├── http/
│   │   ├── controllers/
│   │   │   ├── file.ts       # File streaming endpoints
│   │   │   ├── health.ts     # Health check
│   │   │   ├── moderation.ts # Ban/unban endpoints
│   │   │   └── node.ts       # Node inspection
│   │   └── middlewares/
│   │       ├── auth.ts       # API authentication
│   │       └── error.ts      # Error handling
│   ├── repositories/
│   │   ├── banned-files.ts   # Moderation DB queries
│   │   └── dag-indexer.ts    # DAG node DB queries
│   └── services/
│       ├── batchOptimizer.ts # Groups objects by piece
│       ├── cache.ts          # Two-layer caching
│       ├── dsnFetcher.ts     # Subspace Gateway client
│       ├── fileComposer.ts   # DAG traversal & streaming
│       ├── moderation.ts     # Ban list management
│       └── objectMappingIndexer.ts # OMI client
└── Dockerfile
```

## Testing

```bash
yarn file-retriever test
```

Tests use supertest for HTTP endpoint testing with mocked dependencies.

`getSortedChunksByCid` is not covered: its behaviour *is* its SQL — a recursive
CTE's ordering and its join semantics — and a mocked `pg` client asserts nothing
about either. Both were wrong at one point in ways that return a `200` carrying
the wrong bytes (see the chunk-ordering and partially-indexed notes in
`docs/file-retriever.md`), so changes to that query are worth checking by hand
against a real PostgreSQL:

```bash
docker run -d --rm -p 55433:5432 -e POSTGRES_PASSWORD=test postgres:17
```

Create `"dag-indexer".nodes` per `services/dag-indexer/schema.graphql`, insert a
head with two inlinks over five leaves, and confirm the leaves come back in file
order and that deleting any referenced node shows up in `unindexedLinks`.
