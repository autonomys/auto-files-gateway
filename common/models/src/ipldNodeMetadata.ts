import { IPLDNodeData } from '@autonomys/auto-dag-data'

export interface ExtendedIPLDMetadata extends IPLDNodeData {
  cid: string
  blockHeight: number
  blockHash: string
  extrinsicId: string
  extrinsicHash: string
  indexInBlock: number
  links: string[]
  blake3Hash: string
  timestamp: Date
}
