/**
 * Work that any number of callers can wait on together. The first time the
 * last waiting caller gives up before the work has settled, the signal handed
 * to the work is aborted. The work decides whether to stop, and callers can
 * still join work that carries on.
 */
export class SharedTask<T> {
  private readonly controller = new AbortController()
  private waiters = 0
  private settled = false
  readonly result: Promise<T>

  constructor(run: (signal: AbortSignal) => Promise<T>) {
    this.result = run(this.controller.signal)
    this.result.then(
      () => {
        this.settled = true
      },
      () => {
        this.settled = true
      },
    )
  }

  /** Aborted the first time nobody is left waiting for the result. */
  get signal(): AbortSignal {
    return this.controller.signal
  }

  /**
   * Settles with the work, or rejects with `signal.reason` as soon as `signal`
   * aborts.
   */
  wait(signal: AbortSignal): Promise<T> {
    this.waiters++

    return new Promise<T>((resolve, reject) => {
      let waiting = true
      const leave = () => {
        waiting = false
        this.waiters--
        signal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        if (!waiting) {
          return
        }
        leave()
        if (this.waiters === 0 && !this.settled) {
          this.controller.abort()
        }
        reject(signal.reason)
      }

      this.result.then(
        (value) => {
          if (waiting) {
            leave()
            resolve(value)
          }
        },
        (error) => {
          if (waiting) {
            leave()
            reject(error)
          }
        },
      )

      if (signal.aborted) {
        onAbort()
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }
}
