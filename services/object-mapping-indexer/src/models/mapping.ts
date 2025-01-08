import { z } from 'zod'

export type ObjectMapping = [
  hash: string,
  pieceIndex: number,
  pieceOffset: number,
]

export const ObjectMappingSchema = z.tuple([z.string(), z.number(), z.number()])

export const ObjectMappingListEntrySchema = z.object({
  blockNumber: z.number(),
  v0: z.object({
    objects: z.array(ObjectMappingSchema),
  }),
})

export type ObjectMappingListEntry = z.infer<
  typeof ObjectMappingListEntrySchema
>

export const constructListFromObjectMapping = (
  objects: ObjectMapping[],
  blockNumber: number,
): ObjectMappingListEntry => {
  return {
    blockNumber,
    v0: {
      objects,
    },
  }
}

export type GlobalObjectMapping = {
  blockNumber: number
  v0: {
    objects: ObjectMapping[]
  }
}
