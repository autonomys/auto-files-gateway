import { jest } from '@jest/globals'
import { Request, Response } from 'express'
import { HttpError, errorMiddleware } from '../src/http/middlewares/error.js'

describe('errorMiddleware', () => {
  it('should set headers and return reason when provided in HttpError', () => {
    const error = new HttpError(503, 'DAG node not indexed yet', {
      reason: 'not_indexed',
      headers: { 'Retry-After': '5' },
    })

    const req = {} as Request
    const setHeaderMock = jest.fn()
    const jsonMock = jest.fn()
    const statusMock = jest.fn().mockReturnValue({ json: jsonMock })
    const res = {
      setHeader: setHeaderMock,
      status: statusMock,
    } as unknown as Response
    const nextMock = jest.fn()

    errorMiddleware(error, req, res, nextMock)

    expect(setHeaderMock).toHaveBeenCalledWith('Retry-After', '5')
    expect(statusMock).toHaveBeenCalledWith(503)
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'HttpError',
      message: 'DAG node not indexed yet',
      reason: 'not_indexed',
    })
  })

  it('should handle standard HttpError without optional fields', () => {
    const error = new HttpError(404, 'Not found')

    const req = {} as Request
    const setHeaderMock = jest.fn()
    const jsonMock = jest.fn()
    const statusMock = jest.fn().mockReturnValue({ json: jsonMock })
    const res = {
      setHeader: setHeaderMock,
      status: statusMock,
    } as unknown as Response
    const nextMock = jest.fn()

    errorMiddleware(error, req, res, nextMock)

    expect(setHeaderMock).not.toHaveBeenCalled()
    expect(statusMock).toHaveBeenCalledWith(404)
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'HttpError',
      message: 'Not found',
    })
  })
})
