import { uniqueHeaderValue } from '../src/utils/http.js'

describe('uniqueHeaderValue', () => {
  it('should return null when header is undefined', () => {
    expect(uniqueHeaderValue(undefined)).toBeNull()
  })

  it('should return null when header is an empty string', () => {
    expect(uniqueHeaderValue('')).toBeNull()
  })

  it('should return the string value when header is a single string', () => {
    expect(uniqueHeaderValue('application/json')).toBe('application/json')
  })

  it('should return the first element when header is an array of strings', () => {
    expect(uniqueHeaderValue(['first-value', 'second-value'])).toBe('first-value')
  })

  it('should return the single element when header is a single-element array', () => {
    expect(uniqueHeaderValue(['only-value'])).toBe('only-value')
  })
})
