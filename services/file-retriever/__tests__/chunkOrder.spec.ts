import {
  blake3HashFromCid,
  cidToString,
  decodeIPLDNodeData,
  decodeNode,
  NODE_METADATA_SIZE,
  processFileToIPLDFormat,
  stringToCid,
} from '@autonomys/auto-dag-data'
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'
import { MemoryBlockstore } from 'blockstore-core'
import type pg from 'pg'
import type { dagIndexerRepository } from '../src/repositories/dag-indexer.js'

// Mirrors the table SubQuery generates from services/dag-indexer/schema.graphql.
const CREATE_NODES_TABLE = `
  CREATE SCHEMA "dag-indexer";
  CREATE TABLE "dag-indexer".nodes (
    id text PRIMARY KEY,
    cid text NOT NULL,
    type text,
    link_depth integer NOT NULL,
    name text,
    block_height numeric NOT NULL,
    block_hash text NOT NULL,
    extrinsic_id text NOT NULL,
    extrinsic_hash text NOT NULL,
    index_in_block integer NOT NULL,
    links jsonb NOT NULL,
    size numeric NOT NULL,
    blake3_hash text NOT NULL,
    timestamp timestamp with time zone NOT NULL,
    upload_options jsonb
  );
`

const CHUNK_SIZE = 8
// Small enough to keep the DAGs tiny, large enough that link positions reach
// two digits, where sorting the path as text would misorder them.
const MAX_LINK_PER_NODE = 10

const chunkContent = (id: number) => {
  const content = Buffer.alloc(CHUNK_SIZE)
  content.writeUInt32BE(id)
  return content
}

describe('getSortedChunksByCid', () => {
  let container: StartedPostgreSqlContainer
  let db: pg.Client
  let repository: typeof dagIndexerRepository

  beforeAll(async () => {
    // The version of the production RDS instance the gateway reads from
    container = await new PostgreSqlContainer('postgres:17.9').start()
    // config reads DATABASE_URL when it is first imported
    process.env.DATABASE_URL = container.getConnectionUri()
    const { getDatabase } = await import('../src/drivers/pg.js')
    ;({ dagIndexerRepository: repository } = await import(
      '../src/repositories/dag-indexer.js'
    ))
    db = await getDatabase()
    await db.query(CREATE_NODES_TABLE)
  }, 120_000)

  afterAll(async () => {
    await db?.end()
    await container?.stop()
  })

  const uploadFile = async (chunkIds: number[]) => {
    const blockstore = new MemoryBlockstore()
    const content = Buffer.concat(chunkIds.map(chunkContent))
    const headCid = await processFileToIPLDFormat(
      blockstore,
      [content],
      BigInt(content.length),
      'file.bin',
      {
        maxNodeSize: NODE_METADATA_SIZE + CHUNK_SIZE,
        maxLinkPerNode: MAX_LINK_PER_NODE,
      },
    )

    for await (const { cid, block } of blockstore.getAll()) {
      const data = decodeIPLDNodeData(block)
      const links = decodeNode(block).Links.map((link) =>
        cidToString(link.Hash),
      )
      await db.query(
        `INSERT INTO "dag-indexer".nodes
          (id, cid, type, link_depth, name, block_height, block_hash,
           extrinsic_id, extrinsic_hash, index_in_block, links, size,
           blake3_hash, timestamp)
        VALUES ($1, $1, $2, $3, $4, 1, '0x00', '1-0', '0x00', 0, $5, $6, $7, now())
        ON CONFLICT (id) DO NOTHING`,
        [
          cidToString(cid),
          data.type,
          data.linkDepth,
          data.name ?? null,
          JSON.stringify(links),
          (data.size ?? 0n).toString(),
          Buffer.from(blake3HashFromCid(cid)).toString('hex'),
        ],
      )
    }

    return {
      cid: cidToString(headCid),
      linkDepth: decodeIPLDNodeData(await blockstore.get(headCid)).linkDepth,
      readChunkIds: (chunks: { cid: string }[]) =>
        Promise.all(
          chunks.map(async ({ cid }) => {
            const { data } = decodeIPLDNodeData(
              await blockstore.get(stringToCid(cid)),
            )
            return Buffer.from(data!).readUInt32BE()
          }),
        ),
    }
  }

  it.each([
    ['a single node', 1, 0],
    ['one level of links', 10, 1],
    ['two levels of links', 25, 2],
    ['three levels of links', 250, 3],
  ])(
    'returns the chunks of a file with %s in byte order',
    async (_, chunkCount, linkDepth) => {
      const chunkIds = Array.from({ length: chunkCount }, (_, id) => id)
      const file = await uploadFile(chunkIds)
      expect(file.linkDepth).toBe(linkDepth)

      const chunks = await repository.getSortedChunksByCid(file.cid)

      expect(await file.readChunkIds(chunks)).toEqual(chunkIds)
    },
  )

  it('returns a repeated chunk at every position it occupies', async () => {
    // Each run fills one inlink node, so the root links the same inlink twice.
    const run = [0, 1, 0, 2, 0, 3, 4, 5, 6, 7]
    const chunkIds = [...run, ...run, 8, 9]
    const file = await uploadFile(chunkIds)

    const chunks = await repository.getSortedChunksByCid(file.cid)

    expect(await file.readChunkIds(chunks)).toEqual(chunkIds)
  })
})
