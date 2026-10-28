import { jest } from '@jest/globals'
import { NextFunction, Request, Response } from 'express'
import { errorMiddleware, HttpError } from '../src/http/middlewares/error.js'
import { logger } from '../src/drivers/logger.js'

type FakeResponse = {
  status: (code: number) => FakeResponse
  json: (payload: unknown) => FakeResponse
  send: (payload: unknown) => FakeResponse
}

const fakeRequest = (path: string, originalUrl: string) =>
  ({ method: 'GET', path, originalUrl }) as unknown as Request

const fakeResponse = () => {
  const recorded: { statusCode?: number; body?: unknown } = {}
  const response: FakeResponse = {
    status: (code) => {
      recorded.statusCode = code
      return response
    },
    json: (payload) => {
      recorded.body = payload
      return response
    },
    send: (payload) => {
      recorded.body = payload
      return response
    },
  }

  return { response: response as unknown as Response, recorded }
}

const noop = (() => {}) as NextFunction

describe('errorMiddleware', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('never writes the api_key query parameter to the logs', () => {
    const error = jest.spyOn(logger, 'error')
    const warn = jest.spyOn(logger, 'warn')
    const { response } = fakeResponse()

    errorMiddleware(
      new HttpError(504, 'Gateway timeout'),
      fakeRequest(
        '/files/QmTest1/partial',
        '/files/QmTest1/partial?chunk=0&api_key=super-secret',
      ),
      response,
      noop,
    )

    const logged = [...error.mock.calls, ...warn.mock.calls].flat().join('\n')

    expect(logged).toContain('/files/QmTest1/partial')
    expect(logged).not.toContain('super-secret')
    expect(logged).not.toContain('api_key')
  })

  it('logs a server error at error level and keeps the response shape', () => {
    const error = jest.spyOn(logger, 'error')
    const { response, recorded } = fakeResponse()

    errorMiddleware(
      new HttpError(502, 'Bad gateway: the object request failed'),
      fakeRequest('/files/QmTest1', '/files/QmTest1'),
      response,
      noop,
    )

    expect(error).toHaveBeenCalled()
    expect(recorded.statusCode).toBe(502)
    expect(recorded.body).toEqual({
      error: 'Bad gateway: the object request failed',
    })
  })

  it('logs a client error at warn level', () => {
    const error = jest.spyOn(logger, 'error')
    const warn = jest.spyOn(logger, 'warn')
    const { response, recorded } = fakeResponse()

    errorMiddleware(
      new HttpError(400, 'Invalid CID'),
      fakeRequest('/files/nope', '/files/nope'),
      response,
      noop,
    )

    expect(warn).toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(recorded.statusCode).toBe(400)
  })

  it('answers an unexpected error with the plain 500 body', () => {
    jest.spyOn(logger, 'error')
    const { response, recorded } = fakeResponse()

    errorMiddleware(
      new Error('kaboom'),
      fakeRequest('/files/QmTest1', '/files/QmTest1'),
      response,
      noop,
    )

    expect(recorded.statusCode).toBe(500)
    expect(recorded.body).toBe('Internal Server Error')
  })
})
