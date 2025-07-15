import { optimizeBatchFetch } from '../src/services/batchOptimizer.js'
import { ObjectMapping } from '@auto-files/models'

describe('Batch Optimizer', () => {
  it('should optimize the batch and merge the batches', () => {
    const maxObjectsPerFetch = 3
    const objects: ObjectMapping[] = [
      ['1', 1, 3],
      ['4', 2, 6],
      ['7', 4, 9],
    ]
    const optimized = optimizeBatchFetch(objects, maxObjectsPerFetch)
    expect(optimized).toEqual([
      [
        ['1', 1, 3],
        ['4', 2, 6],
        ['7', 4, 9],
      ],
    ])
  })

  it('should optimize the batch and merge the batches limiting the number of objects', () => {
    const maxObjectsPerFetch = 2
    const objects: ObjectMapping[] = [
      ['1', 1, 3],
      ['4', 2, 6],
      ['7', 4, 9],
    ]
    const optimized = optimizeBatchFetch(objects, maxObjectsPerFetch)
    expect(optimized).toEqual([
      [
        ['1', 1, 3],
        ['4', 2, 6],
      ],
      [['7', 4, 9]],
    ])
  })

  it('should optimize the batch and merge the batches limiting the number of objects (reverse order)', () => {
    const maxObjectsPerFetch = 2
    const objects: ObjectMapping[] = [
      ['7', 4, 9],
      ['4', 2, 6],
      ['1', 1, 3],
    ]
    const optimized = optimizeBatchFetch(objects, maxObjectsPerFetch)
    expect(optimized).toEqual([
      [
        ['1', 1, 3],
        ['4', 2, 6],
      ],
      [['7', 4, 9]],
    ])
  })
})
