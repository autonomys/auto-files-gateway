import { config } from '../config'

export type ObjectMapping = [
  hash: string,
  pieceIndex: number,
  pieceOffset: number,
]

export type GlobalObjectMapping = {
  blockNumber: number
  v0: {
    objects: ObjectMapping[]
  }
}

export type GlobalObjectMappingRequest = Omit<
  GlobalObjectMapping,
  'blockNumber'
>

export const fetchObjectMapping = async (hash: string) => {
  const objectMapping = await fetch(
    `${config.objectMappingIndexerUrl}/objects/${hash}`,
  )
  if (!objectMapping.ok) {
    throw new Error('Failed to fetch object mapping')
  }

  const data: GlobalObjectMapping = await objectMapping.json()

  const object = data.v0.objects.find((object) => object[0] === hash)
  if (!object) {
    throw new Error('Object mapping not found')
  }

  return object
}
