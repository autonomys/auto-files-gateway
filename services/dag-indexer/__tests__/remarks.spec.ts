import { Metadata, TypeRegistry } from '@polkadot/types'
import type { Call } from '@polkadot/types/interfaces'
import staticSubstrate from '@polkadot/types-support/metadata/static-substrate'
import {
  batchAll,
  encode,
  fileNode,
  remark,
  remarkWithEvent,
  transfer,
  utility,
} from './helpers'
import {
  CallLike,
  extractRemarks,
  MAX_UTILITY_NESTING,
} from '../src/mappings/remarks'

const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((s) => encode(fileNode(s)))

describe('extractRemarks', () => {
  it('returns the remark of a top-level system.remark', () => {
    expect(extractRemarks(remark(a))).toEqual([a])
  })

  it('returns the remark of a top-level system.remarkWithEvent', () => {
    expect(extractRemarks(remarkWithEvent(a))).toEqual([a])
  })

  it.each(['batchAll', 'batch', 'forceBatch'])(
    'returns the remarks of utility.%s in call order',
    (method) => {
      const call = utility(method, [remark(a), remarkWithEvent(b), remark(c)])
      expect(extractRemarks(call)).toEqual([a, b, c])
    },
  )

  it('ignores non-remark calls in a batch', () => {
    const call = batchAll([
      transfer(),
      remark(a),
      transfer(),
      { ...remark(b), method: 'setCode' },
      remark(c),
    ])
    expect(extractRemarks(call)).toEqual([a, c])
  })

  it('walks nested batches depth first', () => {
    const call = batchAll([
      remark(a),
      utility('batch', [remark(b), utility('forceBatch', [remark(c)])]),
      remark(d),
    ])
    expect(extractRemarks(call)).toEqual([a, b, c, d])
  })

  it.each([
    ['asDerivative', [0, remark(a)]],
    ['dispatchAs', [{ system: { signed: '5Grwva' } }, remark(a)]],
    ['dispatchAsFallible', [{ system: { signed: '5Grwva' } }, remark(a)]],
    ['withWeight', [remark(a), { refTime: 1, proofSize: 1 }]],
  ] as [string, unknown[]][])(
    'returns the remark wrapped in utility.%s',
    (method, args) => {
      expect(extractRemarks(utility(method, ...args))).toEqual([a])
    },
  )

  it('walks a batch inside a single-call wrapper', () => {
    const call = utility('asDerivative', 0, batchAll([remark(a), remark(b)]))
    expect(extractRemarks(call)).toEqual([a, b])
  })

  it('does not descend into utility.ifElse', () => {
    expect(extractRemarks(utility('ifElse', remark(a), remark(b)))).toEqual([])
    expect(
      extractRemarks(
        batchAll([remark(a), utility('ifElse', remark(b), remark(c))]),
      ),
    ).toEqual([a])
  })

  it('does not descend into other pallets', () => {
    const sudo = { section: 'sudo', method: 'sudo', args: [remark(a)] }
    const multisig = {
      section: 'multisig',
      method: 'asMultiThreshold1',
      args: [[], batchAll([remark(a)])],
    }
    expect(extractRemarks(sudo)).toEqual([])
    expect(extractRemarks(batchAll([sudo, multisig, remark(b)]))).toEqual([b])
  })

  it('returns nothing for a non-utility, non-remark top-level call', () => {
    expect(extractRemarks(transfer())).toEqual([])
    expect(extractRemarks({ ...remark(a), method: 'setCode' })).toEqual([])
  })

  describe('nesting limit', () => {
    const nest = (levels: number, inner: CallLike): CallLike => {
      let call = inner
      for (let i = 0; i < levels; i++) call = batchAll([call])
      return call
    }

    it('reads a remark under exactly the maximum number of utility calls', () => {
      expect(extractRemarks(nest(MAX_UTILITY_NESTING, remark(a)))).toEqual([a])
    })

    it('ignores remarks nested deeper than the limit, without throwing', () => {
      expect(extractRemarks(nest(MAX_UTILITY_NESTING + 1, remark(a)))).toEqual(
        [],
      )
      expect(extractRemarks(nest(5000, remark(a)))).toEqual([])
    })

    it('still reads shallower remarks next to a too-deep one', () => {
      const call = batchAll([
        remark(a),
        nest(MAX_UTILITY_NESTING, remark(b)),
        remark(c),
      ])
      expect(extractRemarks(call)).toEqual([a, c])
    })

    it('counts single-call wrappers as utility levels', () => {
      let call: CallLike = remark(a)
      for (let i = 0; i < MAX_UTILITY_NESTING + 1; i++) {
        call = utility('asDerivative', 0, call)
      }
      expect(extractRemarks(call)).toEqual([])
    })
  })

  it('tolerates malformed arguments', () => {
    expect(extractRemarks(utility('batchAll'))).toEqual([])
    expect(extractRemarks(utility('batchAll', 'not-calls'))).toEqual([])
    expect(extractRemarks(utility('batchAll', [null, 1, remark(a)]))).toEqual([
      a,
    ])
    expect(extractRemarks(utility('withWeight'))).toEqual([])
    expect(
      extractRemarks({ section: 'system', method: 'remark', args: [] }),
    ).toEqual([])
  })
})

// The same walker against real polkadot.js codecs (Substrate's reference
// metadata), to pin the method names, the argument positions and the byte
// reader to what the handler receives at runtime.
describe('extractRemarks with polkadot.js calls', () => {
  const registry = new TypeRegistry()
  registry.setMetadata(new Metadata(registry, staticSubstrate))

  const tx = (section: string, method: string, args: unknown[]): Call =>
    registry.findMetaCall(callIndex(section, method))(...args) as Call

  function callIndex(section: string, method: string): Uint8Array {
    const pallet = registry.metadata.pallets.find(
      (p) => p.name.toString().toLowerCase() === section,
    )
    if (!pallet) throw new Error(`no pallet ${section}`)
    const variants = registry.lookup.getSiType(pallet.calls.unwrap().type).def
      .asVariant.variants
    const variant = variants.find((v) => v.name.toString() === method)
    if (!variant) throw new Error(`no call ${section}.${method}`)
    return new Uint8Array([pallet.index.toNumber(), variant.index.toNumber()])
  }

  // polkadot.js reads a Uint8Array given to `Bytes` as length-prefixed, so
  // payloads go in as hex.
  const hex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString('hex')}`
  const sysRemark = (bytes: Uint8Array) => tx('system', 'remark', [hex(bytes)])
  const read = (call: Call) =>
    extractRemarks(call as unknown as CallLike).map((r) => Array.from(r))
  const expected = (...payloads: Uint8Array[]) =>
    payloads.map((p) => Array.from(p))

  it('reads a standalone remark exactly as the previous hex path did', () => {
    const call = sysRemark(a)
    expect(call.section).toBe('system')
    expect(call.method).toBe('remark')

    const viaPrimitive = (call.toPrimitive() as { args: { remark: string } })
      .args.remark
    const legacy = Buffer.from(viaPrimitive.slice(2), 'hex')

    expect(read(call)).toEqual([Array.from(legacy)])
    expect(read(call)).toEqual(expected(a))
  })

  it('reads remarkWithEvent', () => {
    expect(read(tx('system', 'remark_with_event', [hex(a)]))).toEqual(
      expected(a),
    )
  })

  it.each(['batch', 'batch_all', 'force_batch'])(
    'reads every remark of utility.%s, through re-encoding',
    (method) => {
      const built = tx('utility', method, [
        [sysRemark(a), sysRemark(b), tx('utility', 'batch', [[sysRemark(c)]])],
      ])
      // Decode from SCALE bytes, as the indexer receives calls from a block.
      const call = registry.createType('Call', built.toU8a()) as Call
      expect(call.section).toBe('utility')
      expect(read(call)).toEqual(expected(a, b, c))
    },
  )

  it('reads the call wrapped by asDerivative, dispatchAs and withWeight', () => {
    expect(read(tx('utility', 'as_derivative', [3, sysRemark(a)]))).toEqual(
      expected(a),
    )
    expect(
      read(
        tx('utility', 'dispatch_as', [
          { system: { Signed: new Uint8Array(32) } },
          sysRemark(b),
        ]),
      ),
    ).toEqual(expected(b))
    expect(
      read(
        tx('utility', 'with_weight', [
          sysRemark(c),
          { refTime: 1, proofSize: 1 },
        ]),
      ),
    ).toEqual(expected(c))
  })

  it('exposes the camelCase method names the walker matches on', () => {
    expect(tx('utility', 'batch_all', [[]]).method).toBe('batchAll')
    expect(tx('utility', 'force_batch', [[]]).method).toBe('forceBatch')
    expect(tx('system', 'remark_with_event', [hex(a)]).method).toBe(
      'remarkWithEvent',
    )
    expect(tx('utility', 'as_derivative', [0, sysRemark(a)]).method).toBe(
      'asDerivative',
    )
  })
})
