import { jest } from '@jest/globals'
import axios from 'axios'
import {
  blake3HashFromCid,
  cidOfNode,
  cidToString,
  createNode,
  encodeNode,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { ObjectMapping } from '@auto-files/models'
import { dsnFetcher } from '../src/services/dsnFetcher.js'
import { nodeCache } from '../src/services/cache.js'
import { objectMappingIndexer } from '../src/services/objectMappingIndexer.js'
import { config } from '../src/config.js'
import { logger } from '../src/drivers/logger.js'

const hexOf = (node: ReturnType<typeof createNode>) =>
  Buffer.from(encodeNode(node)).toString('hex')

const gatewayAnswers = (nodes: ReturnType<typeof createNode>[]) =>
  jest.spyOn(axios, 'post').mockResolvedValue({
    status: 200,
    data: { jsonrpc: '2.0', id: 1, result: nodes.map(hexOf) },
  })

const settle = () => new Promise((resolve) => setImmediate(resolve))

describe('fetchObjects', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('fetches a piece holding more of a file than the concurrency limit', async () => {
    // 64 KiB nodes in 1 MiB pieces put ~16 nodes of one file in a piece,
    // against a default MAX_SIMULTANEOUS_FETCHES of 10.
    const count = config.objectFetching.maxSimultaneousFetches + 6
    const nodes = Array.from({ length: count }, (_, i) =>
      createNode(Buffer.from(`node ${i}`), []),
    )
    const mappings: ObjectMapping[] = nodes.map((_, i) => [
      `hash${i}`,
      172442,
      i * 1000,
    ])
    gatewayAnswers(nodes)

    const fetched = await dsnFetcher.fetchObjects(mappings)

    expect(fetched).toHaveLength(count)
  })
})

describe('fetchObjects failure logging', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('names the gateway by host, never by its configured URL', async () => {
    jest
      .spyOn(axios, 'post')
      .mockRejectedValue(new axios.AxiosError('boom', 'ECONNREFUSED'))
    const error = jest.spyOn(logger, 'error')
    const warn = jest.spyOn(logger, 'warn')
    const mappings: ObjectMapping[] = [['hash0', 172442, 0]]

    await expect(dsnFetcher.fetchObjects(mappings)).rejects.toThrow()

    const logged = [...error.mock.calls, ...warn.mock.calls].flat().join('\n')
    expect(logged).toContain('gateway=localhost:9955 ')
    expect(logged).not.toContain(config.subspaceGatewayUrls)
  })
})

describe('fetchNode cache writes', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('survives a cache write failing, rather than leaving it unhandled', async () => {
    const node = createNode(Buffer.from('payload'), [])
    const cid = cidToString(cidOfNode(node))
    const hash = Buffer.from(blake3HashFromCid(stringToCid(cid))).toString(
      'hex',
    )
    jest.spyOn(nodeCache, 'has').mockResolvedValue(false)
    jest
      .spyOn(objectMappingIndexer, 'get_object_mappings')
      .mockResolvedValue([[hash, 1, 0]])
    gatewayAnswers([node])
    jest
      .spyOn(nodeCache, 'set')
      .mockRejectedValue(new Error('ENOSPC: no space left on device'))
    const warn = jest.spyOn(logger, 'warn')

    const fetched = await dsnFetcher.fetchNode(cid, [cid])
    await settle()

    expect(cidToString(cidOfNode(fetched))).toBe(cid)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to cache node'),
    )
  })
})
