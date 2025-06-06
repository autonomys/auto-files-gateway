import { AsyncDownloadTree } from '@auto-files/models'

const internalCache = new Map<string, AsyncDownloadTree>()

export const asyncDownloadTreeCache = {
  get: (cid: string) => {
    return internalCache.get(cid)
  },
  set: (cid: string, tree: AsyncDownloadTree) => {
    internalCache.set(cid, tree)
  },
}
