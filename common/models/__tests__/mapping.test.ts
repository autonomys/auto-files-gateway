import {
  ObjectMappingSchema,
  ObjectMappingListEntrySchema,
  constructListFromObjectMapping,
} from '../src/mapping.js'

describe('ObjectMapping', () => {
  test('ObjectMappingSchema validates correct data', () => {
    const validMapping: [string, number, number] = ['abcdef', 1, 100]
    const result = ObjectMappingSchema.safeParse(validMapping)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(validMapping)
    }
  })

  test('ObjectMappingSchema rejects invalid data', () => {
    const invalidMapping = ['abcdef', 'not-a-number', 100]
    const result = ObjectMappingSchema.safeParse(invalidMapping)
    expect(result.success).toBe(false)
  })
})

describe('ObjectMappingListEntry', () => {
  test('ObjectMappingListEntrySchema validates correct data', () => {
    const validEntry = {
      blockNumber: 123,
      v0: {
        objects: [
          ['hash1', 1, 100],
          ['hash2', 2, 200],
        ],
      },
    }
    const result = ObjectMappingListEntrySchema.safeParse(validEntry)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(validEntry)
    }
  })

  test('constructListFromObjectMapping creates valid entry', () => {
    const objects: [string, number, number][] = [
      ['hash1', 1, 100],
      ['hash2', 2, 200],
    ]
    const blockNumber = 123

    const result = constructListFromObjectMapping(objects, blockNumber)

    expect(result).toEqual({
      blockNumber: 123,
      v0: {
        objects,
      },
    })

    const validation = ObjectMappingListEntrySchema.safeParse(result)
    expect(validation.success).toBe(true)
  })
})
