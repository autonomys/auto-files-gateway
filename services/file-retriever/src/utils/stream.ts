import Stream, { PassThrough, Readable } from 'stream'
import { fork } from 'stream-fork'

export async function forkStream(
  stream: Stream,
): Promise<[Readable, Readable]> {
  const passThrough1 = new PassThrough()
  const passThrough2 = new PassThrough()
  const writable = fork([passThrough1, passThrough2])

  stream.pipe(writable)

  return [passThrough1, passThrough2]
}

export const streamToReadable = (stream: Stream) => {
  return new Readable({
    read() {
      stream.on('data', (chunk) => {
        this.push(chunk)
      })

      stream.on('end', () => {
        this.push(null)
      })
    },
  })
}

export const readableToStream = (readable: ReadableStream): Stream => {
  const passThrough = new PassThrough()
  const reader = readable.getReader()

  const read = async () => {
    try {
      const { done, value } = await reader.read()

      if (done) {
        passThrough.end()
        return
      }

      const canContinue = passThrough.write(value)

      if (canContinue) {
        read()
      } else {
        passThrough.once('drain', read)
      }
    } catch (error) {
      passThrough.emit('error', error)
      passThrough.end()
    }
  }

  read()

  return passThrough
}
