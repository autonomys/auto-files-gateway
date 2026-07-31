# File Retriever

The File Retriever serves content from the Autonomys DSN by composing IPLD DAG-PB chunks into streamable files. It validates access, enforces moderation, queries the DAG Indexer for metadata and chunk ordering, and fetches raw objects via the Subspace Gateway using Object Mapping Indexer hints.

## Request Flow

1. Request arrives at `GET /files/:cid` with API authentication
2. Validate CID format and optional byte range; check moderation ban list
3. **Check cache**: If file is cached and not bypassed (via `originControl=no-cache`), return from cache
4. Fetch node metadata from DAG Indexer (size, filename, mime type, encoding)
5. **DAG Indexer miss**: reconstruct metadata and chunk ordering from the DSN (see [DAG Indexer fallback](#dag-indexer-fallback))
6. Resolve object mappings (piece index + offset) via Object Mapping Indexer
7. Batch-fetch nodes from Subspace Gateway
8. Stream file (DFS traversal over chunks) or partial range; cache full responses

## DAG Indexer Fallback

The DAG Indexer is the fast path for node metadata and chunk ordering, but it is
not authoritative: it trails the chain, and a node it fails to index leaves a
permanent gap. A miss therefore does not mean the file is absent — the object may
be perfectly retrievable from the DSN.

On a miss the service rebuilds what the indexer would have provided:

- **Metadata** is decoded from the head node fetched via its object mapping. The
  CID commits to the node bytes, so type, size, name, links and upload options are
  authoritative; chain provenance (block, extrinsic, timestamp) is left empty
  because only the indexer has it.
- **Chunk ordering** comes from walking the DAG depth-first from the head node,
  which yields leaves in file order. The indexed path derives the same order in
  SQL, from the full path of link positions down the DAG. Rebuilt chunk lists are
  cached in memory so a client fetching chunk by chunk doesn't re-walk the DAG
  per request.

A DAG larger than `DAG_INDEXER_FALLBACK_MAX_NODES` is refused with
`dag_too_large_for_fallback` — such a file can only be served once it is indexed,
so the refusal carries no `Retry-After` and is cached (the verdict is deterministic
for a content-addressed CID) to stop retries re-walking thousands of nodes. The
cache honours `DAG_INDEXER_FALLBACK_CHUNK_LIST_CACHE_TTL`, so the verdict is
re-derived once per TTL rather than being remembered forever.

Reconstruction is bounded by `DAG_INDEXER_FALLBACK_DEADLINE_MS`, and that budget
covers each individual gateway fetch as well as the walk as a whole: a fetch is
given no more than the time left, and once the budget is spent no further attempt
is started — including the retries, which `FETCH_TIMEOUT` (180s, three attempts
with a delay between them) would otherwise let run seconds past a deadline that
had already passed when the first attempt failed. Checking the clock only
_between_ fetches cannot undo that, because the check happens after the whole
retry loop has finished.

One second is the residual overrun: a clamped attempt is floored at that, so an
attempt starting with a few milliseconds left still runs for up to a second. The
floor is deliberate — a timeout of a few milliseconds fails every request it is
applied to — and it is one attempt's worth, not one per retry.

The budget applies to rebuilding _metadata_ too, not only chunk lists — a single
node is enough to hang for the full `FETCH_TIMEOUT` × retries, and
`GET /files/:cid/metadata` is the endpoint an indexer gap shows up on first.

### Partially indexed files

A missing head is not the only failure mode. Nodes are indexed one extrinsic at a
time, so a file's head can be indexed while nodes below it are not — the indexer
stopped mid-file, or dropped a node permanently. The indexed chunk list is then a
_truncated_ view of the file, which would be served as a `200` carrying the wrong
bytes (an empty body, in the case where nothing under the head was indexed).

The chunk-list query therefore reports links it could not resolve rather than
dropping them, and any unresolved link is treated exactly like a missing head:
the chunk list is rebuilt from the DSN. So a partially indexed file is served
correctly or fails honestly, never truncated.

Set `DAG_INDEXER_FALLBACK_ENABLED=false` to stop reconstructing and fail on an
indexer miss instead. Note that a partially indexed file then fails too rather
than serving a truncated body, which is a deliberate departure from the behaviour
before this fallback existed: silently short bytes under a `200` is the one
outcome worth ruling out either way.

### Monitoring the gap

`GET /health/dag-indexer` reports the indexer's frontier: `lagBlocks`,
`lastProcessedHeight`, `targetHeight` and the indexer's own `indexerHealthy`
flag. It returns `503` once the lag exceeds `DAG_INDEXER_LAG_ALERT_BLOCKS`, or
whenever the indexer flags itself unhealthy, so a monitor can alert on the status
code alone.

It also reports two timestamps, which answer different questions and are both
taken from SubQuery's `_metadata`:

| Field                         | Meaning                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `lastProcessedBlockTimestamp` | Chain timestamp of the frontier block — how stale the indexed _data_ is.      |
| `lastProcessedTimestamp`      | Wall-clock time the indexer last processed anything — whether it is _moving_. |

The difference between them is what identifies a wedge. A frontier far behind
head with `lastProcessedTimestamp` advancing is an indexer working through a
backlog, which resolves itself; a frontier that does not move _and_ a
`lastProcessedTimestamp` that does not advance is the failure seen in production,
where the frontier sat on one block for a 53-minute observation window. Alerting
on lag alone cannot tell those apart.

`GET /health` stays a pure liveness check and ignores indexer lag on purpose:
this service can still serve cached files and reconstruct unindexed ones, so
failing liveness would remove the only component still able to serve them.

Watch this endpoint whenever the fallback is enabled. Reconstruction makes a
lagging indexer look like latency rather than errors, which is exactly how a
multi-day gap can go unnoticed.

When `VICTORIA_ACTIVE=true` the service also emits a `dag_indexer_fallback`
counter tagged with `outcome`, which says how much traffic the gap is costing:

| `outcome`               | Meaning                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `metadata_rebuilt`      | Node metadata reconstructed from the DSN                            |
| `chunk_list_rebuilt`    | A DAG was walked to rebuild a chunk list (the expensive case)       |
| `chunk_list_cached`     | Unindexed file served from an already-rebuilt chunk list            |
| `chunk_list_incomplete` | The head was indexed but nodes below it were not, so it was rebuilt |
| `failed`                | Reconstruction did not produce a result                             |

Three fields accompany the outcome, each measuring a different thing:

| Field             | Meaning                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `nodes_walked`    | Nodes visited, head included — the cost, and the quantity `MAX_NODES` bounds, so the two are directly comparable. `0` for a cache hit. |
| `chunk_count`     | Leaf chunks in the resulting list — the size signal for the chunk-list cache, which is bounded in chunks, not nodes.                   |
| `unindexed_links` | Links the DAG references that the indexer had no row for.                                                                              |

Keeping them separate matters for reading the numbers at all: `nodes_walked` once
carried the leaf count for a rebuild, the _cached_ chunk count for a cache hit,
and the count of missing links for a partial index. Since the SDK calls into the
chunk list once per chunk request, that made a 5000-chunk download report 25M
walked nodes for a rebuild that visited 5000, while multi-level rebuilds
simultaneously under-reported by omitting inlinks.

A rising ratio of `chunk_list_rebuilt` to `chunk_list_cached` means rebuilds are
not being amortised — check the cache bounds and TTL before raising `MAX_NODES`.
`chunk_list_incomplete` is worth its own alert: it means the indexer is dropping
nodes, which is a different failure from trailing the chain.

## Endpoints

### Health

- `GET /health` — Returns 200 OK (liveness; ignores DAG Indexer lag by design)
- `GET /health/dag-indexer` — DAG Indexer frontier; `503` when degraded

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

`Content-Encoding: deflate` is set from the file's _bytes_, not from its
`compression: ZLIB` metadata: some stored objects carry the flag while their node
bytes are plain, and advertising the encoding over plaintext corrupts the response
for any client that honours it (autonomys/auto-files-gateway#169). The check reads
the leading bytes of the cached copy when there is one and only otherwise from the
DSN — reading them from the DSN unconditionally would make a download that needs
no DSN at all fail when the DSN is unavailable, which an unindexed file reaches as
soon as its rebuilt chunk list expires (10 minutes, against the file cache's 24
hours). When nothing local holds the bytes the check fails the request rather than
guessing: both wrong answers corrupt the body, so there is no safe default.

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
| `404`  | Neither the DAG Indexer nor the Object Mapping Indexer knows the CID       |
| `503`  | Known to the DSN but not servable yet, or not reconstructable — retryable  |

Bodies of `404`/`503` responses carry a machine-readable `reason` so callers can
pick a retry strategy instead of parsing messages:

| Reason                           | Status | Meaning                                                                                                      | Retry?                     |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `object_not_found`               | `404`  | The Object Mapping Indexer has no mapping for the CID. May still appear once its segment is archived.        | Later, with long backoff   |
| `object_not_retrievable_yet`     | `503`  | Mapping exists, bytes aren't available yet (e.g. segment still plotting).                                    | Yes, per `Retry-After`     |
| `object_mapping_lookup_failed`   | `503`  | The mapping lookup itself failed (indexer timeout/unreachable/faulting). Says nothing about the object.      | Yes, per `Retry-After`     |
| `dag_too_large_for_fallback`     | `503`  | The DAG exceeds `DAG_INDEXER_FALLBACK_MAX_NODES`. Only indexing resolves this, so no `Retry-After` is given. | No — the verdict is cached |
| `dag_indexer_fallback_timed_out` | `503`  | Reconstruction exceeded `DAG_INDEXER_FALLBACK_DEADLINE_MS`. The DSN was too slow, not necessarily unhealthy. | Yes, per `Retry-After`     |
| `dsn_gateway_fetch_failed`       | `503`  | The Subspace Gateway could not be reached or did not answer (timeout, refused connection, non-2xx).          | Yes, per `Retry-After`     |

`dsn_gateway_fetch_failed` covers the transport itself, and it is reachable on
every path that fetches nodes, including `GET /files/:cid/metadata` — which never
consulted the gateway before the fallback existed. It is separate from
`object_not_retrievable_yet` on purpose: that one is a verdict about the object
(the mapping resolved, the bytes are not there yet), while this one is the absence
of a verdict. A gateway that has stopped answering says nothing about any
particular CID, and reporting it as a fault (`500`, no `reason`, no `Retry-After`)
told callers to give up on the one failure most likely to clear on its own.

The `reason` is delivered as `{"error": "<message>", "reason": "<code>"}`, from the
error middleware registered in `index.ts`. Express identifies an error handler by
its arity, so that handler must declare four parameters (`err, req, res, next`) —
with three it is silently demoted to ordinary middleware, errors bypass it, and
callers get an HTML body with no `reason` at all.
