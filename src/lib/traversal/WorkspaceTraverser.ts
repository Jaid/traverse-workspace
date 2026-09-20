import type {Package, Packages} from '../../types.ts'

import {basename, join, resolve} from 'forward-slash-path'
import fs from 'fs-extra'
import {globby} from 'globby'

import {readManifest} from '../readManifest.ts'

const manifestFields = ['name', 'workspaces', 'private', 'version', 'peerDependencies', 'peerDependenciesMeta', 'dependencies', 'devDependencies', 'optionalDependencies'] as const

export class WorkspaceTraverser {
  readonly #activeFolders = new Set<string>

  async *iterate(folder: string, inward = false): AsyncGenerator<Package, void, unknown> {
    yield* this.#visitPackages([folder], [], inward, false)
  }

  async traverse(folder: string): Promise<Packages> {
    const packages: Packages = []
    const ancestors: Packages = []
    for await (const entry of this.iterate(folder)) {
      const depth = entry.hierarchy.length
      if (depth === 1) {
        packages.push(entry)
      } else {
        const parent = ancestors[depth - 2]
        parent.packages ??= []
        parent.packages.push(entry)
      }
      ancestors.length = depth - 1
      ancestors.push(entry)
    }
    return packages
  }

  async #getChildFolders(folder: string, patterns: Array<string>): Promise<Array<string>> {
    const positivePatterns: Array<string> = []
    const ignore = ['**/node_modules', '**/node_modules/**', '**/.git', '**/.git/**']
    for (const pattern of patterns) {
      const isExclusion = pattern.startsWith('!') && !pattern.startsWith('!(')
      const workspacePattern = (isExclusion ? pattern.slice(1) : pattern).replace(/\/+$/, '')
      if (isExclusion) {
        // Globby applies negative patterns sequentially. Using ignore keeps workspace exclusions order-independent.
        ignore.push(workspacePattern, `${workspacePattern}/**`)
      } else {
        positivePatterns.push(pattern)
      }
    }
    const matches = await globby(positivePatterns, {
      cwd: folder,
      absolute: true,
      dot: true,
      expandDirectories: false,
      followSymbolicLinks: false,
      ignore,
      onlyDirectories: false,
      onlyFiles: false,
    })
    const packageFolders = await Promise.all(matches.map(async match => {
      const candidate = resolve(match)
      return await fs.pathExists(join(candidate, 'package.json')) ? candidate : undefined
    }))
    return [...new Set(packageFolders.filter(packageFolder => packageFolder !== undefined))].toSorted((left, right) => left.localeCompare(right, 'en'))
  }

  async *#visitPackages(folders: Array<string>, parentHierarchy: Array<string>, inward: boolean, optional: boolean): AsyncGenerator<Package, void, unknown> {
    const seenFolders = new Set<string>
    for (const folder of folders) {
      let realFolder: string
      try {
        realFolder = await fs.realpath(folder)
      } catch (error) {
        // A consumer may delete a package before a later alias or overlapping match is reached.
        if (optional && Error.isError(error) && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
          continue
        }
        throw error
      }
      if (this.#activeFolders.has(realFolder) || seenFolders.has(realFolder)) {
        continue
      }
      seenFolders.add(realFolder)
      const manifestPath = join(folder, 'package.json')
      const loaded = await readManifest(manifestPath, optional)
      if (!loaded) {
        continue
      }
      const {manifest} = loaded
      const hierarchy = [...parentHierarchy, manifest.name ?? basename(folder)]
      // Keep traversal state independent of mutations to yielded metadata.
      const patterns = [...loaded.patterns]
      const entry: Package = {
        folder,
        hierarchy: [...hierarchy],
        ...Object.fromEntries(manifestFields.filter(field => Object.hasOwn(manifest, field)).map(field => [field, manifest[field]])),
      }
      this.#activeFolders.add(realFolder)
      try {
        if (!inward) {
          yield entry
        }
        if (patterns.length) {
          const childFolders = await this.#getChildFolders(folder, patterns)
          yield* this.#visitPackages(childFolders, hierarchy, inward, true)
        }
        if (inward) {
          yield entry
        }
      } finally {
        this.#activeFolders.delete(realFolder)
      }
    }
  }
}
