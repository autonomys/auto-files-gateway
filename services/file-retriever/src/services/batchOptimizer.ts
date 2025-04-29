import { config } from '../config.js'
import { ObjectMapping } from './objectMappingIndexer.js'

export const optimizeBatchFetch = (
  objects: ObjectMapping[],
): ObjectMapping[][] => {
  let currentBatch: ObjectMapping[] = []
  const PIECE_INDEX_KEY = 1
  let lastPieceIndex = null
  const sortedObjects = objects.sort(
    (a, b) => a[PIECE_INDEX_KEY] - b[PIECE_INDEX_KEY],
  )
  const optimizedObjects: ObjectMapping[][] = []

  for (const object of sortedObjects) {
    const pieceIndex = object[PIECE_INDEX_KEY]

    const safePieceIndex = pieceIndex ?? 0
    // if the piece index is the at the same piece or next one, pieces maybe reusable
    const isSameOrConsecutive =
      pieceIndex === safePieceIndex ||
      pieceIndex === safePieceIndex + 1 ||
      lastPieceIndex === null
    const isFull = currentBatch.length === config.maxObjectsPerFetch

    // if pieces are not consecutive, they're not sharing the same piece
    if (isSameOrConsecutive && !isFull) {
      currentBatch.push(object)
    } else {
      optimizedObjects.push(currentBatch)
      currentBatch = [object]
    }

    lastPieceIndex = pieceIndex
  }
  if (currentBatch.length > 0) {
    optimizedObjects.push(currentBatch)
    currentBatch = []
  }

  console.log('optimizedObjects', optimizedObjects)
  console.log('currentBatch', currentBatch)

  // Once we have optimized the list of objects we
  // merge the batches unless they exceed the max objects per fetch
  return optimizedObjects.reduce(
    (acc, curr) => {
      const lastBatch = acc[acc.length - 1]
      if (lastBatch.length + curr.length <= config.maxObjectsPerFetch) {
        acc[acc.length - 1] = lastBatch.concat(curr)
      } else {
        acc.push(curr)
      }
      return acc
    },
    [[]] as ObjectMapping[][],
  )
}
