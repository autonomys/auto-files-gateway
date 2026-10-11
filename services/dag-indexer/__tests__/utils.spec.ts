jest.mock('@autonomys/auto-dag-data', () => ({
  decodeNode: jest.fn(),
  IPLDNodeData: {
    decode: jest.fn(),
  },
}))

import {
  hexToUint8Array,
  getSortId,
  isValidHexString,
  isValidBuffer,
} from '../src/mappings/utils'

describe('dag-indexer mappings utils', () => {
  describe('hexToUint8Array', () => {
    it('throws error when hex string has odd length', () => {
      const hex = '123'
      expect(() => hexToUint8Array(hex)).toThrow('Hex string must have an even length')
    })

    it('converts even-length hex string to Uint8Array properly', () => {
      const hex = '01020304'
      const result = hexToUint8Array(hex)
      expect(result).toEqual(new Uint8Array([1, 2, 3, 4]))
    })

    it('returns empty Uint8Array for empty string', () => {
      expect(hexToUint8Array('')).toEqual(new Uint8Array([]))
    })
  })

  describe('getSortId', () => {
    it('formats block height with 20 padding zeros when indexInBlock is omitted', () => {
      const id = getSortId(123n)
      expect(id).toBe('00000000000000000123')
      expect(id.length).toBe(20)
    })

    it('formats string block height when indexInBlock is omitted', () => {
      const id = getSortId('456')
      expect(id).toBe('00000000000000000456')
      expect(id.length).toBe(20)
    })

    it('formats block height and indexInBlock with hyphen separator', () => {
      const id = getSortId(123n, 45n)
      expect(id).toBe('00000000000000000123-0000000045')
      expect(id.length).toBe(31)
    })

    it('formats string values for both block height and indexInBlock', () => {
      const id = getSortId('100', '2')
      expect(id).toBe('00000000000000000100-0000000002')
    })
  })

  describe('isValidHexString', () => {
    it('returns true for valid hex strings', () => {
      expect(isValidHexString('deadbeef')).toBe(true)
      expect(isValidHexString('1234ABCD')).toBe(true)
      expect(isValidHexString('0a1b2c')).toBe(true)
    })

    it('returns false for empty string', () => {
      expect(isValidHexString('')).toBe(false)
    })

    it('returns false for non-hex characters', () => {
      expect(isValidHexString('xyz')).toBe(false)
      expect(isValidHexString('0x1234')).toBe(false)
      expect(isValidHexString('dead beef')).toBe(false)
    })
  })

  describe('isValidBuffer', () => {
    it('returns true for non-empty Buffer', () => {
      expect(isValidBuffer(Buffer.from('hello'))).toBe(true)
      expect(isValidBuffer(Buffer.from([1]))).toBe(true)
    })

    it('returns false for empty Buffer', () => {
      expect(isValidBuffer(Buffer.from([]))).toBe(false)
    })

    it('returns falsy for null or undefined', () => {
      expect(isValidBuffer(null as unknown as Buffer)).toBeFalsy()
      expect(isValidBuffer(undefined as unknown as Buffer)).toBeFalsy()
    })
  })
})
