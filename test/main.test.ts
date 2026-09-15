import {expect, test} from 'bun:test'

const {default: traverseWorkspace} = await import('#src/main.ts')

test('should run', () => {
  const result = traverseWorkspace()
  expect(result).toBe('traverse-workspace') // TODO Test actual functionality
})
