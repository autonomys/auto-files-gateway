import { cidOfNode, createNode, encodeNode } from '@autonomys/auto-dag-data'
import { decodeNodesOrThrow } from '../src/utils/dagData.js'
import { HttpError } from '../src/http/middlewares/error.js'
import { classifyUpstreamError } from '../src/utils/upstreamErrors.js'

const encodedNode = Buffer.from(
  encodeNode(createNode(Buffer.from('hello world'), [])),
).toString('hex')

describe('decodeNodesOrThrow', () => {
  it('decodes a well formed response', () => {
    const nodes = decodeNodesOrThrow([encodedNode])

    expect(nodes).toHaveLength(1)
    expect(cidOfNode(nodes[0])).toBeDefined()
  })

  it('rejects a payload that satisfies the schema but is not dag-pb', () => {
    // The response schema only requires an array of strings, so a gateway can
    // answer 200 with junk and still get this far.
    expect(() => decodeNodesOrThrow(['ff'])).toThrow(HttpError)
  })

  it('blames the gateway rather than this service', () => {
    let thrown: unknown
    try {
      decodeNodesOrThrow([encodedNode, 'ff'])
    } catch (error) {
      thrown = error
    }

    expect((thrown as HttpError).statusCode).toBe(502)
    expect((thrown as HttpError).message).toContain('position 1')

    const failure = classifyUpstreamError(thrown)
    expect(failure.kind).toBe('invalid-response')
    expect(failure.statusCode).toBe(502)
  })
})
