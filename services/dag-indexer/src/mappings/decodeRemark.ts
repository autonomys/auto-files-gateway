import {
  blake3HashFromCid,
  cidOfNode,
  cidToString,
  decodeNode,
  IPLDNodeData,
} from '@autonomys/auto-dag-data'

/** The `Node` fields that are derived from a remark's bytes alone. */
export type DecodedNodeFields = {
  cid: string
  type: IPLDNodeData['type']
  linkDepth: number
  name: IPLDNodeData['name']
  links: string[]
  size: bigint
  blake3Hash: string
  uploadOptions: IPLDNodeData['uploadOptions']
}

export type DecodeRemarkResult =
  | { ok: true; node: DecodedNodeFields }
  | { ok: false; reason: 'undecodable' | 'no-data' }

/**
 * Decodes a remark payload as a DAG-PB node carrying `IPLDNodeData`.
 * Most remarks on chain are not DAG nodes, so failure is an expected outcome
 * and is reported in the result instead of thrown.
 */
export const decodeRemark = (bytes: Uint8Array): DecodeRemarkResult => {
  try {
    const node = decodeNode(bytes)

    const cidObject = cidOfNode(node)
    const cid = cidToString(cidObject)
    const blake3Hash = Buffer.from(blake3HashFromCid(cidObject)).toString('hex')
    const links = node.Links.map((l) => cidToString(l.Hash))

    if (!node.Data) return { ok: false, reason: 'no-data' }

    const ipldNodeData = IPLDNodeData.decode(node.Data)

    return {
      ok: true,
      node: {
        cid,
        type: ipldNodeData.type,
        linkDepth: ipldNodeData.linkDepth,
        name: ipldNodeData.name,
        links,
        size: ipldNodeData?.size ?? BigInt(0),
        blake3Hash,
        uploadOptions: ipldNodeData.uploadOptions,
      },
    }
  } catch {
    return { ok: false, reason: 'undecodable' }
  }
}
