import { isValidCID } from '../src/utils/dagData.js'

describe('isValidCID', () => {
  it('returns true for valid CIDs', () => {
    // Valid CIDv1 raw / dag-pb
    expect(
      isValidCID('bafkr6idz7htrqhks6xyntulrqfyevx3k5qrhptbmgoxlmbss65yi3u25ym'),
    ).toBe(true)
    expect(
      isValidCID('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'),
    ).toBe(true)
  })

  it('returns false for invalid strings and non-CIDs', () => {
    expect(isValidCID('')).toBe(false)
    expect(isValidCID('invalid-cid')).toBe(false)
    expect(isValidCID('12345')).toBe(false)
    expect(isValidCID('undefined')).toBe(false)
  })
})
