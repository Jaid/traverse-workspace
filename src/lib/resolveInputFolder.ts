import {basename, dirname, resolve} from 'forward-slash-path'
import fs from 'fs-extra'

export const resolveInputFolder = async (input: string): Promise<string> => {
  if (typeof input !== 'string' || !input.length) {
    throw new TypeError('Expected a package directory or package.json file path.')
  }
  const inputPath = resolve(input)
  const stats = await fs.stat(inputPath)
  if (stats.isDirectory()) {
    return inputPath
  }
  const filename = basename(inputPath)
  if (!stats.isFile() || (process.platform === 'win32' ? filename.toLowerCase() : filename) !== 'package.json') {
    throw new TypeError(`Expected a package directory or package.json file, received “${inputPath}”.`)
  }
  return dirname(inputPath)
}
