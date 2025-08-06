import {
  cidToString,
  processFileToIPLDFormat,
  stringToCid,
  decodeNode,
  NODE_METADATA_SIZE,
  MetadataType,
  IPLDNodeData,
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
    const chunks = [
      {
        cid: 'bafkr6idz7htrqhks6xyntulrqfyevx3k5qrhptbmgoxlmbss65yi3u25ym',
        links: [],
        type: MetadataType.File,
        linkDepth: 0,
        blockHeight: 0,
        blockHash: '',
        extrinsicId: '',
        extrinsicHash: '',
        indexInBlock: 0,
        blake3Hash: '',
        timestamp: new Date(),
      },
    ]
    jest.spyOn(dsnFetcher, 'getFileChunks').mockResolvedValue(chunks)

    const fetchNodeSpy = jest
      .spyOn(dsnFetcher, 'fetchNode')
      .mockImplementation(async (cid) => ({
        Data: IPLDNodeData.encode({
          type: MetadataType.File,
          data: Buffer.from(cid),
        }),
        Links: [],
      }))

    const chunk = await dsnFetcher.getPartial(
      'bafkr6idz7htrqhks6xyntulrqfyevx3k5qrhptbmgoxlmbss65yi3u25ym',
      0,
    )
    expect(chunk).toEqual(Buffer.from(chunks[0].cid))
    expect(fetchNodeSpy).toHaveBeenCalledWith(
      'bafkr6idz7htrqhks6xyntulrqfyevx3k5qrhptbmgoxlmbss65yi3u25ym',
      chunks.map((e) => e.cid),
    )
  })
})
