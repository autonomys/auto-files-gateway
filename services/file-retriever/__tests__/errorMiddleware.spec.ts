import { jest } from '@jest/globals'
import { Request, Response } from 'express'
import { errorMiddleware, HttpError } from '../src/http/middlewares/error.js'

describe('errorMiddleware', () => {
  let mockRequest: Partial<Request>
  let mockResponse: Partial<Response>
  let statusFn: any
  let jsonFn: any
  let consoleErrorSpy: any

  beforeEach(() => {
    mockRequest = {}
    jsonFn = jest.fn()
    statusFn = jest.fn().mockImplementation(() => ({ json: jsonFn }))
    mockResponse = {
      status: statusFn,
      json: jsonFn,
    }
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('should format HttpError with specified status code and name', () => {
    const error = new HttpError(404, 'Resource not found')
    const next = jest.fn()

    errorMiddleware(
      error,
      mockRequest as Request,
      mockResponse as Response,
      next,
    )

    expect(statusFn).toHaveBeenCalledWith(404)
    expect(jsonFn).toHaveBeenCalledWith({
      error: 'HttpError',
      message: 'Resource not found',
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('should format generic Error with 500 status code', () => {
    const error = new Error('Database connection failed')
    const next = jest.fn()

    errorMiddleware(
      error,
      mockRequest as Request,
      mockResponse as Response,
      next,
    )

    expect(statusFn).toHaveBeenCalledWith(500)
    expect(jsonFn).toHaveBeenCalledWith({
      error: 'Internal Server Error',
      message: 'Database connection failed',
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('should handle non-Error objects gracefully with 500 status', () => {
    const error = 'Something went wrong'
    const next = jest.fn()

    errorMiddleware(
      error,
      mockRequest as Request,
      mockResponse as Response,
      next,
    )

    expect(statusFn).toHaveBeenCalledWith(500)
    expect(jsonFn).toHaveBeenCalledWith({
      error: 'Internal Server Error',
      message: 'unknown error',
    })
  })
})
