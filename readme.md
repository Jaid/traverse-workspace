# traverse-workspace

Build a recursive array tree of packages from their `package.json` workspace declarations, or stream individual packages with async iterators. An ESM TypeScript library for Bun.

## Usage

```typescript
import traverseWorkspace from 'traverse-workspace'

const [root] = await traverseWorkspace('C:/projects/example-workspace')

console.log(root.name) // example-workspace
console.log(root.folder) // C:/projects/example-workspace
console.log(root.hierarchy) // ['example-workspace']
console.log(root.packages?.find(entry => entry.name === 'package-a'))
```

The result has this shape, with additional manifest metadata preserved when present:

```typescript
[
  {
    name: 'example-workspace',
    folder: 'C:/projects/example-workspace',
    hierarchy: ['example-workspace'],
    workspaces: ['packages/*'],
    private: true,
    packages: [
      {
        name: 'package-a',
        folder: 'C:/projects/example-workspace/packages/package-a',
        hierarchy: ['example-workspace', 'package-a'],
      },
    ],
  },
]
```

All APIs accept either a package folder or its `package.json` file. Relative paths are resolved against the current working directory. Traversal starts at the supplied package and does not search upward for a workspace root.

## Tree API

```typescript
import traverseWorkspace from 'traverse-workspace'
import type {Output, Package, Packages} from 'traverse-workspace'

const output: Output = await traverseWorkspace('./package.json')
```

`traverseWorkspace(input: string): Promise<Output>` returns an array containing the starting package. Each package’s own workspace declarations determine its immediate children, recursively. Both the top-level result and every `packages` collection are arrays. Duplicate package names are preserved without renaming or collision errors.

The exported types are:

```typescript
import type {PackageJson} from 'type-fest'

type Packages = Array<Package>

type Package = {
  folder: string
  hierarchy: Array<string>
  packages?: Packages
} & Pick<PackageJson, 'name' | 'workspaces' | 'private' | 'version' | 'peerDependencies' | 'peerDependenciesMeta' | 'dependencies' | 'devDependencies' | 'optionalDependencies'>

type Output = Packages
```

`folder` is always the absolute package directory, with forward slashes and no unnecessary trailing separator. There is no `path` field.

`name` is copied only when present in the manifest. `hierarchy` contains the package names from the starting package through the current package, falling back to the respective directory basename for each unnamed package. For example, an unnamed `tools` workspace inside `example-workspace` has `hierarchy: ['example-workspace', 'tools']`, but no invented `name` property. Scoped names such as `@example/package-a` remain one hierarchy element. A hierarchy is descriptive, not a unique identifier: duplicate names can produce equal hierarchies for different folders.

Only the listed manifest fields are copied, and only when present. Their values are preserved without resolving dependency versions or modifying workspace declarations. Leaf packages omit `packages` rather than returning an empty array.

## Flat paths

`traverseWorkspace.flat(input)` returns `Promise<Array<string>>` containing the absolute package folders in the same parent-first depth-first order as `async`.

`traverseWorkspace.flatInward(input)` returns the same folders in the same child-first postorder as `asyncInward`.

```typescript
const folders = await traverseWorkspace.flat('./package.json')
const inwardFolders = await traverseWorkspace.flatInward('./package.json')
```

## Async iterators

```typescript
for await (const entry of traverseWorkspace.async('./package.json')) {
  console.log(entry.hierarchy, entry.folder)
}

for await (const entry of traverseWorkspace.asyncInward('./package.json')) {
  console.log(entry.hierarchy, entry.folder)
}
```

Both methods return `AsyncGenerator<Package, void, unknown>` directly. Do not await the method call before the loop. Iterator entries contain `folder`, `hierarchy` and the selected manifest fields, but always omit `packages`; descendants are yielded separately. The starting package is included.

| Method | Traversal order |
| --- | --- |
| `traverseWorkspace.async(input)` | Depth-first preorder: each parent before its descendants. |
| `traverseWorkspace.asyncInward(input)` | Depth-first postorder: all descendants of a package before that package. |

For a root containing `a` and `b`, where `a` contains `leaf`, `async` yields `root → a → leaf → b`; `asyncInward` yields `leaf → a → b → root`. Both preserve the same folder-sorted sibling order. Inward traversal is child-first, not a global depth sort or a reversal of the entire forward sequence.

The iterators perform no filesystem access until iteration starts. They read package manifests on demand and do not construct or retain the complete tree. Workspace matches are discovered and sorted per parent. Forward traversal yields the parent before discovering its children; inward traversal walks the current branch before yielding its parent, without eagerly reading unrelated sibling manifests. Breaking the loop stops traversal and releases the active branch state. Yielded entries are never populated or mutated later by the library.

Inward traversal supports removing each yielded package folder because its declared descendants have already been visited. Discovered children that disappear during processing are skipped. Ordering follows workspace declarations, not dependency relationships or undeclared physical folder nesting. Workspace patterns can reference folders outside the starting package, and a shared package can occur under multiple branches, so check the folders and declarations before performing destructive operations.

## Workspace discovery

Both `workspaces: ['packages/*']` and `workspaces: {packages: ['packages/*'], nohoist: ['**/react']}` are supported. In the object form, only `packages` controls discovery; the original object is preserved in the output.

Patterns are relative to the declaring package’s directory. Literal directories, globstars, brace expansion, extglobs and `!` exclusions are supported. Use forward slashes in glob patterns, including on Windows. Exclusions apply regardless of their order in the array. A literal directory selects that package, not all of its descendants; deeper traversal requires its own workspace declarations or an explicitly recursive glob.

Discovery includes hidden directories but excludes `node_modules` and `.git`. Unmatched patterns and directories without a `package.json` are skipped. Dependencies are metadata, not additional traversal edges. No lockfile, installed dependencies or package manager configuration is required in the workspace being inspected.

Overlapping patterns and directory aliases are deduplicated within each parent using real filesystem paths, not package names. Directory symlinks and Windows junctions are supported. References to the current package or an ancestor are skipped to prevent cycles. A shared package referenced by independent branches remains present in both branches, with a branch-specific hierarchy. Discovered folders are sorted before traversal.

## Errors

Missing root paths or root manifests, malformed JSON, invalid package names and invalid workspace declarations reject the tree promise or the iterator’s next request. Read and parse errors identify the manifest path and retain the original error as `cause`.

Traversal itself is read-only, and each call or iterator has independent state. Consumers may modify the filesystem between yielded entries; no snapshot of the entire workspace is taken.

## Development

```sh
bun install
bun run test
bun run typecheck
bun run lint
```
