import type {PackageJson} from 'type-fest'

export type Packages = Array<Package>

export type Package = {
  /** absolute package directory, using forward slashes */
  folder: string
  /** package names from the starting package to this package, with directory basenames as fallbacks */
  hierarchy: Array<string>
  /** child workspaces, omitted for leaves and iterator entries */
  packages?: Packages
} & Pick<PackageJson, 'dependencies' | 'devDependencies' | 'name' | 'optionalDependencies' | 'peerDependencies' | 'peerDependenciesMeta' | 'private' | 'version' | 'workspaces'>

export type Output = Packages
