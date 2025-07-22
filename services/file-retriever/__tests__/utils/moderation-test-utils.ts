import { BannedFile } from '../../src/repositories/banned-files.js'

/**
 * Creates a mock banned file for testing
 */
export const createMockBannedFile = (
  cid: string,
  overrides: Partial<BannedFile> = {},
): BannedFile => {
  const now = new Date()
  return {
    cid,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

/**
 * Creates multiple mock banned files for testing
 */
export const createMockBannedFiles = (
  count: number,
  baseCid = 'QmTest',
): BannedFile[] => {
  return Array.from({ length: count }, (_, i) =>
    createMockBannedFile(`${baseCid}${i}`),
  )
}

/**
 * Validates that a response contains the expected banned files
 */
export const expectBannedFilesResponse = (
  response: any,
  expectedCids: string[],
) => {
  expect(response.status).toBe(200)
  expect(response.body).toHaveProperty('bannedFiles')
  expect(response.body.bannedFiles).toEqual(expectedCids)
}

/**
 * Validates that a response indicates a successful ban operation
 */
export const expectBanSuccessResponse = (response: any, cid: string) => {
  expect(response.status).toBe(200)
  expect(response.body).toEqual({
    success: true,
    message: `File ${cid} has been banned successfully`,
  })
}

/**
 * Validates that a response indicates a successful unban operation
 */
export const expectUnbanSuccessResponse = (response: any, cid: string) => {
  expect(response.status).toBe(200)
  expect(response.body).toEqual({
    success: true,
    message: `File ${cid} has been unbanned successfully`,
  })
}

/**
 * Validates that a response indicates an unauthorized error
 */
export const expectUnauthorizedResponse = (response: any) => {
  expect(response.status).toBe(401)
  expect(response.body).toEqual({ error: 'Unauthorized' })
}

/**
 * Creates a mock database query result for banned files
 */
export const createMockDbResult = (rows: BannedFile[], rowCount?: number) => ({
  rows,
  rowCount: rowCount ?? rows.length,
})

/**
 * Validates CID format (basic validation)
 */
export const isValidCid = (cid: string): boolean => {
  // Basic CID validation - starts with Qm and has reasonable length
  return /^Qm[a-zA-Z0-9]{44}$/.test(cid)
}

/**
 * Generates a valid test CID
 */
export const generateTestCid = (): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const randomPart = Array.from(
    { length: 44 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join('')
  return `Qm${randomPart}`
}

/**
 * Waits for a specified number of milliseconds
 */
export const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Creates a mock Express request object for testing
 */
export const createMockRequest = (overrides: any = {}) => {
  return {
    params: {},
    query: {},
    headers: {},
    body: {},
    ip: '127.0.0.1',
    ...overrides,
  }
}

/**
 * Creates a mock Express response object for testing
 */
export const createMockResponse = () => {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  res.send = jest.fn().mockReturnValue(res)
  res.setHeader = jest.fn().mockReturnValue(res)
  res.set = jest.fn().mockReturnValue(res)
  res.headersSent = false
  return res
}
