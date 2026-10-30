import {
  decodeNode,
  IPLDNodeData,
  PBNode,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { HttpError } from '../http/middlewares/error.js'

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

/**
 * Decodes the hex-encoded nodes of a fetch response.
 *
 * A body can satisfy the response schema and still not be dag-pb: the schema
 * only requires an array of strings. Decoding those bytes throws a plain
 * protobuf error, which would otherwise be reported as an internal fault of
 * this service rather than a bad answer from the gateway.
 */
export const decodeNodesOrThrow = (hexes: string[]): PBNode[] =>
  hexes.map((hex, position) => {
    try {
      return decodeNode(Buffer.from(hex, 'hex'))
    } catch (error) {
      throw new HttpError(
        502,
        `Bad gateway: Failed to decode node at position ${position} (${
          error instanceof Error ? error.message : String(error)
        })`,
      )
    }
  })
