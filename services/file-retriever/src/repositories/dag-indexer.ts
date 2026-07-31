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
    size: BigInt(db.size),
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

export interface DagIndexerStatus {
  lastProcessedHeight: number | null
  targetHeight: number | null
  indexerHealthy: boolean | null
  /**
   * Chain timestamp of the frontier block — how stale the indexed *data* is.
   * SubQuery writes this per indexed block, alongside `lastProcessedHeight`.
   */
  lastProcessedBlockTimestamp: number | null
  /**
   * Wall-clock time the indexer last processed anything, which is a different
   * question: it separates "stopped" from "running but behind". A frozen frontier
   * with a moving `lastProcessedTimestamp` is an indexer working through a
   * backlog; frozen with a frozen timestamp is the wedge seen in production,
   * where the frontier sat on one block for the whole observation window.
   */
  lastProcessedTimestamp: number | null
  /** targetHeight - lastProcessedHeight, or null when either is unknown. */
  lagBlocks: number | null
}

// Both timestamps are real SubQuery metadata keys and mean different things —
// see `updateStoreMetadata` in @subql/node-core's base-block-dispatcher, which
// writes `lastProcessedTimestamp: Date.now()` on every batch and
// `lastProcessedBlockTimestamp: blockTimestamp` for each block that carries one.
const METADATA_KEYS = [
  'lastProcessedHeight',
  'targetHeight',
  'indexerHealthy',
  'lastProcessedBlockTimestamp',
  'lastProcessedTimestamp',
] as const

/**
 * Reads the SubQuery indexer's own progress markers.
 *
 * This is how far behind the chain the DAG Indexer is, which decides whether a
 * CID being absent means "does not exist" or merely "not indexed yet". Nothing
 * read the markers before, so an indexer sitting ~100k blocks behind chain head
 * looked identical to a healthy one from the outside.
 */
const getIndexerStatus = async (): Promise<DagIndexerStatus> => {
  const db = await getDatabase()
  const result = await db.query<{ key: string; value: unknown }>(
    'SELECT key, value FROM "dag-indexer"._metadata WHERE key = ANY($1)',
    [[...METADATA_KEYS]],
  )

  const byKey = new Map(result.rows.map((row) => [row.key, row.value]))
  const asNumber = (key: string) => {
    const value = byKey.get(key)
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null
    }

    // SubQuery's own `MetadataKeys` types `lastProcessedTimestamp` as a string
    // while the writer passes `Date.now()`, so the stored representation is not
    // something to rely on. Accept either rather than silently reporting null.
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : null
    }

    return null
  }

  const lastProcessedHeight = asNumber('lastProcessedHeight')
  const targetHeight = asNumber('targetHeight')
  const indexerHealthy = byKey.get('indexerHealthy')

  return {
    lastProcessedHeight,
    targetHeight,
    indexerHealthy:
      typeof indexerHealthy === 'boolean' ? indexerHealthy : null,
    lastProcessedBlockTimestamp: asNumber('lastProcessedBlockTimestamp'),
    lastProcessedTimestamp: asNumber('lastProcessedTimestamp'),
    lagBlocks:
      lastProcessedHeight !== null && targetHeight !== null
        ? Math.max(0, targetHeight - lastProcessedHeight)
        : null,
  }
}

export interface IndexedChunkList {
  /** The file's leaf chunks, in file order. */
  chunks: ExtendedIPLDMetadata[]
  /**
   * CIDs the DAG references that the indexer has no row for. Non-empty means
   * `chunks` is an incomplete view of the file, not the whole file.
   */
  unindexedLinks: string[]
}

const getSortedChunksByCid = async (
  cid: string,
): Promise<IndexedChunkList> => {
  logger.info(`Getting chunks by CID: ${cid}`)

  try {
    const db = await getDatabase()
    const result = await db.query<
      ExtendedIPLDMetadataDB & { missing: boolean; referenced_cid: string }
    >(
      `WITH RECURSIVE file_chunks AS (
        SELECT
          n.*,
          0 AS depth,
          ARRAY[n.cid] AS path,
          NULL::text AS parent,
          ARRAY[]::int[] AS link_path,
          false AS missing,
          n.cid AS referenced_cid
        FROM "dag-indexer".nodes n
        WHERE n.cid = $1

        UNION ALL

        -- LEFT JOIN, not JOIN: an inner join silently *drops* a link the indexer
        -- has no row for, so a partially indexed file returned a short chunk list
        -- that looked complete. Unresolved links come back as rows with
        -- missing = true so the caller can tell truncation from a whole file.
        SELECT
          n.*,
          fc.depth + 1,
          fc.path || n.cid,
          fc.cid AS parent,
          fc.link_path || link_with_idx.ordinality::int,
          n.cid IS NULL AS missing,
          link_with_idx.cid AS referenced_cid
        FROM file_chunks fc
        JOIN LATERAL (
          SELECT value::text AS cid, ordinality
          FROM jsonb_array_elements_text(fc.links) WITH ORDINALITY
        ) AS link_with_idx ON TRUE
        LEFT JOIN "dag-indexer".nodes n ON n.cid = link_with_idx.cid
        WHERE NOT fc.missing
      )

      -- Ordered by the *full* path of link positions, not the position within the
      -- immediate parent. Ordering by the latter interleaves leaves from
      -- different inlinks (they all restart at 1), which silently corrupts any
      -- file whose DAG is more than one level deep — i.e. over ~106 MB, where
      -- chunk count exceeds DEFAULT_MAX_LINK_PER_NODE. Postgres compares int[]
      -- element by element, which is exactly depth-first order.
      SELECT *
      FROM file_chunks
      WHERE missing OR links IS NULL OR jsonb_array_length(links) = 0
      ORDER BY link_path;
    `,
      [cid],
    )

    // Unresolved links carry NULLs in every node column, so they must not reach
    // `mapToDomain` (`BigInt(null)` throws).
    return {
      chunks: result.rows.filter((row) => !row.missing).map(mapToDomain),
      unindexedLinks: result.rows
        .filter((row) => row.missing)
        .map((row) => row.referenced_cid),
    }
  } catch (error) {
    logger.error(
      `Failed to get chunks by CID: ${cid} - ${error instanceof Error ? error.message : String(error)}`,
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
  getIndexerStatus,
  getSortedChunksByCid,
}
