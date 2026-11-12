import {
  cidOfNode,
  createChunkedFileIpldNode,
  createFileChunkIpldNode,
  createSingleFileIpldNode,
  DEFAULT_MAX_CHUNK_SIZE,
  encodeNode,
  PBNode,
} from '@autonomys/auto-dag-data'
import { CallLike } from '../src/mappings/remarks'

export const encode = (node: PBNode): Uint8Array => encodeNode(node)

/** A small single-file node; distinct `content` gives a distinct CID. */
export const fileNode = (content: string, name?: string): PBNode =>
  createSingleFileIpldNode(Buffer.from(content), name)

export const chunkNode = (content: string): PBNode =>
  createFileChunkIpldNode(Buffer.from(content))

/** A chunk node filled to the maximum chunk size (about 64 KiB encoded). */
export const maxSizeChunkNode = (seed: number): PBNode => {
  const data = Buffer.alloc(DEFAULT_MAX_CHUNK_SIZE, seed % 251)
  data.writeUInt32BE(seed, 0)
  return createFileChunkIpldNode(data)
}

/** A file head node linking to `chunks`. */
export const chunkedFileNode = (
  chunks: PBNode[],
  size: bigint,
  name?: string,
): PBNode => createChunkedFileIpldNode(chunks.map(cidOfNode), size, 0, name)

/** A valid DAG-PB node that has links but no `Data`. */
export const nodeWithoutData = (): PBNode => ({
  Links: [{ Hash: cidOfNode(fileNode('linked')) }],
})

export const UNDECODABLE = new Uint8Array([0xff, 0xff, 0xff, 0xff])

/**
 * Stand-in for a polkadot.js `Bytes` argument: `toU8a(true)` is the payload,
 * `toU8a()` carries a length prefix that must never reach the decoder.
 */
export const bytesArg = (payload: Uint8Array) => ({
  toU8a: (isBare?: boolean): Uint8Array =>
    isBare ? payload : new Uint8Array([0xfc, ...payload]),
})

export const remark = (payload: Uint8Array): CallLike => ({
  section: 'system',
  method: 'remark',
  args: [bytesArg(payload)],
})

export const remarkWithEvent = (payload: Uint8Array): CallLike => ({
  section: 'system',
  method: 'remarkWithEvent',
  args: [bytesArg(payload)],
})

export const utility = (method: string, ...args: unknown[]): CallLike => ({
  section: 'utility',
  method,
  args,
})

export const batchAll = (calls: CallLike[]): CallLike =>
  utility('batchAll', calls)

export const transfer = (): CallLike => ({
  section: 'balances',
  method: 'transferKeepAlive',
  args: ['5Grwva', 1000n],
})
