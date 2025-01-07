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
import { PBNode } from '@ipld/dag-pb'
import { HttpError } from '../http/middlewares/error.js'
import { safeIPLDDecode } from '../utils/dagData.js'
import mime from 'mime-types'
import { config } from '../config.js'
import { logger } from '../drivers/logger.js'
import axios from 'axios'
import pLimit from 'p-limit'

const concurrencyLimit = pLimit(config.maxSimultaneousFetches)

const fetchNode = async (
  cid: string,
  ignoreCidCheck = false,
): Promise<PBNode> => {
  try {
    const start = performance.now()
    const objectMappingHash = Buffer.from(
      blake3HashFromCid(stringToCid(cid)),
    ).toString('hex')

    const response = await concurrencyLimit(() =>
      axios.get(`${config.subspaceGatewayUrl}/data/${objectMappingHash}`, {
        timeout: 3600_000,
        responseType: 'arraybuffer',
      }),
    )
    if (response.status !== 200) {
      console.error('Failed to fetch node', response)
      throw new HttpError(500, 'Internal server error: Failed to fetch node')
    }

    const node = decodeNode(response.data)

    if (!ignoreCidCheck && cidToString(cidOfNode(node)) !== cid) {
      throw new Error(
        `Cid mismatch: ${cid} !== ${cidToString(cidOfNode(node))}`,
      )
    }

    const end = performance.now()
    logger.debug(`Fetching node ${cid} took ${end - start}ms`)
    return node
  } catch (error) {
    logger.error(`Error fetching node ${cid}: ${error}`)
    throw error
  }
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
      let requestsPending = node.Links.map(({ Hash }) => cidToString(Hash))
      while (requestsPending.length > 0) {
        // for each iteration, we fetch the nodes in batches of MAX_SIMULTANEOUS_FETCHES
        const requestingNodes = requestsPending.slice(
          0,
          config.maxSimultaneousFetches,
        )

        const start = performance.now()
        // we fetch the nodes in parallel
        const nodes = await Promise.all(
          requestingNodes.map(async (e) => await fetchNode(e)),
        )
        const end = performance.now()
        logger.debug(
          `Fetching ${requestingNodes.length} nodes took ${end - start}ms`,
        )

        let newLinks: string[] = []
        for (const node of nodes) {
          const ipldMetadata = safeIPLDDecode(node)
          // if the node has no links or has data (is the same thing), we write into the stream
          if (ipldMetadata?.data) {
            controller.enqueue(ipldMetadata.data)
          } else {
            // if the node has links, we need to fetch them in the next iteration
            newLinks = newLinks.concat(
              node.Links.map((e) => cidToString(e.Hash)),
            )
          }
        }

        // we update the list of pending requests with the new links
        requestsPending = [
          ...newLinks,
          ...requestsPending.slice(config.maxSimultaneousFetches),
        ]
      }
      controller.close()
    },
  })
}

const fetchFile = async (cid: string): Promise<FileResponse> => {
  const head = await fetchNode(cid)
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
  fetchNode,
}
