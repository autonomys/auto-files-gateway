import { FileResponse } from '@autonomys/file-caching'
import {
  blake3HashFromCid,
  stringToCid,
  decodeNode,
  MetadataType,
  cidToString,
  CompressionAlgorithm,
  cidOfNode,
  cidFromBlakeHash,
  decodeIPLDNodeData,
} from '@autonomys/auto-dag-data'
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
import { weightedRequestConcurrencyController } from '@autonomys/asynchronous'
import { optimizeBatchFetch } from './batchOptimizer.js'
import {
  ObjectMapping,
  AsyncDownloadTree,
  AsyncDownloadNode,
  getNodeByIndex,
  getLeftmostNode,
  getUnresolvedNodes,
  setChildrenToNode,
} from '@auto-files/models'
import { withRetries } from '../utils/retries.js'
import { Readable } from 'stream'
import { asyncDownloadTreeCache } from './asyncDownloadTreeCache.js'

const fetchNodesSchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: z.array(z.string()),
})

const gatewayUrls = config.subspaceGatewayUrls.split(',')
const concurrencyControllerByGateway = gatewayUrls.map(() =>
  weightedRequestConcurrencyController(config.maxSimultaneousFetches),
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
            timeout: 3600_000,
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
const fetchFileAsStream = (node: PBNode): Readable => {
  const metadata = safeIPLDDecode(node)

  // if a file is a single node (< 64KB) no additional fetching is needed
  if (node.Links.length === 0) {
    logger.debug(
      `File resolved to single node file: (cid=${cidToString(cidOfNode(node))}, size=${metadata?.size})`,
    )
    return new Readable({
      read: async function () {
        this.push(Buffer.from(metadata?.data ?? []))
        this.push(null)
      },
    })
  }

  logger.debug(
    `File resolved to multi-node file: (cid=${cidToString(cidOfNode(node))}, size=${metadata?.size})`,
  )
  // if a file is a multi-node file, we need to fetch the nodes in the correct order
  // bearing in mind there might be multiple levels of links, we need to fetch
  // all the links from the root node first and then continue with the next level
  
  return new Readable({
    read: async function () {
      try {
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
          const objectsByHash = fromEntries<string, PBNode>(
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
              this.push(ipldMetadata.data)
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
        this.push(null)
      } catch (error) {
        logger.error(
          `Failed to fetch file as stream (cid=${cidToString(cidOfNode(node))}); error=${error}`,
        )
        this.emit('error', error)
      }
    },
  })
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

    const isCompressedAndNotEncrypted =
      nodeMetadata.uploadOptions?.encryption === undefined &&
      nodeMetadata.uploadOptions?.compression?.algorithm ===
        CompressionAlgorithm.ZLIB

    const data = fetchFileAsStream(head)

    return {
      data,
      size: nodeMetadata.size,
      mimeType:
        isCompressedAndNotEncrypted && nodeMetadata.name
          ? mime.lookup(nodeMetadata.name) || undefined
          : undefined,
      filename: nodeMetadata.name,
      encoding: isCompressedAndNotEncrypted ? 'deflate' : undefined,
    }
  } catch (error) {
    logger.error(`Failed to fetch file (cid=${cid}); error=${error}`)
    throw new HttpError(500, 'Internal server error: Failed to fetch file')
  }
}

const fetchNode = async (cid: string) => {
  const [objectMapping] = await objectMappingIndexer.get_object_mappings({
    hashes: [getObjectMappingHash(cid)],
  })
  const head = await fetchObjects([objectMapping]).then((nodes) => nodes[0])
  return head
}

// Returns the max link depth for the current tree iteration
const getPartial = async (
  cid: string,
  index: number,
): Promise<Buffer | null> => {
  const asyncDownloadTree = asyncDownloadTreeCache.get(cid)

  // If the tree is not in the cache we fetch the node and create the tree
  if (!asyncDownloadTree) {
    const node = await fetchNode(cid)
    const ipldData = decodeIPLDNodeData(node.Data!)

    if (ipldData.linkDepth === 0) {
      return Buffer.from(node.Data!)
    }

    const tree: AsyncDownloadTree = {
      cid,
      linkDepth: ipldData.linkDepth,
      children: undefined,
    }
    asyncDownloadTreeCache.set(cid, tree)
    return null
  }

  const node = getNodeByIndex(asyncDownloadTree, index)
  // If the node is found we return it
  if (node) {
    const nodeData = await fetchNode(node.cid)
    if (!nodeData.Data) {
      throw new HttpError(
        500,
        `Internal server error: Fetching node (cid=${node.cid}) data failed due to missing data`,
      )
    }
    return Buffer.from(nodeData.Data)
  }

  // If the node is not found we need to fetch the node
  const leftmostNode = getLeftmostNode(asyncDownloadTree)
  const leftmostNodeObjectMappingHash = getObjectMappingHash(leftmostNode.cid)

  // We get the list of unresolved nodes
  const unresolvedNodes = getUnresolvedNodes(asyncDownloadTree)
  const unresolvedNodesByCid = fromEntries<string, AsyncDownloadNode>(
    unresolvedNodes.map((n) => [n.cid, n]),
  )

  // We get the object mappings for the unresolved nodes
  const objectMappings = await objectMappingIndexer.get_object_mappings({
    hashes: unresolvedNodes.map((n) => getObjectMappingHash(n.cid)),
  })

  // We optimize the batch fetch for the unresolved nodes
  const optimizedBatchWithLeftmostPendingNode = optimizeBatchFetch(
    objectMappings,
  ).find((batch) => {
    batch.some((om) => om[0] === leftmostNodeObjectMappingHash)
  })

  // If the optimized batch with the leftmost pending node is not found, we throw an error (this should never happen)
  if (!optimizedBatchWithLeftmostPendingNode) {
    throw new HttpError(
      500,
      `Internal server error: Failed to fetch node (cid=${leftmostNode.cid}) data due to missing object mapping`,
    )
  }

  // We fetch the nodes in the optimized batch
  const fetchedObjects = await fetchObjects(
    optimizedBatchWithLeftmostPendingNode,
  )

  // We update the tree with the new fetched nodes
  fetchedObjects.forEach((object, i) => {
    const cid = cidToString(
      cidFromBlakeHash(
        Buffer.from(optimizedBatchWithLeftmostPendingNode[i][0], 'hex'),
      ),
    )
    const node = unresolvedNodesByCid[cid]
    if (!node) {
      throw new HttpError(
        500,
        `Internal server error: Failed to fetch node (cid=${cid}) data due to missing node`,
      )
    }
    if (node) {
      setChildrenToNode(node, object)
    }
  })

  // We update the tree with the new nodes

  // // We set the nodes in the cache
  // // @ts-expect-error: cache is not defined
  // const flattenTree: AsyncDownloadTree = cache.set(cid, asyncDownloadTree)

  return null
}

export const dsnFetcher = {
  fetchFile,
  fetchNode,
  fetchObjects,
  getPartial,
}
