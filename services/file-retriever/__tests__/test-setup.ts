import * as dotenv from 'dotenv'
import { jest } from '@jest/globals'

jest.mock('../src/drivers/pg.js', () => ({
  getDatabase: jest.fn(),
}))

jest.mock(
  '@vscode/sqlite3',
  () => ({
    Database: class {
      constructor(_db: string, cb?: (err: Error | null) => void) {
        if (cb) setImmediate(() => cb(null))
      }
      all(_sql: string, cb?: (err: Error | null, rows: unknown[]) => void) {
        if (cb) cb(null, [])
      }
      configure() {}
      close() {}
    },
  }),
  { virtual: true },
)

dotenv.config({ path: './.env.test' })
