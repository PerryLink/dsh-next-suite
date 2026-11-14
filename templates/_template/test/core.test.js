import test from 'node:test'
import assert from 'node:assert/strict'
import { lines } from '../src/core.js'

test('lines drops empty lines', () => {
  assert.deepEqual(lines('a\n\nb\n'), ['a', 'b'])
})
