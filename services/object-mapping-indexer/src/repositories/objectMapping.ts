import { getDatabase } from '../drivers/pg.js'
import pgFormat from 'pg-format'

interface DBObjectMapping {
  hash: string
  pieceIndex: number
  pieceOffset: number
  blockNumber: number
}

const saveObjectMappings = async (objectMappings: DBObjectMapping[]) => {
  const db = await getDatabase()
  await db.query(
    pgFormat(
      'INSERT INTO object_mappings (hash, "pieceIndex", "pieceOffset", "blockNumber") VALUES %L ON CONFLICT DO NOTHING',
      objectMappings.map(({ hash, pieceIndex, pieceOffset, blockNumber }) => [
        hash,
        pieceIndex,
        pieceOffset,
        blockNumber,
      ]),
    ),
  )
}

const getByBlockNumber = async (blockNumber: number) => {
  const db = await getDatabase()

  const result = await db.query<DBObjectMapping>(
    'SELECT * FROM object_mappings WHERE "blockNumber" = $1',
    [blockNumber],
  )

  return result.rows
}

const getByPieceIndex = async (pieceIndex: number) => {
  const db = await getDatabase()
  const result = await db.query<DBObjectMapping>(
    'SELECT * FROM object_mappings WHERE "pieceIndex" = $1',
    [pieceIndex],
  )

  return result.rows
}

const getLatestBlockNumber = async () => {
  const db = await getDatabase()
  const result = await db.query<DBObjectMapping>(
    'SELECT MAX("blockNumber") as "blockNumber" FROM object_mappings',
  )

  return result.rows[0]
}

const getByHash = async (hash: string) => {
  const db = await getDatabase()
  const result = await db.query<DBObjectMapping>(
    'SELECT * FROM object_mappings WHERE hash = $1',
    [hash],
  )

  return result.rows.at(0)
}

const getByPieceIndexRange = async (min: number, max: number) => {
  const db = await getDatabase()

  const result = await db.query<DBObjectMapping>(
    'SELECT * FROM object_mappings WHERE "pieceIndex" >= $1 AND "pieceIndex" <= $2',
    [min, max],
  )

  return result.rows
}

const getByHashes = async (hashes: string[]) => {
  const db = await getDatabase()
  const result = await db.query<DBObjectMapping>(
    'SELECT * FROM object_mappings WHERE hash = ANY($1)',
    [hashes],
  )

  return result.rows
}

export const objectMappingRepository = {
  saveObjectMappings,
  getByBlockNumber,
  getLatestBlockNumber,
  getByPieceIndex,
  getByHash,
  getByPieceIndexRange,
  getByHashes,
}
