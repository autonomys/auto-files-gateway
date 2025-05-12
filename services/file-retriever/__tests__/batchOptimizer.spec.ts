import { config } from '../src/config.js'
import { optimizeBatchFetch } from '../src/services/batchOptimizer.js'
import { ObjectMapping } from '@auto-files/models'

describe('Batch Optimizer', () => {
  it('should optimize the batch and merge the batches', () => {
    config.maxObjectsPerFetch = 3
    const objects: ObjectMapping[] = [
      ['1', 1, 3],
      ['4', 2, 6],
      ['7', 4, 9],
    ]
    const optimized = optimizeBatchFetch(objects)
    expect(optimized).toEqual([
      [
        ['1', 1, 3],
        ['4', 2, 6],
        ['7', 4, 9],
      ],
    ])
  })

  it('should optimize the batch and merge the batches limiting the number of objects', () => {
    config.maxObjectsPerFetch = 2
    const objects: ObjectMapping[] = [
      ['1', 1, 3],
      ['4', 2, 6],
      ['7', 4, 9],
    ]
    const optimized = optimizeBatchFetch(objects)
    expect(optimized).toEqual([
      [
        ['1', 1, 3],
        ['4', 2, 6],
      ],
      [['7', 4, 9]],
    ])
  })

  it('should optimize the batch and merge the batches limiting the number of objects (reverse order)', () => {
    config.maxObjectsPerFetch = 2
    const objects: ObjectMapping[] = [
      ['7', 4, 9],
      ['4', 2, 6],
      ['1', 1, 3],
    ]
    const optimized = optimizeBatchFetch(objects)
    expect(optimized).toEqual([
      [
        ['1', 1, 3],
        ['4', 2, 6],
      ],
      [['7', 4, 9]],
    ])
  })
})
