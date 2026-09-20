import type {Output, Package} from './types.ts'

import {resolveInputFolder} from './lib/resolveInputFolder.ts'
import {WorkspaceTraverser} from './lib/traversal/WorkspaceTraverser.ts'

export type {Output, Package, Packages} from './types.ts'

/** Build a recursive workspace tree from a package directory or its package.json file. */
const traverseWorkspace = async (input: string): Promise<Output> => {
  const folder = await resolveInputFolder(input)
  return (new WorkspaceTraverser).traverse(folder)
}
/** Lazily yield flat package entries in depth-first order, with parents before their descendants. */
traverseWorkspace.async = async function *(input: string): AsyncGenerator<Package, void, unknown> {
  const folder = await resolveInputFolder(input)
  yield* (new WorkspaceTraverser).iterate(folder)
}
/** Lazily yield flat package entries in depth-first postorder, with descendants before their parents. */
traverseWorkspace.asyncInward = async function *(input: string): AsyncGenerator<Package, void, unknown> {
  const folder = await resolveInputFolder(input)
  yield* (new WorkspaceTraverser).iterate(folder, true)
}
/** Return absolute package folders in depth-first order, with parents before their descendants. */
traverseWorkspace.flat = async (input: string): Promise<Array<string>> => Array.fromAsync(traverseWorkspace.async(input), entry => entry.folder)
/** Return absolute package folders in depth-first postorder, with descendants before their parents. */
traverseWorkspace.flatInward = async (input: string): Promise<Array<string>> => Array.fromAsync(traverseWorkspace.asyncInward(input), entry => entry.folder)

export default traverseWorkspace
