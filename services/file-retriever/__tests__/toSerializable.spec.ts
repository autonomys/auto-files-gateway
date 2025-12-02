import { toSerializable } from '../src/utils/express.js'

describe('toSerializable', () => {
  describe('null and undefined handling', () => {
    it('should return null as-is', () => {
      expect(toSerializable(null)).toBeNull()
    })

    it('should return undefined as-is', () => {
      expect(toSerializable(undefined)).toBeUndefined()
    })
  })

  describe('primitive handling', () => {
    it('should return strings as-is', () => {
      expect(toSerializable('hello')).toBe('hello')
    })

    it('should return numbers as-is', () => {
      expect(toSerializable(42)).toBe(42)
    })

    it('should return booleans as-is', () => {
      expect(toSerializable(true)).toBe(true)
      expect(toSerializable(false)).toBe(false)
    })
  })

  describe('bigint handling', () => {
    it('should convert bigint to string', () => {
      expect(toSerializable(BigInt(123456789))).toBe('123456789')
    })

    it('should convert large bigint to string', () => {
      const largeBigInt = BigInt('9007199254740993')
      expect(toSerializable(largeBigInt)).toBe('9007199254740993')
    })
  })

  describe('Date handling', () => {
    it('should convert Date to ISO string', () => {
      const date = new Date('2025-12-02T10:30:00.000Z')
      expect(toSerializable(date)).toBe('2025-12-02T10:30:00.000Z')
    })

    it('should handle Date with different timezone', () => {
      const date = new Date(0) // Unix epoch
      expect(toSerializable(date)).toBe('1970-01-01T00:00:00.000Z')
    })
  })

  describe('array handling', () => {
    it('should process simple arrays', () => {
      expect(toSerializable([1, 2, 3])).toEqual([1, 2, 3])
    })

    it('should recursively process array elements', () => {
      const date = new Date('2025-12-02T10:30:00.000Z')
      const input = [BigInt(123), date, 'hello']
      expect(toSerializable(input)).toEqual([
        '123',
        '2025-12-02T10:30:00.000Z',
        'hello',
      ])
    })

    it('should handle nested arrays', () => {
      const input = [[BigInt(1)], [BigInt(2)]]
      expect(toSerializable(input)).toEqual([['1'], ['2']])
    })
  })

  describe('object handling', () => {
    it('should process simple objects', () => {
      expect(toSerializable({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    })

    it('should recursively process object values', () => {
      const date = new Date('2025-12-02T10:30:00.000Z')
      const input = {
        size: BigInt(1024),
        timestamp: date,
        name: 'test',
      }
      expect(toSerializable(input)).toEqual({
        size: '1024',
        timestamp: '2025-12-02T10:30:00.000Z',
        name: 'test',
      })
    })

    it('should handle nested objects', () => {
      const input = {
        outer: {
          inner: {
            value: BigInt(42),
          },
        },
      }
      expect(toSerializable(input)).toEqual({
        outer: {
          inner: {
            value: '42',
          },
        },
      })
    })
  })

  describe('complex nested structures', () => {
    it('should handle ExtendedIPLDMetadata-like structure', () => {
      const input = {
        cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        blockHeight: 12345,
        blockHash: '0xabc123',
        extrinsicId: 'ext-001',
        extrinsicHash: '0xdef456',
        indexInBlock: 0,
        links: ['link1', 'link2'],
        blake3Hash: 'hash123',
        timestamp: new Date('2025-12-02T10:30:00.000Z'),
        size: BigInt('1048576'),
        type: 'file',
      }

      const result = toSerializable(input)

      expect(result).toEqual({
        cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        blockHeight: 12345,
        blockHash: '0xabc123',
        extrinsicId: 'ext-001',
        extrinsicHash: '0xdef456',
        indexInBlock: 0,
        links: ['link1', 'link2'],
        blake3Hash: 'hash123',
        timestamp: '2025-12-02T10:30:00.000Z',
        size: '1048576',
        type: 'file',
      })
    })

    it('should handle array of objects with mixed types', () => {
      const input = [
        {
          id: 1,
          value: BigInt(100),
          created: new Date('2025-01-01T00:00:00Z'),
        },
        {
          id: 2,
          value: BigInt(200),
          created: new Date('2025-01-02T00:00:00Z'),
        },
      ]

      expect(toSerializable(input)).toEqual([
        { id: 1, value: '100', created: '2025-01-01T00:00:00.000Z' },
        { id: 2, value: '200', created: '2025-01-02T00:00:00.000Z' },
      ])
    })

    it('should handle objects with array properties containing special types', () => {
      const input = {
        timestamps: [
          new Date('2025-01-01T00:00:00Z'),
          new Date('2025-01-02T00:00:00Z'),
        ],
        sizes: [BigInt(100), BigInt(200)],
      }

      expect(toSerializable(input)).toEqual({
        timestamps: ['2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z'],
        sizes: ['100', '200'],
      })
    })
  })
})
