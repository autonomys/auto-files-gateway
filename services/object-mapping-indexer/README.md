# Object Mapping Indexer

Indexes DSN object mappings that locate objects within archived pieces. Provides HTTP and WebSocket APIs for lookups and real-time distribution.

For architecture and API documentation, see [docs/object-mapping-indexer.md](../../docs/object-mapping-indexer.md).

## Environment Variables

| Variable                      | Required | Default                       | Description                             |
| ----------------------------- | -------- | ----------------------------- | --------------------------------------- |
| `NODE_RPC_URL`                | Yes      | —                             | Autonomys Node WebSocket URL            |
| `DATABASE_URL`                | Yes      | —                             | PostgreSQL connection string            |
| `OBJECT_MAPPING_INDEXER_PORT` | No       | `3000`                        | HTTP/WebSocket server port              |
| `LOG_LEVEL`                   | No       | `info` (prod) / `debug` (dev) | Logging verbosity                       |
| `REQUEST_SIZE_LIMIT`          | No       | `200mb`                       | Max request body size                   |
| `CORS_ALLOW_ORIGINS`          | No       | —                             | Allowed CORS origins                    |
| `RECOVERY_INTERVAL`           | No       | `1000`                        | Interval between recovery batches (ms)  |
| `MAX_RECOVERY_STEP`           | No       | `1000`                        | Max mappings per recovery batch         |
| `MAX_OBJECTS_PER_MESSAGE`     | No       | `1000`                        | Max mappings per WebSocket message      |
| `TIME_BETWEEN_MESSAGES`       | No       | `1000`                        | Throttle interval between messages (ms) |
| `MAX_BLOCK_HEIGHT_RANGE`      | No       | `1000`                        | Max block range for IPLD node queries   |

## Running

**Development:**

```bash
# From repository root
make indexer
yarn indexer start
```

**Docker:**

```bash
docker-compose -f docker/object-mapping-indexer/docker-compose.yml up
```

## Database Migrations

Migrations are managed with `db-migrate`:

```bash
cd services/object-mapping-indexer
yarn db-migrate up
```

Migration files are in `migrations/sqls/`.

## Health Check

```
GET http://localhost:3000/health
```

Returns 200 OK when the service is running.

## Project Structure

```
services/object-mapping-indexer/
├── src/
│   ├── index.ts              # Entry point
│   ├── config.ts             # Environment configuration
│   ├── listeners.ts          # Subscription initialization
│   ├── drivers/
│   │   ├── logger.ts         # Winston logger
│   │   ├── pg.ts             # PostgreSQL client
│   │   └── substrateEvents.ts
│   ├── http/
│   │   ├── api.ts            # Express app setup
│   │   └── controllers/      # HTTP route handlers
│   ├── repositories/
│   │   ├── objectMapping.ts  # Object mapping DB queries
│   │   └── IPLDNodes.ts      # DAG node DB queries
│   ├── rpc/
│   │   └── server.ts         # WebSocket RPC server
│   ├── services/
│   │   ├── objectMappingListener/  # RPC subscription handler
│   │   └── objectMappingRouter/    # WebSocket distribution
│   └── useCases/
│       ├── objectMapping.ts  # Business logic
│       └── segment.ts        # Segment header tracking
├── migrations/               # Database migrations
├── __tests__/                # Jest tests
└── Dockerfile
```

## Testing

```bash
yarn indexer test
```

Tests use mocked RPC clients and an in-memory database setup.
