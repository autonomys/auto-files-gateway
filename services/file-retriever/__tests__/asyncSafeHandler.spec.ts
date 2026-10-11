import { jest } from '@jest/globals'
import { Request, Response, NextFunction } from 'express'
import { asyncSafeHandler } from '../src/utils/express.js'

type MockResponse = {
  status: jest.Mock
  json: jest.Mock
  send: jest.Mock
}

describe('asyncSafeHandler', () => {
  let mockReq: Partial<Request>
  let mockRes: MockResponse
  let mockNext: jest.Mock

  beforeEach(() => {
    mockReq = {}
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    }
    mockNext = jest.fn()
  })

  it('should execute successfully when async handler resolves without error', async () => {
    const handler = async (req: Request, res: Response) => {
      res.status(200).json({ ok: true })
    }

    const wrapped = asyncSafeHandler(handler)
    await wrapped(mockReq as Request, mockRes as unknown as Response, mockNext as unknown as NextFunction)

    expect(mockRes.status).toHaveBeenCalledWith(200)
    expect(mockRes.json).toHaveBeenCalledWith({ ok: true })
    expect(mockNext).not.toHaveBeenCalled()
  })

  it('should catch thrown error in async handler and forward to next()', async () => {
    const testError = new Error('Async handler exploded')
    const handler = async () => {
      throw testError
    }

    const wrapped = asyncSafeHandler(handler)
    await wrapped(mockReq as Request, mockRes as unknown as Response, mockNext as unknown as NextFunction)

    expect(mockNext).toHaveBeenCalledWith(testError)
    expect(mockRes.status).not.toHaveBeenCalled()
  })

  it('should catch rejected promise in handler and forward to next()', async () => {
    const testError = new Error('Promise rejection')
    const handler = () => Promise.reject(testError)

    const wrapped = asyncSafeHandler(handler)
    await wrapped(mockReq as Request, mockRes as unknown as Response, mockNext as unknown as NextFunction)

    expect(mockNext).toHaveBeenCalledWith(testError)
  })

  it('should forward synchronous errors thrown in handler to next()', async () => {
    const testError = new Error('Synchronous throw')
    const handler = () => {
      throw testError
    }

    const wrapped = asyncSafeHandler(handler)
    await wrapped(mockReq as Request, mockRes as unknown as Response, mockNext as unknown as NextFunction)

    expect(mockNext).toHaveBeenCalledWith(testError)
  })

  it('should pass req, res, and next arguments correctly to inner handler', async () => {
    const innerFn = jest.fn().mockImplementation(async () => {})
    const wrapped = asyncSafeHandler(innerFn as unknown as (req: Request, res: Response, next: NextFunction) => Promise<void>)

    await wrapped(mockReq as Request, mockRes as unknown as Response, mockNext as unknown as NextFunction)

    expect(innerFn).toHaveBeenCalledWith(mockReq, mockRes, mockNext)
  })
})
