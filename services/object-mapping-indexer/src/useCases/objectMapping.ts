import {
  constructListFromObjectMapping,
  GlobalObjectMapping,
  ObjectMappingListEntry,
} from '../models/mapping.js'
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

const getObjectByBlock = async (
  blockNumber: number,
): Promise<GlobalObjectMapping> => {
  const objectMappings =
    await objectMappingRepository.getByBlockNumber(blockNumber)

  return constructListFromObjectMapping(
    objectMappings.map((e) => [e.hash, e.pieceIndex, e.pieceOffset]),
    blockNumber,
  )
}

export const objectMappingUseCase = {
  processObjectMapping,
  getObject,
  getObjectByBlock,
}
