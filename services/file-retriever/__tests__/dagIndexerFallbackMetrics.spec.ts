import { jest } from '@jest/globals'
import { config } from '../src/config.js'
import { recordDagIndexerFallback } from '../src/services/dagIndexerFallbackMetrics.js'

/**
 * Stubs `fetch` rather than the metrics driver: ESM exports are read-only, so
 * they cannot be spied on. Going through the real driver also means these tests
 * assert the line-protocol payload Victoria actually receives.
 */
const stubFetch = (impl: () => Promise<unknown>) =>
  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(impl as unknown as typeof fetch)

const bodyOf = (spy: ReturnType<typeof stubFetch>, call = 0) =>
  String(spy.mock.calls[call][1]?.body)

describe('recordDagIndexerFallback', () => {
  const originalActive = config.monitoring.active

  afterEach(() => {
    config.monitoring.active = originalActive
    jest.restoreAllMocks()
  })

  const okResponse = () => Promise.resolve({ ok: true })

  it('tags the outcome so a rebuild can be told apart from a cache hit', () => {
    config.monitoring.active = true
    const fetchSpy = stubFetch(okResponse)

    recordDagIndexerFallback('chunk_list_rebuilt', {
      nodesWalked: 24,
      chunkCount: 20,
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = bodyOf(fetchSpy)
    expect(body).toContain('dag_indexer_fallback,')
    expect(body).toContain('outcome=chunk_list_rebuilt')
    expect(body).toContain('count=1')
    // Separate fields: a multi-level DAG walks inlinks as well as leaves, so the
    // cost of the rebuild and the size of its result are different numbers.
    expect(body).toContain('nodes_walked=24')
    expect(body).toContain('chunk_count=20')
  })

  it('distinguishes a cache hit, which costs no DSN traffic', () => {
    config.monitoring.active = true
    const fetchSpy = stubFetch(okResponse)

    recordDagIndexerFallback('chunk_list_cached', { chunkCount: 20 })

    const body = bodyOf(fetchSpy)
    expect(body).toContain('outcome=chunk_list_cached')
    // Reporting the chunk count as nodes *walked* made cache hits — one per chunk
    // request during a download — look like the most expensive thing the service
    // does, when they cost no DSN traffic at all.
    expect(body).toContain('nodes_walked=0')
    expect(body).toContain('chunk_count=20')
  })

  it('reports missing links under their own field, not as nodes walked', () => {
    config.monitoring.active = true
    const fetchSpy = stubFetch(okResponse)

    recordDagIndexerFallback('chunk_list_incomplete', {
      unindexedLinks: 3,
      chunkCount: 12,
    })

    const body = bodyOf(fetchSpy)
    expect(body).toContain('unindexed_links=3')
    expect(body).toContain('nodes_walked=0')
  })

  it('stays silent when monitoring is disabled', () => {
    config.monitoring.active = false
    const fetchSpy = stubFetch(okResponse)

    recordDagIndexerFallback('metadata_rebuilt')

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // A download must never fail because the metrics endpoint is unhappy.
  it('swallows a metrics transport failure', async () => {
    config.monitoring.active = true
    stubFetch(() => Promise.reject(new Error('victoria unreachable')))

    expect(() => recordDagIndexerFallback('failed')).not.toThrow()
    // Let the rejected promise settle so an unhandled rejection would surface.
    await new Promise((resolve) => setImmediate(resolve))
  })

  it('swallows a non-2xx metrics response', async () => {
    config.monitoring.active = true
    stubFetch(() => Promise.resolve({ ok: false, statusText: 'Bad Gateway' }))

    expect(() => recordDagIndexerFallback('failed')).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))
  })
})
