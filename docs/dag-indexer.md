## DAG Indexer

SubQuery-based indexer that listens to `system.remark` and `system.remarkWithEvent` extrinsics and indexes DAG-PB nodes produced by `@autonomys/auto-dag-data`. Persists node metadata, links, sizes, and upload options for downstream services like File Retriever.

### How It Works

1. SubQuery runtime connects to Autonomys network via configured RPC endpoints
2. For each successful `system.remark` extrinsic:
   - Decode DAG-PB from hex remark data
   - Compute CID and BLAKE3 hash
   - Extract links and IPLD metadata
3. Save `Node` entity with block/extrinsic identifiers and metadata

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
| `extrinsicId`   | string   | Format: `{blockHeight}-{indexInBlock}`                      |
| `extrinsicHash` | string   | Extrinsic hash                                              |
| `indexInBlock`  | int      | Position within the block                                   |
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
- Size defaults to `0` if missing in metadata

### Project Details

See [services/dag-indexer/README.md](../services/dag-indexer/README.md) for configuration, environment variables, and running instructions.
