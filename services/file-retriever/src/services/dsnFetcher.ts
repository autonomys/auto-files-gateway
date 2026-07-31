import {
  blake3HashFromCid,
  stringToCid,
  decodeNode,
  cidToString,
  CompressionAlgorithm,
  cidOfNode,
  encodeNode,
  IPLDNodeData,
  MetadataType,
} from '@autonomys/auto-dag-data'
import {
  ByteRange,
  FileCacheOptions,
  FileResponse,
} from '@autonomys/file-server'
import { z } from 'zod'
import { PBNode } from '@ipld/dag-pb'
import { HttpError } from '../http/middlewares/error.js'
import { safeIPLDDecode } from '../utils/dagData.js'
import { isZlibCompressed } from '../utils/compression.js'
import mime from 'mime-types'
import { config } from '../config.js'
import { logger } from '../drivers/logger.js'
import axios from 'axios'
import { objectMappingIndexer } from './objectMappingIndexer.js'
import {
  streamToBuffer,
  weightedRequestConcurrencyController,
} from '@autonomys/asynchronous'
import { ExtendedIPLDMetadata, ObjectMapping } from '@auto-files/models'
import { withRetries } from '../utils/retries.js'
import { Readable } from 'stream'
import { ReadableStream } from 'stream/web'
import { fileCache, nodeCache } from './cache.js'
import { dagIndexerRepository } from '../repositories/dag-indexer.js'
import { readLeadingBytes, sliceReadable } from '../utils/readable.js'
import { LRUCache } from 'lru-cache'
import { recordDagIndexerFallback } from './dagIndexerFallbackMetrics.js'

const fetchNodesSchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: z.array(z.string()),
})

const gatewayUrls = config.subspaceGatewayUrls.split(',')
const concurrencyControllerByGateway = gatewayUrls.map(() =>
  weightedRequestConcurrencyController(
    config.objectFetching.maxSimultaneousFetches,
  ),
)
let gatewayIndex = 0

const getObjectMappingHash = (cid: string) => {
  try {
    return Buffer.from(blake3HashFromCid(stringToCid(cid))).toString('hex')
  } catch {
    throw new HttpError(400, 'Bad request: Not a valid auto-dag-data IPLD node')
  }
}

/**
 * Machine-readable reasons a CID can't be served, returned in the error body so
 * callers can tell a miss that may resolve itself from one that won't.
 */
export const UNAVAILABLE_REASON = {
  /** Neither the DAG Indexer nor the Object Mapping Indexer knows this CID. */
  objectNotFound: 'object_not_found',
  /** The DSN knows the object, but it isn't retrievable right now. */
  notRetrievableYet: 'object_not_retrievable_yet',
  /** The object mapping lookup itself failed — upstream trouble, not a miss. */
  mappingLookupFailed: 'object_mapping_lookup_failed',
  /** Too large to rebuild without the DAG Indexer; waiting won't help. */
  dagTooLargeForFallback: 'dag_too_large_for_fallback',
  /** Reconstruction ran out of time; the DSN was too slow to answer. */
  fallbackTimedOut: 'dag_indexer_fallback_timed_out',
  /** The Subspace Gateway itself could not be reached, or did not answer. */
  gatewayFetchFailed: 'dsn_gateway_fetch_failed',
} as const

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const objectNotFoundError = (cid: string) =>
  new HttpError(404, `Not found: no object mapping for cid=${cid}`, {
    reason: UNAVAILABLE_REASON.objectNotFound,
  })

const retryAfterHeader = () => ({
  'Retry-After': config.dagIndexerFallback.retryAfterSeconds.toString(),
})

/**
 * The object *is* on the DSN (it has an object mapping) but we couldn't get its
 * bytes yet — most often because the segment holding it is still being plotted.
 * Retryable, so say so with a 503 + `Retry-After` rather than reporting a miss.
 */
const notRetrievableYetError = (cid: string, detail: string) =>
  new HttpError(503, `Object not retrievable yet (cid=${cid}): ${detail}`, {
    reason: UNAVAILABLE_REASON.notRetrievableYet,
    headers: retryAfterHeader(),
  })

/**
 * The Object Mapping Indexer couldn't answer at all (timeout, refused
 * connection, its own DB failing). Says nothing about whether the object exists,
 * so it must not be reported as a miss — callers keying on `object_not_found`
 * would stop retrying for the duration of an outage.
 */
const mappingLookupFailedError = (cid: string, error: unknown) =>
  new HttpError(
    503,
    `Object mapping lookup failed (cid=${cid}): ${describeError(error)}`,
    {
      reason: UNAVAILABLE_REASON.mappingLookupFailed,
      headers: retryAfterHeader(),
    },
  )

/**
 * The Subspace Gateway did not answer usably — refused connection, timeout,
 * socket reset, a non-2xx status. Like a failed mapping lookup this says nothing
 * about whether the object exists, so it must be retryable.
 *
 * It needs its own reason because it is a *transport* failure rather than a
 * verdict, and because the fallback makes it reachable on `GET /files/:cid/metadata`,
 * where the gateway was never consulted before. Left raw, an axios error escapes
 * every typed branch here and the error middleware answers a bare 500 with no
 * `reason` and no `Retry-After` — indistinguishable, to a caller, from a fault
 * that will not clear.
 */
const gatewayFetchFailedError = (objects: ObjectMapping[], error: unknown) =>
  new HttpError(
    503,
    `Subspace Gateway fetch failed (objects=${objects.length}, firstHash=${objects[0]?.[0] ?? 'none'}): ${describeError(error)}`,
    {
      reason: UNAVAILABLE_REASON.gatewayFetchFailed,
      headers: retryAfterHeader(),
    },
  )

/**
 * The DAG is larger than we're willing to walk without the indexer. Unlike the
 * cases above this does not clear by waiting — only by the file being indexed —
 * so it carries no `Retry-After`, and the verdict is cached (see
 * `dsnChunkListRejections`) so retries fail fast instead of re-walking.
 *
 * 503 rather than 500: nothing has faulted. The service is working exactly as
 * configured and is declining a request it cannot serve until a dependency
 * catches up, which is what 503 means. Reporting it as 500 put a deliberate,
 * deterministic refusal into the same bucket as genuine faults and would page
 * on-call for a non-incident.
 */
const dagTooLargeForFallbackError = (cid: string) =>
  new HttpError(
    503,
    `Cannot rebuild chunk list (cid=${cid}): its DAG exceeds the ${config.dagIndexerFallback.maxNodes}-node walk limit for unindexed files. It can only be served once the DAG Indexer has indexed it.`,
    { reason: UNAVAILABLE_REASON.dagTooLargeForFallback },
  )

/**
 * Reconstruction exceeded its wall-clock budget. Retryable — the DSN may simply
 * be slow right now — so it carries `Retry-After`, but it is reported *before*
 * the caller's own timeout fires so the failure is legible rather than a hang.
 */
const fallbackTimedOutError = (cid: string, elapsedMs: number) =>
  new HttpError(
    503,
    `DAG Indexer fallback timed out (cid=${cid}) after ${Math.round(elapsedMs)}ms: the DSN did not return the file's nodes within the ${config.dagIndexerFallback.deadlineMs}ms budget.`,
    {
      reason: UNAVAILABLE_REASON.fallbackTimedOut,
      headers: retryAfterHeader(),
    },
  )

/**
 * A wall-clock budget for one reconstruction.
 *
 * `check` is deliberately cooperative rather than a `Promise.race`: racing would
 * leave the losing walk running in the background, still fetching nodes for a
 * request that has gone away. Checking between fetches means we stop doing the
 * work.
 *
 * Checking between fetches is not enough on its own, though — it bounds the
 * number of fetches *started*, not the time spent. One `fetchObjects` may take
 * FETCH_TIMEOUT (180s) and is retried three times, so a single slow gateway call
 * can overrun a 45s budget by an order of magnitude and blow past the caller's
 * own timeout regardless. `remainingMs` exists so each fetch can be clamped to
 * the time actually left.
 */
const createDeadline = (cid: string) => {
  const startedAt = performance.now()
  const budgetMs = config.dagIndexerFallback.deadlineMs

  const elapsed = () => performance.now() - startedAt

  return {
    check: () => {
      const elapsedMs = elapsed()
      if (budgetMs > 0 && elapsedMs > budgetMs) {
        throw fallbackTimedOutError(cid, elapsedMs)
      }
    },
    remainingMs: () =>
      budgetMs > 0 ? Math.max(0, budgetMs - elapsed()) : Infinity,
  }
}

type ReconstructionDeadline = ReturnType<typeof createDeadline>

/**
 * Runs one budgeted fetch, reporting a budget overrun as the timeout it is.
 *
 * A clamped fetch fails with whatever axios says when its timeout fires, which
 * would surface as a bare gateway error (and a `500`) rather than a `503` with
 * `dag_indexer_fallback_timed_out` and `Retry-After`. Every fetch inside a
 * reconstruction goes through here so none can be left out of that mapping.
 */
const withDeadlineReporting = async <T>(
  deadline: ReconstructionDeadline,
  fetch: () => Promise<T>,
): Promise<T> => {
  try {
    return await fetch()
  } catch (error) {
    deadline.check()
    throw error
  }
}

/**
 * Never let a clamped timeout collapse to something no request could satisfy.
 *
 * This floor is the one way a reconstruction can still overrun its budget: an
 * attempt that starts with a few milliseconds left runs for up to a second. That
 * is the whole of the overrun — an attempt is not started once the budget is
 * spent, and retries stop there too (see `fetchObjects`), so it is one attempt's
 * floor rather than `maxRetries` floors plus the delays between them.
 */
const MIN_BUDGETED_FETCH_TIMEOUT_MS = 1_000

/**
 * How long a single gateway fetch may take, given whatever is left of a
 * reconstruction's budget. Unbudgeted callers (ordinary downloads of indexed
 * files) keep the full FETCH_TIMEOUT.
 */
const budgetedFetchTimeout = (remainingMs?: number) => {
  if (remainingMs === undefined || !Number.isFinite(remainingMs)) {
    return config.objectFetching.fetchTimeout
  }

  return Math.max(
    MIN_BUDGETED_FETCH_TIMEOUT_MS,
    Math.min(config.objectFetching.fetchTimeout, Math.floor(remainingMs)),
  )
}

/** The message the Object Mapping Indexer uses for a hash it has no row for. */
const OBJECT_MAPPING_NOT_FOUND_MESSAGE = 'object mapping not found'

/**
 * True only for the indexer's explicit "I have no mapping for this hash" answer.
 *
 * Errors the indexer *reported* reach us as `RpcError`, which carries a numeric
 * JSON-RPC `code`; transport faults arrive as plain `Error`s (a failed fetch, a
 * non-2xx response) or with a string `code` like `ECONNREFUSED`. Requiring both
 * the numeric code and the message means anything ambiguous — an indexer whose
 * database is down also reports `InternalError` — falls through to the retryable
 * branch rather than being reported as a miss.
 */
const isObjectMappingMiss = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }

  const rpcErrorCode = (error as { code?: unknown }).code

  return (
    typeof rpcErrorCode === 'number' &&
    error.message.toLowerCase().includes(OBJECT_MAPPING_NOT_FOUND_MESSAGE)
  )
}

/**
 * Fetches the nodes for a given list of cids
 *
 * @param cids - The list of cids to fetch the nodes for
 * @returns The list of nodes
 */
const fetchObjects = async (
  objects: ObjectMapping[],
  remainingMs?: () => number,
) => {
  const requestId = Math.floor(Math.random() * 65535)
  const now = performance.now()
  logger.debug(
    `Enqueuing nodes fetch (requestId=${requestId}): ${objects.map((e) => e[0]).join(', ')}`,
  )
  const mappings = {
    v0: {
      objects,
    },
  }

  const index = gatewayIndex++ % gatewayUrls.length
  const gatewayUrl = gatewayUrls[index]
  const concurrencyController = concurrencyControllerByGateway[index]

  const body = {
    jsonrpc: '2.0',
    method: 'subspace_fetchObject',
    params: { mappings },
    id: requestId,
  }

  /**
   * Unbudgeted callers get `undefined` here, and a disabled deadline gets
   * `Infinity`, so both keep the previous behaviour: three attempts at the full
   * FETCH_TIMEOUT.
   */
  const budgetSpent = () => {
    const remaining = remainingMs?.()
    return remaining !== undefined && remaining <= 0
  }

  /**
   * A budgeted attempt must not *start* once the budget is gone, and its retries
   * must not either.
   *
   * Clamping each attempt's timeout is not enough on its own. The mapping lookup
   * that precedes this fetch is not itself budgeted, so a fetch can be reached
   * with nothing left; and `withRetries` runs three attempts with a delay between
   * them, each attempt floored at MIN_BUDGETED_FETCH_TIMEOUT_MS, while the
   * deadline is only re-checked once the whole loop has finished. A single fetch
   * could therefore run several seconds past DAG_INDEXER_FALLBACK_DEADLINE_MS,
   * which no amount of checking *between* fetches can undo.
   *
   * The enclosing `withDeadlineReporting` re-checks the deadline on the way out
   * and replaces this with the timeout error carrying the CID and the elapsed
   * time, so this message is only a fallback for a caller that has no deadline
   * to report against.
   */
  const budgetExhaustedError = () =>
    new HttpError(
      503,
      `Subspace Gateway fetch not attempted (objects=${objects.length}): the reconstruction budget was already spent`,
      {
        reason: UNAVAILABLE_REASON.fallbackTimedOut,
        headers: retryAfterHeader(),
      },
    )

  try {
    return await concurrencyController(
      async () =>
        withRetries(
          async () => {
            if (budgetSpent()) {
              throw budgetExhaustedError()
            }

            logger.debug(
              `Fetching nodes (requestId=${requestId}): ${objects.map((e) => e[0]).join(', ')}`,
            )
            const fetchStart = performance.now()
            // Re-read the budget per attempt, not once per call: retries each
            // need to fit in what is left, or three attempts would each get the
            // full remaining budget as measured before the first one.
            const response = await axios.post(gatewayUrl, body, {
              timeout: budgetedFetchTimeout(remainingMs?.()),
              responseType: 'json',
            })
            if (response.status !== 200) {
              console.error(
                'Failed to fetch nodes',
                response.status,
                response.data,
              )
              throw new HttpError(
                500,
                'Internal server error: Failed to fetch nodes',
              )
            }

            const validatedResponseData = fetchNodesSchema.safeParse(
              response.data,
            )
            if (!validatedResponseData.success) {
              logger.error(
                `Failed to parse fetch nodes response: ${JSON.stringify(
                  validatedResponseData.error,
                )}`,
              )
              logger.debug(
                `Fetch nodes response: ${JSON.stringify(response.data)}`,
              )
              throw new HttpError(
                500,
                'Internal server error: Failed to parse fetch nodes response',
              )
            }

            const end = performance.now()
            logger.debug(
              `Fetched ${objects.length} nodes in total=${end - now}ms fetch=${end - fetchStart}ms (requestId=${requestId})`,
            )

            return validatedResponseData.data.result.map((hex) =>
              decodeNode(Buffer.from(hex, 'hex')),
            )
          },
          {
            maxRetries: 3,
            delay: 500,
            shouldRetry: () => !budgetSpent(),
          },
        ),
      objects.length,
    )
  } catch (error) {
    // Everything raised above this point must be typed. A raw axios rejection —
    // the ordinary shape of a flaky or unreachable gateway — has no status and no
    // reason, so it reaches the error middleware as a bare 500 that tells callers
    // to give up on a failure that is very likely to clear.
    if (error instanceof HttpError) {
      throw error
    }

    if (axios.isAxiosError(error)) {
      logger.error(
        `Subspace Gateway fetch failed (requestId=${requestId}); reporting as retryable; error=${error}`,
      )
      throw gatewayFetchFailedError(objects, error)
    }

    // Anything else is us, not the gateway: a response that parsed but would not
    // decode, or a misconfiguration. Kept a 500 so it stays loud rather than
    // being advertised as retryable, but typed so the body carries the message.
    logger.error(
      `Unexpected failure fetching nodes (requestId=${requestId}); error=${error}`,
    )
    throw new HttpError(
      500,
      `Internal server error: Failed to fetch nodes: ${describeError(error)}`,
    )
  }
}

const getNodesForPartialRetrieval = async (
  chunks: ExtendedIPLDMetadata[],
  byteRange: ByteRange,
): Promise<{
  nodes: string[]
  firstNodeFileOffset: number
}> => {
  let accumulatedLength = 0
  const nodeRange: [number | null, number | null] = [null, null]
  let firstNodeFileOffset: number | undefined
  let i = 0

  logger.debug(
    `getNodesForPartialRetrieval called (byteRange=[${byteRange[0]}, ${byteRange[1] ?? 'EOF'}])`,
  )

  // Searches for the first node that contains the byte range
  while (nodeRange[0] === null && i < chunks.length) {
    const chunk = chunks[i]
    const chunkSize = Number((chunk.size ?? 0).valueOf())
    // [accumulatedLength, accumulatedLength + chunkSize) // is the range of the chunk
    if (
      byteRange[0] >= accumulatedLength &&
      byteRange[0] < accumulatedLength + chunkSize
    ) {
      nodeRange[0] = i
      firstNodeFileOffset = accumulatedLength
    } else {
      accumulatedLength += chunkSize
      i++
    }
  }

  // Searchs for the last node that contains the byte range
  // unless the byte range is the last byte of the file
  if (byteRange[1]) {
    while (nodeRange[1] === null && i < chunks.length) {
      const chunk = chunks[i]
      const chunkSize = Number((chunk.size ?? 0).valueOf())
      if (
        byteRange[1] >= accumulatedLength &&
        byteRange[1] < accumulatedLength + chunkSize
      ) {
        nodeRange[1] = i
      }
      accumulatedLength += chunkSize
      i++
    }
  }

  if (nodeRange[0] == null) {
    throw new Error('Byte range not found')
  }

  const nodes = chunks
    .slice(nodeRange[0], nodeRange[1] === null ? undefined : nodeRange[1] + 1)
    .map((e) => e.cid)

  return {
    nodes,
    firstNodeFileOffset: firstNodeFileOffset ?? 0,
  }
}

const fetchFileAsStreamWithByteRange = async (
  cid: string,
  byteRange: ByteRange,
): Promise<Readable> => {
  const chunks = await dsnFetcher.getFileChunks(cid)
  const { nodes, firstNodeFileOffset } = await getNodesForPartialRetrieval(
    chunks,
    byteRange,
  )

  logger.debug(
    `getNodesForPartialRetrieval called (byteRange=[${byteRange[0]}, ${byteRange[1] ?? 'EOF'}]) nodes=${JSON.stringify(nodes)} firstNodeFileOffset=${firstNodeFileOffset}`,
  )

  // We pass all the chunks to the fetchNode function
  // So that we can fetch all the nodes within the same piece
  // in one go
  const siblings = chunks.map((e) => e.cid)
  const stream = new ReadableStream({
    start: async (controller) => {
      try {
        for (const chunk of nodes) {
          const node = await dsnFetcher.fetchNode(chunk, siblings)
          const data = safeIPLDDecode(node)
          if (!data) {
            throw new HttpError(
              400,
              'Bad request: Not a valid auto-dag-data IPLD node',
            )
          }

          controller.enqueue(Buffer.from(data.data ?? []))
        }

        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })

  const metadata = await dsnFetcher.fetchNodeMetadata(cid)
  const fileSize = Number(metadata.size)
  const endIndex = byteRange[1] ?? fileSize - 1
  const length = endIndex - byteRange[0] + 1

  return sliceReadable(
    Readable.fromWeb(stream),
    byteRange[0] - firstNodeFileOffset,
    length,
  )
}

/**
 * Fetches a file as a stream
 *
 * The approach is DFS-like though we use the
 * max simultaneous fetches to speed up the process.
 *
 * @param node - The root node of the file
 * @returns A readable stream of the file
 */
const fetchFileAsStream = async (cid: string): Promise<Readable> => {
  const chunks = await dsnFetcher.getFileChunks(cid)

  // if a file is a multi-node file, we need to fetch the nodes in the correct order
  // bearing in mind there might be multiple levels of links, we need to fetch
  // all the links from the root node first and then continue with the next level
  const stream = new ReadableStream({
    start: async (controller) => {
      try {
        for (const chunk of chunks) {
          const node = await dsnFetcher.fetchNode(
            chunk.cid,
            chunks.map((e) => e.cid),
          )
          const data = safeIPLDDecode(node)
          if (!data) {
            throw new HttpError(
              400,
              'Bad request: Not a valid auto-dag-data IPLD node',
            )
          }

          controller.enqueue(Buffer.from(data.data ?? []))
        }

        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })

  return Readable.fromWeb(stream)
}

const getFileMetadata = (
  nodeMetadata: IPLDNodeData,
): Omit<FileResponse, 'data'> => {
  const isCompressedAndNotEncrypted =
    nodeMetadata.uploadOptions?.encryption === undefined &&
    nodeMetadata.uploadOptions?.compression?.algorithm ===
      CompressionAlgorithm.ZLIB

  return {
    size: nodeMetadata.size,
    mimeType:
      isCompressedAndNotEncrypted && nodeMetadata.name
        ? mime.lookup(nodeMetadata.name) || undefined
        : undefined,
    filename: nodeMetadata.name,
    encoding: isCompressedAndNotEncrypted ? 'deflate' : undefined,
  }
}

/** All `isZlibCompressed` reads: a zlib header is CMF + FLG. */
const ZLIB_HEADER_BYTES = 2

/**
 * The head of the file's stored body, read from the cached copy if we have one.
 *
 * The file cache is consulted first, and that is the point rather than an
 * optimisation. The compression probe runs on every download of a ZLIB-flagged
 * file, *including* one served entirely from `fileCache` — and reading the head
 * from the DSN instead means an unindexed file can fail a request whose bytes we
 * already hold: the chunk-list cache lives 10 minutes while the file cache lives
 * 24 hours, so once the former expires the probe re-walks the DAG and a slow or
 * unreachable gateway turns a local cache hit into a 503. Precisely during an
 * indexer gap, when both the fallback and the cache are load-bearing.
 *
 * The cached body is the *stored* bytes: `fileComposer` forks the response before
 * any content transform, so its first two bytes are the first chunk's first two
 * bytes. Reading them is also valid under `originControl=no-cache` — that asks
 * for fresh bytes, while this asks whether the content is zlib, and content does
 * not change under a CID.
 *
 * Returns `null` when the cache cannot answer, so the caller falls back to the
 * DSN rather than guessing from a read that failed.
 */
const cachedLeadingBytes = async (cid: string): Promise<Buffer | null> => {
  try {
    const cached = await fileCache.get(cid)
    if (!cached) {
      return null
    }

    return await readLeadingBytes(cached.data, ZLIB_HEADER_BYTES)
  } catch (error) {
    logger.warn(
      `Failed to read the cached copy to verify compression (cid=${cid}); falling back to the DSN; error=${error}`,
    )
    return null
  }
}

/**
 * Verifies whether a file flagged as ZLIB-compressed is *actually* stored as a
 * valid zlib stream by inspecting the leading bytes of its body.
 *
 * Some stored objects carry `compression: ZLIB` metadata while their node bytes
 * are plain (uncompressed) — see autonomys/auto-files-gateway#169. Serving those
 * with `Content-Encoding: deflate` (or inflating them server-side) corrupts the
 * response, so callers should use this to decide how to treat the body rather
 * than trusting the metadata flag alone.
 *
 * Reads from the cached copy when there is one and only otherwise from the DSN
 * (see `cachedLeadingBytes`).
 *
 * @returns true if the leading bytes are a valid zlib stream; false when the file
 *   is not actually compressed.
 * @throws the underlying `HttpError` when the bytes could not be inspected at
 *   all. Answering `false` in that case is not a safe default: for a file that
 *   *is* zlib, it strips `Content-Encoding` from a compressed body and hands the
 *   client something it cannot decode. Unindexed files make this reachable —
 *   `getFileChunks` may walk the whole DAG here and hit its deadline — so the
 *   request must fail honestly instead of succeeding with corrupt bytes. It only
 *   applies when nothing local holds the bytes; a file we can serve is a file we
 *   can inspect.
 */
const isActuallyCompressed = async (cid: string): Promise<boolean> => {
  try {
    const cachedHead = await cachedLeadingBytes(cid)
    if (cachedHead) {
      return isZlibCompressed(cachedHead)
    }

    const chunks = await dsnFetcher.getFileChunks(cid)
    const firstChunk = chunks[0]
    if (!firstChunk) {
      return false
    }

    const node = await dsnFetcher.fetchNode(
      firstChunk.cid,
      chunks.map((e) => e.cid),
    )
    const decoded = safeIPLDDecode(node)
    const data = decoded?.data
    if (!data || data.length === 0) {
      return false
    }

    return isZlibCompressed(Buffer.from(data))
  } catch (error) {
    // A typed failure means we could not read the bytes, not that they are
    // plaintext — surface it so the caller answers 503/404 rather than serving a
    // compressed body with the encoding stripped off.
    if (error instanceof HttpError) {
      logger.error(
        `Failed to verify actual compression (cid=${cid}); refusing to guess; error=${error}`,
      )
      throw error
    }

    logger.warn(
      `Failed to verify actual compression (cid=${cid}); assuming uncompressed; error=${error}`,
    )
    return false
  }
}

const fetchFile = async (
  cid: string,
  options?: FileCacheOptions,
): Promise<FileResponse> => {
  try {
    const metadata = await dsnFetcher.fetchNodeMetadata(cid)
    if (metadata.type !== MetadataType.File) {
      throw new HttpError(400, 'Bad request: Not a file')
    }

    const traits = getFileMetadata(metadata)

    logger.debug(
      `Fetching file (cid=${cid}, size=${traits.size}, mimeType=${traits.mimeType}, filename=${traits.filename}, encoding=${traits.encoding})`,
    )

    const readable = options?.byteRange
      ? await fetchFileAsStreamWithByteRange(cid, options.byteRange)
      : await fetchFileAsStream(cid)

    return {
      data: readable,
      ...traits,
    }
  } catch (error) {
    logger.error(`Failed to fetch file (cid=${cid}); error=${error}`)
    // Keep the diagnosis: a 400/404/503 raised while resolving the file said
    // something specific about why it can't be served, and flattening all of
    // them to 500 tells callers to give up on a failure that is retryable.
    if (error instanceof HttpError) {
      throw error
    }
    throw new HttpError(500, 'Internal server error: Failed to fetch file')
  }
}

const onFileDownloaded = async (cid: string) => {
  setTimeout(() => {
    migrateToFileCache(cid)
  })
}

const getNodeFromCache = async (cid: string) => {
  const cachedItem = await nodeCache.get(cid)
  if (!cachedItem) {
    return null
  }
  const buffer = await streamToBuffer(cachedItem.data)
  return decodeNode(buffer)
}

const migrateToFileCache = async (cid: string) => {
  const node = await getNodeFromCache(cid)
  if (!node) {
    logger.error(
      `Failed to migrate to file cache (cid=${cid}): node not found in cache`,
    )
    return
  }

  const chunks = await dsnFetcher.getFileChunks(cid)

  const ipldNodeData = safeIPLDDecode(node)
  if (!ipldNodeData) {
    logger.error(`Failed to migrate to file cache (cid=${cid})`)
    return
  }

  let index = 0
  fileCache.set(cid, {
    data: new Readable({
      read: async function () {
        if (index >= chunks.length) {
          this.push(null)
          return
        }

        while (index < chunks.length) {
          const chunk = chunks[index]
          const node = await getNodeFromCache(chunk.cid)
          if (!node) {
            logger.error(`Failed to migrate to file cache (cid=${cid})`)
            return
          }

          const data = safeIPLDDecode(node)
          if (!data) {
            logger.error(`Failed to migrate to file cache (cid=${cid})`)
            return
          }

          const canContinue = this.push(Buffer.from(data.data ?? []))
          index++
          if (!canContinue) {
            break
          }
        }
      },
    }),
    ...getFileMetadata(ipldNodeData),
  })
}

/**
 * Rebuilds the DAG Indexer's view of a node from the node itself.
 *
 * Chain provenance (block, extrinsic, timestamp) only exists in the indexer, so
 * those fields stay empty rather than being invented; everything the retrieval
 * path reads — type, size, name, upload options, links — comes from the IPLD
 * payload, which is authoritative because the CID commits to it.
 */
const metadataFromNode = (cid: string, node: PBNode): ExtendedIPLDMetadata => {
  const ipldMetadata = safeIPLDDecode(node)
  if (!ipldMetadata) {
    throw new HttpError(400, 'Bad request: Not a valid auto-dag-data IPLD node')
  }

  return {
    cid,
    type: ipldMetadata.type,
    linkDepth: ipldMetadata.linkDepth,
    name: ipldMetadata.name,
    // `IPLDNodeData.size` is optional, and the DAG Indexer stores `size ?? 0`.
    // Passing `undefined` through would diverge from the indexed path, where
    // `Number(metadata.size)` is relied upon to be a number.
    size: ipldMetadata.size ?? BigInt(0),
    uploadOptions: ipldMetadata.uploadOptions,
    links: node.Links.map((link) => cidToString(link.Hash)),
    blake3Hash: getObjectMappingHash(cid),
    blockHeight: 0,
    blockHash: '',
    extrinsicId: '',
    extrinsicHash: '',
    indexInBlock: 0,
    timestamp: new Date(0),
  }
}

const fetchNodeMetadataFromDsn = async (
  cid: string,
  remainingMs?: () => number,
): Promise<ExtendedIPLDMetadata> => {
  const node = await dsnFetcher.fetchNode(cid, [], remainingMs)
  return metadataFromNode(cid, node)
}

const fetchNodeMetadata = async (
  cid: string,
): Promise<ExtendedIPLDMetadata> => {
  const node = await dagIndexerRepository.getDagNode(cid)
  if (node) {
    return node
  }

  if (!config.dagIndexerFallback.enabled) {
    throw new HttpError(404, 'Not found: Failed to get node metadata', {
      reason: UNAVAILABLE_REASON.objectNotFound,
    })
  }

  logger.info(
    `DAG node not indexed (cid=${cid}); reconstructing metadata from the DSN`,
  )

  // Budgeted like the chunk-list rebuild. It is only one node, but one node is
  // enough to hang for FETCH_TIMEOUT (180s) times three retries — and this is
  // `GET /files/:cid/metadata`, the endpoint the original incident was reported
  // on. Without a deadline the caller gives up first and gets no reason why.
  const deadline = createDeadline(cid)

  try {
    const metadata = await withDeadlineReporting(deadline, () =>
      dsnFetcher.fetchNodeMetadataFromDsn(cid, deadline.remainingMs),
    )
    recordDagIndexerFallback('metadata_rebuilt', { nodesWalked: 1 })
    return metadata
  } catch (error) {
    recordDagIndexerFallback('failed')
    throw error
  }
}

/**
 * Chunk lists rebuilt from the DSN, kept in memory so a client walking a file
 * chunk by chunk (`/files/:cid/partial`) doesn't re-traverse the DAG per request.
 * Keyed by file CID; content-addressed, so entries can never go stale.
 *
 * `updateAgeOnGet` is essential, not an optimisation: the SDK downloads a file
 * one `/files/:cid/partial?chunk=N` request at a time and every one of those
 * calls `getFileChunks`. Without refreshing the age the TTL is a wall clock on
 * the *download* rather than on idle time, so any transfer outliving the TTL
 * hits an expired entry mid-stream and re-walks the whole DAG — repeatedly, and
 * for a large file each re-walk can itself outlast the TTL.
 */
const dsnChunkListCache = new LRUCache<string, ExtendedIPLDMetadata[]>({
  max: config.dagIndexerFallback.chunkListCacheSize,
  // Entry count alone does not bound memory here: one entry holds up to
  // `maxNodes` chunk records, so 500 entries ranges from a few megabytes to over
  // a gigabyte depending on file sizes. Bound the total chunk count as well.
  maxSize: config.dagIndexerFallback.chunkListCacheMaxChunks,
  sizeCalculation: (chunks) => chunks.length || 1,
  ttl: config.dagIndexerFallback.chunkListCacheTtl,
  updateAgeOnGet: true,
})

/**
 * A chunk list already rebuilt from the DSN, if one is cached, counted as the
 * cache hit it is.
 *
 * Callers consult this *before* asking the indexer anything. That matters for a
 * file the indexer has only partially indexed: its head is present, so the
 * expensive chunk-list query runs, and only its result reveals that the file is
 * truncated — after which the cached rebuild is returned anyway. Since the SDK
 * calls `getFileChunks` once per chunk, a single download re-ran a recursive CTE
 * over the whole DAG, re-emitted `chunk_list_incomplete` and re-logged its
 * warning, once per chunk of the file. A fully unindexed file never paid that,
 * because a missing head reaches the cache immediately.
 *
 * Returning a cached rebuild without consulting the indexer costs nothing in
 * correctness even for a file indexed since: a rebuild is a full depth-first walk
 * of content-addressed nodes, so it carries the same leaves in the same order as
 * the indexed query, and the fields read downstream (`cid`, `size`) are decoded
 * from the node bytes the CID commits to. Chain provenance is the only thing it
 * lacks, and nothing on the retrieval path reads it. The TTL bounds how long the
 * indexer stays unasked.
 */
const cachedChunkListFromDsn = (cid: string): ExtendedIPLDMetadata[] | null => {
  const cached = dsnChunkListCache.get(cid)
  if (!cached) {
    return null
  }

  // Counted separately: a served-from-cache hit still means this file is
  // unindexed, but it costs no DSN traffic. Conflating the two would make the
  // fallback look far more expensive than it is — and reporting the chunk count
  // as nodes *walked* did exactly that. This is called once per chunk request, so
  // a 5000-chunk download reported 25M walked nodes for a rebuild that visited
  // ~5000.
  recordDagIndexerFallback('chunk_list_cached', {
    nodesWalked: 0,
    chunkCount: cached.length,
  })

  return cached
}

/**
 * CIDs whose DAG we refused to walk because it exceeds the node limit. The
 * verdict is deterministic for a content-addressed CID, so caching it keeps a
 * retrying client from re-walking thousands of nodes only to fail identically.
 * Transient fetch failures are deliberately *not* cached — those should retry.
 */
const dsnChunkListRejections = new LRUCache<string, true>({
  max: config.dagIndexerFallback.chunkListCacheSize,
  ttl: config.dagIndexerFallback.chunkListCacheTtl,
})

/**
 * Rebuilds in progress, so concurrent requests for the same CID share one walk.
 *
 * The cache is only populated once a walk *finishes*, so without this every
 * request arriving during a rebuild starts its own full traversal of the same
 * DAG. A rebuild is the most expensive thing this service does — it fetches
 * every node of the file — and the requests most likely to overlap are requests
 * for the same popular file.
 */
const dsnChunkListRebuilds = new Map<string, Promise<ExtendedIPLDMetadata[]>>()

/**
 * Rebuilds a file's ordered leaf-chunk list straight from the DSN, for files the
 * DAG Indexer has no record of.
 *
 * Walks the DAG depth-first so leaves come out in file order, passing each
 * level's link list as siblings so nodes sharing a piece are fetched in one
 * request.
 */
const getFileChunksFromDsn = async (
  cid: string,
): Promise<ExtendedIPLDMetadata[]> => {
  const cached = cachedChunkListFromDsn(cid)
  if (cached) {
    return cached
  }

  if (dsnChunkListRejections.has(cid)) {
    throw dagTooLargeForFallbackError(cid)
  }

  const inFlight = dsnChunkListRebuilds.get(cid)
  if (inFlight) {
    return inFlight
  }

  // Removed on settle either way: a rejection must not be cached, so the next
  // request retries a transient failure rather than inheriting it.
  const rebuild = rebuildChunkListFromDsn(cid)
    .then(({ chunks, nodesWalked }) => {
      // `nodesWalked`, not `chunks.length`: inlinks are fetched too, and it is
      // the walked count that `maxNodes` bounds, so this is the number to compare
      // against DAG_INDEXER_FALLBACK_MAX_NODES when tuning it.
      recordDagIndexerFallback('chunk_list_rebuilt', {
        nodesWalked,
        chunkCount: chunks.length,
      })
      return chunks
    })
    .catch((error: unknown) => {
      recordDagIndexerFallback('failed')
      throw error
    })
    .finally(() => {
      dsnChunkListRebuilds.delete(cid)
    })
  dsnChunkListRebuilds.set(cid, rebuild)

  return rebuild
}

const rebuildChunkListFromDsn = async (
  cid: string,
): Promise<{ chunks: ExtendedIPLDMetadata[]; nodesWalked: number }> => {
  const deadline = createDeadline(cid)

  // The head fetch is budgeted like any other, so it needs the same mapping: a
  // budget overrun here is still `dag_indexer_fallback_timed_out`, not a 500.
  const head = await withDeadlineReporting(deadline, () =>
    dsnFetcher.fetchNodeMetadataFromDsn(cid, deadline.remainingMs),
  )
  if (head.type !== MetadataType.File) {
    throw new HttpError(400, 'Bad request: Not a file')
  }

  const chunks: ExtendedIPLDMetadata[] = []
  // Starts at 1 for the head, which is fetched above and is as real a fetch as
  // any in the walk.
  let nodesWalked = 1

  const walk = async (nodeCid: string, siblings: string[]): Promise<void> => {
    deadline.check()

    if (++nodesWalked > config.dagIndexerFallback.maxNodes) {
      dsnChunkListRejections.set(cid, true)
      throw dagTooLargeForFallbackError(cid)
    }

    const node = await withDeadlineReporting(deadline, () =>
      dsnFetcher.fetchNode(nodeCid, siblings, deadline.remainingMs),
    )

    const metadata = metadataFromNode(nodeCid, node)
    if (metadata.links.length === 0) {
      chunks.push(metadata)
      return
    }

    for (const child of metadata.links) {
      await walk(child, metadata.links)
    }
  }

  // A file that fits in a single node is its own only chunk.
  if (head.links.length === 0) {
    chunks.push(head)
  } else {
    for (const child of head.links) {
      await walk(child, head.links)
    }
  }

  // TTL is applied per entry rather than only from the constructor so the knob
  // is read where it is used, matching how `maxNodes` is read inside the walk.
  dsnChunkListCache.set(cid, chunks, {
    ttl: config.dagIndexerFallback.chunkListCacheTtl,
  })

  return { chunks, nodesWalked }
}

/**
 * Resolves the object mapping for `targetHash`, batching `siblingHashes` into
 * the same lookup so nodes sharing a piece can be fetched in one request.
 *
 * The indexer rejects the *whole* batch when any hash is unknown to it, so a
 * single not-yet-indexed sibling would otherwise make a perfectly retrievable
 * node unfetchable. Fall back to looking up the target alone — the siblings are
 * only a batching optimisation.
 *
 * The retry is deliberately limited to that one case. Retrying after a timeout,
 * a refused connection or an indexer-side fault doubles the request volume and
 * doubles time-to-failure at exactly the moment the indexer is already
 * struggling — and during a DAG walk that doubling applies once per cold node.
 */
const resolveObjectMappings = async (
  targetHash: string,
  siblingHashes: string[],
): Promise<ObjectMapping[]> => {
  if (siblingHashes.length === 0) {
    return objectMappingIndexer.get_object_mappings({ hashes: [targetHash] })
  }

  try {
    return await objectMappingIndexer.get_object_mappings({
      hashes: [targetHash, ...siblingHashes],
    })
  } catch (error) {
    if (!isObjectMappingMiss(error)) {
      throw error
    }

    logger.warn(
      `Batched object mapping lookup rejected for an unknown sibling (hash=${targetHash}, siblings=${siblingHashes.length}); retrying target alone; error=${error}`,
    )
    return objectMappingIndexer.get_object_mappings({ hashes: [targetHash] })
  }
}

const fetchNode = async (
  cid: string,
  siblings: string[],
  /**
   * Milliseconds left in the caller's budget, when it has one. Only DAG-indexer
   * reconstruction does; ordinary downloads pass nothing and keep the full
   * FETCH_TIMEOUT per fetch.
   */
  remainingMs?: () => number,
): Promise<PBNode> => {
  const isCached: boolean = await nodeCache.has(cid)
  if (isCached) {
    const buffer = await nodeCache.get(cid).then((e) => streamToBuffer(e!.data))
    return decodeNode(buffer)
  }

  const nodeObjectMappingHash = getObjectMappingHash(cid)
  const siblingHashes = siblings
    .filter((e) => e !== cid)
    .map(getObjectMappingHash)

  let objectMappings: ObjectMapping[]
  try {
    objectMappings = await resolveObjectMappings(
      nodeObjectMappingHash,
      siblingHashes,
    )
  } catch (error) {
    if (isObjectMappingMiss(error)) {
      // The Object Mapping Indexer only publishes mappings once the segment
      // holding the object is fully archived, so an unknown hash means "not on
      // the DSN (yet)" — a miss, not a server fault.
      logger.warn(`No object mapping for cid=${cid}; error=${error}`)
      throw objectNotFoundError(cid)
    }

    logger.error(
      `Object mapping lookup failed (cid=${cid}); error=${error} — reporting as retryable, not as a miss`,
    )
    throw mappingLookupFailedError(cid, error)
  }

  const nodeObjectMapping = objectMappings.find(
    (e) => e[0] === nodeObjectMappingHash,
  )
  if (!nodeObjectMapping) {
    throw objectNotFoundError(cid)
  }

  const objectMappingsWithinSamePiece = objectMappings.filter(
    (e) => e[1] === nodeObjectMapping[1],
  )
  if (objectMappingsWithinSamePiece.length === 0) {
    throw new HttpError(
      500,
      'Internal server error: Optimizing batch did not include target node',
    )
  }

  const objectsByCID = await dsnFetcher
    .fetchObjects(objectMappingsWithinSamePiece, remainingMs)
    .then((nodes) =>
      Object.fromEntries(
        nodes.map((e) => [cidToString(cidOfNode(e)), e] as [string, PBNode]),
      ),
    )

  Object.entries(objectsByCID).forEach(([cid, node]) => {
    nodeCache.set(cid, {
      data: Readable.from(Buffer.from(encodeNode(node))),
    })
  })

  const node = objectsByCID[cid]
  if (!node) {
    // Returning `undefined` here used to surface as a bare 404 (or an empty
    // 200 on /nodes/:cid) even though the mapping proves the object exists.
    throw notRetrievableYetError(
      cid,
      'the Subspace Gateway fetch did not return the requested node',
    )
  }

  return node
}

const getFileChunks = async (cid: string): Promise<ExtendedIPLDMetadata[]> => {
  // Before the indexer, not after it: see `cachedChunkListFromDsn`. A partially
  // indexed file would otherwise re-run the chunk-list query, and re-report
  // itself as incomplete, on every one of the per-chunk requests a download is
  // made of.
  const rebuilt = cachedChunkListFromDsn(cid)
  if (rebuilt) {
    return rebuilt
  }

  const root = await dagIndexerRepository.getDagNode(cid)
  if (!root) {
    if (!config.dagIndexerFallback.enabled) {
      throw new HttpError(
        500,
        'Internal server error: Failed to get file chunks',
      )
    }

    logger.info(
      `DAG node not indexed (cid=${cid}); rebuilding chunk list from the DSN`,
    )

    return dsnFetcher.getFileChunksFromDsn(cid)
  }

  if (root.type !== MetadataType.File) {
    throw new HttpError(400, 'Bad request: Not a file')
  }

  const { chunks, unindexedLinks } =
    await dagIndexerRepository.getSortedChunksByCid(cid)

  // A missing *root* is not the only way the indexer can fail us. Nodes are
  // indexed one extrinsic at a time and `handleCall` swallows per-extrinsic
  // failures, so a file's head can be indexed while nodes below it are not —
  // whether because the indexer stopped mid-file or because it dropped a node
  // permanently. The chunk list is then a truncated view of the file, and
  // serving it produces a `200` carrying the wrong bytes: short at best, empty
  // when nothing under the head was indexed. Treat it as a miss and reconstruct,
  // which turns silent corruption into either correct bytes or an honest 503.
  if (unindexedLinks.length > 0) {
    if (!config.dagIndexerFallback.enabled) {
      throw new HttpError(
        500,
        'Internal server error: Failed to get file chunks',
      )
    }

    logger.warn(
      `DAG partially indexed (cid=${cid}): ${unindexedLinks.length} referenced node(s) missing (e.g. ${unindexedLinks.slice(0, 3).join(', ')}); rebuilding chunk list from the DSN rather than serving ${chunks.length} chunk(s) of a truncated file`,
    )
    recordDagIndexerFallback('chunk_list_incomplete', {
      unindexedLinks: unindexedLinks.length,
      chunkCount: chunks.length,
    })

    return dsnFetcher.getFileChunksFromDsn(cid)
  }

  return chunks
}

const getPartial = async (
  cid: string,
  chunk: number,
): Promise<Buffer | null> => {
  const chunks = await dsnFetcher.getFileChunks(cid)
  const chunkDagNode = chunks[chunk]
  if (!chunkDagNode) {
    return null
  }

  const node = await dsnFetcher.fetchNode(
    chunkDagNode.cid,
    chunks.map((e) => e.cid),
  )

  if (chunk === chunks.length - 1) {
    onFileDownloaded(cid)
  }

  const ipldMetadata = safeIPLDDecode(node)
  if (!ipldMetadata) {
    throw new HttpError(400, 'Bad request: Not a valid auto-dag-data IPLD node')
  }
  return Buffer.from(ipldMetadata.data ?? [])
}

/**
 * Drops all DAG-indexer-fallback state. Exposed for tests: these caches are
 * module-level, so without a reset one test's rejection or rebuilt chunk list
 * silently satisfies the next test's assertions.
 */
export const resetDagIndexerFallbackState = () => {
  dsnChunkListCache.clear()
  dsnChunkListRejections.clear()
  dsnChunkListRebuilds.clear()
}

export const dsnFetcher = {
  fetchFile,
  fetchNode,
  fetchObjects,
  getPartial,
  fetchNodeMetadata,
  fetchNodeMetadataFromDsn,
  getFileChunks,
  getFileChunksFromDsn,
  getFileMetadata,
  isActuallyCompressed,
}
