// @benchmark-real-fixture
// Source: deepseek-harness/docs/cookbook/adding-a-tool.md lines 9-37 (fenced ts block)
// License: MIT; see benchmarks/capdiff/fixtures/real/SOURCES.md
// TypeScript annotations stripped to JavaScript; imports and calls preserved.

import { readFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',          // what the model sees
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path' },
      limit: { type: 'number' },                     // optional by default
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      // args is TYPED from the schema: { path: string; limit?: number }
      // exec carries immutable identity + token; signal is the operational field
      // A production tool converts errno failures such as ENOENT into FsError codes
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}
