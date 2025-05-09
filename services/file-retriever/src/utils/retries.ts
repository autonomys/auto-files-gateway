type RetryOptions = {
  maxRetries?: number
  delay?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const withRetries = async <T>(
  fn: () => Promise<T>,
  { maxRetries = 5, delay = 1000 }: RetryOptions = {},
): Promise<T> => {
  let retries = 0
  let lastError: Error

  while (retries < maxRetries) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      retries++
      await sleep(delay)
    }
  }

  throw lastError!
}
