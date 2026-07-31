import {
  blake3HashFromCid,
  cidOfNode,
  cidToString,
  CompressionAlgorithm,
  IPLDNodeData,
  MetadataType,
  PBNode,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { ExtendedIPLDMetadata } from '@auto-files/models'
import { jest } from '@jest/globals'
import axios from 'axios'
import zlib from 'zlib'
import { config } from '../src/config.js'
import {
  dsnFetcher,
  resetDagIndexerFallbackState,
} from '../src/services/dsnFetcher.js'
import { dagIndexerRepository } from '../src/repositories/dag-indexer.js'
import { objectMappingIndexer } from '../src/services/objectMappingIndexer.js'
import { nodeCache } from '../src/services/cache.js'
import { HttpError } from '../src/http/middlewares/error.js'

const chunkNode = (content: string): PBNode => ({
  Data: IPLDNodeData.encode({
    type: MetadataType.FileChunk,
    linkDepth: 0,
    size: BigInt(content.length),
    data: Buffer.from(content),
  }),
  Links: [],
})

const parentNode = (
  children: PBNode[],
  { type = MetadataType.FileInlink, name, linkDepth = 1 } = {} as {
    type?: MetadataType
    name?: string
    linkDepth?: number
  },
): PBNode => ({
  Data: IPLDNodeData.encode({
    type,
    linkDepth,
    name,
    size: BigInt(0),
    uploadOptions: { compression: { algorithm: CompressionAlgorithm.ZLIB } },
  }),
  Links: children.map((child) => ({ Hash: cidOfNode(child) })),
})

const cidOf = (node: PBNode) => cidToString(cidOfNode(node))

/** The row the DAG indexer would hold for a node, for stubbing indexed reads. */
const metadataOf = (node: PBNode, cid = cidOf(node)): ExtendedIPLDMetadata => {
  const decoded = IPLDNodeData.decode(node.Data!)

  return {
    cid,
    type: decoded.type,
    linkDepth: decoded.linkDepth,
    name: decoded.name,
    size: decoded.size ?? BigInt(0),
    uploadOptions: decoded.uploadOptions,
    links: node.Links.map((link) => cidToString(link.Hash)),
    blake3Hash: '',
    blockHeight: 0,
    blockHash: '',
    extrinsicId: '',
    extrinsicHash: '',
    indexInBlock: 0,
    timestamp: new Date(0),
  }
}

/**
 * Mirrors what the RPC client throws for an error the indexer reported: an Error
 * carrying a numeric JSON-RPC code (`RpcError` is not exported from the package
 * root, and only its observable shape matters here).
 */
const rpcError = (message: string, code = -32603) =>
  Object.assign(new Error(message), { code })

/**
 * Serves the given nodes to `dsnFetcher.fetchNode` by CID and records the CIDs
 * asked for, so tests can assert on traversal order and cache hits.
 */
const stubDsnNodes = (nodes: PBNode[]) => {
  const byCid = new Map(nodes.map((node) => [cidOf(node), node]))
  const requested: string[] = []

  const spy = jest
    .spyOn(dsnFetcher, 'fetchNode')
    .mockImplementation(async (cid: string) => {
      requested.push(cid)
      const node = byCid.get(cid)
      if (!node) {
        throw new HttpError(
          404,
          `Not found: no object mapping for cid=${cid}`,
          {
            reason: 'object_not_found',
          },
        )
      }
      return node
    })

  return { spy, requested }
}

describe('DAG indexer fallback', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    // The fallback's caches are module-level, so state leaks between tests
    // without this and an assertion can be satisfied by a previous test's work.
    resetDagIndexerFallbackState()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('fetchNodeMetadata', () => {
    it('serves indexed nodes from the DAG indexer without touching the DSN', async () => {
      const node = chunkNode('indexed')
      const cid = cidOf(node)
      const indexed: ExtendedIPLDMetadata = {
        cid,
        type: MetadataType.File,
        linkDepth: 0,
        size: BigInt(7),
        links: [],
        blake3Hash: 'hash',
        blockHeight: 10,
        blockHash: 'block',
        extrinsicId: '10-1',
        extrinsicHash: 'extrinsic',
        indexInBlock: 1,
        timestamp: new Date(0),
      }
      jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(indexed)
      const { spy } = stubDsnNodes([node])

      await expect(dsnFetcher.fetchNodeMetadata(cid)).resolves.toEqual(indexed)
      expect(spy).not.toHaveBeenCalled()
    })

    it('reconstructs metadata from the DSN when the node is not indexed', async () => {
      const chunk = chunkNode('hello world')
      const head = parentNode([chunk], {
        type: MetadataType.File,
        name: 'hello.txt',
      })
      const cid = cidOf(head)

      jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
      stubDsnNodes([head, chunk])

      const metadata = await dsnFetcher.fetchNodeMetadata(cid)

      expect(metadata.cid).toBe(cid)
      expect(metadata.type).toBe(MetadataType.File)
      expect(metadata.name).toBe('hello.txt')
      expect(metadata.links).toEqual([cidOf(chunk)])
      expect(metadata.uploadOptions?.compression?.algorithm).toBe(
        CompressionAlgorithm.ZLIB,
      )
    })

    // The DAG Indexer stores `size ?? 0`, and callers do `Number(metadata.size)`
    // on the way to byte-range maths — `Number(undefined)` is NaN, which
    // silently defeats the 416 guard and corrupts range lengths.
    it('reports size as 0 rather than undefined when the node omits it', async () => {
      const head: PBNode = {
        Data: IPLDNodeData.encode({
          type: MetadataType.File,
          linkDepth: 0,
          name: 'sizeless.txt',
        }),
        Links: [],
      }
      const cid = cidOf(head)

      jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
      stubDsnNodes([head])

      const metadata = await dsnFetcher.fetchNodeMetadata(cid)

      expect(metadata.size).toBe(BigInt(0))
      expect(Number(metadata.size)).not.toBeNaN()
    })

    it('propagates a not-found miss from the DSN instead of masking it', async () => {
      const unknown = cidOf(chunkNode('unknown'))
      jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
      stubDsnNodes([])

      await expect(dsnFetcher.fetchNodeMetadata(unknown)).rejects.toMatchObject(
        {
          statusCode: 404,
          reason: 'object_not_found',
        },
      )
    })

    // `GET /files/:cid/metadata` is the endpoint the incident was reported on, and
    // it is one node — but one node is enough to hang for FETCH_TIMEOUT (180s)
    // times three retries, long past any caller's patience, with no reason given.
    describe('when the metadata fetch exceeds the deadline', () => {
      const originalDeadline = config.dagIndexerFallback.deadlineMs

      afterEach(() => {
        config.dagIndexerFallback.deadlineMs = originalDeadline
      })

      it('reports a retryable timeout instead of hanging', async () => {
        const cid = cidOf(chunkNode('slow-metadata'))
        jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
        jest.spyOn(dsnFetcher, 'fetchNode').mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 40))
          throw Object.assign(new Error('timeout of 1000ms exceeded'), {
            code: 'ECONNABORTED',
          })
        })

        config.dagIndexerFallback.deadlineMs = 20

        const error = await dsnFetcher.fetchNodeMetadata(cid).catch((e) => e)

        expect(error).toBeInstanceOf(HttpError)
        expect(error.statusCode).toBe(503)
        expect(error.reason).toBe('dag_indexer_fallback_timed_out')
        expect(error.headers?.['Retry-After']).toBeDefined()
      })

      it('clamps the metadata fetch to the budget', async () => {
        const node = chunkNode('metadata')
        const cid = cidOf(node)
        const budgets: (number | undefined)[] = []

        jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
        jest
          .spyOn(dsnFetcher, 'fetchNode')
          .mockImplementation(
            async (
              _cid: string,
              _siblings: string[],
              remainingMs?: () => number,
            ) => {
              budgets.push(remainingMs?.())
              return node
            },
          )

        config.dagIndexerFallback.deadlineMs = 5_000

        await dsnFetcher.fetchNodeMetadata(cid)

        expect(budgets).toHaveLength(1)
        expect(budgets[0]).toBeGreaterThan(0)
        expect(budgets[0]).toBeLessThanOrEqual(5_000)
      })
    })
  })

  describe('getFileChunks', () => {
    it('rebuilds the chunk list from the DSN in file order', async () => {
      const chunks = ['one', 'two', 'three', 'four'].map(chunkNode)
      const firstInlink = parentNode(chunks.slice(0, 2))
      const secondInlink = parentNode(chunks.slice(2))
      const head = parentNode([firstInlink, secondInlink], {
        type: MetadataType.File,
        name: 'big.txt',
        linkDepth: 2,
      })

      jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
      const sortedChunksSpy = jest.spyOn(
        dagIndexerRepository,
        'getSortedChunksByCid',
      )
      stubDsnNodes([head, firstInlink, secondInlink, ...chunks])

      const result = await dsnFetcher.getFileChunks(cidOf(head))

      expect(result.map((e) => e.cid)).toEqual(chunks.map(cidOf))
      expect(sortedChunksSpy).not.toHaveBeenCalled()
    })

    /**
     * The rebuild's cost is what this metric is tuned against, so it has to be
     * the walked count — a multi-level DAG fetches inlinks and the head as well
     * as leaves, and `maxNodes` bounds all of them. Reporting the leaf count
     * under-reports every multi-level rebuild and cannot be compared with
     * `DAG_INDEXER_FALLBACK_MAX_NODES` at all.
     */
    it('reports the nodes it walked, not just the leaves it found', async () => {
      const originalActive = config.monitoring.active
      const leaves = ['m1', 'm2', 'm3', 'm4'].map(chunkNode)
      const firstInlink = parentNode(leaves.slice(0, 2))
      const secondInlink = parentNode(leaves.slice(2))
      const head = parentNode([firstInlink, secondInlink], {
        type: MetadataType.File,
        name: 'metered.txt',
        linkDepth: 2,
      })

      jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
      stubDsnNodes([head, firstInlink, secondInlink, ...leaves])
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true } as Response)

      config.monitoring.active = true
      try {
        await dsnFetcher.getFileChunks(cidOf(head))
      } finally {
        config.monitoring.active = originalActive
      }

      const rebuildMetric = fetchSpy.mock.calls
        .map((call) => String(call[1]?.body))
        .find((body) => body.includes('outcome=chunk_list_rebuilt'))

      // head + 2 inlinks + 4 leaves walked, for a 4-chunk result.
      expect(rebuildMetric).toContain('nodes_walked=7')
      expect(rebuildMetric).toContain('chunk_count=4')
    })

    it('treats a single-node file as its own only chunk', async () => {
      const head = {
        Data: IPLDNodeData.encode({
          type: MetadataType.File,
          linkDepth: 0,
          name: 'small.txt',
          size: BigInt(5),
          data: Buffer.from('small'),
        }),
        Links: [],
      }

      jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
      stubDsnNodes([head])

      const result = await dsnFetcher.getFileChunks(cidOf(head))

      expect(result.map((e) => e.cid)).toEqual([cidOf(head)])
    })

    it('reuses the rebuilt chunk list across calls', async () => {
      const chunks = ['a', 'b'].map(chunkNode)
      const head = parentNode(chunks, {
        type: MetadataType.File,
        name: 'cached.txt',
      })

      jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
      const { requested } = stubDsnNodes([head, ...chunks])

      await dsnFetcher.getFileChunks(cidOf(head))
      const afterFirstCall = requested.length
      await dsnFetcher.getFileChunks(cidOf(head))

      expect(requested.length).toBe(afterFirstCall)
    })

    // The cache is only written once a walk completes, so overlapping requests
    // would each start their own full traversal of the same DAG without a
    // shared in-flight promise.
    it('collapses concurrent rebuilds of the same file into one walk', async () => {
      const chunks = ['con-1', 'con-2', 'con-3'].map(chunkNode)
      const head = parentNode(chunks, {
        type: MetadataType.File,
        name: 'concurrent.txt',
      })

      jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
      const { requested } = stubDsnNodes([head, ...chunks])

      const [first, second, third] = await Promise.all([
        dsnFetcher.getFileChunks(cidOf(head)),
        dsnFetcher.getFileChunks(cidOf(head)),
        dsnFetcher.getFileChunks(cidOf(head)),
      ])

      expect(first).toBe(second)
      expect(second).toBe(third)
      // The head plus its three chunks, fetched once — not once per caller.
      expect(requested).toHaveLength(4)
    })

    // A chunk-by-chunk download calls getFileChunks once per chunk request, so
    // the TTL must measure idle time, not total download time. Without
    // `updateAgeOnGet` a transfer slower than the TTL re-walks the DAG in the
    // middle of streaming.
    //
    // Uses a real (short) TTL rather than fake timers: lru-cache captures the
    // `performance` object at import time, so jest's fake clock never reaches it.
    describe('during a download slower than the cache TTL', () => {
      const originalTtl = config.dagIndexerFallback.chunkListCacheTtl
      const shortTtl = 150

      beforeEach(() => {
        config.dagIndexerFallback.chunkListCacheTtl = shortTtl
      })

      afterEach(() => {
        config.dagIndexerFallback.chunkListCacheTtl = originalTtl
      })

      const sleep = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms))

      it('keeps the rebuilt chunk list alive while the file is still being read', async () => {
        const chunks = ['slow-a', 'slow-b'].map(chunkNode)
        const head = parentNode(chunks, {
          type: MetadataType.File,
          name: 'slow-download.txt',
        })

        jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
        const { requested } = stubDsnNodes([head, ...chunks])

        await dsnFetcher.getFileChunks(cidOf(head))
        const afterFirstWalk = requested.length
        expect(afterFirstWalk).toBeGreaterThan(0)

        // Three reads, each inside the TTL, spanning well over one TTL in total.
        for (let i = 0; i < 3; i++) {
          await sleep(shortTtl * 0.6)
          await dsnFetcher.getFileChunks(cidOf(head))
        }

        expect(requested.length).toBe(afterFirstWalk)
      })
    })

    // Without a deadline the walk can outlive its caller: a node fetch may take
    // up to FETCH_TIMEOUT (180s) and is retried three times, while auto-drive
    // abandons the gateway after 60s. A hang is much harder to act on than a
    // 503 that says why.
    describe('when reconstruction exceeds its deadline', () => {
      const originalDeadline = config.dagIndexerFallback.deadlineMs

      afterEach(() => {
        config.dagIndexerFallback.deadlineMs = originalDeadline
      })

      it('reports a retryable timeout rather than running past the caller', async () => {
        const chunks = ['deadline-1', 'deadline-2', 'deadline-3'].map(chunkNode)
        const head = parentNode(chunks, {
          type: MetadataType.File,
          name: 'deadline.txt',
        })
        const byCid = new Map(
          [head, ...chunks].map((node) => [cidOf(node), node]),
        )

        jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
        jest
          .spyOn(dsnFetcher, 'fetchNode')
          .mockImplementation(async (nodeCid: string) => {
            await new Promise((resolve) => setTimeout(resolve, 20))
            return byCid.get(nodeCid)!
          })

        config.dagIndexerFallback.deadlineMs = 30

        const error = await dsnFetcher
          .getFileChunks(cidOf(head))
          .catch((e) => e)

        expect(error).toBeInstanceOf(HttpError)
        expect(error.statusCode).toBe(503)
        expect(error.reason).toBe('dag_indexer_fallback_timed_out')
        expect(error.headers?.['Retry-After']).toBeDefined()
      })

      // The head is fetched before the walk begins, so it is easy to leave out of
      // the timeout mapping — and then a budget overrun on the very first fetch
      // surfaces as a raw gateway error, i.e. a 500 telling callers not to retry.
      it('reports a timeout on the head fetch as a timeout too', async () => {
        const chunks = ['head-timeout'].map(chunkNode)
        const head = parentNode(chunks, {
          type: MetadataType.File,
          name: 'head-timeout.txt',
        })

        jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
        // What a budget-clamped axios call looks like when its timeout fires:
        // untyped, and carrying nothing a caller could branch on.
        jest.spyOn(dsnFetcher, 'fetchNode').mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 40))
          throw Object.assign(new Error('timeout of 1000ms exceeded'), {
            code: 'ECONNABORTED',
          })
        })

        config.dagIndexerFallback.deadlineMs = 20

        const error = await dsnFetcher
          .getFileChunks(cidOf(head))
          .catch((e) => e)

        expect(error).toBeInstanceOf(HttpError)
        expect(error.statusCode).toBe(503)
        expect(error.reason).toBe('dag_indexer_fallback_timed_out')
        expect(error.headers?.['Retry-After']).toBeDefined()
      })

      // Checking the clock between fetches only bounds how many fetches start.
      // Each one must also be clamped to the time left, or a single gateway call
      // (FETCH_TIMEOUT 180s, retried three times) overruns the budget by an order
      // of magnitude and the caller times out first anyway.
      it('clamps each node fetch to the budget that is left', async () => {
        const chunks = ['clamp-1', 'clamp-2'].map(chunkNode)
        const head = parentNode(chunks, {
          type: MetadataType.File,
          name: 'clamp.txt',
        })
        const byCid = new Map(
          [head, ...chunks].map((node) => [cidOf(node), node]),
        )

        config.dagIndexerFallback.deadlineMs = 5_000

        const budgets: number[] = []
        jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
        jest
          .spyOn(dsnFetcher, 'fetchNode')
          .mockImplementation(
            async (
              nodeCid: string,
              _siblings: string[],
              remainingMs?: () => number,
            ) => {
              budgets.push(remainingMs?.() ?? Infinity)
              await new Promise((resolve) => setTimeout(resolve, 20))
              return byCid.get(nodeCid)!
            },
          )

        await dsnFetcher.getFileChunks(cidOf(head))

        // Every fetch in a reconstruction is handed a budget, and it shrinks as
        // the walk proceeds rather than being re-measured per fetch.
        expect(budgets.length).toBeGreaterThan(1)
        expect(budgets.every((budget) => Number.isFinite(budget))).toBe(true)
        expect(budgets.every((budget) => budget <= 5_000)).toBe(true)
        expect(budgets[budgets.length - 1]).toBeLessThan(budgets[0])
      })

      it('leaves ordinary downloads of indexed files unbudgeted', async () => {
        const chunk = chunkNode('indexed')
        const head = parentNode([chunk], {
          type: MetadataType.File,
          name: 'indexed.txt',
        })
        const cid = cidOf(head)

        jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue({
          ...metadataOf(head, cid),
          type: MetadataType.File,
        })
        jest
          .spyOn(dagIndexerRepository, 'getSortedChunksByCid')
          .mockResolvedValue({
            chunks: [metadataOf(chunk)],
            unindexedLinks: [],
          })

        const budgets: (number | undefined)[] = []
        jest
          .spyOn(dsnFetcher, 'fetchNode')
          .mockImplementation(
            async (
              _cid: string,
              _siblings: string[],
              remainingMs?: () => number,
            ) => {
              budgets.push(remainingMs?.())
              return chunk
            },
          )

        await dsnFetcher.getPartial(cid, 0)

        expect(budgets).toEqual([undefined])
      })
    })

    describe('when the DAG exceeds the walk limit', () => {
      const originalMaxNodes = config.dagIndexerFallback.maxNodes

      afterEach(() => {
        config.dagIndexerFallback.maxNodes = originalMaxNodes
      })

      const oversizedFile = () => {
        const chunks = ['one', 'two', 'three'].map(chunkNode)
        const head = parentNode(chunks, {
          type: MetadataType.File,
          name: 'oversized.txt',
        })
        return { head, chunks }
      }

      it('refuses without advertising a retry, since waiting cannot help', async () => {
        config.dagIndexerFallback.maxNodes = 2
        const { head, chunks } = oversizedFile()
        jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
        stubDsnNodes([head, ...chunks])

        const error = await dsnFetcher
          .getFileChunks(cidOf(head))
          .catch((e) => e)

        expect(error).toBeInstanceOf(HttpError)
        // 503, not 500: nothing faulted. This is a configured refusal, and
        // bucketing it with genuine faults would page on-call for a non-incident.
        expect(error.statusCode).toBe(503)
        expect(error.reason).toBe('dag_too_large_for_fallback')
        expect(error.headers?.['Retry-After']).toBeUndefined()
        expect(error.message).toContain('DAG Indexer')
      })

      it('fails fast on retry instead of re-walking the DAG', async () => {
        config.dagIndexerFallback.maxNodes = 2
        const { head, chunks } = oversizedFile()
        jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
        const { requested } = stubDsnNodes([head, ...chunks])

        await dsnFetcher.getFileChunks(cidOf(head)).catch(() => undefined)
        const afterFirstAttempt = requested.length
        // Guards the point of the test: if the first attempt short-circuited,
        // the second one proves nothing about failing fast.
        expect(afterFirstAttempt).toBeGreaterThan(0)

        const error = await dsnFetcher
          .getFileChunks(cidOf(head))
          .catch((e) => e)

        expect(error.reason).toBe('dag_too_large_for_fallback')
        expect(requested.length).toBe(afterFirstAttempt)
      })
    })

    it('still uses the DAG indexer when the node is indexed', async () => {
      const head = parentNode([chunkNode('x')], {
        type: MetadataType.File,
        name: 'indexed.txt',
      })
      const cid = cidOf(head)
      const indexedChunks = [
        {
          cid: 'chunk-from-indexer',
          type: MetadataType.FileChunk,
          linkDepth: 0,
          links: [],
          blake3Hash: '',
          blockHeight: 0,
          blockHash: '',
          extrinsicId: '',
          extrinsicHash: '',
          indexInBlock: 0,
          timestamp: new Date(0),
        },
      ]
      jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue({
        ...indexedChunks[0],
        cid,
        type: MetadataType.File,
      })
      jest
        .spyOn(dagIndexerRepository, 'getSortedChunksByCid')
        .mockResolvedValue({ chunks: indexedChunks, unindexedLinks: [] })
      const { spy } = stubDsnNodes([head])

      await expect(dsnFetcher.getFileChunks(cid)).resolves.toEqual(
        indexedChunks,
      )
      expect(spy).not.toHaveBeenCalled()
    })

    // A missing root is not the only failure mode: nodes are indexed one
    // extrinsic at a time, so the head can be indexed while nodes below it are
    // not. The indexed chunk list is then a truncated view of the file, and
    // serving it means a 200 carrying the wrong bytes.
    describe('when the head is indexed but nodes below it are not', () => {
      const partiallyIndexedFile = () => {
        const chunks = ['one', 'two', 'three', 'four'].map(chunkNode)
        const firstInlink = parentNode(chunks.slice(0, 2))
        const secondInlink = parentNode(chunks.slice(2))
        const head = parentNode([firstInlink, secondInlink], {
          type: MetadataType.File,
          name: 'big.txt',
          linkDepth: 2,
        })

        return { chunks, firstInlink, secondInlink, head }
      }

      it('rebuilds from the DSN instead of serving a truncated chunk list', async () => {
        const { chunks, firstInlink, secondInlink, head } =
          partiallyIndexedFile()
        const cid = cidOf(head)

        jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue({
          ...metadataOf(head, cid),
          type: MetadataType.File,
        })
        // The indexer resolved the first inlink's leaves and nothing else.
        jest
          .spyOn(dagIndexerRepository, 'getSortedChunksByCid')
          .mockResolvedValue({
            chunks: chunks.slice(0, 2).map((node) => metadataOf(node)),
            unindexedLinks: [cidOf(secondInlink)],
          })
        stubDsnNodes([head, firstInlink, secondInlink, ...chunks])

        const result = await dsnFetcher.getFileChunks(cid)

        expect(result.map((e) => e.cid)).toEqual(chunks.map(cidOf))
      })

      it('rebuilds when nothing under the head is indexed at all', async () => {
        const { chunks, firstInlink, secondInlink, head } =
          partiallyIndexedFile()
        const cid = cidOf(head)

        jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue({
          ...metadataOf(head, cid),
          type: MetadataType.File,
        })
        jest
          .spyOn(dagIndexerRepository, 'getSortedChunksByCid')
          .mockResolvedValue({
            chunks: [],
            unindexedLinks: [cidOf(firstInlink), cidOf(secondInlink)],
          })
        stubDsnNodes([head, firstInlink, secondInlink, ...chunks])

        const result = await dsnFetcher.getFileChunks(cid)

        // Without the guard this resolved to `[]` — an empty 200 for a file that
        // exists and is perfectly retrievable.
        expect(result.map((e) => e.cid)).toEqual(chunks.map(cidOf))
      })

      it('fails rather than truncating when the fallback is disabled', async () => {
        const { chunks, head } = partiallyIndexedFile()
        const cid = cidOf(head)

        jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue({
          ...metadataOf(head, cid),
          type: MetadataType.File,
        })
        jest
          .spyOn(dagIndexerRepository, 'getSortedChunksByCid')
          .mockResolvedValue({
            chunks: chunks.slice(0, 2).map((node) => metadataOf(node)),
            unindexedLinks: ['missing-node'],
          })

        config.dagIndexerFallback.enabled = false
        try {
          await expect(dsnFetcher.getFileChunks(cid)).rejects.toMatchObject({
            statusCode: 500,
          })
        } finally {
          config.dagIndexerFallback.enabled = true
        }
      })

      /**
       * The head being indexed is what makes this path expensive: it means the
       * chunk-list query runs, and only its result reveals that the file is
       * truncated. Discovering that per request — the SDK calls `getFileChunks`
       * once per chunk — re-runs a recursive CTE over the whole DAG, re-emits
       * `chunk_list_incomplete` and re-logs its warning, all to arrive at a
       * rebuild that was already cached. A fully unindexed file never had this
       * problem, because it reaches the cache before the indexer is asked.
       */
      it('does not re-ask the indexer once the rebuild is cached', async () => {
        const { chunks, firstInlink, secondInlink, head } =
          partiallyIndexedFile()
        const cid = cidOf(head)

        jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue({
          ...metadataOf(head, cid),
          type: MetadataType.File,
        })
        const sortedChunks = jest
          .spyOn(dagIndexerRepository, 'getSortedChunksByCid')
          .mockResolvedValue({
            chunks: chunks.slice(0, 2).map((node) => metadataOf(node)),
            unindexedLinks: [cidOf(secondInlink)],
          })
        const { requested } = stubDsnNodes([
          head,
          firstInlink,
          secondInlink,
          ...chunks,
        ])

        const first = await dsnFetcher.getFileChunks(cid)
        const walked = requested.length
        const second = await dsnFetcher.getFileChunks(cid)

        expect(second.map((e) => e.cid)).toEqual(first.map((e) => e.cid))
        expect(sortedChunks).toHaveBeenCalledTimes(1)
        expect(requested).toHaveLength(walked)
      })
    })
  })

  describe('fetchNode', () => {
    const mapping = (hash: string, pieceIndex = 1, pieceOffset = 0) =>
      [hash, pieceIndex, pieceOffset] as [string, number, number]

    const objectMappingHashOf = (cid: string) =>
      Buffer.from(blake3HashFromCid(stringToCid(cid))).toString('hex')

    beforeEach(() => {
      jest.spyOn(nodeCache, 'has').mockResolvedValue(false)
      jest.spyOn(nodeCache, 'set').mockResolvedValue(undefined as never)
    })

    it('reports a retryable failure when the gateway omits the requested node', async () => {
      const node = chunkNode('missing from response')
      const cid = cidOf(node)
      const hash = objectMappingHashOf(cid)

      jest
        .spyOn(objectMappingIndexer, 'get_object_mappings')
        .mockResolvedValue([mapping(hash)])
      jest.spyOn(dsnFetcher, 'fetchObjects').mockResolvedValue([])

      const error = await dsnFetcher.fetchNode(cid, []).catch((e) => e)

      expect(error).toBeInstanceOf(HttpError)
      expect(error.statusCode).toBe(503)
      expect(error.reason).toBe('object_not_retrievable_yet')
      expect(error.headers?.['Retry-After']).toBeDefined()
    })

    it('falls back to a target-only lookup when a sibling is unmapped', async () => {
      const node = chunkNode('target')
      const sibling = chunkNode('unmapped sibling')
      const cid = cidOf(node)
      const hash = objectMappingHashOf(cid)

      const lookup = jest
        .spyOn(objectMappingIndexer, 'get_object_mappings')
        .mockImplementation(async ({ hashes }) => {
          if (hashes.length > 1) {
            throw rpcError('Object mapping not found')
          }
          return [mapping(hash)]
        })
      jest.spyOn(dsnFetcher, 'fetchObjects').mockResolvedValue([node])

      await expect(
        dsnFetcher.fetchNode(cid, [cidOf(sibling)]),
      ).resolves.toEqual(node)
      expect(lookup).toHaveBeenCalledTimes(2)
    })

    // The sibling-batch retry exists for one specific case: the indexer
    // rejecting a batch because it has no row for a sibling. Retrying an outage
    // just doubles load and latency while the indexer is already unhealthy.
    it('does not retry the batch when the lookup failed for an unrelated reason', async () => {
      const cid = cidOf(chunkNode('batch broken'))
      const sibling = cidOf(chunkNode('batch broken sibling'))

      const lookup = jest
        .spyOn(objectMappingIndexer, 'get_object_mappings')
        .mockRejectedValue(new Error('fetch failed'))

      const error = await dsnFetcher.fetchNode(cid, [sibling]).catch((e) => e)

      expect(error.statusCode).toBe(503)
      expect(error.reason).toBe('object_mapping_lookup_failed')
      expect(lookup).toHaveBeenCalledTimes(1)
    })

    it('reports the indexer’s "no mapping" answer as a miss', async () => {
      const cid = cidOf(chunkNode('never uploaded'))
      jest
        .spyOn(objectMappingIndexer, 'get_object_mappings')
        .mockRejectedValue(rpcError('Object mapping not found'))

      const error = await dsnFetcher.fetchNode(cid, []).catch((e) => e)

      expect(error.statusCode).toBe(404)
      expect(error.reason).toBe('object_not_found')
    })

    // A lookup that never reached a verdict says nothing about whether the
    // object exists. Reporting these as 404 would make callers stop retrying
    // for the duration of an indexer outage.
    it.each([
      ['a transport fault', new Error('fetch failed')],
      [
        'a non-2xx response',
        new Error('HTTP error! status: 502 (Bad Gateway)'),
      ],
      [
        'an indexer-side fault reported over RPC',
        rpcError('connection terminated unexpectedly'),
      ],
      [
        'a malformed response',
        rpcError('Expected array, received null', -32602),
      ],
    ])('reports %s as retryable rather than as a miss', async (_, thrown) => {
      const cid = cidOf(chunkNode('mapping lookup broken'))
      jest
        .spyOn(objectMappingIndexer, 'get_object_mappings')
        .mockRejectedValue(thrown)

      const error = await dsnFetcher.fetchNode(cid, []).catch((e) => e)

      expect(error).toBeInstanceOf(HttpError)
      expect(error.statusCode).toBe(503)
      expect(error.reason).toBe('object_mapping_lookup_failed')
      expect(error.headers?.['Retry-After']).toBeDefined()
    })
  })

  /**
   * The gateway is the one dependency the fallback cannot avoid, and a flaky one
   * is the normal case during the incident this fallback exists for. Its failures
   * have to arrive typed: an untyped rejection reaches the error middleware as a
   * bare `500` with no `reason` and no `Retry-After`, which tells callers to stop
   * retrying something that is very likely to clear.
   */
  describe('fetchObjects', () => {
    const mapping = (pieceIndex = 1, pieceOffset = 0) =>
      ['a'.repeat(64), pieceIndex, pieceOffset] as [string, number, number]

    const transportFailure = () =>
      new axios.AxiosError(
        'connect ECONNREFUSED 127.0.0.1:9944',
        'ECONNREFUSED',
      )

    it('reports a gateway transport failure as retryable, not as a fault', async () => {
      const post = jest
        .spyOn(axios, 'post')
        .mockRejectedValue(transportFailure())

      const error = await dsnFetcher
        .fetchObjects([mapping()], () => 5_000)
        .catch((e) => e)

      expect(error).toBeInstanceOf(HttpError)
      expect(error.statusCode).toBe(503)
      expect(error.reason).toBe('dsn_gateway_fetch_failed')
      expect(error.headers?.['Retry-After']).toBeDefined()
      expect(post).toHaveBeenCalled()
    })

    // Not every failure here is the gateway's: a response that parsed but would
    // not decode is ours. Those must stay loud rather than being advertised as
    // retryable, but still typed so the body carries a message.
    it('keeps a non-transport failure a 500 without advertising a retry', async () => {
      jest.spyOn(axios, 'post').mockRejectedValue(new Error('not axios'))

      const error = await dsnFetcher.fetchObjects([mapping()]).catch((e) => e)

      expect(error).toBeInstanceOf(HttpError)
      expect(error.statusCode).toBe(500)
      expect(error.reason).toBeUndefined()
      expect(error.headers).toBeUndefined()
      expect(error.message).toContain('not axios')
    })

    /**
     * Clamping each attempt's timeout to the time left is not enough on its own.
     * `withRetries` runs three attempts with a delay between them and the
     * deadline is only re-checked once the whole loop has finished, so a fetch
     * whose budget was already spent used to keep attempting — each attempt
     * floored at a second — several seconds past
     * `DAG_INDEXER_FALLBACK_DEADLINE_MS`.
     */
    it('does not attempt a fetch once the budget is spent', async () => {
      const post = jest
        .spyOn(axios, 'post')
        .mockRejectedValue(transportFailure())

      const error = await dsnFetcher
        .fetchObjects([mapping()], () => 0)
        .catch((e) => e)

      // The mapping lookup ahead of this fetch is not itself budgeted, so a fetch
      // really can be reached with nothing left. A clamped attempt is still
      // floored at a second, and there would be three of them.
      expect(post).not.toHaveBeenCalled()
      expect(error).toBeInstanceOf(HttpError)
      expect(error.statusCode).toBe(503)
      expect(error.reason).toBe('dag_indexer_fallback_timed_out')
    })

    it('stops retrying when an attempt consumes the rest of the budget', async () => {
      let remaining = 5_000
      const post = jest.spyOn(axios, 'post').mockImplementation(async () => {
        remaining = 0
        throw transportFailure()
      })

      await dsnFetcher
        .fetchObjects([mapping()], () => remaining)
        .catch(() => undefined)

      expect(post).toHaveBeenCalledTimes(1)
    })

    it('still retries for callers that have no budget', async () => {
      const post = jest
        .spyOn(axios, 'post')
        .mockRejectedValue(transportFailure())

      await dsnFetcher.fetchObjects([mapping()]).catch(() => undefined)

      expect(post).toHaveBeenCalledTimes(3)
    })

    // The endpoint the incident was reported on, and the one the fallback newly
    // routes to the gateway: before it, a miss answered 404 without ever calling
    // out, so a gateway failure could not surface here at all.
    it('surfaces a typed failure through GET /files/:cid/metadata', async () => {
      const cid = cidOf(chunkNode('gateway down'))
      jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
      jest.spyOn(nodeCache, 'has').mockResolvedValue(false)
      jest
        .spyOn(objectMappingIndexer, 'get_object_mappings')
        .mockResolvedValue([
          [
            Buffer.from(blake3HashFromCid(stringToCid(cid))).toString('hex'),
            1,
            0,
          ],
        ])
      jest.spyOn(axios, 'post').mockRejectedValue(transportFailure())

      const error = await dsnFetcher.fetchNodeMetadata(cid).catch((e) => e)

      expect(error).toBeInstanceOf(HttpError)
      expect(error.statusCode).toBe(503)
      expect(error.reason).toBe('dsn_gateway_fetch_failed')
      expect(error.headers?.['Retry-After']).toBeDefined()
    })
  })

  describe('fetchFile', () => {
    it('keeps the underlying status instead of flattening it to 500', async () => {
      jest.spyOn(dsnFetcher, 'fetchNodeMetadata').mockRejectedValue(
        new HttpError(503, 'Object not retrievable yet', {
          reason: 'object_not_retrievable_yet',
        }),
      )

      await expect(
        dsnFetcher.fetchFile(cidOf(chunkNode('any'))),
      ).rejects.toMatchObject({
        statusCode: 503,
        reason: 'object_not_retrievable_yet',
      })
    })
  })

  /**
   * The download path calls this for every file flagged ZLIB, and on the fallback
   * path reading "the first chunk" can mean walking the whole DAG. Answering
   * `false` when the bytes could not be read strips `Content-Encoding` off a body
   * that really is compressed, so the client gets undecodable bytes with a 200.
   */
  describe('isActuallyCompressed', () => {
    it('reports a genuinely compressed file as compressed', async () => {
      const compressed = zlib.deflateSync(Buffer.from('compress me'))
      const chunk: PBNode = {
        Data: IPLDNodeData.encode({
          type: MetadataType.FileChunk,
          linkDepth: 0,
          size: BigInt(compressed.length),
          data: compressed,
        }),
        Links: [],
      }
      const head = parentNode([chunk], {
        type: MetadataType.File,
        name: 'c.txt',
      })

      jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
      stubDsnNodes([head, chunk])

      await expect(dsnFetcher.isActuallyCompressed(cidOf(head))).resolves.toBe(
        true,
      )
    })

    it('reports plaintext flagged as compressed as uncompressed', async () => {
      const chunk = chunkNode('not really compressed')
      const head = parentNode([chunk], {
        type: MetadataType.File,
        name: 'p.txt',
      })

      jest.spyOn(dagIndexerRepository, 'getDagNode').mockResolvedValue(null)
      stubDsnNodes([head, chunk])

      await expect(dsnFetcher.isActuallyCompressed(cidOf(head))).resolves.toBe(
        false,
      )
    })

    it('propagates a typed failure instead of guessing "uncompressed"', async () => {
      jest.spyOn(dsnFetcher, 'getFileChunks').mockRejectedValue(
        new HttpError(503, 'DAG Indexer fallback timed out', {
          reason: 'dag_indexer_fallback_timed_out',
        }),
      )

      await expect(
        dsnFetcher.isActuallyCompressed('bafk-whatever'),
      ).rejects.toMatchObject({
        statusCode: 503,
        reason: 'dag_indexer_fallback_timed_out',
      })
    })

    it('still assumes uncompressed when the bytes are merely undecodable', async () => {
      jest
        .spyOn(dsnFetcher, 'getFileChunks')
        .mockRejectedValue(new Error('not an HttpError'))

      await expect(
        dsnFetcher.isActuallyCompressed('bafk-whatever'),
      ).resolves.toBe(false)
    })
  })

  /**
   * `isObjectMappingMiss` distinguishes a real miss from upstream trouble by the
   * *message* the Object Mapping Indexer produces, because a reported miss and a
   * reported fault both arrive as JSON-RPC InternalError. Nothing in the type
   * system ties the two services together, so this pins the string: if the
   * indexer's `throw new Error('Object mapping not found')` is reworded, every
   * miss silently becomes a retryable 503 and the sibling-batch retry — which is
   * what lets a walk proceed past an unindexed sibling — stops firing.
   *
   * The literal below must match services/object-mapping-indexer/src/useCases/
   * objectMapping.ts.
   */
  describe('object mapping miss detection', () => {
    const INDEXER_MISS_MESSAGE = 'Object mapping not found'

    it('treats the indexer’s own not-found message as a miss', async () => {
      const cid = cidOf(chunkNode('unmapped'))
      jest
        .spyOn(objectMappingIndexer, 'get_object_mappings')
        .mockRejectedValue(rpcError(INDEXER_MISS_MESSAGE))

      await expect(dsnFetcher.fetchNode(cid, [])).rejects.toMatchObject({
        statusCode: 404,
        reason: 'object_not_found',
      })
    })

    it('treats an indexer-side fault with the same code as retryable', async () => {
      const cid = cidOf(chunkNode('unmapped'))
      jest
        .spyOn(objectMappingIndexer, 'get_object_mappings')
        .mockRejectedValue(rpcError('database connection terminated'))

      await expect(dsnFetcher.fetchNode(cid, [])).rejects.toMatchObject({
        statusCode: 503,
        reason: 'object_mapping_lookup_failed',
      })
    })
  })
})
