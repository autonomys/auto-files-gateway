import { getDatabase } from '../drivers/pg.js'
import { logger } from '../drivers/logger.js'

interface BannedFile {
  cid: string
  created_at: Date
  updated_at: Date
}

/**
 * Add a CID to the banned files list
 * @param cid - The CID to ban
 * @returns Promise that resolves when the operation is complete
 */
const addBannedFile = async (cid: string): Promise<void> => {
  logger.info(`Adding CID to banned files list: ${cid}`)

  try {
    const db = await getDatabase()
    await db.query(
      'INSERT INTO moderation.banned_files (cid) VALUES ($1) ON CONFLICT (cid) DO UPDATE SET updated_at = CURRENT_TIMESTAMP',
      [cid],
    )
    logger.info(`Successfully added/updated CID in banned files list: ${cid}`)
  } catch (error) {
    logger.error(
      `Failed to add CID to banned files list: ${cid} - ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

/**
 * Get a banned file by CID
 * @param cid - The CID to look up
 * @returns Promise that resolves to the banned file or null if not found
 */
const getBannedFile = async (cid: string): Promise<BannedFile | null> => {
  logger.info(`Looking up banned file by CID: ${cid}`)

  try {
    const db = await getDatabase()
    const result = await db.query<BannedFile>(
      'SELECT * FROM moderation.banned_files WHERE cid = $1',
      [cid],
    )

    const found = result.rows[0] || null
    if (found) {
      logger.info(`Found banned file for CID: ${cid}`)
    } else {
      logger.info(`No banned file found for CID: ${cid}`)
    }

    return found
  } catch (error) {
    logger.error(
      `Failed to get banned file for CID: ${cid} - ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

/**
 * Remove a CID from the banned files list
 * @param cid - The CID to unban
 * @returns Promise that resolves to true if the CID was removed, false if it wasn't found
 */
const removeBannedFile = async (cid: string): Promise<boolean> => {
  logger.info(`Removing CID from banned files list: ${cid}`)

  try {
    const db = await getDatabase()
    const result = await db.query(
      'DELETE FROM moderation.banned_files WHERE cid = $1',
      [cid],
    )

    const removed = (result.rowCount ?? 0) > 0
    if (removed) {
      logger.info(`Successfully removed CID from banned files list: ${cid}`)
    } else {
      logger.info(`CID not found in banned files list for removal: ${cid}`)
    }

    return removed
  } catch (error) {
    logger.error(
      `Failed to remove CID from banned files list: ${cid} - ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

const getAllBannedFiles = async (
  page: number,
  limit: number,
): Promise<BannedFile[]> => {
  logger.info(`Getting all banned files - page: ${page}, limit: ${limit}`)

  try {
    const db = await getDatabase()
    const result = await db.query<BannedFile>(
      'SELECT * FROM moderation.banned_files ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, (page - 1) * limit],
    )

    logger.info(`Retrieved ${result.rows.length} banned files for page ${page}`)
    return result.rows
  } catch (error) {
    logger.error(
      `Failed to get all banned files - page: ${page}, limit: ${limit} - ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

export const bannedFilesRepository = {
  addBannedFile,
  getBannedFile,
  removeBannedFile,
  getAllBannedFiles,
}

export type { BannedFile }
