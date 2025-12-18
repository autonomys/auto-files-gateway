import { IPLDNodeData, PBNode, stringToCid } from '@autonomys/auto-dag-data'

export const safeIPLDDecode = (node: PBNode): IPLDNodeData | undefined => {
  return node.Data ? IPLDNodeData.decode(node.Data) : undefined
}

export const isValidCID = (cid: string): boolean => {
  try {
    stringToCid(cid)
    return true
  } catch {
    return false
  }
}
