import * as dotenv from 'dotenv'
import { jest } from '@jest/globals'

jest.mock('../src/drivers/pg.js', () => ({
  getDatabase: jest.fn(),
}))

dotenv.config({ path: './.env.test' })
