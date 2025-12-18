import {
  blake3HashFromCid,
  cidOfNode,
  cidToString,
  decodeNode,
  IPLDNodeData,
  PBNode,
} from '@autonomys/auto-dag-data'
import { SubstrateExtrinsic } from '@subql/types'
import { ExtrinsicPrimitive } from './utils'
import { Node } from '../types/models/Node'

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
  try {
    // Skip if extrinsic failed
    if (!success) return

    const blockHeight = BigInt(number.toString())
    const blockHash = _blockHash.toString()
    const extrinsicId = `${blockHeight}-${indexInBlock}`
    const extrinsicHash = hash.toString()
    const blockTimestamp = timestamp ? timestamp : new Date(0)

    const methodToPrimitive = method.toPrimitive() as ExtrinsicPrimitive

    logger.debug(`Processing extrinsic`)
    const data = methodToPrimitive.args.remark
    const hexString = data.startsWith('0x') ? data.slice(2) : data
    const buffer = Buffer.from(hexString, 'hex')
    const node: PBNode = decodeNode(buffer)

    const cidObject = cidOfNode(node)
    const cid = cidToString(cidObject)
    const blake3HashArrayBuffer = blake3HashFromCid(cidObject)
    const blake3Hash = Buffer.from(blake3HashArrayBuffer).toString('hex')
    const links = node.Links.map((l) => cidToString(l.Hash))

    if (!node.Data) {
      logger.warn(`No IPLD data found for extrinsic ${extrinsicId}`)
      return
    }

    const ipldNodeData = IPLDNodeData.decode(node.Data)

    const size = ipldNodeData?.size ?? BigInt(0)
    await Node.create({
      id: cid,
      cid,
      type: ipldNodeData.type,
      linkDepth: ipldNodeData.linkDepth,
      name: ipldNodeData.name,
      blockHeight,
      blockHash,
      extrinsicId,
      extrinsicHash,
      indexInBlock,
      links,
      blake3Hash,
      timestamp: blockTimestamp,
      size,
      uploadOptions: ipldNodeData.uploadOptions,
    }).save()
  } catch (error: any) {
    logger.error('Error decoding remark or seedHistory extrinsic')
  }
}
