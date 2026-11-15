// @benchmark-real-fixture
// Source: deepseek-harness/docs/user/develop/practice/llm-adapter.md lines 158-189 (fenced ts block)
// License: MIT; see benchmarks/capdiff/fixtures/real/SOURCES.md
// TypeScript annotations stripped to JavaScript; imports and calls preserved.
// `private readonly endpoint` becomes an explicit field assigned in the constructor.

import { attributionHeaders, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'

class HttpAdapter extends LlmAdapter {
  constructor(endpoint) {
    super()
    this.endpoint = endpoint
  }

  async *stream(options) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...attributionHeaders(),
      },
      body: JSON.stringify({ model: options.model, messages: options.messages }),
      ...options.signal ? { signal: options.signal } : {},
    })
    if (!response.ok) {
      throw LlmError.fromFailure({ message: `Provider API error: ${response.status}`, code: 'PROVIDER_HTTP_ERROR', status: response.status })
    }
    // A real adapter parses the response and emits the complete chunk sequence.
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
