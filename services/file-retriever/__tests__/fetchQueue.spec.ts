import { jest } from '@jest/globals'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import axios from 'axios'
import express from 'express'
import {
  blake3HashFromCid,
  cidOfNode,
  cidToString,
  createNode,
  encodeNode,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { ExtendedIPLDMetadata, ObjectMapping } from '@auto-files/models'
import { PBNode } from '@ipld/dag-pb'
import { config } from '../src/config.js'
import { fileRouter } from '../src/http/controllers/file.js'
import { nodeRouter } from '../src/http/controllers/node.js'
import { errorMiddleware, HttpError } from '../src/http/middlewares/error.js'
import { logger } from '../src/drivers/logger.js'
import { nodeCache } from '../src/services/cache.js'
import { dsnFetcher } from '../src/services/dsnFetcher.js'
import { moderationService } from '../src/services/moderation.js'
import { objectMappingIndexer } from '../src/services/objectMappingIndexer.js'

const nodesByHash = new Map<string, PBNode>()
const mappingsByHash = new Map<string, ObjectMapping>()

const hashOf = (cid: string) =>
  Buffer.from(blake3HashFromCid(stringToCid(cid))).toString('hex')

/** Nodes stored in one piece, as the object mapping indexer reports them. */
const piece = (pieceIndex: number, count: number) => {
  const nodes = Array.from({ length: count }, (_, i) =>
    createNode(Buffer.from(`piece ${pieceIndex} node ${i}`), []),
  )
  const cids = nodes.map((node) => cidToString(cidOfNode(node)))
  const mappings: ObjectMapping[] = cids.map((cid, i) => [
    hashOf(cid),
    pieceIndex,
    i * 1000,
  ])
  mappings.forEach((mapping, i) => {
    nodesByHash.set(mapping[0], nodes[i])
    mappingsByHash.set(mapping[0], mapping)
  })
  return { cids, mappings }
}

const knownMappings = (hashes: string[]) =>
  hashes
    .filter((hash) => mappingsByHash.has(hash))
    .map((hash) => mappingsByHash.get(hash)!)

type GatewayCall = {
  hashes: string[]
  signal?: AbortSignal
  answer: () => void
}

/**
 * A Subspace gateway that answers each call only when the test says so, and
 * drops a call whose signal aborts, as axios does.
 */
const gateway = ({ answerAtOnce = false } = {}) => {
  const calls: GatewayCall[] = []
  const post = (
    _url: string,
    body: { params: { mappings: { v0: { objects: ObjectMapping[] } } } },
    options?: { signal?: AbortSignal },
  ) =>
    new Promise((resolve, reject) => {
      const hashes = body.params.mappings.v0.objects.map(([hash]) => hash)
      const call = {
        hashes,
        signal: options?.signal,
        answer: () =>
          resolve({
            status: 200,
            data: {
              jsonrpc: '2.0',
              id: 1,
              result: hashes.map((hash) =>
                Buffer.from(encodeNode(nodesByHash.get(hash)!)).toString(
                  'hex',
                ),
              ),
            },
          }),
      }
      options?.signal?.addEventListener('abort', () =>
        reject(new axios.CanceledError()),
      )
      calls.push(call)
      if (answerAtOnce) {
        setImmediate(call.answer)
      }
    })
  jest
    .spyOn(axios, 'post')
    .mockImplementation(post as unknown as typeof axios.post)
  return calls
}

const settle = async (rounds = 5) => {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

const waitFor = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const clientGone = () => new HttpError(499, 'Client closed request')

const cidOf = (node: PBNode) => cidToString(cidOfNode(node))

describe('object fetch queue', () => {
  const max = config.objectFetching.maxSimultaneousFetches

  beforeEach(() => {
    jest.spyOn(nodeCache, 'get').mockResolvedValue(null)
    jest.spyOn(nodeCache, 'set').mockResolvedValue(undefined)
    jest
      .spyOn(objectMappingIndexer, 'get_object_mappings')
      .mockImplementation(async ({ hashes }) => knownMappings(hashes))
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('fetches different pieces at the same time', async () => {
    // A piece holds ~16 of a file's 64 KiB nodes.
    const first = piece(1, 16)
    const second = piece(2, 16)
    const calls = gateway()

    const fetches = [
      dsnFetcher.fetchObjects(first.mappings),
      dsnFetcher.fetchObjects(second.mappings),
    ]
    await waitFor(() => calls.length === 2)

    expect(calls).toHaveLength(2)
    calls.forEach((call) => call.answer())
    await Promise.all(fetches)
  })

  it('holds back pieces beyond MAX_SIMULTANEOUS_FETCHES', async () => {
    const pieces = Array.from({ length: max + 1 }, (_, i) => piece(100 + i, 1))
    const calls = gateway()

    const fetches = pieces.map(({ mappings }) =>
      dsnFetcher.fetchObjects(mappings),
    )
    await waitFor(() => calls.length === max)
    await settle()
    expect(calls).toHaveLength(max)

    calls[0].answer()
    await waitFor(() => calls.length === max + 1)
    expect(calls).toHaveLength(max + 1)

    calls.slice(1).forEach((call) => call.answer())
    await Promise.all(fetches)
  })

  it('makes one gateway call for concurrent requests for nodes of one piece', async () => {
    // Production on 2026-11-04 queued one 15-object set 36 times.
    const { cids } = piece(7, 15)
    const wanted = Array.from({ length: 36 }, (_, i) => (i * 7) % cids.length)
    gateway({ answerAtOnce: true })

    const nodes = await Promise.all(
      wanted.map((i) => dsnFetcher.fetchNode(cids[i], cids)),
    )

    expect(nodes.map(cidOf)).toEqual(wanted.map((i) => cids[i]))
    expect(axios.post).toHaveBeenCalledTimes(1)
  })

  it('joins later requests for a chunk to the fetch already running for it', async () => {
    // Each new download pass read the earlier chunks from the cache and then
    // asked for the same stalled chunk again.
    const { cids } = piece(10, 15)
    const calls = gateway()

    const first = dsnFetcher.fetchNode(cids[14], cids)
    await waitFor(() => calls.length === 1)
    const later = Array.from({ length: 35 }, () =>
      dsnFetcher.fetchNode(cids[14], cids),
    )
    await settle()
    expect(calls).toHaveLength(1)

    calls[0].answer()
    const nodes = await Promise.all([first, ...later])
    expect(new Set(nodes.map(cidOf))).toEqual(new Set([cids[14]]))
    expect(calls).toHaveLength(1)
  })

  it('shares a finished fetch until its nodes are in the cache', async () => {
    const { cids } = piece(8, 4)
    let cached = () => {}
    const cacheWritten = new Promise<void>((resolve) => {
      cached = resolve
    })
    jest
      .spyOn(nodeCache, 'set')
      .mockImplementation(() => cacheWritten.then(() => {}))
    gateway({ answerAtOnce: true })

    await dsnFetcher.fetchNode(cids[0], cids)
    const sibling = await dsnFetcher.fetchNode(cids[1], cids)
    expect(cidOf(sibling)).toBe(cids[1])
    expect(axios.post).toHaveBeenCalledTimes(1)

    cached()
    await settle()
    await dsnFetcher.fetchNode(cids[2], cids)
    expect(axios.post).toHaveBeenCalledTimes(2)
  })

  it('keeps fetching for the requests still waiting when one leaves', async () => {
    const { cids } = piece(9, 4)
    const calls = gateway()
    const leaving = new AbortController()

    const left = dsnFetcher.fetchNode(cids[0], cids, leaving.signal)
    const staying = dsnFetcher.fetchNode(cids[1], cids)
    await waitFor(() => calls.length === 1)
    leaving.abort(clientGone())

    await expect(left).rejects.toMatchObject({ statusCode: 499 })
    calls[0].answer()
    expect(cidOf(await staying)).toBe(cids[1])
  })

  it('lets a sent gateway call finish and cache its nodes after every request has left', async () => {
    const { cids } = piece(200, 2)
    const calls = gateway()
    const client = new AbortController()

    const request = dsnFetcher.fetchNode(cids[0], cids, client.signal)
    await waitFor(() => calls.length === 1)
    client.abort(clientGone())
    await expect(request).rejects.toMatchObject({ statusCode: 499 })

    const retry = dsnFetcher.fetchNode(cids[1], cids)
    await settle()
    expect(calls).toHaveLength(1)

    calls[0].answer()
    expect(cidOf(await retry)).toBe(cids[1])
    await settle()
    expect(nodeCache.set).toHaveBeenCalledWith(cids[0], expect.anything())
    expect(nodeCache.set).toHaveBeenCalledWith(cids[1], expect.anything())
  })

  it('never sends a queued fetch that no request is waiting for any more', async () => {
    const busy = Array.from({ length: max }, (_, i) => piece(300 + i, 1))
    const queued = piece(400, 1)
    const calls = gateway()
    const client = new AbortController()

    const running = busy.map(({ cids }) => dsnFetcher.fetchNode(cids[0], cids))
    await waitFor(() => calls.length === max)
    const request = dsnFetcher.fetchNode(
      queued.cids[0],
      queued.cids,
      client.signal,
    )
    await settle()
    client.abort(clientGone())
    await expect(request).rejects.toMatchObject({ statusCode: 499 })

    calls.forEach((call) => call.answer())
    await Promise.all(running)
    await settle()

    expect(calls.flatMap((call) => call.hashes)).not.toContain(
      queued.mappings[0][0],
    )
  })

  describe('with a short request timeout', () => {
    const requestTimeout = config.objectFetching.requestTimeout

    beforeEach(() => {
      config.objectFetching.requestTimeout = 50
    })

    afterEach(() => {
      config.objectFetching.requestTimeout = requestTimeout
    })

    it('answers 504 when the gateway is too slow', async () => {
      const { cids } = piece(500, 1)
      const calls = gateway()

      await expect(dsnFetcher.fetchNode(cids[0], cids)).rejects.toMatchObject(
        { statusCode: 504 },
      )
      expect(calls).toHaveLength(1)
      calls[0].answer()
      await settle()
    })

    it('lets a request retried after a timeout join the call still running', async () => {
      // A cold piece can take longer than any one request is allowed to wait.
      const { cids } = piece(510, 1)
      const calls = gateway()

      await expect(dsnFetcher.fetchNode(cids[0], cids)).rejects.toMatchObject(
        { statusCode: 504 },
      )
      const retry = dsnFetcher.fetchNode(cids[0], cids)
      await settle()
      calls[0].answer()

      expect(cidOf(await retry)).toBe(cids[0])
      expect(calls).toHaveLength(1)
    })

    it('counts the time spent queued', async () => {
      const busy = Array.from({ length: max }, (_, i) => piece(600 + i, 1))
      const queued = piece(700, 1)
      const calls = gateway()

      const running = busy.map(({ mappings }) =>
        dsnFetcher.fetchObjects(mappings),
      )
      await waitFor(() => calls.length === max)

      await expect(
        dsnFetcher.fetchNode(queued.cids[0], queued.cids),
      ).rejects.toMatchObject({ statusCode: 504 })
      calls.forEach((call) => call.answer())
      await Promise.all(running)
      await settle()
      expect(calls.flatMap((call) => call.hashes)).not.toContain(
        queued.mappings[0][0],
      )
    })

    it('counts an object mapping lookup that never answers', async () => {
      const { cids } = piece(800, 1)
      jest
        .spyOn(objectMappingIndexer, 'get_object_mappings')
        .mockReturnValue(new Promise(() => {}))
      const calls = gateway()

      await expect(dsnFetcher.fetchNode(cids[0], cids)).rejects.toMatchObject(
        { statusCode: 504 },
      )
      expect(calls).toHaveLength(0)
    })
  })
})

describe('routes that fetch nodes', () => {
  let server: http.Server
  let baseUrl: string

  beforeAll(async () => {
    const app = express()
    app.use('/files', fileRouter)
    app.use('/nodes', nodeRouter)
    app.use(errorMiddleware)
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  let lookups = 0

  beforeEach(() => {
    lookups = 0
    jest.spyOn(nodeCache, 'get').mockResolvedValue(null)
    jest.spyOn(nodeCache, 'set').mockResolvedValue(undefined)
    jest
      .spyOn(objectMappingIndexer, 'get_object_mappings')
      .mockImplementation(async ({ hashes }) => {
        lookups++
        return knownMappings(hashes)
      })
    jest.spyOn(moderationService, 'isFileBanned').mockResolvedValue(false)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each([
    ['/files/:cid/partial?chunk=0', 900],
    ['/nodes/:cid', 901],
    ['/nodes/:cid/ipld', 902],
  ])(
    '%s drops its queued fetch when the client disconnects',
    async (route, pieceIndex) => {
      const max = config.objectFetching.maxSimultaneousFetches
      const busy = Array.from({ length: max }, (_, i) =>
        piece(pieceIndex * 100 + i, 1),
      )
      const { cids } = piece(pieceIndex, 2)
      jest
        .spyOn(dsnFetcher, 'getFileChunks')
        .mockResolvedValue(
          cids.map((cid) => ({ cid }) as unknown as ExtendedIPLDMetadata),
        )
      const calls = gateway()
      const warn = jest.spyOn(logger, 'warn')

      const running = busy.map(({ mappings }) =>
        dsnFetcher.fetchObjects(mappings),
      )
      await waitFor(() => calls.length === max)
      const request = http.get(`${baseUrl}${route.replace(':cid', cids[0])}`, {
        headers: { authorization: `Bearer ${config.apiSecret}` },
      })
      request.on('error', () => {})
      await waitFor(() => lookups > 0)
      await settle()

      request.destroy()
      await waitFor(() =>
        warn.mock.calls.some(([message]) => String(message).includes('499')),
      )
      calls.forEach((call) => call.answer())
      await Promise.all(running)
      await settle()

      expect(calls.flatMap((call) => call.hashes)).not.toContain(
        hashOf(cids[0]),
      )
    },
  )
})
