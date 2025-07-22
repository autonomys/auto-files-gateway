import { getDatabase } from '../drivers/pg.js'

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
  const db = await getDatabase()
  await db.query(
    'INSERT INTO moderation.banned_files (cid) VALUES ($1) ON CONFLICT (cid) DO UPDATE SET updated_at = CURRENT_TIMESTAMP',
    [cid],
  )
}

/**
 * Get a banned file by CID
 * @param cid - The CID to look up
 * @returns Promise that resolves to the banned file or null if not found
 */
const getBannedFile = async (cid: string): Promise<BannedFile | null> => {
  const db = await getDatabase()
  const result = await db.query<BannedFile>(
    'SELECT * FROM moderation.banned_files WHERE cid = $1',
    [cid],
  )

  return result.rows[0] || null
}

/**
 * Remove a CID from the banned files list
 * @param cid - The CID to unban
 * @returns Promise that resolves to true if the CID was removed, false if it wasn't found
 */
const removeBannedFile = async (cid: string): Promise<boolean> => {
  const db = await getDatabase()
  const result = await db.query(
    'DELETE FROM moderation.banned_files WHERE cid = $1',
    [cid],
  )

  return (result.rowCount ?? 0) > 0
}

const getAllBannedFiles = async (
  page: number,
  limit: number,
): Promise<BannedFile[]> => {
  const db = await getDatabase()
  const result = await db.query<BannedFile>(
    'SELECT * FROM moderation.banned_files ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, (page - 1) * limit],
  )

  return result.rows
}
export const bannedFilesRepository = {
  addBannedFile,
  getBannedFile,
  removeBannedFile,
  getAllBannedFiles,
}

export type { BannedFile }
