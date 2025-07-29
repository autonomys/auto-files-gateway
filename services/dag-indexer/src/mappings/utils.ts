import { decodeNode, IPLDNodeData, PBNode } from '@autonomys/auto-dag-data'

export const PAD_ZEROS = '0'.repeat(32)

export const hexToUint8Array = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0)
    throw new Error('Hex string must have an even length')
  return new Uint8Array(
    hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
  )
}

export const getSortId = (
  blockHeight: bigint | string,
  indexInBlock?: bigint | string,
): string => {
  const str1 = blockHeight.toString().padStart(20, PAD_ZEROS)
  if (indexInBlock === undefined) return str1
  const str2 = indexInBlock.toString().padStart(10, PAD_ZEROS)
  return str1 + '-' + str2
}

// Add DAG-PB validation utilities
export const isValidHexString = (hex: string): boolean => {
  return hex.length > 0 && /^[0-9a-fA-F]+$/.test(hex)
}

export const isValidBuffer = (buffer: Buffer): boolean => {
  return buffer && buffer.length > 0
}

export const safeDecodeNode = (
  buffer: Uint8Array,
  extrinsicId: string,
): PBNode | null => {
  try {
    return decodeNode(buffer)
  } catch (error) {
    logger.warn(
      `Failed to decode DAG-PB node for extrinsic ${extrinsicId}: ${error}`,
    )
    return null
  }
}

export const safeDecodeIPLDData = async (
  nodeData: Uint8Array,
  extrinsicId: string,
): Promise<IPLDNodeData | null> => {
  try {
    const { IPLDNodeData } = await import('@autonomys/auto-dag-data')
    return IPLDNodeData.decode(nodeData)
  } catch (error) {
    logger.warn(
      `Failed to decode IPLD node data for extrinsic ${extrinsicId}: ${error}`,
    )
    return null
  }
}

export type ExtrinsicPrimitive = {
  callIndex: string
  args: any
}

export type ExtrinsicHuman = ExtrinsicPrimitive & {
  method: string
  section: string
}
