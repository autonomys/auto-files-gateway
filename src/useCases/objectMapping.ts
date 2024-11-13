import { config } from '../config.js'
import { v4 } from 'uuid'
import { logger } from '../drivers/logger.js'
import {
  constructListFromObjectMapping,
  ObjectMappingListEntry,
} from '../models/mapping.js'
import { objectMappingRepository } from '../repositories/objectMapping.js'
import { blake3HashFromCid, stringToCid } from '@autonomys/auto-dag-data'
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

const startRecovery = async (
  id: string,
  initialBlockNumber: number,
  finalBlockNumber: number,
  messageSender: (message: string) => void,
) => {
  logger.info(
    `Starting recovery from block ${initialBlockNumber} to ${finalBlockNumber}.`,
  )
  let currentBlockNumber = initialBlockNumber
  while (currentBlockNumber <= finalBlockNumber) {
    const objectMappings =
      await objectMappingRepository.getByBlockNumber(currentBlockNumber)
    const event = constructListFromObjectMapping(
      objectMappings.map((e) => [e.hash, e.pieceIndex, e.pieceOffset]),
      currentBlockNumber,
    )
    messageSender(JSON.stringify({ subscriptionId: id, event }))
    logger.debug(`Sent event for block ${currentBlockNumber}.`)
    await new Promise((resolve) => setTimeout(resolve, config.recoveryInterval))
    currentBlockNumber++
  }
}

const recoverObjectMappings = async (
  subscriptionId: string,
  initialBlockNumber: number,
  messageSender: (message: string) => void,
) => {
  const latestBlockNumber = await objectMappingRepository.getLatestBlockNumber()

  startRecovery(
    subscriptionId,
    initialBlockNumber,
    latestBlockNumber.blockNumber,
    messageSender,
  )

  return subscriptionId
}

const getObject = async (cid: string) => {
  const hash = Buffer.from(blake3HashFromCid(stringToCid(cid))).toString('hex')
  const objectMapping = await objectMappingRepository.getByHash(hash)

  return objectMapping
}

const getObjectByBlock = async (blockNumber: number) => {
  return objectMappingRepository.getByBlockNumber(blockNumber)
}

export const objectMappingUseCase = {
  processObjectMapping,
  recoverObjectMappings,
  getObject,
  getObjectByBlock,
}
