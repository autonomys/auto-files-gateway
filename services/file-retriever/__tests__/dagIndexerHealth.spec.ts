import { jest } from '@jest/globals'
import { config } from '../src/config.js'
import {
  dagIndexerHealthStatusCode,
  getDagIndexerHealth,
} from '../src/services/dagIndexerHealth.js'
import {
  dagIndexerRepository,
  DagIndexerStatus,
} from '../src/repositories/dag-indexer.js'

const indexerStatus = (
  overrides: Partial<DagIndexerStatus> = {},
): DagIndexerStatus => {
  const lastProcessedHeight = overrides.lastProcessedHeight ?? 8_898_000
  const targetHeight = overrides.targetHeight ?? 8_898_059

  return {
    lastProcessedHeight,
    targetHeight,
    indexerHealthy: true,
    lastProcessedBlockTimestamp: 1_753_000_000_000,
    lastProcessedTimestamp: 1_753_000_030_000,
    lagBlocks:
      overrides.lagBlocks ?? Math.max(0, targetHeight - lastProcessedHeight),
    ...overrides,
  }
}

const stubIndexerStatus = (status: DagIndexerStatus) =>
  jest.spyOn(dagIndexerRepository, 'getIndexerStatus').mockResolvedValue(status)

describe('getDagIndexerHealth', () => {
  const originalThreshold = config.dagIndexerFallback.lagAlertBlocks

  afterEach(() => {
    config.dagIndexerFallback.lagAlertBlocks = originalThreshold
    jest.restoreAllMocks()
  })

  it('reports ok when the indexer is close to chain head', async () => {
    stubIndexerStatus(indexerStatus())

    const health = await getDagIndexerHealth()

    expect(health.status).toBe('ok')
    expect(health.lagBlocks).toBe(59)
    expect(dagIndexerHealthStatusCode(health)).toBe(200)
  })

  it('reports degraded once the lag crosses the threshold', async () => {
    config.dagIndexerFallback.lagAlertBlocks = 1_000
    // The frontier observed in production: ~100k blocks, days behind head.
    stubIndexerStatus(indexerStatus({ lastProcessedHeight: 8_798_059 }))

    const health = await getDagIndexerHealth()

    expect(health.status).toBe('degraded')
    expect(health.lagBlocks).toBe(100_000)
    expect(dagIndexerHealthStatusCode(health)).toBe(503)
  })

  it('stays ok while the lag is under the threshold', async () => {
    config.dagIndexerFallback.lagAlertBlocks = 1_000
    stubIndexerStatus(indexerStatus({ lastProcessedHeight: 8_897_059 }))

    const health = await getDagIndexerHealth()

    expect(health.lagBlocks).toBe(1_000)
    expect(health.status).toBe('ok')
  })

  // The indexer marks itself unhealthy independently of how far behind it is —
  // the May backup on the prod box had indexerHealthy = false.
  it('reports degraded when the indexer flags itself unhealthy', async () => {
    stubIndexerStatus(indexerStatus({ indexerHealthy: false }))

    const health = await getDagIndexerHealth()

    expect(health.status).toBe('degraded')
  })

  // "Cannot tell" must not read as "lagging": an alert that fires on unknown
  // state gets muted, and then it never fires on real state either.
  it('does not call an unknown lag degraded', async () => {
    stubIndexerStatus(
      indexerStatus({
        lastProcessedHeight: null,
        targetHeight: null,
        lagBlocks: null,
        indexerHealthy: null,
      }),
    )

    const health = await getDagIndexerHealth()

    expect(health.status).toBe('ok')
    expect(health.lagBlocks).toBeNull()
  })

  it('reports unknown rather than throwing when the markers cannot be read', async () => {
    jest
      .spyOn(dagIndexerRepository, 'getIndexerStatus')
      .mockRejectedValue(new Error('connection terminated unexpectedly'))

    const health = await getDagIndexerHealth()

    expect(health.status).toBe('unknown')
    expect(dagIndexerHealthStatusCode(health)).toBe(503)
  })

  /**
   * Both timestamps are surfaced because they answer different questions, and the
   * wedge seen in production is only visible in the difference between them: the
   * frontier sat on one block for the whole observation window, so a *stale*
   * `lastProcessedTimestamp` is what separates "stopped" from "working through a
   * backlog". Reporting only one of them makes those two look identical.
   */
  it('surfaces the frontier block time and the last-activity time separately', async () => {
    stubIndexerStatus(
      indexerStatus({
        lastProcessedBlockTimestamp: 1_752_600_000_000,
        lastProcessedTimestamp: 1_753_000_030_000,
      }),
    )

    const health = await getDagIndexerHealth()

    expect(health.lastProcessedBlockTimestamp).toBe(1_752_600_000_000)
    expect(health.lastProcessedTimestamp).toBe(1_753_000_030_000)
  })
})
