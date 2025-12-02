import { NextFunction, Request, Response } from 'express'

export const asyncSafeHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => unknown,
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res, next)
    } catch (err) {
      next(err)
    }
  }
}

export const toSerializable = <T>(obj: T): T => {
  if (obj === null || obj === undefined) {
    return obj
  }
  if (typeof obj === 'bigint') {
    return obj.toString() as unknown as T
  }
  if (Array.isArray(obj)) {
    return obj.map(toSerializable) as unknown as T
  }
  if (obj instanceof Date) {
    return obj.toISOString() as unknown as T
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = toSerializable(value)
    }
    return result as T
  }
  return obj
}
