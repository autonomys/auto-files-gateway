### DAG Indexer — Service Overview

SubQuery-based indexer that listens to `system.remark` and `system.remark_with_event` extrinsics and indexes DAG-PB nodes produced by `@autonomys/auto-dag-data`. Persists node metadata, links, sizes, and upload options for downstream services like File Retriever.

### Flow

- SubQuery runtime connects to Subspace network (`wss://rpc.mainnet.subspace.foundation/ws`).
- For each successful `system.remark` extrinsic, decode DAG-PB, compute CID and BLAKE3, extract links and IPLD metadata.
- Save entity `Node` with block/extrinsic identifiers and metadata.

### Data Model (GraphQL schema)

- `Node` fields: `cid`, `type`, `linkDepth`, `name`, `blockHeight`, `blockHash`, `extrinsicId`, `extrinsicHash`, `indexInBlock`, `links[]`, `size`, `blake3Hash`, `timestamp`, `uploadOptions`.
- `uploadOptions` includes optional compression and encryption options.

### Mapping Logic (handleCall)

- Skip failed extrinsics.
- Decode remark hex to PBNode; derive `cid`, `links`, `blake3Hash`.
- Decode `IPLDNodeData` for `type`, `size`, `name`, `linkDepth`, `uploadOptions`.
- Persist as `Node` entity with composite indexes on `(blockHeight,indexInBlock)` and `(timestamp,indexInBlock)` for efficient ordering.

### Configuration (project.yaml)

- `dataSources[0]` kind: `substrate/Runtime` with handler `handleCall` and filter `{ module: system, method: remark }` or `{ module: system, method: remarkWithEvent }`.
- Network `chainId` and endpoint set to Subspace Mainnet.
- Runner `@subql/node` `>=5.2.9` with `unsafe: true`, `historical: false`.

### Consumers

- File Retriever queries DAG Indexer storage to get:
  - Node metadata for `/:cid/metadata` and validation.
  - Sorted chunks for multi-node files.
  - Object mapping indexer `/ipld-nodes` service.

### Notes

- Only nodes with `node.Data` are saved; others are ignored with a warning.
- `size` defaults to `0` if missing in metadata.
