import type {Package, Packages} from '../../types.ts'

import {basename, dirname, join, resolve} from 'forward-slash-path'
import fs from 'fs-extra'
import {glob} from 'tinyglobby'

import {readManifest} from '../readManifest.ts'

const manifestFields = ['name', 'workspaces', 'private', 'version', 'peerDependencies', 'peerDependenciesMeta', 'dependencies', 'devDependencies', 'optionalDependencies'] as const

export class WorkspaceTraverser {
  readonly #activeFolders = new Set<string>

  async *iterate(folder: string, backwards = false): AsyncGenerator<Package, void, unknown> {
    yield* this.#visitPackages([folder], [], backwards, false)
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
    // Match manifests directly so directory symlinks are included.
    const manifestPatterns = patterns.flatMap(pattern => {
      const manifestPattern = `${pattern.replace(/\/+$/, '')}/package.json`
      // Preserve directory exclusions to prune their descendants too.
      return pattern.startsWith('!') && !pattern.startsWith('!(') ? [pattern, manifestPattern] : [manifestPattern]
    })
    const matches = await glob(manifestPatterns, {
      cwd: folder,
      absolute: true,
      dot: true,
      expandDirectories: false,
      onlyFiles: true,
      followSymbolicLinks: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    })
    return [...new Set(matches.map(match => dirname(resolve(match))))].toSorted((left, right) => left.localeCompare(right, 'en'))
  }

  async *#visitPackages(folders: Array<string>, parentHierarchy: Array<string>, backwards: boolean, optional: boolean): AsyncGenerator<Package, void, unknown> {
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
        if (!backwards) {
          yield entry
        }
        if (patterns.length) {
          const childFolders = await this.#getChildFolders(folder, patterns)
          yield* this.#visitPackages(childFolders, hierarchy, backwards, true)
        }
        if (backwards) {
          yield entry
        }
      } finally {
        this.#activeFolders.delete(realFolder)
      }
    }
  }
}
