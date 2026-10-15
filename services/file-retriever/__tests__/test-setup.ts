import * as dotenv from 'dotenv'
import { jest } from '@jest/globals'

jest.mock('../src/drivers/pg.js', () => ({
  getDatabase: jest.fn(),
}))

jest.mock(
  '@vscode/sqlite3',
  () => ({
    Database: class {
      constructor(_db: any, cb: (err: any) => void) {
        if (cb) setImmediate(cb)
      }
      all(_sql: any, cb: (err: any, rows: any[]) => void) {
        if (cb) cb(null, [])
      }
      configure() {}
      close() {}
    },
  }),
  { virtual: true },
)

dotenv.config({ path: './.env.test' })
