import {
  blake3HashFromCid,
  stringToCid,
  decodeNode,
  cidToString,
  CompressionAlgorithm,
  cidOfNode,
  encodeNode,
  IPLDNodeData,
  isZlibCompressed,
  MetadataType,
} from '@autonomys/auto-dag-data'
import {
  ByteRange,
  FileCacheOptions,
  FileResponse,
  readByteRange,
} from '@autonomys/file-server'
import { z } from 'zod'
import { PBNode } from '@ipld/dag-pb'
import { HttpError } from '../http/middlewares/error.js'
import { decodeNodesOrThrow, safeIPLDDecode } from '../utils/dagData.js'
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
import {
  classifyUpstreamError,
  describeUpstreamFailure,
  gatewayLabel,
  UpstreamRpcError,
} from '../utils/upstreamErrors.js'
import { sendMetricToVictoria } from '../drivers/metrics.js'
import { Readable } from 'stream'
import { fileCache, nodeCache } from './cache.js'
import { dagIndexerRepository } from '../repositories/dag-indexer.js'
import { SharedTask } from '../utils/sharedTask.js'

const fetchNodesSchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: z.array(z.string()),
})

const rpcErrorSchema = z.object({
  error: z.object({
    code: z.number(),
    message: z.string(),
  }),
})

const gatewayUrls = config.subspaceGatewayUrls.split(',')
const gatewayLabels = gatewayUrls.map(gatewayLabel)
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

const MAX_FETCH_ATTEMPTS = 3

/**
 * Reports the outcome of one object fetch so a stalled piece can be told apart
 * from a saturated gateway without reading the logs.
 */
const reportObjectFetch = (fields: {
  outcome: string
  gateway: number
  durationMs: number
  queueMs: number
  fetchMs: number
  attempts: number
  objects: number
  pieceIndex: number
}) => {
  if (!config.monitoring.active) {
    return
  }

  const { outcome, gateway, ...values } = fields

  sendMetricToVictoria({
    measurement: 'object_fetch',
    tag: `${config.monitoring.metricEnvironmentTag},outcome=${outcome},gateway=${gateway}`,
    fields: values,
  }).catch((error) => {
    logger.warn(`Failed to send object fetch metric: ${error}`)
  })
}

/**
 * Fetches the nodes for a given list of cids
 *
 * @param cids - The list of cids to fetch the nodes for
 * @param shouldSend - Asked when the fetch reaches the front of the queue:
 *   false drops it there, unsent. Once sent, a fetch runs to the end.
 * @returns The list of nodes
 */
const fetchObjects = async (
  objects: ObjectMapping[],
  shouldSend?: () => boolean,
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

  const pieceIndexes = [...new Set(objects.map((object) => object[1]))]
  const request = `requestId=${requestId} gateway=${gatewayLabels[index]} objects=${objects.length} pieces=[${pieceIndexes.join(',')}]`

  let attempts = 0
  let attemptStartedAt = now
  let firstAttemptStartedAt: number | undefined
  let dropped = false

  const timings = () => {
    const total = performance.now() - now
    const queueMs = Math.round(
      (firstAttemptStartedAt ?? performance.now()) - now,
    )
    return {
      durationMs: Math.round(total),
      queueMs,
      fetchMs: Math.round(total) - queueMs,
    }
  }

  try {
    const nodes = await concurrencyController(
      async () => {
        // The controller cannot take a job back out of its queue, so a fetch
        // nobody waits for any more is dropped here, when it reaches the front.
        if (shouldSend && !shouldSend()) {
          dropped = true
          throw new Error('Object fetch dropped before it was sent')
        }
        return withRetries(
          async () => {
            attempts++
            attemptStartedAt = performance.now()
            firstAttemptStartedAt ??= attemptStartedAt
            logger.debug(
              `Fetching nodes (requestId=${requestId}): ${objects.map((e) => e[0]).join(', ')}`,
            )
            const response = await axios.post(gatewayUrl, body, {
              timeout: config.objectFetching.fetchTimeout,
              responseType: 'json',
            })
            if (response.status !== 200) {
              throw new HttpError(
                502,
                `Bad gateway: fetch nodes returned status ${response.status}`,
              )
            }

            const rpcError = rpcErrorSchema.safeParse(response.data)
            if (rpcError.success) {
              throw new UpstreamRpcError(
                rpcError.data.error.code,
                rpcError.data.error.message,
              )
            }

            const validatedResponseData = fetchNodesSchema.safeParse(
              response.data,
            )
            if (!validatedResponseData.success) {
              logger.debug(
                `Fetch nodes response: ${JSON.stringify(response.data)}`,
              )
              throw new HttpError(
                502,
                `Bad gateway: Failed to parse fetch nodes response (${validatedResponseData.error.issues
                  .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                  .join('; ')})`,
              )
            }

            const end = performance.now()
            logger.debug(
              `Fetched ${objects.length} nodes in total=${end - now}ms fetch=${end - attemptStartedAt}ms (requestId=${requestId})`,
            )

            return decodeNodesOrThrow(validatedResponseData.data.result)
          },
          {
            maxRetries: MAX_FETCH_ATTEMPTS,
            delay: 500,
            onError: (error, attempt, willRetry) => {
              const failure = classifyUpstreamError(error)
              logger.warn(
                `Object fetch attempt failed: ${request} attempt=${attempt}/${MAX_FETCH_ATTEMPTS} elapsedMs=${Math.round(
                  performance.now() - attemptStartedAt,
                )} ${describeUpstreamFailure(failure)} retrying=${willRetry}`,
              )
            },
          },
        )
      },
      // The gateway downloads each piece once per call, however many of its
      // objects are asked for, so a call costs one slot per piece. The
      // controller rejects a weight above its maximum outright, so a batch
      // spanning more pieces than that takes every slot instead.
      Math.min(pieceIndexes.length, config.objectFetching.maxSimultaneousFetches),
    )

    reportObjectFetch({
      outcome: 'success',
      gateway: index,
      ...timings(),
      attempts,
      objects: objects.length,
      pieceIndex: pieceIndexes[0] ?? -1,
    })

    return nodes
  } catch (error) {
    const { durationMs, queueMs, fetchMs } = timings()
    const failure = classifyUpstreamError(error)

    if (dropped) {
      logger.info(
        `Object fetch dropped before it was sent, no request is waiting for it: ${request} queueMs=${queueMs}`,
      )
    } else {
      logger.error(
        `Object fetch failed: ${request} attempts=${attempts} totalMs=${durationMs} queueMs=${queueMs} fetchMs=${fetchMs} ${describeUpstreamFailure(
          failure,
        )} hashes=[${objects.map((object) => object[0]).join(',')}]`,
      )
    }

    reportObjectFetch({
      outcome: dropped ? 'dropped' : failure.kind,
      gateway: index,
      durationMs,
      queueMs,
      fetchMs,
      attempts,
      objects: objects.length,
      pieceIndex: pieceIndexes[0] ?? -1,
    })

    if (dropped) {
      throw error
    }
    throw new HttpError(failure.statusCode, failure.clientMessage)
  }
}

type FetchedNodes = Map<string, PBNode>

/**
 * Fetches that requests can still join, by the object mapping hash of every
 * node they bring back. A fetch stays listed until its nodes are in the node
 * cache, so a request that just missed the cache still finds it here. That
 * holds even after every request has given up on a fetch already sent, so a
 * retry after a timeout joins it rather than starting the piece over.
 */
const sharedFetches = new Map<string, SharedTask<FetchedNodes>>()

// Nobody awaits this, so it must never reject: an unhandled rejection takes
// the whole process down.
const cacheNodes = (nodes: FetchedNodes) =>
  Promise.all(
    [...nodes].map(async ([cid, node]) => {
      try {
        await nodeCache.set(cid, {
          data: Readable.from(Buffer.from(encodeNode(node))),
        })
      } catch (error) {
        logger.warn(`Failed to cache node (cid=${cid}): ${error}`)
      }
    }),
  )

const startSharedFetch = (
  objects: ObjectMapping[],
): SharedTask<FetchedNodes> => {
  let sent = false
  const fetch = new SharedTask(async (signal) => {
    const nodes = await fetchObjects(objects, () => {
      sent = !signal.aborted
      return sent
    })
    return new Map(nodes.map((node) => [cidToString(cidOfNode(node)), node]))
  })

  const hashes = objects
    .map(([hash]) => hash)
    .filter((hash) => !sharedFetches.has(hash))
  hashes.forEach((hash) => sharedFetches.set(hash, fetch))
  const unlist = () =>
    hashes.forEach((hash) => {
      if (sharedFetches.get(hash) === fetch) {
        sharedFetches.delete(hash)
      }
    })

  fetch.signal.addEventListener('abort', () => {
    if (!sent) {
      unlist()
    }
  })
  fetch.result.then((nodes) => cacheNodes(nodes).finally(unlist), unlist)

  return fetch
}

const withRequestTimeout = (signal?: AbortSignal): AbortSignal => {
  const timeout = AbortSignal.timeout(config.objectFetching.requestTimeout)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/** Settles with `work`, or rejects with `signal.reason` once it aborts. */
const unlessAborted = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
    if (signal.aborted) {
      onAbort()
    } else {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })

// A piece holds about 16 full-size nodes, so this covers the rest of the
// current piece with room to spare, while keeping each object mapping lookup
// small however large the file is.
const SIBLING_WINDOW = 64

const siblingWindow = (cids: string[], index: number) =>
  cids.slice(index, index + SIBLING_WINDOW)

// Fetches each node only when the stream wants more data, so a slow or
// stalled client cannot make the whole file pile up in memory.
const streamNodes = (cids: string[], signal?: AbortSignal): Readable =>
  Readable.from(
    (async function* () {
      for (const [index, cid] of cids.entries()) {
        // A node that fails inside a response stream can only reset the
        // connection, and inside a cache fill it loses the copy being cached,
        // so streamed nodes wait for as long as their fetch takes.
        const node = await dsnFetcher.fetchNode(
          cid,
          siblingWindow(cids, index),
          signal,
          { timeout: false },
        )
        const data = safeIPLDDecode(node)
        if (!data) {
          throw new HttpError(
            400,
            'Bad request: Not a valid auto-dag-data IPLD node',
          )
        }
        yield Buffer.from(data.data ?? [])
      }
    })(),
    { objectMode: false },
  )

const fetchFileAsStreamWithByteRange = async (
  cid: string,
  byteRange: ByteRange,
  signal?: AbortSignal,
): Promise<Readable> => {
  const chunks = await dsnFetcher.getFileChunks(cid)

  return readByteRange(chunks, byteRange, (nodes) => {
    logger.debug(
      `fetchFileAsStreamWithByteRange (cid=${cid}, byteRange=[${byteRange[0]}, ${byteRange[1] ?? 'EOF'}]) ${nodes.length} nodes from ${nodes[0]} to ${nodes[nodes.length - 1]}`,
    )
    return streamNodes(nodes, signal)
  })
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
const fetchFileAsStream = async (
  cid: string,
  signal?: AbortSignal,
): Promise<Readable> => {
  const chunks = await dsnFetcher.getFileChunks(cid)
  return streamNodes(
    chunks.map((e) => e.cid),
    signal,
  )
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

/**
 * Verifies whether a file flagged as ZLIB-compressed is *actually* stored as a
 * valid zlib stream by inspecting the leading bytes of its first chunk.
 *
 * Some stored objects carry `compression: ZLIB` metadata while their node bytes
 * are plain (uncompressed) — see autonomys/auto-files-gateway#169. Serving those
 * with `Content-Encoding: deflate` (or inflating them server-side) corrupts the
 * response, so callers should use this to decide how to treat the body rather
 * than trusting the metadata flag alone.
 *
 * @returns true if the first chunk's bytes are a valid zlib stream; false when
 *   they are not, or there are none. Rejects when the first chunk cannot be
 *   fetched, since either guess would serve some files with the wrong encoding.
 */
const isActuallyCompressed = async (
  cid: string,
  signal?: AbortSignal,
): Promise<boolean> => {
  const chunks = await dsnFetcher.getFileChunks(cid)
  const firstChunk = chunks[0]
  if (!firstChunk) {
    return false
  }

  const node = await dsnFetcher.fetchNode(
    firstChunk.cid,
    siblingWindow(
      chunks.map((e) => e.cid),
      0,
    ),
    signal,
  )
  const decoded = safeIPLDDecode(node)
  const data = decoded?.data
  if (!data || data.length === 0) {
    return false
  }

  return isZlibCompressed(Buffer.from(data))
}

const fetchFile = async (
  cid: string,
  options?: FileCacheOptions & { signal?: AbortSignal },
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
      ? await fetchFileAsStreamWithByteRange(
          cid,
          options.byteRange,
          options.signal,
        )
      : await fetchFileAsStream(cid, options?.signal)

    return {
      data: readable,
      ...traits,
    }
  } catch (error) {
    logger.error(`Failed to fetch file (cid=${cid}); error=${error}`)
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
  fileCache
    .set(cid, {
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
    .catch((error) => {
      logger.warn(`Failed to migrate to file cache (cid=${cid}): ${error}`)
    })
}

const fetchNodeMetadata = async (
  cid: string,
): Promise<ExtendedIPLDMetadata> => {
  const node = await dagIndexerRepository.getDagNode(cid)
  if (!node) {
    throw new HttpError(404, 'Not found: Failed to get node metadata')
  }
  return node
}

const findPieceObjects = async (
  cid: string,
  siblings: string[],
): Promise<ObjectMapping[]> => {
  const nodeObjectMappingHash = getObjectMappingHash(cid)
  const hashes = [cid, ...siblings.filter((e) => e !== cid)].map(
    getObjectMappingHash,
  )
  const objectMappings = await objectMappingIndexer.get_object_mappings({
    hashes,
  })
  const nodeObjectMapping = objectMappings.find(
    (e) => e[0] === nodeObjectMappingHash,
  )
  if (!nodeObjectMapping) {
    throw new HttpError(
      500,
      'Internal server error: Failed to find node object mapping',
    )
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

  return objectMappingsWithinSamePiece
}

const fetchNodeFromDsn = async (
  cid: string,
  siblings: string[],
  deadline: AbortSignal,
): Promise<PBNode> => {
  const hash = getObjectMappingHash(cid)
  let fetch = sharedFetches.get(hash)
  if (fetch) {
    logger.debug(`Joining in-flight fetch (cid=${cid})`)
  } else {
    // The indexer client takes no signal, so a lookup that hangs is left
    // behind rather than cancelled.
    const objects = await unlessAborted(
      findPieceObjects(cid, siblings),
      deadline,
    )
    fetch = sharedFetches.get(hash)
    if (!fetch) {
      // A fetch that finished during the lookup is no longer listed, but its
      // nodes are cached.
      const cached = await getNodeFromCache(cid)
      if (cached) {
        return cached
      }
      fetch = sharedFetches.get(hash) ?? startSharedFetch(objects)
    }
  }

  const node = (await fetch.wait(deadline)).get(cid)
  if (!node) {
    throw new HttpError(
      502,
      'Bad gateway: the subspace gateway did not return the requested node',
    )
  }
  return node
}

/**
 * @param siblings - Nodes fetched along with this one when they share its piece
 * @param signal - Stops waiting once aborted. The fetch itself is dropped only
 *   when no other request is waiting for it.
 * @param timeout - Also stops waiting after FETCH_REQUEST_TIMEOUT, with a 504
 */
const fetchNode = async (
  cid: string,
  siblings: string[],
  signal?: AbortSignal,
  { timeout = true }: { timeout?: boolean } = {},
): Promise<PBNode> => {
  const cached = await getNodeFromCache(cid)
  if (cached) {
    return cached
  }

  const deadline = timeout
    ? withRequestTimeout(signal)
    : (signal ?? new AbortController().signal)
  try {
    return await fetchNodeFromDsn(cid, siblings, deadline)
  } catch (error) {
    if (error !== deadline.reason || error instanceof HttpError) {
      throw error
    }
    throw new HttpError(
      504,
      'Gateway timeout: the object could not be retrieved in time',
    )
  }
}

const getFileChunks = async (cid: string): Promise<ExtendedIPLDMetadata[]> => {
  const root = await dagIndexerRepository.getDagNode(cid)
  if (!root) {
    throw new HttpError(500, 'Internal server error: Failed to get file chunks')
  }

  if (root.type !== MetadataType.File) {
    throw new HttpError(400, 'Bad request: Not a file')
  }

  return dagIndexerRepository.getSortedChunksByCid(cid)
}

const getPartial = async (
  cid: string,
  chunk: number,
  signal?: AbortSignal,
): Promise<Buffer | null> => {
  const chunks = await dsnFetcher.getFileChunks(cid)
  const chunkDagNode = chunks[chunk]
  if (!chunkDagNode) {
    return null
  }

  const node = await dsnFetcher.fetchNode(
    chunkDagNode.cid,
    siblingWindow(
      chunks.map((e) => e.cid),
      chunk,
    ),
    signal,
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

export const dsnFetcher = {
  fetchFile,
  fetchNode,
  fetchObjects,
  getPartial,
  fetchNodeMetadata,
  getFileChunks,
  getFileMetadata,
  isActuallyCompressed,
}
