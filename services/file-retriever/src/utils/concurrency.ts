import Queue from 'yocto-queue'

export type Job<T> = () => Promise<T>

type ConcurrencyController = <T>(job: Job<T>, concurrency: number) => Promise<T>

export const multiRequestConcurrencyController = (
  maxConcurrency: number,
): ConcurrencyController => {
  if (maxConcurrency <= 0) {
    throw new Error('Max concurrency must be greater than 0')
  }

  const queue = new Queue<() => Promise<unknown>>()
  let active = 0

  const enqueue = <T>(task: Job<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      queue.enqueue(() => task().then(resolve).catch(reject))
    })
  }

  const manageJobFinalization = async (concurrency: number) => {
    active -= concurrency
    if (queue.size < maxConcurrency) {
      const task = queue.dequeue()
      if (task) {
        active += 1
        task()
      }
    }
  }

  const runJob = async <T>(job: Job<T>, concurrency: number): Promise<T> => {
    if (active >= maxConcurrency) {
      return enqueue(job)
    }

    active += concurrency
    return job().finally(() => manageJobFinalization(concurrency))
  }

  return runJob
}
