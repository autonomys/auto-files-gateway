import Stream from 'stream'

export type FileResponse = {
  data: Stream
  mimeType?: string
  filename?: string
  size?: bigint
  encoding?: string
}
