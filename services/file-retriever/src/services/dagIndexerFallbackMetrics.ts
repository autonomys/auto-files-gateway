import { config } from '../config.js'
import { logger } from '../drivers/logger.js'
import { sendMetricToVictoria } from '../drivers/metrics.js'

/**
 * What triggered a reconstruction, so the metric can distinguish "the indexer is
 * behind" from "reconstruction is failing".
 */
export type DagIndexerFallbackOutcome =
  | 'metadata_rebuilt'
  | 'chunk_list_rebuilt'
  | 'chunk_list_cached'
  // The head was indexed but nodes below it were not, so the indexed chunk list
  // was a truncated view of the file. Counted separately because it means the
  // indexer is *dropping* nodes, not merely trailing the chain — the two call for
  // different responses.
  | 'chunk_list_incomplete'
  | 'failed'

/**
 * Counts DAG Indexer misses served (or not) from the DSN.
 *
 * Without this the fallback is invisible: it converts a loud outage into extra
 * latency, so the indexer can fall arbitrarily far behind while every dashboard
 * stays green. `/health/dag-indexer` answers "how far behind is the indexer";
 * this answers "how much traffic is that costing us", which is what says whether
 * the mitigation is holding.
 *
 * Fire-and-forget: a metrics failure must never break a download.
 */
/**
 * Quantities worth recording alongside an outcome. Each is a distinct thing, so
 * each gets its own field: a single `nodes_walked` carrying "leaves" for one
 * outcome, "missing links" for another and "chunks served from cache" for a third
 * cannot be summed or compared with anything, least of all with
 * `DAG_INDEXER_FALLBACK_MAX_NODES`.
 */
export interface DagIndexerFallbackCounts {
  /**
   * Nodes visited by the walk, head included — the cost of a rebuild, and the
   * quantity `DAG_INDEXER_FALLBACK_MAX_NODES` bounds, so the two are directly
   * comparable when tuning it. Includes nodes served from the node cache: the
   * limit counts those too. Zero for a cache hit, which walks nothing.
   */
  nodesWalked?: number
  /**
   * Leaf chunks in the resulting list — the size signal for the chunk-list cache
   * bounds, which are counted in chunks rather than nodes.
   */
  chunkCount?: number
  /** Links the DAG references that the indexer had no row for. */
  unindexedLinks?: number
}

export const recordDagIndexerFallback = (
  outcome: DagIndexerFallbackOutcome,
  { nodesWalked = 0, chunkCount = 0, unindexedLinks = 0 }: DagIndexerFallbackCounts = {},
) => {
  if (!config.monitoring.active) {
    return
  }

  sendMetricToVictoria({
    measurement: 'dag_indexer_fallback',
    tag: `${config.monitoring.metricEnvironmentTag},outcome=${outcome}`,
    fields: {
      count: 1,
      // Quoted: these are line-protocol field names, where snake_case is the
      // convention, not JS identifiers.
      'nodes_walked': nodesWalked,
      'chunk_count': chunkCount,
      'unindexed_links': unindexedLinks,
    },
  }).catch((error) => {
    logger.warn(`Failed to send DAG indexer fallback metric: ${error}`)
  })
}
