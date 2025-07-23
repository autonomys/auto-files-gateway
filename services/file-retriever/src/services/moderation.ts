import { bannedFilesRepository } from '../repositories/banned-files.js'
import { logger } from '../drivers/logger.js'
import { fileCache } from './cache.js'

/**
 * Moderation service for handling banned files
 */
export const moderationService = {
  /**
   * Ban a file by its CID
   * @param cid - The CID to ban
   * @returns Promise that resolves when the operation is complete
   */
  banFile: async (cid: string): Promise<void> => {
    try {
      await bannedFilesRepository.addBannedFile(cid)
      await fileCache.remove(cid)
      logger.info(`File banned successfully: ${cid}`)
    } catch (error) {
      logger.error(`Failed to ban file ${cid}: ${String(error)}`)
      throw error
    }
  },
  /**
   * Unban a file by its CID
   * @param cid - The CID to unban
   * @returns Promise that resolves to true if the file was unbanned, false if it wasn't found
   */
  unbanFile: async (cid: string): Promise<boolean> => {
    try {
      const wasRemoved = await bannedFilesRepository.removeBannedFile(cid)
      if (wasRemoved) {
        logger.info(`File unbanned successfully: ${cid}`)
      } else {
        logger.warn(`File was not found in banned list: ${cid}`)
      }
      return wasRemoved
    } catch (error) {
      logger.error(`Failed to unban file ${cid}: ${String(error)}`)
      throw error
    }
  },
  /**
   * Check if a file is banned
   * @param cid - The CID to check
   * @returns Promise that resolves to true if the file is banned, false otherwise
   */
  isFileBanned: async (cid: string): Promise<boolean> => {
    const bannedFile = await bannedFilesRepository.getBannedFile(cid)

    return bannedFile !== null
  },
  getAllBannedFiles: async (page: number, limit: number): Promise<string[]> => {
    return bannedFilesRepository
      .getAllBannedFiles(page, limit)
      .then((bannedFiles) => bannedFiles.map((bannedFile) => bannedFile.cid))
  },
}
