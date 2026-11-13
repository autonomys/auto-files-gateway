import { jest } from '@jest/globals'
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'
import pg from 'pg'
import type { objectMappingRepository } from '../src/repositories/objectMapping.js'

// The table the init migration creates, with the index on the dispatch cursor
const CREATE_SCHEMA = `
  CREATE TABLE object_mappings (
    hash TEXT NOT NULL PRIMARY KEY,
    "pieceIndex" INTEGER NOT NULL,
    "pieceOffset" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "insertedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX object_mappings_piece_index_offset_index
    ON object_mappings ("pieceIndex", "pieceOffset");
`

interface PlanNode {
  'Index Cond'?: string
  Plans?: PlanNode[]
}

const indexConditions = (node: PlanNode): string[] => [
  ...(node['Index Cond'] ? [node['Index Cond']] : []),
  ...(node.Plans ?? []).flatMap(indexConditions),
]

describe('getObjectsFromPieceIndexAndOffset', () => {
  let container: StartedPostgreSqlContainer
  let client: pg.Client
  let repository: typeof objectMappingRepository
  const queries: { text: string; values: unknown[] }[] = []

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.9').start()
    client = new pg.Client({ connectionString: container.getConnectionUri() })
    await client.connect()
    await client.query(CREATE_SCHEMA)

    // test-setup.ts replaces the driver with a stub for every test file
    jest.unstable_mockModule('../src/drivers/pg.ts', () => ({
      getDatabase: async () => ({
        query: (text: string, values?: unknown[]) => {
          queries.push({ text, values: values ?? [] })
          return client.query(text, values)
        },
      }),
    }))
    ;({ objectMappingRepository: repository } = await import(
      '../src/repositories/objectMapping.js'
    ))

    // pieces 0 to 99, with mappings at offsets 0, 100 and 200 in each
    await repository.saveObjectMappings(
      Array.from({ length: 300 }, (_, i) => ({
        hash: `hash-${i}`,
        pieceIndex: Math.floor(i / 3),
        pieceOffset: (i % 3) * 100,
        blockNumber: i,
      })),
    )
    await client.query('ANALYZE object_mappings')
  }, 120_000)

  afterAll(async () => {
    await client?.end()
    await container?.stop()
  })

  const positions = (rows: { pieceIndex: number; pieceOffset: number }[]) =>
    rows.map(({ pieceIndex, pieceOffset }) => [pieceIndex, pieceOffset])

  it('returns the mappings after the cursor, in order, up to the limit', async () => {
    const rows = await repository.getObjectsFromPieceIndexAndOffset(
      10,
      100,
      12,
      5,
    )

    expect(positions(rows)).toEqual([
      [10, 200],
      [11, 0],
      [11, 100],
      [11, 200],
      [12, 0],
    ])
  })

  it('includes offset 0 of the first piece for the starting cursor', async () => {
    const rows = await repository.getObjectsFromPieceIndexAndOffset(
      50,
      -1,
      50,
      10,
    )

    expect(positions(rows)).toEqual([
      [50, 0],
      [50, 100],
      [50, 200],
    ])
  })

  it('stops after the last piece', async () => {
    const rows = await repository.getObjectsFromPieceIndexAndOffset(
      98,
      200,
      99,
      10,
    )

    expect(positions(rows)).toEqual([
      [99, 0],
      [99, 100],
      [99, 200],
    ])
  })

  it('starts the index scan at the cursor rather than at the first piece', async () => {
    queries.length = 0
    await repository.getObjectsFromPieceIndexAndOffset(90, 0, 99, 5)
    const [{ text, values }] = queries

    await client.query('SET enable_seqscan = off')
    try {
      const { rows } = await client.query(`EXPLAIN (FORMAT JSON) ${text}`, values)
      const [{ Plan }] = rows[0]['QUERY PLAN'] as { Plan: PlanNode }[]

      expect(
        indexConditions(Plan).some((cond) => cond.includes('"pieceOffset"')),
      ).toBe(true)
    } finally {
      await client.query('RESET enable_seqscan')
    }
  })
})
