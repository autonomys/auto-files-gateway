import { jest } from '@jest/globals'
import {
  blake3HashFromCid,
  cidOfNode,
  cidToString,
  PBNode,
} from '@autonomys/auto-dag-data'
import type { SubstrateExtrinsic } from '@subql/types'
import {
  batchAll,
  chunkedFileNode,
  chunkNode,
  encode,
  fileNode,
  maxSizeChunkNode,
  nodeWithoutData,
  remark,
  remarkWithEvent,
  transfer,
  UNDECODABLE,
  utility,
} from './helpers'
import type { CallLike } from '../src/mappings/remarks'

type Row = Record<string, unknown>

// Rows keyed by id, as the store would hold them after upserts.
const rows = new Map<string, Row>()
const save = jest.fn(async (row: Row) => {
  rows.set(row.id as string, row)
})

jest.unstable_mockModule('../src/types/models/Node', () => ({
  Node: { create: (row: Row) => ({ save: () => save(row) }) },
}))

const { handleCall } = await import('../src/mappings/handleCall')

const log = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}
;(globalThis as unknown as { logger: typeof log }).logger = log

const BLOCK_HASH = '0x' + 'b1'.repeat(32)
const EXTRINSIC_HASH = '0x' + 'e7'.repeat(32)
const TIMESTAMP = new Date('2026-11-12T10:00:00.000Z')

const extrinsic = (
  method: CallLike,
  overrides: { success?: boolean; idx?: number; timestamp?: Date | null } = {},
): SubstrateExtrinsic =>
  ({
    idx: overrides.idx ?? 4,
    success: overrides.success ?? true,
    block: {
      timestamp:
        overrides.timestamp === null
          ? undefined
          : (overrides.timestamp ?? TIMESTAMP),
      block: {
        header: {
          number: { toString: () => '1234' },
          hash: { toString: () => BLOCK_HASH },
        },
      },
    },
    extrinsic: { method, hash: { toString: () => EXTRINSIC_HASH } },
  }) as unknown as SubstrateExtrinsic

const cidOf = (node: PBNode) => cidToString(cidOfNode(node))
const blake3Of = (node: PBNode) =>
  Buffer.from(blake3HashFromCid(cidOfNode(node))).toString('hex')

const SHARED = {
  blockHeight: 1234n,
  blockHash: BLOCK_HASH,
  extrinsicId: '1234-4',
  extrinsicHash: EXTRINSIC_HASH,
  indexInBlock: 4,
  timestamp: TIMESTAMP,
}

const allLogged = () =>
  Object.values(log)
    .flatMap((fn) => fn.mock.calls)
    .map((args) => args.join(' '))

beforeEach(() => {
  rows.clear()
  save.mockClear()
  Object.values(log).forEach((fn) => fn.mockClear())
})

describe('handleCall', () => {
  describe('standalone remark', () => {
    it('writes one row with every field', async () => {
      const node = fileNode('hello world', 'hello.txt')

      await handleCall(extrinsic(remark(encode(node))))

      expect(save).toHaveBeenCalledTimes(1)
      expect(save.mock.calls[0][0]).toEqual({
        id: cidOf(node),
        cid: cidOf(node),
        type: 'File',
        linkDepth: 0,
        name: 'hello.txt',
        blockHeight: 1234n,
        blockHash: BLOCK_HASH,
        extrinsicId: '1234-4',
        extrinsicHash: EXTRINSIC_HASH,
        indexInBlock: 4,
        links: [],
        blake3Hash: blake3Of(node),
        timestamp: TIMESTAMP,
        size: 11n,
        uploadOptions: undefined,
      })
    })

    it('indexes remarkWithEvent the same way', async () => {
      const node = fileNode('with event')
      await handleCall(extrinsic(remarkWithEvent(encode(node))))
      expect([...rows.keys()]).toEqual([cidOf(node)])
    })

    it('records links and size of a head node', async () => {
      const chunks = [chunkNode('part one'), chunkNode('part two')]
      const head = chunkedFileNode(chunks, 16n, 'big.bin')

      await handleCall(extrinsic(remark(encode(head))))

      expect(rows.get(cidOf(head))).toMatchObject({
        links: chunks.map(cidOf),
        size: 16n,
        name: 'big.bin',
      })
    })

    it('falls back to the epoch when the block has no timestamp', async () => {
      await handleCall(
        extrinsic(remark(encode(fileNode('x'))), { timestamp: null }),
      )
      expect(save.mock.calls[0][0].timestamp).toEqual(new Date(0))
    })

    it('skips a remark that is not a DAG node, without error', async () => {
      await expect(
        handleCall(extrinsic(remark(UNDECODABLE))),
      ).resolves.toBeUndefined()
      expect(save).not.toHaveBeenCalled()
      expect(log.error).not.toHaveBeenCalled()
    })
  })

  describe('utility batch', () => {
    it('writes one row per node, sharing the extrinsic fields', async () => {
      const chunks = [chunkNode('chunk a'), chunkNode('chunk bb')]
      const head = chunkedFileNode(chunks, 15n, 'file.bin')
      const nodes = [...chunks, head]

      await handleCall(
        extrinsic(batchAll(nodes.map((node) => remark(encode(node))))),
      )

      expect(save).toHaveBeenCalledTimes(3)
      const written = save.mock.calls.map(([row]) => row)
      for (const row of written) expect(row).toMatchObject(SHARED)

      expect(written.map((row) => row.cid)).toEqual(nodes.map(cidOf))
      expect(written.map((row) => row.id)).toEqual(nodes.map(cidOf))
      expect(written.map((row) => row.blake3Hash)).toEqual(nodes.map(blake3Of))
      expect(written.map((row) => row.size)).toEqual([7n, 8n, 15n])
      expect(written.map((row) => row.links)).toEqual([
        [],
        [],
        chunks.map(cidOf),
      ])
      expect(written.map((row) => row.type)).toEqual([
        'FileChunk',
        'FileChunk',
        'File',
      ])
    })

    it('writes the same row for a batched remark as for a standalone one', async () => {
      const node = fileNode('same bytes', 'same.txt')

      await handleCall(extrinsic(remark(encode(node))))
      const standalone = save.mock.calls[0][0]
      save.mockClear()

      await handleCall(extrinsic(batchAll([transfer(), remark(encode(node))])))
      expect(save.mock.calls[0][0]).toEqual(standalone)
    })

    it.each(['batch', 'forceBatch'])('indexes utility.%s', async (method) => {
      const nodes = [fileNode('one'), fileNode('two')]
      await handleCall(
        extrinsic(
          utility(
            method,
            nodes.map((n) => remark(encode(n))),
          ),
        ),
      )
      expect([...rows.keys()]).toEqual(nodes.map(cidOf))
    })

    it('indexes remarks in nested batches and single-call wrappers', async () => {
      const [n1, n2, n3] = ['n1', 'n2', 'n3'].map((s) => fileNode(s))
      await handleCall(
        extrinsic(
          batchAll([
            remark(encode(n1)),
            utility('batch', [remark(encode(n2))]),
            utility('asDerivative', 0, remark(encode(n3))),
          ]),
        ),
      )
      expect([...rows.keys()]).toEqual([n1, n2, n3].map(cidOf))
    })

    it('skips an undecodable remark and indexes the others', async () => {
      const [first, last] = [fileNode('first'), fileNode('last')]

      await handleCall(
        extrinsic(
          batchAll([
            remark(encode(first)),
            remark(UNDECODABLE),
            remark(encode(last)),
          ]),
        ),
      )

      expect([...rows.keys()]).toEqual([first, last].map(cidOf))
      expect(log.debug).toHaveBeenCalledWith(
        expect.stringMatching(/1234-4 \(remark 2 of 3\)/),
      )
      expect(log.error).not.toHaveBeenCalled()
    })

    it('skips a node without Data and indexes the others', async () => {
      const [first, last] = [fileNode('first'), fileNode('last')]

      await handleCall(
        extrinsic(
          batchAll([
            remark(encode(nodeWithoutData())),
            remark(encode(first)),
            remark(encode(last)),
          ]),
        ),
      )

      expect([...rows.keys()]).toEqual([first, last].map(cidOf))
      expect(log.warn).toHaveBeenCalledWith(
        'No IPLD data found for extrinsic 1234-4 (remark 1 of 3)',
      )
    })

    it('never logs a remark payload', async () => {
      const payload = encode(fileNode('secret payload'))
      const noData = encode(nodeWithoutData())

      await handleCall(
        extrinsic(
          batchAll([remark(payload), remark(UNDECODABLE), remark(noData)]),
        ),
      )

      const logged = allLogged().join('\n')
      for (const bytes of [payload, UNDECODABLE, noData]) {
        expect(logged).not.toContain(Buffer.from(bytes).toString('hex'))
      }
      expect(logged).not.toContain('secret payload')
    })

    it('writes a CID repeated within one batch once', async () => {
      const node = fileNode('twice')
      const other = fileNode('other')

      await expect(
        handleCall(
          extrinsic(
            batchAll([
              remark(encode(node)),
              remark(encode(other)),
              remark(encode(node)),
            ]),
          ),
        ),
      ).resolves.toBeUndefined()

      expect(save).toHaveBeenCalledTimes(2)
      expect(rows.size).toBe(2)
      expect(rows.has(cidOf(node))).toBe(true)
    })

    it('writes nothing for a batch without remarks', async () => {
      await handleCall(extrinsic(batchAll([transfer(), transfer()])))
      expect(save).not.toHaveBeenCalled()
    })

    it('processes a batch of 50 maximum-size nodes', async () => {
      const nodes = Array.from({ length: 50 }, (_, i) => maxSizeChunkNode(i))
      const payloads = nodes.map(encode)
      expect(payloads.every((p) => p.length > 65_000)).toBe(true)

      await handleCall(extrinsic(batchAll(payloads.map(remark))))

      expect(save).toHaveBeenCalledTimes(50)
      expect(new Set(rows.keys())).toEqual(new Set(nodes.map(cidOf)))
    }, 20_000)
  })

  describe('failed extrinsic', () => {
    it('writes nothing for a failed batch', async () => {
      const call = batchAll([
        remark(encode(fileNode('a'))),
        remark(encode(fileNode('b'))),
      ])
      await handleCall(extrinsic(call, { success: false }))
      expect(save).not.toHaveBeenCalled()
    })

    it('writes nothing for a failed standalone remark', async () => {
      await handleCall(
        extrinsic(remark(encode(fileNode('a'))), { success: false }),
      )
      expect(save).not.toHaveBeenCalled()
    })
  })

  describe('store errors', () => {
    it('propagates, so SubQuery retries the block', async () => {
      const nodes = [fileNode('s1'), fileNode('s2'), fileNode('s3')]
      save.mockImplementationOnce(async (row: Row) => {
        rows.set(row.id as string, row)
      })
      save.mockImplementationOnce(async () => {
        throw new Error('connection terminated')
      })

      await expect(
        handleCall(extrinsic(batchAll(nodes.map((n) => remark(encode(n)))))),
      ).rejects.toThrow('connection terminated')

      // Nothing after the failing write is attempted.
      expect(save).toHaveBeenCalledTimes(2)
    })

    it('propagates for a standalone remark too', async () => {
      save.mockImplementationOnce(async () => {
        throw new Error('store down')
      })
      await expect(
        handleCall(extrinsic(remark(encode(fileNode('solo'))))),
      ).rejects.toThrow('store down')
    })
  })
})
