import {
  AsyncDownloadNode,
  AsyncDownloadTree,
  getLeafByIndex,
  getLeftmostNode,
  getUnresolvedNodes,
  setChildrenToNode,
} from '../src/tree.js'
import { PBNode } from '@ipld/dag-pb'
import { jest } from '@jest/globals'

// Mock cidToString function from @autonomys/auto-dag-data
jest.mock('@autonomys/auto-dag-data', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cidToString: (cid: any) => cid.toString(),
}))

describe('AsyncDownloadTree functions', () => {
  let mockTree: AsyncDownloadTree

  beforeEach(() => {
    // Create a mock tree for testing
    mockTree = {
      cid: 'root-cid',
      linkDepth: 3,
      children: [
        {
          cid: 'child-1',
          linkDepth: 2,
          children: [
            {
              cid: 'child-1-1',
              linkDepth: 1,
              children: undefined,
            },
            {
              cid: 'child-1-2',
              linkDepth: 1,
              children: undefined,
            },
          ],
        },
        {
          cid: 'child-2',
          linkDepth: 2,
          children: undefined,
        },
      ],
    }
  })

  test('getNodeByIndex returns the correct node', () => {
    const result = getLeafByIndex(mockTree, 0)
    expect(result).toBeDefined()
    expect(result?.cid).toBe('child-1-1')

    const result2 = getLeafByIndex(mockTree, 1)
    expect(result2).toBeDefined()
    expect(result2?.cid).toBe('child-1-2')

    // Index out of bounds should return undefined
    const result3 = getLeafByIndex(mockTree, 5)
    expect(result3).toBeUndefined()
  })

  test('getLeftmostNode returns the leftmost unresolved node', () => {
    // This test was failing because our mock tree has unresolved nodes,
    // so getLeftmostNode should find child-2
    const result = getLeftmostNode(mockTree)
    expect(result).toBeDefined()
    expect(result.cid).toBe('child-2')
  })

  test('getUnresolvedNodes returns all unresolved nodes', () => {
    const unresolved = getUnresolvedNodes(mockTree)
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0].cid).toBe('child-2')
  })

  test('setChildrenToNode sets children correctly', () => {
    const node: AsyncDownloadNode = {
      cid: 'test-node',
      linkDepth: 2,
      children: undefined,
    }

    const mockPBNode = {
      Links: [
        { Hash: { toString: () => 'child-1' } },
        { Hash: { toString: () => 'child-2' } },
      ],
    } as unknown as PBNode

    setChildrenToNode(node, mockPBNode)

    expect(node.children).toHaveLength(2)
    if (node.children) {
      expect(node.children[0].cid).toBe('child-1')
      expect(node.children[0].linkDepth).toBe(1)
      expect(node.children[1].cid).toBe('child-2')
      expect(node.children[1].linkDepth).toBe(1)
    }
  })

  test('setChildrenToNode throws error when called on leaf node', () => {
    const leafNode: AsyncDownloadNode = {
      cid: 'leaf-node',
      linkDepth: 1,
      children: undefined,
    }

    const mockPBNode = {
      Links: [],
    } as unknown as PBNode

    expect(() => setChildrenToNode(leafNode, mockPBNode)).toThrow()
  })
})
