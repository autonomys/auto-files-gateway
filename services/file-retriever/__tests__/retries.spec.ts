import { withRetries } from '../src/utils/retries.js'

const failing = (error: unknown) => {
  let calls = 0
  return {
    calls: () => calls,
    fn: async () => {
      calls++
      throw error
    },
  }
}

describe('withRetries', () => {
  it('returns the first successful result without retrying', async () => {
    let calls = 0

    await expect(
      withRetries(
        async () => {
          calls++
          return 'ok'
        },
        { maxRetries: 3, delay: 1 },
      ),
    ).resolves.toBe('ok')
    expect(calls).toBe(1)
  })

  it('retries up to maxRetries and rethrows the last error', async () => {
    const error = new Error('always fails')
    const { fn, calls } = failing(error)

    await expect(withRetries(fn, { maxRetries: 3, delay: 1 })).rejects.toBe(
      error,
    )
    expect(calls()).toBe(3)
  })

  // The delay exists to space out *retries*. After the final attempt there is no
  // retry to space out, so waiting only postpones a failure the caller is already
  // blocked on — and when the caller has a wall-clock budget, past its deadline.
  it('does not wait after the final attempt', async () => {
    const delay = 200
    const { fn } = failing(new Error('always fails'))

    const startedAt = performance.now()
    await withRetries(fn, { maxRetries: 3, delay }).catch(() => undefined)
    const elapsed = performance.now() - startedAt

    // Two gaps between three attempts, not three: ~400ms rather than ~600ms.
    expect(elapsed).toBeLessThan(delay * 2.5)
  })

  /**
   * How a caller with a deadline stops retrying once its budget is spent. Without
   * it, a budgeted fetch keeps attempting (and sleeping between attempts) long
   * after the deadline it was clamped to has passed.
   */
  it('stops immediately when shouldRetry declines', async () => {
    const { fn, calls } = failing(new Error('budget spent'))
    let asked = 0

    await expect(
      withRetries(fn, {
        maxRetries: 5,
        delay: 1,
        shouldRetry: () => {
          asked++
          return false
        },
      }),
    ).rejects.toThrow('budget spent')
    expect(calls()).toBe(1)
    expect(asked).toBe(1)
  })

  it('passes the failure to shouldRetry so it can decide per error', async () => {
    const seen: unknown[] = []
    let calls = 0

    await expect(
      withRetries(
        async () => {
          calls++
          throw new Error(`attempt ${calls}`)
        },
        {
          maxRetries: 5,
          delay: 1,
          shouldRetry: (error) => {
            seen.push(error)
            return seen.length < 2
          },
        },
      ),
    ).rejects.toThrow('attempt 2')
    expect(calls).toBe(2)
    expect(seen.map((error) => (error as Error).message)).toEqual([
      'attempt 1',
      'attempt 2',
    ])
  })
})
