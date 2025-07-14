import { segmentUseCase } from '../src/useCases/segment.js'

describe('Segment Use Cases', () => {
  it('should get the piece index range by segment', () => {
    expect(segmentUseCase.getPieceIndexRangeBySegment(0)).toEqual([0, 255])
    expect(segmentUseCase.getPieceIndexRangeBySegment(1)).toEqual([256, 511])
  })

  it('should get the segment by piece index', () => {
    expect(segmentUseCase.getSegmentByPieceIndex(0)).toEqual(0)
    expect(segmentUseCase.getSegmentByPieceIndex(1)).toEqual(0)
    expect(segmentUseCase.getSegmentByPieceIndex(255)).toEqual(0)
    expect(segmentUseCase.getSegmentByPieceIndex(256)).toEqual(1)
  })
})
