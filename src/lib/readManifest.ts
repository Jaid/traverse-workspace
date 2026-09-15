import type {PackageJson} from 'type-fest'

import fs from 'fs-extra'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonemptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export const readManifest = async (manifestPath: string, optional: boolean): Promise<{
  manifest: PackageJson
  patterns: Array<string>
} | undefined> => {
  let manifest: unknown
  try {
    manifest = await fs.readJson(manifestPath)
  } catch (error) {
    if (optional && Error.isError(error) && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return
    }
    throw new Error(`Failed to read package manifest “${manifestPath}”.`, {cause: error})
  }
  if (!isRecord(manifest)) {
    throw new TypeError(`Expected a JSON object in “${manifestPath}”.`)
  }
  if (manifest.name !== undefined && !isNonemptyString(manifest.name)) {
    throw new TypeError(`Expected a nonempty package name in “${manifestPath}”.`)
  }
  const {workspaces} = manifest
  let patterns: unknown = []
  if (workspaces !== undefined) {
    if (Array.isArray(workspaces)) {
      patterns = workspaces
    } else if (isRecord(workspaces)) {
      patterns = workspaces.packages === undefined ? [] : workspaces.packages
    } else {
      throw new TypeError(`Expected workspaces to be an array or an object in “${manifestPath}”.`)
    }
  }
  if (!Array.isArray(patterns) || !patterns.every(isNonemptyString)) {
    throw new TypeError(`Expected workspace patterns to be nonempty strings in “${manifestPath}”.`)
  }
  return {
    manifest: manifest as PackageJson,
    patterns,
  }
}
