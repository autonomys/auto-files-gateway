import { getDatabase } from '../drivers/pg.js'
import { logger } from '../drivers/logger.js'
import { FileUploadOptions, MetadataType } from '@autonomys/auto-dag-data'
import { ExtendedIPLDMetadata } from '@auto-files/models'

export interface ExtendedIPLDMetadataDB {
  id: string
  cid: string
  type: string
  link_depth: number
  name: string
  block_height: number
  block_hash: string
  extrinsic_id: string
  extrinsic_hash: string
  index_in_block: number
  links: string[]
  size: number
  blake3_hash: string
  timestamp: Date
  upload_options: FileUploadOptions | null
}

const mapToDomain = (db: ExtendedIPLDMetadataDB): ExtendedIPLDMetadata => {
  return {
    cid: db.cid,
    type: db.type as MetadataType,
    linkDepth: db.link_depth,
    name: db.name,
    blockHeight: db.block_height,
    blockHash: db.block_hash,
    extrinsicId: db.extrinsic_id,
    extrinsicHash: db.extrinsic_hash,
    indexInBlock: db.index_in_block,
    links: db.links,
    blake3Hash: db.blake3_hash,
    timestamp: db.timestamp,
    uploadOptions: db.upload_options ?? undefined,
  }
}

/**
 * Get a DAG node by ID
 * @param id - The node ID to look up
 * @returns Promise that resolves to the DAG node or null if not found
 */
const getDagNode = async (id: string): Promise<ExtendedIPLDMetadata | null> => {
  logger.info(`Looking up DAG node by ID: ${id}`)

  try {
    const db = await getDatabase()
    const result = await db.query<ExtendedIPLDMetadataDB>(
      'SELECT * FROM "dag-indexer".nodes WHERE id = $1',
      [id],
    )

    const found = result.rows.map(mapToDomain)[0] || null
    if (found) {
      logger.info(`Found DAG node for ID: ${id}`)
    } else {
      logger.info(`No DAG node found for ID: ${id}`)
    }

    return found
  } catch (error) {
    logger.error(
      `Failed to get DAG node for ID: ${id} - ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

/**
 * Get DAG nodes by block hash
 * @param blockHash - The block hash to filter by
 * @returns Promise that resolves to an array of DAG nodes
 */
const getDagNodesByBlockHash = async (
  blockHash: string,
): Promise<ExtendedIPLDMetadata[]> => {
  logger.info(`Looking up DAG nodes by block hash: ${blockHash}`)

  try {
    const db = await getDatabase()
    const result = await db.query<ExtendedIPLDMetadataDB>(
      'SELECT * FROM "dag-indexer".nodes WHERE block_hash = $1 ORDER BY index_in_block ASC',
      [blockHash],
    )

    logger.info(
      `Found ${result.rows.length} DAG nodes for block hash: ${blockHash}`,
    )
    return result.rows.map(mapToDomain)
  } catch (error) {
    logger.error(
      `Failed to get DAG nodes for block hash: ${blockHash} - ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

/**
 * Get DAG nodes by extrinsic hash
 * @param extrinsicHash - The extrinsic hash to filter by
 * @returns Promise that resolves to an array of DAG nodes
 */
const getDagNodesByExtrinsicHash = async (
  extrinsicHash: string,
): Promise<ExtendedIPLDMetadata[]> => {
  logger.info(`Looking up DAG nodes by extrinsic hash: ${extrinsicHash}`)

  try {
    const db = await getDatabase()
    const result = await db.query<ExtendedIPLDMetadataDB>(
      'SELECT * FROM "dag-indexer".nodes WHERE extrinsic_hash = $1 ORDER BY index_in_block ASC',
      [extrinsicHash],
    )

    logger.info(
      `Found ${result.rows.length} DAG nodes for extrinsic hash: ${extrinsicHash}`,
    )
    return result.rows.map(mapToDomain)
  } catch (error) {
    logger.error(
      `Failed to get DAG nodes for extrinsic hash: ${extrinsicHash} - ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

/**
 * Get DAG nodes by block height range
 * @param fromBlock - The starting block height (inclusive)
 * @param toBlock - The ending block height (inclusive)
 * @returns Promise that resolves to an array of DAG nodes
 */
const getDagNodesByBlockHeightRange = async (
  fromBlock: number,
  toBlock: number,
): Promise<ExtendedIPLDMetadata[]> => {
  logger.info(
    `Looking up DAG nodes by block height range: ${fromBlock} to ${toBlock}`,
  )

  try {
    const db = await getDatabase()
    const result = await db.query<ExtendedIPLDMetadataDB>(
      'SELECT * FROM "dag-indexer".nodes WHERE block_height >= $1 AND block_height <= $2 ORDER BY block_height ASC, index_in_block ASC',
      [fromBlock, toBlock],
    )

    logger.info(
      `Found ${result.rows.length} DAG nodes for block height range: ${fromBlock} to ${toBlock}`,
    )
    return result.rows.map(mapToDomain)
  } catch (error) {
    logger.error(
      `Failed to get DAG nodes for block height range: ${fromBlock} to ${toBlock} - ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

/**
 * Get DAG nodes by timestamp range
 * @param fromTimestamp - The starting timestamp (inclusive)
 * @param toTimestamp - The ending timestamp (inclusive)
 * @returns Promise that resolves to an array of DAG nodes
 */
const getDagNodesByTimestampRange = async (
  fromTimestamp: Date,
  toTimestamp: Date,
): Promise<ExtendedIPLDMetadata[]> => {
  logger.info(
    `Looking up DAG nodes by timestamp range: ${fromTimestamp.toISOString()} to ${toTimestamp.toISOString()}`,
  )

  try {
    const db = await getDatabase()
    const result = await db.query<ExtendedIPLDMetadataDB>(
      'SELECT * FROM "dag-indexer".nodes WHERE timestamp >= $1 AND timestamp <= $2 ORDER BY timestamp ASC, index_in_block ASC',
      [fromTimestamp, toTimestamp],
    )

    logger.info(
      `Found ${result.rows.length} DAG nodes for timestamp range: ${fromTimestamp.toISOString()} to ${toTimestamp.toISOString()}`,
    )
    return result.rows.map(mapToDomain)
  } catch (error) {
    logger.error(
      `Failed to get DAG nodes for timestamp range: ${fromTimestamp.toISOString()} to ${toTimestamp.toISOString()} - ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

/**
 * Get DAG nodes with pagination
 * @param page - The page number (1-based)
 * @param limit - The number of items per page
 * @returns Promise that resolves to an array of DAG nodes
 */
const getDagNodesPaginated = async (
  page: number,
  limit: number,
): Promise<ExtendedIPLDMetadata[]> => {
  logger.info(
    `Getting DAG nodes with pagination - page: ${page}, limit: ${limit}`,
  )

  try {
    const db = await getDatabase()
    const result = await db.query<ExtendedIPLDMetadataDB>(
      'SELECT * FROM "dag-indexer".nodes ORDER BY timestamp DESC, index_in_block ASC LIMIT $1 OFFSET $2',
      [limit, (page - 1) * limit],
    )

    logger.info(`Retrieved ${result.rows.length} DAG nodes for page ${page}`)
    return result.rows.map(mapToDomain)
  } catch (error) {
    logger.error(
      `Failed to get DAG nodes with pagination - page: ${page}, limit: ${limit} - ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

/**
 * Search DAG nodes by upload options (using GIN index)
 * @param uploadOptions - The upload options to search for
 * @returns Promise that resolves to an array of DAG nodes
 */
const searchDagNodesByUploadOptions = async (
  uploadOptions: Record<string, unknown>,
): Promise<ExtendedIPLDMetadata[]> => {
  logger.info(
    `Searching DAG nodes by upload options: ${JSON.stringify(uploadOptions)}`,
  )

  try {
    const db = await getDatabase()
    const result = await db.query<ExtendedIPLDMetadataDB>(
      'SELECT * FROM "dag-indexer".nodes WHERE upload_options @> $1 ORDER BY timestamp DESC',
      [JSON.stringify(uploadOptions)],
    )

    logger.info(`Found ${result.rows.length} DAG nodes matching upload options`)
    return result.rows.map(mapToDomain)
  } catch (error) {
    logger.error(
      `Failed to search DAG nodes by upload options: ${JSON.stringify(uploadOptions)} - ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

/**
 * Get the total count of DAG nodes
 * @returns Promise that resolves to the total count
 */
const getDagNodesCount = async (): Promise<number> => {
  logger.info('Getting total count of DAG nodes')

  try {
    const db = await getDatabase()
    const result = await db.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM "dag-indexer".nodes',
    )

    const count = parseInt(result.rows[0]?.count || '0', 10)
    logger.info(`Total DAG nodes count: ${count}`)
    return count
  } catch (error) {
    logger.error(
      `Failed to get DAG nodes count - ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

export const dagIndexerRepository = {
  getDagNode,
  getDagNodesByBlockHash,
  getDagNodesByExtrinsicHash,
  getDagNodesByBlockHeightRange,
  getDagNodesByTimestampRange,
  getDagNodesPaginated,
  searchDagNodesByUploadOptions,
  getDagNodesCount,
}
