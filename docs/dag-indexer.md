## DAG Indexer

SubQuery-based indexer that indexes DAG-PB nodes produced by `@autonomys/auto-dag-data` and published on chain as remarks. It reads `system.remark` and `system.remarkWithEvent` extrinsics, and remarks nested inside `utility` batches. Persists node metadata, links, sizes, and upload options for downstream services like File Retriever.

### How It Works

1. SubQuery runtime connects to Autonomys network via configured RPC endpoints
2. For each successful extrinsic whose top-level call is `system.remark`, `system.remarkWithEvent` or a `utility` call, every remark it carries is read (see below) and, for each one:
   - Decode DAG-PB from the remark bytes
   - Compute CID and BLAKE3 hash
   - Extract links and IPLD metadata
3. Save one `Node` entity per remark with block/extrinsic identifiers and metadata

### Which Calls Are Indexed

| Call                                                                                    | Indexed                                 |
| --------------------------------------------------------------------------------------- | --------------------------------------- |
| Top-level `system.remark`, `system.remarkWithEvent`                                     | Yes                                     |
| Remarks inside `utility.batch`, `utility.batchAll`, `utility.forceBatch`                | Yes, every remark, in call order        |
| Remarks inside `utility.asDerivative`, `dispatchAs`, `dispatchAsFallible`, `withWeight` | Yes                                     |
| Any combination of the `utility` calls above, nested                                    | Yes, up to 10 levels of `utility` calls |
| Remarks inside `utility.ifElse`                                                         | No                                      |
| Remarks inside other pallets (sudo, multisig, scheduler, ...)                           | No                                      |

These rules mirror the runtime's object mapping (`autonomys/subspace`, `crates/subspace-runtime/src/object_mapping.rs`, including its `MAX_CALL_RECURSION_DEPTH` of 10), so the indexer has a row for the same remarks the chain maps.

Nested remarks are indexed whenever the enclosing extrinsic succeeded. Per-call batch events are not inspected: with `batchAll` success means every call ran, and with `batch` / `forceBatch` the bytes of a call that did not run are still in the block and mapped by the runtime.

A node published in a batch gets the same row as one published in a standalone remark. Its `extrinsicId`, `extrinsicHash` and `indexInBlock` are those of the enclosing extrinsic, so **all nodes of one batch share these three fields**, and their relative order under `(blockHeight, indexInBlock)` is unspecified.

### Data Model

Nodes are stored in the `dag-indexer.nodes` PostgreSQL table:

| Field           | Type     | Description                                                 |
| --------------- | -------- | ----------------------------------------------------------- |
| `id`            | string   | Primary key (same as CID)                                   |
| `cid`           | string   | Content Identifier (indexed)                                |
| `type`          | string   | Node type: `File`, `Chunk`, `ChunkLink`, `InLink`, `Folder` |
| `linkDepth`     | int      | Depth in the DAG tree                                       |
| `name`          | string   | Optional filename                                           |
| `blockHeight`   | bigint   | Block number where node was indexed                         |
| `blockHash`     | string   | Block hash                                                  |
| `extrinsicId`   | string   | `{blockHeight}-{indexInBlock}` (shared within a batch)      |
| `extrinsicHash` | string   | Hash of the top-level extrinsic (shared within a batch)     |
| `indexInBlock`  | int      | Position of the top-level extrinsic within the block        |
| `links`         | string[] | Array of linked CIDs                                        |
| `size`          | bigint   | File/chunk size in bytes                                    |
| `blake3Hash`    | string   | BLAKE3 hash (hex)                                           |
| `timestamp`     | date     | Block timestamp                                             |
| `uploadOptions` | json     | Optional compression/encryption settings                    |

**Upload Options** (when present):

```typescript
{
  compression?: {
    algorithm: string  // e.g., "zlib"
    level?: number
    chunkSize?: number
  }
  encryption?: {
    algorithm: string  // e.g., "AES-256-GCM"
    chunkSize?: number
  }
}
```

**Composite Indexes** for efficient ordering:

- `(blockHeight, indexInBlock)`
- `(timestamp, indexInBlock)`

### Data Access

File Retriever queries DAG Indexer data via **direct PostgreSQL** queries to the `"dag-indexer".nodes` table. Key query patterns:

| Query                                     | Description                               |
| ----------------------------------------- | ----------------------------------------- |
| `getDagNode(cid)`                         | Lookup single node by CID                 |
| `getDagNodesByBlockHeightRange(from, to)` | Nodes within block range                  |
| `getDagNodesByTimestampRange(from, to)`   | Nodes within time range                   |
| `getSortedChunksByCid(cid)`               | Recursive DAG traversal for file assembly |
| `searchDagNodesByUploadOptions(opts)`     | Filter by compression/encryption          |

**DAG Traversal** (used for file composition):

```sql
WITH RECURSIVE file_chunks AS (
  SELECT *, 0 AS depth FROM nodes WHERE cid = $1
  UNION ALL
  SELECT n.*, fc.depth + 1
  FROM file_chunks fc
  JOIN LATERAL jsonb_array_elements_text(fc.links) AS link ON TRUE
  JOIN nodes n ON n.cid = link
)
SELECT * FROM file_chunks WHERE links IS NULL OR jsonb_array_length(links) = 0;
```

### Notes

- Only nodes with `node.Data` are saved; others are skipped with a warning
- A remark that does not decode as a DAG node is skipped on its own; the other remarks of the same batch are still indexed
- `id` is the CID and writes are upserts, so a CID seen again overwrites the earlier row; a CID repeated within one extrinsic is written once
- Store errors fail the handler, so SubQuery retries the block rather than losing nodes
- Batched remarks in blocks indexed before batch support was deployed are not indexed; picking them up takes a reindex from the relevant block
- Size defaults to `0` if missing in metadata

### Project Details

See [services/dag-indexer/README.md](../services/dag-indexer/README.md) for configuration, environment variables, and running instructions.
