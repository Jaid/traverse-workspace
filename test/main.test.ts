import type {Output, Package, Packages} from '#src/main.ts'
import type {PackageJson} from 'type-fest'

import {afterEach, beforeEach, expect, expectTypeOf, test} from 'bun:test'
import {tmpdir} from 'node:os'

import {basename, dirname, join, relative, resolve} from 'forward-slash-path'
import fs from 'fs-extra'

import traverseWorkspace from '#src/main.ts'

let directory: string
const writePackage = async (relativePath: string, manifest: unknown) => {
  const folder = join(directory, relativePath)
  await fs.outputJson(join(folder, 'package.json'), manifest)
  return folder
}
const linkDirectory = async (target: string, link: string) => {
  await fs.ensureDir(dirname(link))
  await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}
const collect = async (iterable: AsyncIterable<Package>): Promise<Packages> => {
  const entries: Packages = await Array.fromAsync(iterable)
  return entries
}
const flatten = (packages: Packages, backwards = false): Packages => packages.flatMap(({packages: children, ...entry}) => {
  const descendants = children ? flatten(children, backwards) : []
  return backwards ? [...descendants, entry] : [entry, ...descendants]
})
const writeBranchingWorkspace = async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/*'],
  })
  await writePackage('packages/a', {
    name: 'a',
    workspaces: ['children/*'],
  })
  await writePackage('packages/a/children/one', {
    name: 'one',
    workspaces: ['nested/*'],
  })
  await writePackage('packages/a/children/one/nested/leaf', {
    name: 'leaf',
    version: '1.0.0',
  })
  await writePackage('packages/a/children/two', {name: 'two'})
  await writePackage('packages/b', {name: 'b'})
}
beforeEach(async () => {
  directory = resolve(await fs.mkdtemp(join(tmpdir(), 'traverse-workspace-')))
  await writePackage('.', {name: 'root'})
})
afterEach(async () => {
  await fs.remove(directory)
})
test('exports the requested recursive types and iterator signatures', () => {
  type ExpectedPackage = {
    folder: string
    hierarchy: Array<string>
    packages?: Array<ExpectedPackage>
  } & Pick<PackageJson, 'dependencies' | 'devDependencies' | 'name' | 'optionalDependencies' | 'peerDependencies' | 'peerDependenciesMeta' | 'private' | 'version' | 'workspaces'>
  expectTypeOf<Package>().toEqualTypeOf<ExpectedPackage>()
  expectTypeOf<Packages>().toEqualTypeOf<Array<Package>>()
  expectTypeOf<Output>().toEqualTypeOf<Packages>()
  expectTypeOf<ReturnType<typeof traverseWorkspace>>().toEqualTypeOf<Promise<Output>>()
  expectTypeOf<ReturnType<typeof traverseWorkspace.async>>().toEqualTypeOf<AsyncGenerator<Package, void, unknown>>()
  expectTypeOf<ReturnType<typeof traverseWorkspace.asyncBackwards>>().toEqualTypeOf<AsyncGenerator<Package, void, unknown>>()
})
test('returns a root array with exactly the requested manifest fields', async () => {
  const metadata = {
    name: '@scope/root',
    version: '1.2.3',
    private: false,
    workspaces: [],
    dependencies: {runtime: '^1.0.0'},
    devDependencies: {typescript: '^6.0.0'},
    optionalDependencies: {native: '2.0.0'},
    peerDependencies: {react: '>=19'},
    peerDependenciesMeta: {react: {optional: true}},
  } satisfies PackageJson
  await writePackage('.', {
    ...metadata,
    description: 'ignored',
    scripts: {test: 'bun test'},
    path: '/incorrect',
    folder: '/incorrect',
    hierarchy: ['incorrect'],
    packages: [{name: 'incorrect'}],
  })
  expect(await traverseWorkspace(directory)).toEqual([
    {
      folder: directory,
      hierarchy: ['@scope/root'],
      ...metadata,
    },
  ])
})
test('accepts a directory, trailing separator or package.json path', async () => {
  const expected = [
    {
      name: 'root',
      folder: directory,
      hierarchy: ['root'],
    },
  ]
  expect(await traverseWorkspace(directory)).toEqual(expected)
  expect(await traverseWorkspace(`${directory}/`)).toEqual(expected)
  expect(await traverseWorkspace(join(directory, 'package.json'))).toEqual(expected)
})
test('resolves relative input paths against the working directory', async () => {
  const relativeInput = relative(process.cwd(), directory)
  const expected = [
    {
      name: 'root',
      folder: directory,
      hierarchy: ['root'],
    },
  ]
  expect(await traverseWorkspace(relativeInput)).toEqual(expected)
  expect(await traverseWorkspace(join(relativeInput, 'package.json'))).toEqual(expected)
})
test.skipIf(process.platform !== 'win32')('normalizes Windows backslash input and accepts manifest filename casing', async () => {
  const expected = [
    {
      name: 'root',
      folder: directory,
      hierarchy: ['root'],
    },
  ]
  expect(await traverseWorkspace(directory.replaceAll('/', '\\'))).toEqual(expected)
  expect(await traverseWorkspace(String.raw`${directory.replaceAll('/', '\\')}\PACKAGE.JSON`)).toEqual(expected)
})
test('distinguishes a directory named package.json from a manifest file', async () => {
  const folder = await writePackage('folder/package.json', {name: 'unusual'})
  expect(await traverseWorkspace(folder)).toEqual([
    {
      name: 'unusual',
      folder,
      hierarchy: ['unusual'],
    },
  ])
})
test('recursively resolves each package’s own workspace declarations and hierarchy', async () => {
  await writePackage('.', {
    name: 'root',
    private: true,
    workspaces: ['packages/*'],
  })
  const group = await writePackage('packages/group', {
    name: '@scope/group',
    version: '2.0.0',
    workspaces: ['children/*'],
  })
  const child = await writePackage('packages/group/children/child', {
    name: 'child',
    workspaces: {
      packages: ['nested/*'],
      nohoist: ['**/react'],
    },
  })
  const grandchild = await writePackage('packages/group/children/child/nested/leaf', {
    name: 'leaf',
    dependencies: {external: '^1.0.0'},
  })
  const sibling = await writePackage('packages/sibling', {name: 'sibling'})
  await writePackage('unlisted', {name: 'unlisted'})
  expect(await traverseWorkspace(directory)).toEqual([
    {
      name: 'root',
      folder: directory,
      hierarchy: ['root'],
      private: true,
      workspaces: ['packages/*'],
      packages: [
        {
          name: '@scope/group',
          folder: group,
          hierarchy: ['root', '@scope/group'],
          version: '2.0.0',
          workspaces: ['children/*'],
          packages: [
            {
              name: 'child',
              folder: child,
              hierarchy: ['root', '@scope/group', 'child'],
              workspaces: {
                packages: ['nested/*'],
                nohoist: ['**/react'],
              },
              packages: [
                {
                  name: 'leaf',
                  folder: grandchild,
                  hierarchy: ['root', '@scope/group', 'child', 'leaf'],
                  dependencies: {external: '^1.0.0'},
                },
              ],
            },
          ],
        }, {
          name: 'sibling',
          folder: sibling,
          hierarchy: ['root', 'sibling'],
        },
      ],
    },
  ])
})
test('preserves object-form workspaces without treating nohoist as discovery patterns', async () => {
  const workspaces = {
    packages: ['packages/*'],
    nohoist: ['unlisted/*'],
  }
  await writePackage('.', {
    name: 'root',
    workspaces,
  })
  const included = await writePackage('packages/a', {name: 'a'})
  await writePackage('unlisted/b', {name: 'b'})
  expect(await traverseWorkspace(directory)).toEqual([
    {
      name: 'root',
      folder: directory,
      hierarchy: ['root'],
      workspaces,
      packages: [
        {
          name: 'a',
          folder: included,
          hierarchy: ['root', 'a'],
        },
      ],
    },
  ])
})
test('does not automatically expand a literal workspace directory into its descendants', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/a/'],
  })
  const a = await writePackage('packages/a', {name: 'a'})
  await writePackage('packages/a/unlisted', {name: 'unlisted'})
  const [root] = await traverseWorkspace(directory)
  expect(root.packages).toEqual([
    {
      name: 'a',
      folder: a,
      hierarchy: ['root', 'a'],
    },
  ])
})
test('supports globstars, brace expansion, extglobs and exclusions', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['{packages,plugins}/**', '!packages/excluded/**', 'tools/!(ignored)'],
  })
  await writePackage('packages/a', {name: 'a'})
  await writePackage('packages/group/nested', {name: 'nested'})
  await writePackage('plugins/b', {name: 'b'})
  await writePackage('packages/excluded', {name: 'excluded'})
  await writePackage('packages/excluded/child', {name: 'excluded-child'})
  await writePackage('tools/c', {name: 'c'})
  await writePackage('tools/ignored', {name: 'ignored'})
  const [root] = await traverseWorkspace(directory)
  expect(root.packages!.map(entry => entry.name)).toEqual(['a', 'nested', 'b', 'c'])
})
test('applies negative patterns independently of their order', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['!packages/b', 'packages/*'],
  })
  const a = await writePackage('packages/a', {name: 'a'})
  await writePackage('packages/b', {name: 'b'})
  const [root] = await traverseWorkspace(directory)
  expect(root.packages).toEqual([
    {
      name: 'a',
      folder: a,
      hierarchy: ['root', 'a'],
    },
  ])
})
test('deduplicates overlapping patterns and sorts results by directory rather than name', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/z', 'packages/*', './packages/a', 'packages/a/'],
  })
  const z = await writePackage('packages/z', {name: '2'})
  const a = await writePackage('packages/a', {name: '10'})
  const [root] = await traverseWorkspace(directory)
  expect(root.packages).toEqual([
    {
      name: '10',
      folder: a,
      hierarchy: ['root', '10'],
    },
    {
      name: '2',
      folder: z,
      hierarchy: ['root', '2'],
    },
  ])
})
test('ignores unmatched patterns, directories without manifests and ordinary files', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/*', 'missing/*'],
  })
  const a = await writePackage('packages/a', {name: 'a'})
  await fs.ensureDir(join(directory, 'packages/empty'))
  await fs.outputFile(join(directory, 'packages/notes.txt'), 'not a package')
  const [root] = await traverseWorkspace(directory)
  expect(root.packages).toEqual([
    {
      name: 'a',
      folder: a,
      hierarchy: ['root', 'a'],
    },
  ])
})
test('includes hidden workspace directories but excludes node_modules and .git', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['**'],
  })
  const hidden = await writePackage('.hidden', {name: 'hidden'})
  const a = await writePackage('packages/a', {name: 'a'})
  await writePackage('node_modules/installed', {name: 'installed'})
  await writePackage('packages/a/node_modules/nested', {name: 'installed-nested'})
  await writePackage('.git/fake', {name: 'git-internal'})
  await writePackage('packages/.git/fake', {name: 'nested-git-internal'})
  const [root] = await traverseWorkspace(directory)
  expect(root.packages).toEqual([
    {
      name: 'hidden',
      folder: hidden,
      hierarchy: ['root', 'hidden'],
    },
    {
      name: 'a',
      folder: a,
      hierarchy: ['root', 'a'],
    },
  ])
})
const emptyWorkspaceManifests: Array<Pick<PackageJson, 'workspaces'>> = [
  {workspaces: undefined},
  {workspaces: []},
  {workspaces: {}},
  {workspaces: {nohoist: ['**/react']}},
  {workspaces: {packages: []}},
  {workspaces: ['missing/*']},
  {workspaces: ['!**']},
]
test.each(emptyWorkspaceManifests)('omits packages when discovery finds no children: %j', async ({workspaces}) => {
  await writePackage('.', {
    name: 'root',
    workspaces,
  })
  const [root] = await traverseWorkspace(directory)
  expect(root.folder).toBe(directory)
  expect(root.hierarchy).toEqual(['root'])
  expect(Object.hasOwn(root, 'packages')).toBe(false)
  if (workspaces !== undefined) {
    expect(root.workspaces).toEqual(workspaces)
  }
})
test('falls back to directory basenames in hierarchy without inventing manifest names', async () => {
  await writePackage('.', {
    private: true,
    workspaces: ['packages/*'],
  })
  const child = await writePackage('packages/unnamed', {
    version: '1.0.0',
    workspaces: ['children/*'],
  })
  const leaf = await writePackage('packages/unnamed/children/leaf', {name: '@scope/leaf'})
  expect(await traverseWorkspace(directory)).toEqual([
    {
      folder: directory,
      hierarchy: [basename(directory)],
      private: true,
      workspaces: ['packages/*'],
      packages: [
        {
          folder: child,
          hierarchy: [basename(directory), 'unnamed'],
          version: '1.0.0',
          workspaces: ['children/*'],
          packages: [
            {
              name: '@scope/leaf',
              folder: leaf,
              hierarchy: [basename(directory), 'unnamed', '@scope/leaf'],
            },
          ],
        },
      ],
    },
  ])
})
test('preserves duplicate sibling names and their independent subtrees', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/*'],
  })
  const a = await writePackage('packages/a', {
    name: 'duplicate',
    workspaces: ['children/*'],
  })
  const aChild = await writePackage('packages/a/children/child', {name: 'child'})
  const b = await writePackage('packages/b', {
    name: 'duplicate',
    workspaces: ['children/*'],
  })
  const bChild = await writePackage('packages/b/children/child', {name: 'child'})
  const [root] = await traverseWorkspace(directory)
  expect(root.packages).toEqual([
    {
      name: 'duplicate',
      folder: a,
      hierarchy: ['root', 'duplicate'],
      workspaces: ['children/*'],
      packages: [
        {
          name: 'child',
          folder: aChild,
          hierarchy: ['root', 'duplicate', 'child'],
        },
      ],
    },
    {
      name: 'duplicate',
      folder: b,
      hierarchy: ['root', 'duplicate'],
      workspaces: ['children/*'],
      packages: [
        {
          name: 'child',
          folder: bChild,
          hierarchy: ['root', 'duplicate', 'child'],
        },
      ],
    },
  ])
})
test('allows a fallback basename to equal another package’s explicit name', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/*'],
  })
  const a = await writePackage('packages/a', {name: 'unnamed'})
  const unnamed = await writePackage('packages/unnamed', {})
  const [root] = await traverseWorkspace(directory)
  expect(root.packages).toEqual([
    {
      name: 'unnamed',
      folder: a,
      hierarchy: ['root', 'unnamed'],
    },
    {
      folder: unnamed,
      hierarchy: ['root', 'unnamed'],
    },
  ])
})
test('allows equal names in separate levels of the tree', async () => {
  await writePackage('.', {
    name: 'same',
    workspaces: ['packages/*'],
  })
  const child = await writePackage('packages/a', {name: 'same'})
  const [root] = await traverseWorkspace(directory)
  expect(root.packages).toEqual([
    {
      name: 'same',
      folder: child,
      hierarchy: ['same', 'same'],
    },
  ])
})
test('treats prototype-related package names as ordinary values', async () => {
  await writePackage('.', {
    name: '__proto__',
    workspaces: ['packages/*'],
  })
  const constructor = await writePackage('packages/a', {name: 'constructor'})
  const proto = await writePackage('packages/b', {name: '__proto__'})
  const [root] = await traverseWorkspace(directory)
  expect(root.name).toBe('__proto__')
  expect(root.packages).toEqual([
    {
      name: 'constructor',
      folder: constructor,
      hierarchy: ['__proto__', 'constructor'],
    },
    {
      name: '__proto__',
      folder: proto,
      hierarchy: ['__proto__', '__proto__'],
    },
  ])
})
test('allows workspace paths outside the starting package and ignores ancestor cycles', async () => {
  const root = await writePackage('project', {
    name: 'project',
    workspaces: ['.', '../shared'],
  })
  const shared = await writePackage('shared', {
    name: 'shared',
    workspaces: ['../project'],
  })
  expect(await traverseWorkspace(root)).toEqual([
    {
      name: 'project',
      folder: root,
      hierarchy: ['project'],
      workspaces: ['.', '../shared'],
      packages: [
        {
          name: 'shared',
          folder: shared,
          hierarchy: ['project', 'shared'],
          workspaces: ['../project'],
        },
      ],
    },
  ])
})
test('ignores direct self references and backreferences to the root', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['.', 'packages/*'],
  })
  const a = await writePackage('packages/a', {
    name: 'a',
    workspaces: ['../..'],
  })
  expect(await traverseWorkspace(directory)).toEqual([
    {
      name: 'root',
      folder: directory,
      hierarchy: ['root'],
      workspaces: ['.', 'packages/*'],
      packages: [
        {
          name: 'a',
          folder: a,
          hierarchy: ['root', 'a'],
          workspaces: ['../..'],
        },
      ],
    },
  ])
})
test('does not globally suppress packages referenced by separate branches', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/*'],
  })
  await writePackage('packages/a', {
    name: 'a',
    workspaces: ['../../shared'],
  })
  await writePackage('packages/b', {
    name: 'b',
    workspaces: ['../../shared'],
  })
  const shared = await writePackage('shared', {name: 'shared'})
  const [root] = await traverseWorkspace(directory)
  const [a, b] = root.packages!
  expect(a.packages).toEqual([
    {
      name: 'shared',
      folder: shared,
      hierarchy: ['root', 'a', 'shared'],
    },
  ])
  expect(b.packages).toEqual([
    {
      name: 'shared',
      folder: shared,
      hierarchy: ['root', 'b', 'shared'],
    },
  ])
  expect(a.packages![0]).not.toBe(b.packages![0])
})
test('follows workspace directory links and deduplicates physical package aliases', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['links/*', 'targets/*'],
  })
  const target = await writePackage('targets/a', {name: 'linked'})
  const alias = join(directory, 'links/a')
  await linkDirectory(target, alias)
  const [root] = await traverseWorkspace(directory)
  expect(root.packages).toEqual([
    {
      name: 'linked',
      folder: alias,
      hierarchy: ['root', 'linked'],
    },
  ])
}, 5000)
test('ignores junction or symlink cycles during recursive glob discovery', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/**'],
  })
  const a = await writePackage('packages/a', {
    name: 'a',
    workspaces: ['back'],
  })
  await linkDirectory(directory, join(a, 'back'))
  const tree = await traverseWorkspace(directory)
  expect(tree[0].packages).toEqual([
    {
      name: 'a',
      folder: a,
      hierarchy: ['root', 'a'],
      workspaces: ['back'],
    },
  ])
  expect(await collect(traverseWorkspace.async(directory))).toEqual(flatten(tree))
  expect(await collect(traverseWorkspace.asyncBackwards(directory))).toEqual(flatten(tree, true))
  expect(() => JSON.stringify(tree)).not.toThrow()
}, 5000)
test('keeps traversal state independent across calls', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/*'],
  })
  const a = await writePackage('packages/a', {
    name: 'a',
    version: '1.0.0',
  })
  const [first, second] = await Promise.all([traverseWorkspace(directory), traverseWorkspace(directory)])
  expect(first).toEqual(second)
  await writePackage('packages/a', {
    name: 'a',
    version: '2.0.0',
  })
  const [root] = await traverseWorkspace(directory)
  expect(root.packages).toEqual([
    {
      name: 'a',
      folder: a,
      hierarchy: ['root', 'a'],
      version: '2.0.0',
    },
  ])
  expect(first[0].packages![0].version).toBe('1.0.0')
})
test('supports package paths containing spaces and glob metacharacters', async () => {
  const rootFolder = await writePackage('a [special] (workspace)', {
    name: 'special',
    workspaces: ['packages/*'],
  })
  const child = await writePackage('a [special] (workspace)/packages/a', {name: 'a'})
  const [root] = await traverseWorkspace(rootFolder)
  expect(root.packages).toEqual([
    {
      name: 'a',
      folder: child,
      hierarchy: ['special', 'a'],
    },
  ])
})
test('reads UTF-8 manifests with a byte order mark', async () => {
  await fs.writeFile(join(directory, 'package.json'), '\u{FEFF}{"name":"bom"}')
  expect(await traverseWorkspace(directory)).toEqual([
    {
      name: 'bom',
      folder: directory,
      hierarchy: ['bom'],
    },
  ])
})
test('rejects invalid input and non-package files', async () => {
  await expect(traverseWorkspace('')).rejects.toThrow(TypeError)
  await expect(traverseWorkspace(undefined as never)).rejects.toThrow(TypeError)
  await expect(traverseWorkspace(42 as never)).rejects.toThrow(TypeError)
  const other = join(directory, 'other.json')
  await fs.outputJson(other, {name: 'other'})
  await expect(traverseWorkspace(other)).rejects.toThrow('Expected a package directory or package.json file')
})
test('rejects missing root paths or root manifests', async () => {
  await expect(traverseWorkspace(join(directory, 'missing'))).rejects.toThrow()
  const empty = join(directory, 'empty')
  await fs.ensureDir(empty)
  await expect(traverseWorkspace(empty)).rejects.toThrow(join(empty, 'package.json'))
  await expect(traverseWorkspace(join(empty, 'package.json'))).rejects.toThrow()
})
test('reports malformed root and child JSON with manifest paths and the original cause', async () => {
  const manifestPath = join(directory, 'package.json')
  await fs.writeFile(manifestPath, '{invalid')
  try {
    await traverseWorkspace(directory)
    throw new Error('Expected traversal to fail.')
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(manifestPath)
    expect((error as Error).cause).toBeInstanceOf(SyntaxError)
  }
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/*'],
  })
  const childManifest = join(directory, 'packages/broken/package.json')
  await fs.outputFile(childManifest, '{invalid')
  await expect(traverseWorkspace(directory)).rejects.toThrow(childManifest)
})
test.each(['null', '[]', '42', 'true', '"string"'])('rejects non-object manifests: %s', async json => {
  await fs.writeFile(join(directory, 'package.json'), json)
  await expect(traverseWorkspace(directory)).rejects.toThrow('Expected a JSON object')
})
test.each([{name: ''}, {name: ' '}, {name: null}, {name: 42}, {name: []}])('rejects invalid package names: %j', async manifest => {
  await writePackage('.', manifest)
  await expect(traverseWorkspace(directory)).rejects.toThrow('Expected a nonempty package name')
})
test.each([
  {workspaces: null},
  {workspaces: 'packages/*'},
  {workspaces: 42},
  {workspaces: ['']},
  {workspaces: [' ']},
  {workspaces: [false]},
  {workspaces: {packages: 'packages/*'}},
  {workspaces: {packages: null}},
  {workspaces: {packages: [42]}},
])('rejects invalid workspace declarations: %j', async manifest => {
  await writePackage('.', {
    name: 'root',
    ...manifest,
  })
  await expect(traverseWorkspace(directory)).rejects.toThrow(TypeError)
})
test('async yields flat entries in parent-first depth-first order', async () => {
  await writeBranchingWorkspace()
  const entries = await collect(traverseWorkspace.async(directory))
  expect(entries.map(entry => entry.name)).toEqual(['root', 'a', 'one', 'leaf', 'two', 'b'])
  expect(entries.map(entry => entry.hierarchy)).toEqual([['root'], ['root', 'a'], ['root', 'a', 'one'], ['root', 'a', 'one', 'leaf'], ['root', 'a', 'two'], ['root', 'b']])
  expect(entries).toEqual(flatten(await traverseWorkspace(directory)))
  expect(entries.every(entry => !Object.hasOwn(entry, 'packages') && !Object.hasOwn(entry, 'path'))).toBe(true)
})
test('asyncBackwards yields descendants before parents without reversing sibling order', async () => {
  await writeBranchingWorkspace()
  const entries = await collect(traverseWorkspace.asyncBackwards(directory))
  expect(entries.map(entry => entry.name)).toEqual(['leaf', 'one', 'two', 'a', 'b', 'root'])
  expect(entries).toEqual(flatten(await traverseWorkspace(directory), true))
  expect(entries.every(entry => !Object.hasOwn(entry, 'packages') && !Object.hasOwn(entry, 'path'))).toBe(true)
})
test.each(['async', 'asyncBackwards'] as const)('%s accepts the same input forms as the tree API', async method => {
  await writeBranchingWorkspace()
  const expected = await collect(traverseWorkspace[method](directory))
  expect(await collect(traverseWorkspace[method](join(directory, 'package.json')))).toEqual(expected)
  expect(await collect(traverseWorkspace[method](`${directory}/`))).toEqual(expected)
  expect(await collect(traverseWorkspace[method](relative(process.cwd(), directory)))).toEqual(expected)
  if (process.platform === 'win32') {
    expect(await collect(traverseWorkspace[method](directory.replaceAll('/', '\\')))).toEqual(expected)
  }
})
test.each(['async', 'asyncBackwards'] as const)('%s performs no filesystem access before the first next call', async method => {
  const folder = join(directory, 'not-created-yet')
  const iterator = traverseWorkspace[method](folder)
  expect(iterator[Symbol.asyncIterator]()).toBe(iterator)
  await writePackage('not-created-yet', {name: 'created-later'})
  expect(await collect(iterator)).toEqual([
    {
      name: 'created-later',
      folder,
      hierarchy: ['created-later'],
    },
  ])
})
test('async yields the parent before reading children and stops immediately on break', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/*'],
  })
  const broken = join(directory, 'packages/broken/package.json')
  await fs.outputFile(broken, '{invalid')
  const visited: Array<string | undefined> = []
  for await (const entry of traverseWorkspace.async(directory)) {
    visited.push(entry.name)
    break
  }
  expect(visited).toEqual(['root'])
  const iterator = traverseWorkspace.async(directory)
  expect(await iterator.next()).toMatchObject({
    done: false,
    value: {name: 'root'},
  })
  await expect(iterator.next()).rejects.toThrow(broken)
  expect(await iterator.next()).toEqual({
    done: true,
    value: undefined,
  })
})
test('asyncBackwards yields the first branch without reading later siblings', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/*'],
  })
  await writePackage('packages/a', {name: 'a'})
  await fs.outputFile(join(directory, 'packages/b/package.json'), '{invalid')
  const iterator = traverseWorkspace.asyncBackwards(directory)
  expect(await iterator.next()).toMatchObject({
    done: false,
    value: {name: 'a'},
  })
  await writePackage('packages/b', {
    name: 'b',
    version: '2.0.0',
  })
  const remaining = await collect(iterator)
  expect(remaining.map(entry => entry.name)).toEqual(['b', 'root'])
  expect(remaining[0].version).toBe('2.0.0')
})
test('asyncBackwards stops before later siblings when its consumer breaks', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/*'],
  })
  await writePackage('packages/a', {name: 'a'})
  await fs.outputFile(join(directory, 'packages/b/package.json'), '{invalid')
  const visited: Array<string | undefined> = []
  for await (const entry of traverseWorkspace.asyncBackwards(directory)) {
    visited.push(entry.name)
    break
  }
  expect(visited).toEqual(['a'])
})
test.each(['async', 'asyncBackwards'] as const)('%s never adds descendants or otherwise mutates yielded entries', async method => {
  await writeBranchingWorkspace()
  const visited: Packages = []
  for await (const entry of traverseWorkspace[method](directory)) {
    Object.freeze(entry.hierarchy)
    Object.freeze(entry)
    visited.push(entry)
  }
  expect(visited).toEqual(flatten(await traverseWorkspace(directory), method === 'asyncBackwards'))
})
test.each([{workspaces: ['packages/*']}, {workspaces: {packages: ['packages/*']}}] as const)('keeps traversal state independent of yielded hierarchy and workspaces mutations: %j', async ({workspaces}) => {
  await writePackage('.', {
    name: 'root',
    workspaces,
  })
  const child = await writePackage('packages/a', {name: 'a'})
  const iterator = traverseWorkspace.async(directory)
  const first = await iterator.next()
  expect(first.done).toBe(false)
  if (first.done) {
    throw new Error('Expected a root entry.')
  }
  const root = first.value
  root.name = 'changed'
  root.folder = '/changed'
  root.hierarchy.splice(0, root.hierarchy.length, 'changed')
  const patterns = Array.isArray(root.workspaces) ? root.workspaces : root.workspaces!.packages!
  patterns.splice(0, patterns.length, 'not-the-real-children/*')
  expect(await collect(iterator)).toEqual([
    {
      name: 'a',
      folder: child,
      hierarchy: ['root', 'a'],
    },
  ])
})
test.each(['async', 'asyncBackwards'] as const)('%s preserves duplicate names, fallback hierarchy and independent branches', async method => {
  await writePackage('.', {workspaces: ['packages/*']})
  await writePackage('packages/a', {
    name: 'duplicate',
    workspaces: ['../../shared'],
  })
  await writePackage('packages/b', {
    name: 'duplicate',
    workspaces: ['../../shared'],
  })
  await writePackage('shared', {})
  const entries = await collect(traverseWorkspace[method](directory))
  expect(entries).toEqual(flatten(await traverseWorkspace(directory), method === 'asyncBackwards'))
  expect(entries.filter(entry => entry.name === 'duplicate')).toHaveLength(2)
  const shared = entries.filter(entry => entry.folder === join(directory, 'shared'))
  expect(shared).toHaveLength(2)
  expect(shared[0].hierarchy).toEqual([basename(directory), 'duplicate', 'shared'])
  expect(shared[1].hierarchy).toEqual(shared[0].hierarchy)
  expect(shared[0]).not.toBe(shared[1])
})
test('keeps concurrently interleaved iterators independent', async () => {
  await writeBranchingWorkspace()
  const forward = traverseWorkspace.async(directory)
  const backwards = traverseWorkspace.asyncBackwards(directory)
  expect(await forward.next()).toMatchObject({
    done: false,
    value: {name: 'root'},
  })
  expect(await backwards.next()).toMatchObject({
    done: false,
    value: {name: 'leaf'},
  })
  const [forwardRest, backwardsRest] = await Promise.all([collect(forward), collect(backwards)])
  expect(forwardRest.map(entry => entry.name)).toEqual(['a', 'one', 'leaf', 'two', 'b'])
  expect(backwardsRest.map(entry => entry.name)).toEqual(['one', 'two', 'a', 'b', 'root'])
})
test.each(['async', 'asyncBackwards'] as const)('%s rejects invalid inputs and malformed root manifests during iteration', async method => {
  await expect(traverseWorkspace[method]('').next()).rejects.toThrow(TypeError)
  await expect(traverseWorkspace[method](undefined as never).next()).rejects.toThrow(TypeError)
  await expect(traverseWorkspace[method](join(directory, 'missing')).next()).rejects.toThrow()
  const manifestPath = join(directory, 'package.json')
  await fs.writeFile(manifestPath, '{invalid')
  await expect(traverseWorkspace[method](directory).next()).rejects.toThrow(manifestPath)
})
test('asyncBackwards supports deleting every yielded package directory', async () => {
  await writeBranchingWorkspace()
  const visited: Array<string | undefined> = []
  for await (const entry of traverseWorkspace.asyncBackwards(directory)) {
    visited.push(entry.name)
    expect(await fs.pathExists(join(entry.folder, 'package.json'))).toBe(true)
    await fs.remove(entry.folder)
  }
  expect(visited).toEqual(['leaf', 'one', 'two', 'a', 'b', 'root'])
  expect(await fs.pathExists(directory)).toBe(false)
})
test('asyncBackwards skips overlapping matches already removed by the consumer', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/**'],
  })
  await writePackage('packages/a', {
    name: 'a',
    workspaces: ['children/*'],
  })
  await writePackage('packages/a/children/leaf', {name: 'leaf'})
  const visited: Array<string | undefined> = []
  for await (const entry of traverseWorkspace.asyncBackwards(directory)) {
    visited.push(entry.name)
    await fs.remove(entry.folder)
  }
  expect(visited).toEqual(['leaf', 'a', 'root'])
  expect(await fs.pathExists(directory)).toBe(false)
})
test('skips a discovered child whose manifest disappears before its turn', async () => {
  await writePackage('.', {
    name: 'root',
    workspaces: ['packages/*'],
  })
  await writePackage('packages/a', {name: 'a'})
  const b = await writePackage('packages/b', {name: 'b'})
  const iterator = traverseWorkspace.asyncBackwards(directory)
  expect(await iterator.next()).toMatchObject({
    done: false,
    value: {name: 'a'},
  })
  await fs.remove(join(b, 'package.json'))
  const remaining = await collect(iterator)
  expect(remaining.map(entry => entry.name)).toEqual(['root'])
})
