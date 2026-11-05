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

| Variable                   | Default  | Description                                                                       |
| -------------------------- | -------- | --------------------------------------------------------------------------------- |
| `MAX_OBJECTS_PER_FETCH`    | `100`    | Max objects per gateway request                                                   |
| `MAX_SIMULTANEOUS_FETCHES` | `10`     | Max pieces fetched from each gateway at once                                      |
| `FETCH_TIMEOUT`            | `180000` | Timeout of one gateway request, in milliseconds                                   |
| `FETCH_REQUEST_TIMEOUT`    | `100000` | Max wait for a node before answering, queue and retries included, in milliseconds |

`MAX_SIMULTANEOUS_FETCHES` counts pieces. A gateway request takes one slot per piece it touches, however many of that piece's objects it asks for. It used to count objects, so a request for one piece of a file (typically 15 or 16 objects) took 15 or 16 slots, and `MAX_SIMULTANEOUS_FETCHES=20` fetched about one piece at a time. The same value now allows up to 20 pieces at once. When upgrading a deployment that sets it, start lower (for example 4 to 8) and raise it while watching `queueMs` and `fetchMs` on the `object_fetch` metric.

`FETCH_REQUEST_TIMEOUT` bounds the wait for a node on `/files/:cid/partial` and `/nodes/:cid`, and for the encoding check of `GET /files/:cid`. Each of those waits for one node, so with this below the read timeout of the proxy in front, they answer before the proxy gives up. A request that runs out of time gets a 504, but a gateway request already sent keeps running and caches its nodes, so a retry picks them up. Nodes streamed into a `GET /files/:cid` response are not bounded: a failure there can only cut the response short, and on a full download it would also stop the file being cached.

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
GET http://localhost:8090/health
```

Returns 200 OK when the service is running.

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

Tests use supertest for HTTP endpoint testing with mocked dependencies. The chunk ordering query runs against a Postgres container started with Testcontainers, so Docker must be running.
