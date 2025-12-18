# Local Development Setup

This guide walks through setting up the Files Gateway locally. The system consists of three services that should be launched in order.

## Prerequisites

- Node.js (v18+)
- Yarn 4.x
- Docker and Docker Compose
- (Optional) Local Subspace node

## 1. Install Dependencies

```bash
yarn install
```

## 2. Database

Both the DAG Indexer and Object Mapping Indexer require PostgreSQL for storage.

Start a local database:

```bash
docker compose -f docker/object-mapping-indexer/docker-compose.yml --profile development up -d db
```

This creates a database at `postgres://postgres:postgres@localhost:5432/postgres`.

## 3. Subspace Node (Optional)

You can connect to a remote RPC endpoint instead of running a local node. However, with a remote node you'll need to wait for your published IPLD nodes to be archived before they become retrievable.

## 4. DAG Indexer

The DAG Indexer stores IPLD node metadata in the database. This enables features like partial file retrieval and improves performance by resolving `InLink` nodes without additional network requests.

Create `.env` at the repository root:

```bash
# SubQuery params
RPC_ENDPOINTS=wss://rpc-0.mainnet.autonomys.xyz/ws  # or your local node
CHAIN_ID=0x66455a580aabff303720aa83adbe6c44502922251c03ba73686d5245da9e21bd
START_BLOCK=0  # requires archival node if starting from 0

# Database
DB_USER=postgres
DB_PASSWORD=postgres
DB_DATABASE=postgres
DB_HOST=127.0.0.1
DB_PORT=5432
```

Build and start:

```bash
make dag-indexer
yarn dag-indexer start
```

## 5. Object Mapping Indexer

The Object Mapping Indexer tracks where objects are located in the DSN (piece index + offset).

Create `services/object-mapping-indexer/.env`:

```bash
NODE_RPC_URL=wss://rpc-0.mainnet.autonomys.xyz/ws  # or your local node
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
```

Build and start:

```bash
make indexer
yarn indexer start
```

## 6. File Retriever

The File Retriever is the HTTP service that composes and serves files from DSN chunks.

Create `services/file-retriever/.env`:

```bash
# Required
SUBSPACE_GATEWAY_URLS=http://localhost:9955
OBJECT_MAPPING_INDEXER_URL=http://localhost:3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
API_SECRET=your-secret-key

# Metrics (optional)
VICTORIA_ACTIVE=false
VICTORIA_ENDPOINT=<victoria-endpoint>
VICTORIA_USERNAME=<victoria-username>
VICTORIA_PASSWORD=<victoria-password>

# Configuration (optional)
CORS_ORIGIN=*
MAX_SIMULTANEOUS_FETCHES=10
CACHE_DIR=./.cache
CACHE_MAX_SIZE=1024000000
CACHE_TTL=86400000
```

Build and start:

```bash
make file-retriever
yarn file-retriever start
```

## Verification

Once all services are running, the Files Gateway is ready. You can test file retrieval:

```bash
curl -H "Authorization: Bearer your-secret-key" \
  http://localhost:8090/files/<CID>
```

## Related Documentation

- [Architecture Overview](./architecture.md)
- [DAG Indexer](./dag-indexer.md)
- [Object Mapping Indexer](./object-mapping-indexer.md)
- [File Retriever](./file-retriever.md)
