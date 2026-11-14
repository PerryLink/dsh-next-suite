/**
 * Lab 1 starter: a minimal DeepSeek Harness / Cordis plugin.
 *
 * A Cordis plugin is a module that exports `name` (and optionally `inject`)
 * and an `apply(ctx)` function. Declaring `inject = ['tools']` tells the
 * loader to wait until the tool registry exists before calling `apply`.
 *
 * This file intentionally has no third-party imports so the lab runs offline.
 * The raw tool definition below has the same shape produced by
 * `defineTool()` from `@deepseek-ai/dsh-tools`, except that argument
 * validation is written by hand. In a real plugin prefer defineTool, which
 * also validates arguments before `execute` runs.
 */

export const name = 'dsh-hello-plugin'

/** Wait for the tool registry before `apply` is called. */
export const inject = ['tools']

/**
 * The canonical tool definition registered with `ctx.tools.register`.
 *
 * DSH passes `parameters` to the model as JSON Schema, calls `execute` with
 * validated arguments, and uses `output.render` to turn the returned string
 * into model-facing content.
 */
export const greetTool = {
  name: 'greet',
  description: 'Greet someone by name.',

  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The name to greet, for example "Ada".',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },

  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  },

  /**
   * @param {{ name?: unknown }} args
   * @returns {Promise<string>}
   */
  async execute(args) {
    if (typeof args?.name !== 'string' || args.name.trim() === '') {
      throw new Error('greet: "name" must be a non-empty string')
    }
    return `Hello, ${args.name}!`
  },
}

/**
 * Register the tool. The disposer returned by `register` is owned by the
 * Cordis context, so unloading the plugin unregisters `greet` automatically.
 *
 * @param {{ tools: { register(definition: object): () => void } }} ctx
 * @returns {() => void}
 */
export function apply(ctx) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.tools?.register !== 'function') {
    throw new TypeError(
      'dsh-hello-plugin requires ctx.tools.register(); declare `export const inject = [\'tools\']`',
    )
  }
  return ctx.tools.register(greetTool)
}
