import { deflateSync } from 'zlib'
import { deflateSync as fflateRawDeflateSync, zlibSync } from 'fflate'
import { MetadataType, IPLDNodeData } from '@autonomys/auto-dag-data'
import { jest } from '@jest/globals'
import { isZlibCompressed } from '../src/utils/compression.js'
import { dsnFetcher } from '../src/services/dsnFetcher.js'

describe('isZlibCompressed', () => {
  it('recognizes a valid zlib stream (node zlib)', () => {
    const compressed = deflateSync(Buffer.from('hello world'.repeat(100)))
    expect(isZlibCompressed(compressed)).toBe(true)
  })

  it('recognizes a valid zlib stream (fflate, as used by auto-dag-data)', () => {
    const compressed = Buffer.from(
      zlibSync(new TextEncoder().encode('hello world'.repeat(100))),
    )
    expect(isZlibCompressed(compressed)).toBe(true)
  })

  it('rejects an uncompressed PNG (issue #169 repro)', () => {
    // PNG signature + start of IHDR — the broken bafkr6ia5… case
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
    ])
    expect(isZlibCompressed(png)).toBe(false)
  })

  it('rejects literal JSON bytes (issue #169 repro)', () => {
    const json = Buffer.from('{\n  "header": {\n    "agentName": "x"')
    expect(isZlibCompressed(json)).toBe(false)
  })

  it('rejects raw deflate without a zlib wrapper', () => {
    const raw = Buffer.from(
      fflateRawDeflateSync(new TextEncoder().encode('abc'.repeat(50))),
    )
    // raw deflate has no zlib header; should not be misidentified
    expect(isZlibCompressed(raw)).toBe(false)
  })

  it('rejects buffers shorter than the header', () => {
    expect(isZlibCompressed(Buffer.from([0x78]))).toBe(false)
    expect(isZlibCompressed(Buffer.alloc(0))).toBe(false)
  })
})

describe('dsnFetcher.isActuallyCompressed', () => {
  const cid = 'bafkr6idz7htrqhks6xyntulrqfyevx3k5qrhptbmgoxlmbss65yi3u25ym'

  const chunks = [
    {
      cid,
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

  beforeEach(() => {
    jest.clearAllMocks()
  })
  afterEach(() => {
    jest.clearAllMocks()
  })

  const mockFirstChunkData = (data: Buffer) => {
    jest.spyOn(dsnFetcher, 'getFileChunks').mockResolvedValue(chunks)
    jest.spyOn(dsnFetcher, 'fetchNode').mockResolvedValue({
      Data: IPLDNodeData.encode({
        type: MetadataType.File,
        data,
      }),
      Links: [],
    })
  }

  it('returns false for flagged-but-uncompressed bytes', async () => {
    mockFirstChunkData(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))
    await expect(dsnFetcher.isActuallyCompressed(cid)).resolves.toBe(false)
  })

  it('returns true for genuinely zlib-compressed bytes', async () => {
    mockFirstChunkData(deflateSync(Buffer.from('payload'.repeat(50))))
    await expect(dsnFetcher.isActuallyCompressed(cid)).resolves.toBe(true)
  })

  it('returns false when there are no chunks', async () => {
    jest.spyOn(dsnFetcher, 'getFileChunks').mockResolvedValue([])
    await expect(dsnFetcher.isActuallyCompressed(cid)).resolves.toBe(false)
  })
})
