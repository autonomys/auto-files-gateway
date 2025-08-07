import { IPLDNodeData } from '@autonomys/auto-dag-data'

export interface ExtendedIPLDMetadata extends Omit<IPLDNodeData, 'data'> {
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
