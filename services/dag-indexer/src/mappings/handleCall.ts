import { SubstrateExtrinsic } from '@subql/types'
import { decodeRemark, DecodedNodeFields } from './decodeRemark'
import { CallLike, extractRemarks } from './remarks'
import { Node } from '../types/models/Node'

/**
 * Indexes every DAG node published by an extrinsic: the remark of a top-level
 * `system.remark` / `system.remarkWithEvent`, or every remark nested in a
 * top-level `utility` call (see `extractRemarks`).
 *
 * Nodes of one batch share the enclosing extrinsic's `extrinsicId`,
 * `extrinsicHash` and `indexInBlock`.
 *
 * A remark that is not a DAG node is skipped on its own. Store errors are not
 * caught: they propagate so SubQuery retries the block instead of losing nodes.
 */
export async function handleCall(_call: SubstrateExtrinsic): Promise<void> {
  const {
    idx: indexInBlock,
    block: {
      timestamp,
      block: {
        header: { number, hash: _blockHash },
      },
    },
    extrinsic: { method, hash },
    success,
  } = _call

  // Skip if extrinsic failed
  if (!success) return

  const blockHeight = BigInt(number.toString())
  const extrinsicId = `${blockHeight}-${indexInBlock}`

  const remarks = extractRemarks(method as unknown as CallLike)
  if (remarks.length === 0) return

  // Keyed by CID so a CID repeated within one extrinsic is written once
  // (last one wins, as with consecutive upserts).
  const nodes = new Map<string, DecodedNodeFields>()
  remarks.forEach((bytes, position) => {
    const decoded = decodeRemark(bytes)
    if (decoded.ok) {
      nodes.set(decoded.node.cid, decoded.node)
      return
    }
    const where = `extrinsic ${extrinsicId} (remark ${position + 1} of ${remarks.length})`
    if (decoded.reason === 'no-data') {
      logger.warn(`No IPLD data found for ${where}`)
    } else {
      logger.debug(`Remark is not a DAG node, skipping ${where}`)
    }
  })
  if (nodes.size === 0) return

  const blockHash = _blockHash.toString()
  const extrinsicHash = hash.toString()
  const blockTimestamp = timestamp ? timestamp : new Date(0)

  for (const node of nodes.values()) {
    await Node.create({
      id: node.cid,
      cid: node.cid,
      type: node.type,
      linkDepth: node.linkDepth,
      name: node.name,
      blockHeight,
      blockHash,
      extrinsicId,
      extrinsicHash,
      indexInBlock,
      links: node.links,
      blake3Hash: node.blake3Hash,
      timestamp: blockTimestamp,
      size: node.size,
      uploadOptions: node.uploadOptions,
    }).save()
  }
}
