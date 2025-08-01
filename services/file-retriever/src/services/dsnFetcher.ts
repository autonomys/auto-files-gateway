import {
  blake3HashFromCid,
  stringToCid,
  decodeNode,
  MetadataType,
  cidToString,
  CompressionAlgorithm,
  cidOfNode,
  encodeNode,
} from '@autonomys/auto-dag-data'
import { FileResponse } from '@autonomys/file-caching'
import { z } from 'zod'
import { PBNode } from '@ipld/dag-pb'
import { HttpError } from '../http/middlewares/error.js'
import { safeIPLDDecode } from '../utils/dagData.js'
import mime from 'mime-types'
import { config } from '../config.js'
import { logger } from '../drivers/logger.js'
import axios from 'axios'
import { objectMappingIndexer } from './objectMappingIndexer.js'
import { fromEntries, promiseAll } from '../utils/array.js'
import {
  streamToBuffer,
  weightedRequestConcurrencyController,
} from '@autonomys/asynchronous'
import { optimizeBatchFetch } from './batchOptimizer.js'
import { ObjectMapping } from '@auto-files/models'
import { withRetries } from '../utils/retries.js'
import { Readable } from 'stream'
import { ReadableStream } from 'stream/web'
import { fileCache, nodeCache } from './cache.js'

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

/**
 * Fetches a file as a stream
 *
 * The approach is DFS-like though we use the
 * max simultaneous fetches to speed up the process.
 *
 * @param node - The root node of the file
 * @returns A readable stream of the file
 */
const fetchFileAsStream = (node: PBNode): ReadableStream => {
  const metadata = safeIPLDDecode(node)

  // if a file is a single node (< 64KB) no additional fetching is needed
  if (node.Links.length === 0) {
    logger.debug(
      `File resolved to single node file: (cid=${cidToString(cidOfNode(node))}, size=${metadata?.size})`,
    )
    return new ReadableStream({
      start: async (controller) => {
        controller.enqueue(Buffer.from(metadata?.data ?? []))
        controller.close()
      },
    })
  }

  logger.debug(
    `File resolved to multi-node file: (cid=${cidToString(cidOfNode(node))}, size=${metadata?.size})`,
  )
  // if a file is a multi-node file, we need to fetch the nodes in the correct order
  // bearing in mind there might be multiple levels of links, we need to fetch
  // all the links from the root node first and then continue with the next level
  return new ReadableStream({
    start: async (controller) => {
      try {
        logger.debug('Starting to fetch file')
        // for the first iteration, we need to fetch all the links from the root node
        let requestsPending = node.Links.map(({ Hash }) =>
          getObjectMappingHash(cidToString(Hash)),
        )
        while (requestsPending.length > 0) {
          // we fetch the object mappings in parallel
          const objectMappings = await objectMappingIndexer.get_object_mappings(
            {
              hashes: requestsPending,
            },
          )
          // we group the object mapping by the piece index
          const nodes = optimizeBatchFetch(objectMappings)

          // we fetch the nodes in parallel grouped by the piece index
          // and we create a map of the nodes by their hash
          const objectsByHash = fromEntries(
            await promiseAll(
              nodes.map((list) =>
                fetchObjects(list).then((nodes) =>
                  list.map((e, i) => [e[0], nodes[i]] as [string, PBNode]),
                ),
              ),
            ).then((array) => array.flat()),
          )

          // we map the object mappings to the nodes
          const retrievedNodes = objectMappings.map((e) => objectsByHash[e[0]])

          let newLinks: string[] = []
          for (const node of retrievedNodes) {
            const ipldMetadata = safeIPLDDecode(node)
            // if the node has no links or has data (is the same thing), we write into the stream
            if (ipldMetadata?.data) {
              controller.enqueue(ipldMetadata.data)
            } else {
              // if the node has links, we need to fetch them in the next iteration
              newLinks = newLinks.concat(
                node.Links.map((e) =>
                  getObjectMappingHash(cidToString(e.Hash)),
                ),
              )
            }
          }

          // we update the list of pending requests with the new links
          requestsPending = newLinks
        }
        controller.close()
      } catch (error) {
        logger.error(
          `Failed to fetch file as stream (cid=${cidToString(cidOfNode(node))}); error=${error}`,
        )
        controller.error(error)
      }
    },
  })
}

const getFileTraitsFromHead = (head: PBNode): Omit<FileResponse, 'data'> => {
  const nodeMetadata = safeIPLDDecode(head)
  if (!nodeMetadata) {
    throw new HttpError(400, 'Bad request: Not a valid auto-dag-data IPLD node')
  }
  if (nodeMetadata?.type !== MetadataType.File) {
    throw new HttpError(400, 'Bad request: Not a file')
  }
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

const fetchFile = async (cid: string): Promise<FileResponse> => {
  try {
    const [objectMapping] = await objectMappingIndexer.get_object_mappings({
      hashes: [getObjectMappingHash(cid)],
    })
    const head = await fetchObjects([objectMapping]).then((nodes) => nodes[0])
    logger.info(
      `Fetched hash=${objectMapping[0]} pieceIndex=${objectMapping[1]} pieceOffset=${objectMapping[2]}`,
    )
    const nodeMetadata = safeIPLDDecode(head)

    if (!nodeMetadata) {
      throw new HttpError(
        400,
        'Bad request: Not a valid auto-dag-data IPLD node',
      )
    }
    if (nodeMetadata?.type !== MetadataType.File) {
      throw new HttpError(400, 'Bad request: Not a file')
    }

    return {
      data: Readable.fromWeb(fetchFileAsStream(head)),
      ...getFileTraitsFromHead(head),
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

  async function* dfs(node: PBNode): AsyncGenerator<Buffer> {
    if (node.Links.length > 0) {
      for (const link of node.Links) {
        const child = await getNodeFromCache(cidToString(link.Hash))
        if (!child)
          throw new Error(
            `Failed to migrate to file cache: Node not found in cache (cid=${cid})`,
          )
        for await (const chunk of dfs(child)) {
          yield chunk
        }
      }
    } else {
      const data = safeIPLDDecode(node)
      if (!data) {
        logger.error(`Failed to migrate to file cache (cid=${cid})`)
      }
      yield Buffer.from(data?.data ?? [])
    }
  }

  fileCache.set(cid, {
    data: Readable.from(dfs(node)),
    ...getFileTraitsFromHead(node),
  })
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

const getPartial = async (
  cid: string,
  chunk: number,
): Promise<Buffer | null> => {
  let index = 0
  async function dfs(
    cid: string,
    siblings: string[] = [],
  ): Promise<PBNode | undefined> {
    const node = await dsnFetcher.fetchNode(cid, siblings)
    if (index === chunk) {
      return node
    }
    index++
    for (const sibling of node.Links) {
      const result = await dfs(
        cidToString(sibling.Hash),
        node.Links.map((e) => cidToString(e.Hash)),
      )
      if (result) {
        return result
      }
    }
  }

  const node = await dfs(cid)

  // if the node is not found, the chunk is not present
  // and therefore the file has finished being downloaded
  if (!node) {
    onFileDownloaded(cid)
    return null
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
}
