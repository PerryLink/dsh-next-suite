/**
 * Lab 1 check: exercise the plugin without DSH or Cordis installed.
 *
 * Fake ctx is deliberately small: `tools.register` captures the definition and
 * returns a disposer. If the real API changes, this test fails before students
 * lose time debugging a profile boot.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, greetTool, inject, name } from '../index.js'

/**
 * @returns {{
 *   registered: object[],
 *   tools: { register(definition: object): () => void },
 * }}
 */
function createFakeCtx() {
  /** @type {object[]} */
  const registered = []
  return {
    registered,
    tools: {
      register(definition) {
        registered.push(definition)
        return () => {
          const index = registered.indexOf(definition)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
  }
}

test('exports the Cordis plugin identity', () => {
  assert.equal(name, 'dsh-hello-plugin')
  assert.deepEqual(inject, ['tools'])
})

test('apply registers one greet tool and returns a working disposer', () => {
  const ctx = createFakeCtx()
  const dispose = apply(ctx)

  assert.equal(ctx.registered.length, 1)
  assert.equal(ctx.registered[0].name, 'greet')
  assert.equal(typeof dispose, 'function')

  dispose()
  assert.deepEqual(ctx.registered, [])
})

test('greet schema requires a non-empty string name', () => {
  assert.equal(greetTool.name, 'greet')
  assert.equal(greetTool.parameters.type, 'object')
  assert.deepEqual(greetTool.parameters.required, ['name'])
  assert.equal(greetTool.parameters.additionalProperties, false)
  assert.equal(greetTool.parameters.properties.name.type, 'string')
  assert.match(greetTool.parameters.properties.name.description, /name/i)

  assert.equal(greetTool.output.schema.type, 'string')
  assert.equal(typeof greetTool.output.render, 'function')
  assert.equal(typeof greetTool.execute, 'function')
})

test('execute returns "Hello, <name>!"', async () => {
  const result = await greetTool.execute({ name: 'Ada' })
  assert.equal(result, 'Hello, Ada!')
})

test('execute rejects a missing or blank name', async () => {
  await assert.rejects(() => greetTool.execute({}), /non-empty string/)
  await assert.rejects(() => greetTool.execute({ name: '   ' }), /non-empty string/)
})

test('output.render converts the canonical value to text content', () => {
  const content = greetTool.output.render({ name: 'Ada' }, 'Hello, Ada!')
  assert.deepEqual(content, [{ type: 'text', text: 'Hello, Ada!' }])
})
