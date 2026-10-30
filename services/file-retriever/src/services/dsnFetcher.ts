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
import { decodeNodesOrThrow, safeIPLDDecode } from '../utils/dagData.js'
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
import {
  classifyUpstreamError,
  describeUpstreamFailure,
  gatewayLabel,
  UpstreamRpcError,
} from '../utils/upstreamErrors.js'
import { sendMetricToVictoria } from '../drivers/metrics.js'
import { Readable } from 'stream'
import { ReadableStream } from 'stream/web'
import { fileCache, nodeCache } from './cache.js'
import { dagIndexerRepository } from '../repositories/dag-indexer.js'
import { sliceReadable } from '../utils/readable.js'

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
 * @returns The list of nodes
 */
const fetchObjects = async (objects: ObjectMapping[]) => {
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
      async () =>
        withRetries(
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
        ),
      // The controller rejects a weight above its maximum outright, and one
      // piece can hold ~16 nodes of a file (64 KiB nodes, 1 MiB pieces) against
      // a default maximum of 10. An oversized batch is still one request, so
      // let it take every slot rather than fail before it is sent.
      Math.min(objects.length, config.objectFetching.maxSimultaneousFetches),
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
    const failure = classifyUpstreamError(error)

    const { durationMs, queueMs, fetchMs } = timings()

    logger.error(
      `Object fetch failed: ${request} attempts=${attempts} totalMs=${durationMs} queueMs=${queueMs} fetchMs=${fetchMs} ${describeUpstreamFailure(
        failure,
      )} hashes=[${objects.map((object) => object[0]).join(',')}]`,
    )

    reportObjectFetch({
      outcome: failure.kind,
      gateway: index,
      durationMs,
      queueMs,
      fetchMs,
      attempts,
      objects: objects.length,
      pieceIndex: pieceIndexes[0] ?? -1,
    })

    throw new HttpError(failure.statusCode, failure.clientMessage)
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
 *   the file is not actually compressed (or the bytes can't be inspected).
 */
const isActuallyCompressed = async (cid: string): Promise<boolean> => {
  try {
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

// Only callers arriving this soon after a fetch starts may join it. That covers
// the two reads of chunk 0 within one download, which are a DB round trip
// apart, without tying a client that retries after a stall to the same
// gateway's retry chain (up to MAX_FETCH_ATTEMPTS x FETCH_TIMEOUT). Errs short:
// a caller that misses the window just makes its own fetch, as main does.
const IN_FLIGHT_JOIN_WINDOW_MS = 2_000

const inFlightNodeFetches = new Map<
  string,
  { pending: Promise<PBNode>; startedAt: number }
>()

const fetchNode = async (cid: string, siblings: string[]): Promise<PBNode> => {
  const isCached: boolean = await nodeCache.has(cid)
  if (isCached) {
    const buffer = await nodeCache.get(cid).then((e) => streamToBuffer(e!.data))
    return decodeNode(buffer)
  }

  // A full download of a compressed file asks for chunk 0 twice concurrently -
  // once for the response stream, once for isActuallyCompressed - and neither
  // has populated nodeCache yet. Share the fetch so the piece is pulled once.
  const inFlight = inFlightNodeFetches.get(cid)
  if (
    inFlight &&
    performance.now() - inFlight.startedAt < IN_FLIGHT_JOIN_WINDOW_MS
  ) {
    return inFlight.pending
  }

  const startedAt = performance.now()
  const pending: Promise<PBNode> = fetchNodeFromDsn(cid, siblings).finally(
    () => {
      // A newer fetch may have replaced this entry after the window closed.
      if (inFlightNodeFetches.get(cid)?.pending === pending) {
        inFlightNodeFetches.delete(cid)
      }
    },
  )
  inFlightNodeFetches.set(cid, { pending, startedAt })

  return pending
}

const fetchNodeFromDsn = async (
  cid: string,
  siblings: string[],
): Promise<PBNode> => {
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

  const objectsByCID = await fetchObjects(objectMappingsWithinSamePiece).then(
    (nodes) =>
      Object.fromEntries(
        nodes.map((e) => [cidToString(cidOfNode(e)), e] as [string, PBNode]),
      ),
  )

  // Not awaited, so a failed write (full disk, EACCES on the cache dir) must be
  // caught here: unhandled, it would take the whole process down.
  Object.entries(objectsByCID).forEach(([cid, node]) => {
    nodeCache
      .set(cid, {
        data: Readable.from(Buffer.from(encodeNode(node))),
      })
      .catch((error) => {
        logger.warn(`Failed to cache node (cid=${cid}): ${error}`)
      })
  })

  return objectsByCID[cid]
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
