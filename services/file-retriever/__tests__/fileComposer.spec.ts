import { jest } from '@jest/globals'
import { moderationService } from '../src/services/moderation.js'
import { fileComposer } from '../src/services/fileComposer.js'
import { HttpError } from '../src/http/middlewares/error.js'

describe('File Composer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should compose a file from a list of chunks', async () => {
    const isFileBannedSpy = jest.spyOn(moderationService, 'isFileBanned')
    isFileBannedSpy.mockResolvedValue(true)

    await expect(fileComposer.get('QmTest1')).rejects.toEqual(
      new HttpError(451, 'Unavailable for legal reasons'),
    )
  })
})
