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
} from '@autonomys/file-caching'
import { z } from 'zod'
import { PBNode } from '@ipld/dag-pb'
import { HttpError } from '../http/middlewares/error.js'
import { safeIPLDDecode } from '../utils/dagData.js'
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
import { sliceReadable } from '../utils/readable.js'

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

  return concurrencyController(
    async () =>
      withRetries(
        async () => {
          logger.debug(
            `Fetching nodes (requestId=${requestId}): ${objects.map((e) => e[0]).join(', ')}`,
          )
          const fetchStart = performance.now()
          const response = await axios.post(gatewayUrl, body, {
            timeout: config.objectFetching.fetchTimeout,
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
        },
      ),
    objects.length,
  )
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

  // Searchs for the first node that contains the byte range
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

  return sliceReadable(
    Readable.fromWeb(stream),
    byteRange[0] - firstNodeFileOffset,
    byteRange[1] ? byteRange[1] - byteRange[0] + 1 : Number.POSITIVE_INFINITY,
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

const fetchNodeMetadata = async (
  cid: string,
): Promise<ExtendedIPLDMetadata> => {
  const node = await dagIndexerRepository.getDagNode(cid)
  if (!node) {
    throw new HttpError(404, 'Not found: Failed to get node metadata')
  }
  return node
}

const fetchNode = async (cid: string, siblings: string[]): Promise<PBNode> => {
  const isCached: boolean = await nodeCache.has(cid)
  if (isCached) {
    const buffer = await nodeCache.get(cid).then((e) => streamToBuffer(e!.data))
    return decodeNode(buffer)
  }

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

  Object.entries(objectsByCID).forEach(([cid, node]) => {
    nodeCache.set(cid, {
      data: Readable.from(Buffer.from(encodeNode(node))),
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
}
