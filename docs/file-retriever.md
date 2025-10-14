### File Retriever — Service Overview

The File Retriever serves content from Autonomys DSN by composing IPLD DAG-PB chunks into a file stream. It validates access, enforces moderation, consults the DAG Indexer for metadata and chunk ordering, and fetches raw objects via Subspace Gateway using Object Mapping Indexer hints.

### Flow

- Request arrives at `GET /files/:cid` with API auth.
- Validate CID and optional byte range; check moderation ban list.
- Fetch node metadata from DAG Indexer to derive size, filename, mime/encoding.
- Resolve object mappings (piece index/offset) through Object Mapping Indexer and batch-fetch nodes from Subspace Gateway.
- Stream file (DFS over chunks) or partial range; cache full responses.

### Endpoints

- `GET /health` — 200 OK.
- `GET /files/:cid/metadata` — Returns IPLD metadata for the node.
- `GET /files/:cid/status` — `{ isCached: boolean }`.
- `GET /files/:cid` — Streams the file.
  - Query: `raw=true` disables `Content-Encoding`; `originControl=no-cache` or header `x-origin-control: no-cache` bypasses cache; HTTP Range supported via `Range` header.
- `GET /files/:cid/partial?chunk=N` — Returns raw bytes for chunk N; 204 if missing.
- `POST /moderation/:cid/ban` — Ban a CID; `POST /moderation/:cid/unban` — Unban; `GET /moderation/:cid/status` — `{ isBanned }`; `GET /moderation/banned?page&limit` — paginated list.
- `GET /nodes/:cid` — Raw DAG-PB node bytes (decoded to PBNode); `GET /nodes/:cid/ipld` — Decoded IPLD node.

All `/files/*` and `/moderation/*` endpoints require API auth.

### Authentication

- Header: `Authorization: Bearer <API_SECRET>` or query: `?api_key=<API_SECRET>`.

### Caching

- Two layers:
  - Node cache: stores fetched PBNodes for batching and later migration to file cache.
  - File cache: stores complete file streams keyed by CID. Partial responses are not cached.
- Controls: set query param `originControl=no-cache` or header `x-origin-control: no-cache` to bypass cache.

### Partial Content

- Accepts HTTP Range. Determines affected chunks and slices stream precisely with `Content-Range` and `206` responses.
- For `/:cid/partial?chunk=N`, fetches the exact chunk by index.

### Dependencies

- DAG Indexer: node metadata and chunk ordering.
- Object Mapping Indexer: piece index/offset to batch fetch objects within the same piece.
- Subspace Gateway: `subspace_fetchObject` JSON-RPC to retrieve encoded nodes.

### Key Environment Variables

- `API_SECRET` (required): API token.
- `SUBSPACE_GATEWAY_URLS` (required): comma-separated gateway URLs.
- `FILE_RETRIEVER_PORT` (default: 8090)
- `CORS_ORIGIN` (default: `*`)
- `OBJECT_MAPPING_INDEXER_URL` (required)
- `DATABASE_URL` (required)
- Caching: `CACHE_DIR` (default: `./.cache`), `CACHE_MAX_SIZE` (default: 10GiB), `CACHE_TTL` (default: 24h)
- Object fetching: `MAX_OBJECTS_PER_FETCH` (100), `MAX_SIMULTANEOUS_FETCHES` (10), `FETCH_TIMEOUT` (180000 ms)
- Monitoring (optional): `VICTORIA_ACTIVE`, `VICTORIA_ENDPOINT`, `VICTORIA_USERNAME`, `VICTORIA_PASSWORD`, `METRIC_ENVIRONMENT_TAG`

### Headers and Responses

- Sets `Content-Type` from filename when deflate-compressed and not encrypted.
- `Content-Disposition: filename="<name>"` when provided.
- `Accept-Ranges: bytes` advertised; `Content-Encoding: deflate` when applicable and not `raw`.
- `x-file-origin: cache|gateway` indicates source.

### Notes

- Only `MetadataType.File` nodes are streamable; otherwise 400.
- Moderation returns 451 for banned files.
