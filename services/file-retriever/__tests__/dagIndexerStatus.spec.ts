import { jest } from '@jest/globals'
import type { dagIndexerRepository as DagIndexerRepository } from '../src/repositories/dag-indexer.js'

const query = jest.fn()

jest.unstable_mockModule('../src/drivers/pg.js', () => ({
  getDatabase: async () => ({ query }),
}))

/**
 * Covers `getIndexerStatus`'s reading of SubQuery's `_metadata`. The health tests
 * stub this repository wholesale, so nothing asserted which keys it asks for —
 * and a wrong key name is invisible in production: the field is simply always
 * null, which reads as "the indexer never reported it" rather than as a bug.
 *
 * The key names are pinned deliberately. Both timestamps are written by
 * `updateStoreMetadata` in @subql/node-core's base-block-dispatcher:
 * `lastProcessedTimestamp: Date.now()` on every batch, and
 * `lastProcessedBlockTimestamp: blockTimestamp.getTime()` for each block that
 * carries a timestamp. They are different quantities, not alternative spellings.
 */
describe('getIndexerStatus', () => {
  let dagIndexerRepository: typeof DagIndexerRepository

  beforeAll(async () => {
    ;({ dagIndexerRepository } = await import(
      '../src/repositories/dag-indexer.js'
    ))
  })

  beforeEach(() => {
    query.mockReset()
  })

  const stubMetadata = (rows: { key: string; value: unknown }[]) =>
    query.mockResolvedValue({ rows } as never)

  it('asks for both timestamp keys SubQuery actually writes', async () => {
    stubMetadata([])

    await dagIndexerRepository.getIndexerStatus()

    const [, params] = query.mock.calls[0] as [string, [string[]]]
    expect(params[0]).toContain('lastProcessedHeight')
    expect(params[0]).toContain('targetHeight')
    expect(params[0]).toContain('indexerHealthy')
    expect(params[0]).toContain('lastProcessedBlockTimestamp')
    expect(params[0]).toContain('lastProcessedTimestamp')
  })

  it('reads the frontier, its block time, and the last-activity time', async () => {
    stubMetadata([
      { key: 'lastProcessedHeight', value: 8_898_000 },
      { key: 'targetHeight', value: 8_898_059 },
      { key: 'indexerHealthy', value: true },
      { key: 'lastProcessedBlockTimestamp', value: 1_753_000_000_000 },
      { key: 'lastProcessedTimestamp', value: 1_753_000_030_000 },
    ])

    const status = await dagIndexerRepository.getIndexerStatus()

    expect(status).toEqual({
      lastProcessedHeight: 8_898_000,
      targetHeight: 8_898_059,
      indexerHealthy: true,
      lastProcessedBlockTimestamp: 1_753_000_000_000,
      lastProcessedTimestamp: 1_753_000_030_000,
      lagBlocks: 59,
    })
  })

  // SubQuery's own `MetadataKeys` types `lastProcessedTimestamp` as a string
  // while the writer passes `Date.now()`, so the stored representation is not
  // something to depend on.
  it('accepts a timestamp stored as a string', async () => {
    stubMetadata([
      { key: 'lastProcessedTimestamp', value: '1753000030000' },
      { key: 'lastProcessedBlockTimestamp', value: 1_753_000_000_000 },
    ])

    const status = await dagIndexerRepository.getIndexerStatus()

    expect(status.lastProcessedTimestamp).toBe(1_753_000_030_000)
  })

  it('reports a missing or unusable marker as null rather than NaN', async () => {
    stubMetadata([
      { key: 'lastProcessedHeight', value: 'not a number' },
      { key: 'indexerHealthy', value: 'yes' },
    ])

    const status = await dagIndexerRepository.getIndexerStatus()

    expect(status.lastProcessedHeight).toBeNull()
    expect(status.targetHeight).toBeNull()
    // Only a real boolean counts: a truthy string must not read as healthy.
    expect(status.indexerHealthy).toBeNull()
    expect(status.lastProcessedTimestamp).toBeNull()
    expect(status.lagBlocks).toBeNull()
  })

  it('never reports a negative lag when the frontier is ahead of the target', async () => {
    stubMetadata([
      { key: 'lastProcessedHeight', value: 8_898_100 },
      { key: 'targetHeight', value: 8_898_059 },
    ])

    const status = await dagIndexerRepository.getIndexerStatus()

    expect(status.lagBlocks).toBe(0)
  })
})
