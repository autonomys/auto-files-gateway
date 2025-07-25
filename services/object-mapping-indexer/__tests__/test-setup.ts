import * as dotenv from 'dotenv'
import { jest } from '@jest/globals'

dotenv.config({ path: './.env.test' })
jest.unstable_mockModule('../src/drivers/pg.ts', () => {
  return {
    getDatabase: () => {
      return {
        connect: jest.fn(),
        end: jest.fn(),
        query: jest.fn(),
      }
    },
  }
})
