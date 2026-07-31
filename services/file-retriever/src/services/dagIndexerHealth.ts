import { config } from '../config.js'
import { logger } from '../drivers/logger.js'
import { dagIndexerRepository } from '../repositories/dag-indexer.js'

export type DagIndexerHealthStatus = 'ok' | 'degraded' | 'unknown'

export interface DagIndexerHealth {
  status: DagIndexerHealthStatus
  detail?: string
  lagBlocks: number | null
  lagAlertThresholdBlocks: number
  lastProcessedHeight: number | null
  targetHeight: number | null
  indexerHealthy: boolean | null
  /** Chain timestamp of the frontier block: how stale the indexed data is. */
  lastProcessedBlockTimestamp: number | null
  /** When the indexer last did any work: separates "stopped" from "behind". */
  lastProcessedTimestamp: number | null
  fallbackEnabled: boolean
}

/**
 * Summarises how far the DAG Indexer trails the chain.
 *
 * A CID missing from the indexer is indistinguishable from a CID that does not
 * exist unless you know the indexer's frontier, and nothing exposed that before:
 * an indexer ~100k blocks (days) behind chain head looked identical to a healthy
 * one, which is how a multi-day gap ran unnoticed until users reported failed
 * downloads.
 */
export const getDagIndexerHealth = async (): Promise<DagIndexerHealth> => {
  const threshold = config.dagIndexerFallback.lagAlertBlocks
  const base = {
    lagAlertThresholdBlocks: threshold,
    fallbackEnabled: config.dagIndexerFallback.enabled,
  }

  const status = await dagIndexerRepository
    .getIndexerStatus()
    .catch((error: unknown) => {
      logger.error(`Failed to read DAG indexer status: ${error}`)
      return null
    })

  if (!status) {
    return {
      ...base,
      status: 'unknown',
      detail: 'Could not read the DAG indexer progress markers',
      lagBlocks: null,
      lastProcessedHeight: null,
      targetHeight: null,
      indexerHealthy: null,
      lastProcessedBlockTimestamp: null,
      lastProcessedTimestamp: null,
    }
  }

  // An unknown lag is not treated as lagging: absent markers mean we cannot
  // tell, and paging on "cannot tell" trains people to ignore the alert.
  const isLagging = status.lagBlocks !== null && status.lagBlocks > threshold
  const isDegraded = isLagging || status.indexerHealthy === false

  return {
    ...base,
    status: isDegraded ? 'degraded' : 'ok',
    lagBlocks: status.lagBlocks,
    lastProcessedHeight: status.lastProcessedHeight,
    targetHeight: status.targetHeight,
    indexerHealthy: status.indexerHealthy,
    lastProcessedBlockTimestamp: status.lastProcessedBlockTimestamp,
    lastProcessedTimestamp: status.lastProcessedTimestamp,
  }
}

/** 503 for anything a monitor should act on, so it can key on the code alone. */
export const dagIndexerHealthStatusCode = (health: DagIndexerHealth): number =>
  health.status === 'ok' ? 200 : 503
