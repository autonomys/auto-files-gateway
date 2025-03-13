import { FileResponse } from '../models/file.js'
import {
  blake3HashFromCid,
  stringToCid,
  decodeNode,
  MetadataType,
  cidToString,
  CompressionAlgorithm,
  cidOfNode,
} from '@autonomys/auto-dag-data'
import { z } from 'zod'
import { PBNode } from '@ipld/dag-pb'
import { HttpError } from '../http/middlewares/error.js'
import { safeIPLDDecode } from '../utils/dagData.js'
import mime from 'mime-types'
import { config } from '../config.js'
import { logger } from '../drivers/logger.js'
import axios from 'axios'
import {
  fetchObjectMapping,
  GlobalObjectMappingRequest,
  ObjectMapping,
} from './objectMappingIndexer.js'
import { fromEntries, groupBy, promiseAll, values } from '../utils/array.js'
import { multiRequestConcurrencyController } from '../utils/concurrency.js'

const fetchNodesSchema = z.object({
  jsonrpc: z.string(),
  id: z.number(),
  result: z.array(z.string()),
})

const gatewayUrls = config.subspaceGatewayUrls.split(',')
const concurrencyControllerByGateway = gatewayUrls.map(() =>
  multiRequestConcurrencyController(config.maxSimultaneousFetches),
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
const retrieveObjectMappings = async (objects: ObjectMapping[]) => {
  const mappings: GlobalObjectMappingRequest = {
    v0: {
      objects,
    },
  }

  const index = gatewayIndex++ % gatewayUrls.length
  const gatewayUrl = gatewayUrls[index]
  const concurrencyController = concurrencyControllerByGateway[index]

  return concurrencyController(async () => {
    const response = await axios.post(
      gatewayUrl,
      {
        jsonrpc: '2.0',
        method: 'subspace_fetchObject',
        params: { mappings },
      },
      {
        timeout: 3600_000,
        responseType: 'json',
      },
    )
    if (response.status !== 200) {
      console.error('Failed to fetch nodes', response.status, response.data)
      throw new HttpError(500, 'Internal server error: Failed to fetch nodes')
    }

    const data = fetchNodesSchema.safeParse(response.data)
    if (!data.success) {
      console.error('Failed to parse fetch nodes response', data.error)
      throw new HttpError(
        500,
        'Internal server error: Failed to parse fetch nodes response',
      )
    }

    return data.data.result.map((hex) => decodeNode(Buffer.from(hex, 'hex')))
  }, objects.length)
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
  if (metadata?.data) {
    logger.debug(
      `File resolved to single node file: (cid=${cidToString(cidOfNode(node))}, size=${metadata.size})`,
    )
    return new ReadableStream({
      start: async (controller) => {
        controller.enqueue(Buffer.from(metadata.data!))
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
      logger.debug('Starting to fetch file')
      // for the first iteration, we need to fetch all the links from the root node
      let requestsPending = node.Links.map(({ Hash }) =>
        getObjectMappingHash(cidToString(Hash)),
      )
      while (requestsPending.length > 0) {
        // for each iteration, we fetch the nodes in batches of MAX_SIMULTANEOUS_FETCHES
        const requestingNodes = requestsPending

        const start = performance.now()
        // we fetch the object mappings in parallel
        const objectMappings = await Promise.all(
          requestingNodes.map(async (hash) => await fetchObjectMapping(hash)),
        )

        // we group the object mapping by the piece index
        const PIECE_INDEX_KEY = 1
        const nodes = groupBy(objectMappings, PIECE_INDEX_KEY)

        // we fetch the nodes in parallel grouped by the piece index
        const objectsByHash = fromEntries(
          await promiseAll(
            values(nodes).map((list) =>
              retrieveObjectMappings(list).then((nodes) =>
                list.map((e, i) => [e[0], nodes[i]] as [string, PBNode]),
              ),
            ),
          ).then((array) => array.flat()),
        )

        // we map the object mappings to the nodes
        const retrievedNodes = objectMappings.map((e) => objectsByHash[e[0]])

        const end = performance.now()
        logger.debug(
          `Fetching ${requestingNodes.length} nodes took ${end - start}ms`,
        )

        let newLinks: string[] = []
        for (const node of retrievedNodes) {
          const ipldMetadata = safeIPLDDecode(node)
          // if the node has no links or has data (is the same thing), we write into the stream
          if (ipldMetadata?.data) {
            controller.enqueue(ipldMetadata.data)
          } else {
            // if the node has links, we need to fetch them in the next iteration
            newLinks = newLinks.concat(
              node.Links.map((e) => getObjectMappingHash(cidToString(e.Hash))),
            )
          }
        }

        // we update the list of pending requests with the new links
        requestsPending = newLinks
      }
      controller.close()
    },
  })
}

const fetchFile = async (cid: string): Promise<FileResponse> => {
  const objectMapping = await fetchObjectMapping(getObjectMappingHash(cid))
  const head = await retrieveObjectMappings([objectMapping]).then(
    (nodes) => nodes[0],
  )
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
}

export const dsnFetcher = {
  fetchFile,
  fetchNodes: retrieveObjectMappings,
}
