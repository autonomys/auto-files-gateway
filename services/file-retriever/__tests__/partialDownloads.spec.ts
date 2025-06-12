import {
  createFileChunkIpldNode,
  PBNode,
  cidToString,
  cidOfNode,
  createChunkedFileIpldNode,
  processFileToIPLDFormat,
  stringToCid,
  decodeNode,
  NODE_METADATA_SIZE,
} from '@autonomys/auto-dag-data'
import { dsnFetcher } from '../src/services/dsnFetcher.js'
import { jest } from '@jest/globals'
import { randomBytes } from 'crypto'
import { MemoryBlockstore } from 'blockstore-core'

describe('Partial downloads', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should return the correct chunk', async () => {
    const nodeMapByCID: Record<string, PBNode> = {}
    const chunks = ['a', 'b', 'c', 'd', 'e']

    // Create the tree of nodes
    const nodes = chunks.map((chunk) =>
      createFileChunkIpldNode(Buffer.from(chunk, 'utf-8')),
    )
    const headNode = createChunkedFileIpldNode(
      nodes.map((node) => cidOfNode(node)),
      5n,
      1,
    )

    // Create a map of the nodes by CID
    nodes.forEach((node) => {
      const cid = cidToString(cidOfNode(node))
      nodeMapByCID[cid] = node
    })
    nodeMapByCID[cidToString(cidOfNode(headNode))] = headNode

    const cid = cidToString(cidOfNode(headNode))

    jest.spyOn(dsnFetcher, 'fetchNode').mockImplementation(async (cid) => {
      return nodeMapByCID[cid]
    })

    // First node (head) should return null
    const chunk = await dsnFetcher.getPartial(cid, 0)
    expect(chunk).toBeInstanceOf(Buffer)
    expect(chunk?.length).toBe(0)

    // Chunks 1-5 should return the correct chunk
    let i = 0
    while (i < chunks.length) {
      // i + 1 for offsetting the head node
      const chunk = await dsnFetcher.getPartial(cid, i + 1)
      expect(chunk).toBeDefined()
      expect(chunk?.toString('utf-8')).toBe(chunks[i])
      i++
    }

    // Chunk 6 should return empty buffer because it's past the end of the file
    const chunk6 = await dsnFetcher.getPartial(cid, 6)
    expect(chunk6).toBeNull()
  })

  it('should work with a large file', async () => {
    const chunksCount = 30
    const maxLinkPerNode = 5
    const chunkSize = 50
    const totalSize = chunksCount * chunkSize

    const chunks = Array.from({ length: chunksCount }).map(() =>
      randomBytes(chunkSize),
    )

    const blockstore = new MemoryBlockstore()

    const cid = cidToString(
      await processFileToIPLDFormat(
        blockstore,
        chunks,
        BigInt(totalSize),
        'dag-cbor',
        {
          maxLinkPerNode,
          maxNodeSize: chunkSize + NODE_METADATA_SIZE,
        },
      ),
    )

    jest.spyOn(dsnFetcher, 'fetchNode').mockImplementation(async (cid) => {
      return decodeNode(await blockstore.get(stringToCid(cid)))
    })

    let index = 0,
      received = 0
    while (received < chunks.length) {
      const chunk = await dsnFetcher.getPartial(cid, index)
      index++
      if (chunk && chunk?.length > 0) {
        expect(chunk.toString('hex')).toBe(chunks[received].toString('hex'))
        received++
      }
    }

    const finalResult = await dsnFetcher.getPartial(cid, index)
    expect(finalResult).toBeNull()
  })
})
