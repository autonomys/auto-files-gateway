import {
  GlobalObjectMapping,
  ObjectMapping,
  ObjectMappingListEntry,
} from '@auto-files/models'
import { objectMappingRepository } from '../repositories/objectMapping.js'
import { objectMappingRouter } from '../services/objectMappingRouter/index.js'

const processObjectMapping = async (event: ObjectMappingListEntry) => {
  await Promise.all([
    objectMappingRepository.saveObjectMappings(
      event.v0.objects.map((e) => ({
        hash: e[0],
        pieceIndex: e[1],
        pieceOffset: e[2],
        blockNumber: event.blockNumber,
      })),
    ),
  ])

  objectMappingRouter.emitObjectMappings(event)
}

const getObject = async (hash: string): Promise<GlobalObjectMapping> => {
  const objectMapping = await objectMappingRepository.getByHash(hash)
  if (!objectMapping) {
    throw new Error('Object mapping not found')
  }

  return {
    blockNumber: objectMapping.blockNumber,
    v0: {
      objects: [
        [
          objectMapping.hash,
          objectMapping.pieceIndex,
          objectMapping.pieceOffset,
        ],
      ],
    },
  }
}

const getObjectByPieceIndex = async (
  pieceIndex: number,
): Promise<ObjectMapping[]> => {
  const objectMappings =
    await objectMappingRepository.getByPieceIndex(pieceIndex)

  return objectMappings.map((e) => [e.hash, e.pieceIndex, e.pieceOffset])
}

const getObjectByPieceIndexAndStep = async (
  pieceIndex: number,
  step: number,
): Promise<ObjectMapping[]> => {
  const objectMappings = await objectMappingRepository.getByPieceIndexRange(
    pieceIndex,
    pieceIndex + step,
  )

  return objectMappings.map((e) => [e.hash, e.pieceIndex, e.pieceOffset])
}

const getObjectByBlock = async (
  blockNumber: number,
): Promise<ObjectMapping[]> => {
  const objectMappings =
    await objectMappingRepository.getByBlockNumber(blockNumber)

  return objectMappings.map((e) => [e.hash, e.pieceIndex, e.pieceOffset])
}

const getObjectMappings = async (
  hashes: string[],
): Promise<ObjectMapping[]> => {
  const objectMappings = await objectMappingRepository.getByHashes(hashes)

  // Create a map of hash to object mapping for quick lookup
  const mappingsByHash = new Map<string, ObjectMapping>(
    objectMappings.map((e) => [e.hash, [e.hash, e.pieceIndex, e.pieceOffset]]),
  )

  // Return results in the same order as input hashes
  return hashes.map((hash) => {
    const mapping = mappingsByHash.get(hash)
    if (!mapping) {
      throw new Error('Object mapping not found')
    }

    return mapping
  })
}

export const objectMappingUseCase = {
  processObjectMapping,
  getObject,
  getObjectByPieceIndex,
  getObjectByBlock,
  getObjectByPieceIndexAndStep,
  getObjectMappings,
}
