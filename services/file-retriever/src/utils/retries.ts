type RetryOptions = {
  maxRetries?: number
  delay?: number
  /**
   * Called with the error from a failed attempt; return `false` to give up
   * immediately instead of waiting and trying again.
   *
   * This is how a caller with a wall-clock budget stops retrying once that
   * budget is spent. Attempts that cannot possibly finish in time do not make
   * the call more likely to succeed — they only push the failure further past
   * the deadline the caller promised.
   */
  shouldRetry?: (error: unknown) => boolean
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const withRetries = async <T>(
  fn: () => Promise<T>,
  { maxRetries = 5, delay = 1000, shouldRetry }: RetryOptions = {},
): Promise<T> => {
  let attempts = 0
  let lastError: unknown

  while (attempts < maxRetries) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      attempts++
      // No sleep after the final attempt: nothing follows it, so the delay only
      // postpones the failure the caller is already waiting on.
      if (attempts >= maxRetries || shouldRetry?.(error) === false) {
        break
      }
      await sleep(delay)
    }
  }

  throw lastError
}
