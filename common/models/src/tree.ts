import { PBNode } from '@ipld/dag-pb'
import { cidToString } from '@autonomys/auto-dag-data'

// Complexity is not an issue since the tree (e.g 3 levels deep would be for a file of 67.10 GB)
export type AsyncDownloadNode = {
  cid: string
  linkDepth: number
  // Sorted list of children in order to the position of the chunk/inlinks in the file
  // Undefined if the node is not yet received and null if the node is a leaf
  children: AsyncDownloadNode[] | null | undefined
}

export type AsyncDownloadTree = AsyncDownloadNode

const isSolved = (node: AsyncDownloadNode): boolean => {
  return node.linkDepth === 0
}

export const getLeafByIndex = (
  tree: AsyncDownloadTree,
  index: number,
): AsyncDownloadNode | undefined => {
  let currentIndex = 0

  function dfs(node: AsyncDownloadNode): AsyncDownloadNode | undefined {
    if (node.children) {
      for (const child of node.children) {
        if (isSolved(child)) {
          if (currentIndex === index) return child
          currentIndex++
        } else {
          const result = dfs(child)
          if (result) return result
        }
      }
    }
  }

  return dfs(tree)
}

export const getLeftmostNode = (node: AsyncDownloadNode): AsyncDownloadNode => {
  function dfs(node: AsyncDownloadNode): AsyncDownloadNode | undefined {
    if (node.children) {
      for (const child of node.children) {
        if (isSolved(child)) {
          return child
        } else if (child.linkDepth > 1) {
          return dfs(child)
        }
      }
    }
  }

  const result = dfs(node)
  if (!result) {
    throw new Error('The tree is complete so no leftmost node exists')
  }
  return result
}

export const getUnresolvedNodes = (
  node: AsyncDownloadNode,
): AsyncDownloadNode[] => {
  const queue: AsyncDownloadNode[] = [node]
  const unresolvedNodes: AsyncDownloadNode[] = []

  while (queue.length > 0) {
    const currentNode = queue.shift()!
    if (currentNode.children) {
      queue.push(...currentNode.children)
    } else if (currentNode.linkDepth > 1) {
      unresolvedNodes.push(currentNode)
    }
  }
  return unresolvedNodes
}

export const setChildrenToNode = (
  node: AsyncDownloadNode,
  children: PBNode,
) => {
  // We should not be calling this function on a final leaf node (linkDepth === 1)
  if (node.linkDepth === 1) {
    throw new Error('Should not be called on a leaf node')
  }

  const childrenLinkDepth = node.linkDepth - 1

  node.children = children.Links.map((l) => ({
    cid: cidToString(l.Hash),
    linkDepth: childrenLinkDepth,
    children: childrenLinkDepth === 1 ? undefined : null,
  }))
}
