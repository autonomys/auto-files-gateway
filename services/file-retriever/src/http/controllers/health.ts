import express from 'express'
import {
  dagIndexerHealthStatusCode,
  getDagIndexerHealth,
} from '../../services/dagIndexerHealth.js'
import { asyncSafeHandler } from '../../utils/express.js'

export const healthController = express.Router()

/**
 * Liveness only. Deliberately does *not* consider DAG Indexer lag: this process
 * can serve cached files and reconstruct unindexed ones from the DSN, so a
 * lagging indexer is degradation, not death. Failing liveness on a dependency's
 * freshness would take the gateway out of service exactly when it is still the
 * only thing able to serve those files.
 */
healthController.get('/', (_, res) => {
  res.sendStatus(200)
})

/** DAG Indexer freshness, for alerting to scrape. */
healthController.get(
  '/dag-indexer',
  asyncSafeHandler(async (_, res) => {
    const health = await getDagIndexerHealth()
    res.status(dagIndexerHealthStatusCode(health)).json(health)
  }),
)
