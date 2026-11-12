/**
 * Maximum number of nested `utility` calls to descend into. Mirrors
 * `MAX_CALL_RECURSION_DEPTH` in the runtime's object mapping
 * (autonomys/subspace, crates/subspace-runtime/src/object_mapping.rs), so the
 * indexer sees the same remarks the chain maps.
 */
export const MAX_UTILITY_NESTING = 10

/**
 * The part of a polkadot.js `Call` the walker needs. Kept structural so the
 * walker can be exercised with plain objects.
 */
export type CallLike = {
  section: string
  method: string
  args: ArrayLike<unknown>
}

const REMARK_METHODS = new Set(['remark', 'remarkWithEvent'])

/** `utility` methods whose first argument is a list of calls. */
const BATCH_METHODS = new Set(['batch', 'batchAll', 'forceBatch'])

/**
 * `utility` methods wrapping a single call, with the position of that call in
 * the arguments: `asDerivative(index, call)`, `dispatchAs(asOrigin, call)`,
 * `dispatchAsFallible(asOrigin, call)`, `withWeight(call, weight)`.
 *
 * `utility.ifElse` is deliberately absent: the runtime does not map remarks
 * inside it.
 */
const SINGLE_CALL_WRAPPERS = new Map([
  ['asDerivative', 1],
  ['dispatchAs', 1],
  ['dispatchAsFallible', 1],
  ['withWeight', 0],
])

const isCallLike = (value: unknown): value is CallLike => {
  if (typeof value !== 'object' || value === null) return false
  const call = value as Partial<CallLike>
  return (
    typeof call.section === 'string' &&
    typeof call.method === 'string' &&
    typeof call.args === 'object' &&
    call.args !== null
  )
}

/**
 * Reads the bytes of a remark argument: `toU8a(true)` on the polkadot.js
 * `Bytes` codec, which is the payload without its SCALE length prefix and
 * without going through a hex string.
 */
const remarkBytes = (arg: unknown): Uint8Array | null => {
  const codec = arg as { toU8a?: (isBare?: boolean) => Uint8Array } | null
  return typeof codec?.toU8a === 'function' ? codec.toU8a(true) : null
}

const collect = (
  call: unknown,
  utilityLevelsLeft: number,
  remarks: Uint8Array[],
): void => {
  if (!isCallLike(call)) return

  if (call.section === 'system') {
    if (!REMARK_METHODS.has(call.method)) return
    const bytes = remarkBytes(call.args[0])
    if (bytes) remarks.push(bytes)
    return
  }

  if (call.section !== 'utility' || utilityLevelsLeft === 0) return

  if (BATCH_METHODS.has(call.method)) {
    const calls = call.args[0]
    if (!Array.isArray(calls)) return
    for (const nested of calls) {
      collect(nested, utilityLevelsLeft - 1, remarks)
    }
    return
  }

  const callPosition = SINGLE_CALL_WRAPPERS.get(call.method)
  if (callPosition !== undefined) {
    collect(call.args[callPosition], utilityLevelsLeft - 1, remarks)
  }
}

/**
 * Returns the payload of every `system.remark` / `system.remarkWithEvent`
 * reachable from `call`: the call itself, or remarks nested in `utility`
 * batches and single-call wrappers, up to `MAX_UTILITY_NESTING` levels of
 * `utility` calls. Remarks are returned in call order, depth first.
 */
export const extractRemarks = (call: CallLike): Uint8Array[] => {
  const remarks: Uint8Array[] = []
  collect(call, MAX_UTILITY_NESTING, remarks)
  return remarks
}
