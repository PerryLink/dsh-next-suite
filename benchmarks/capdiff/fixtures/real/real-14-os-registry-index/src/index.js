// @benchmark-real-fixture
// Source: dsh-os-suite/packages/dsh-os-registry/src/index.js lines 1-88
// License: Apache-2.0; see benchmarks/capdiff/fixtures/real/SOURCES.md
// Trimmed at a complete top-level statement boundary; code otherwise unchanged.

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRegistry, DEFAULT_TTL_MS, RegistryError } from './core.js'

export const name = 'dsh-os-registry'
export const inject = ['tools']

/** Default owner for tool calls that do not name one. */
const DEFAULT_OWNER = 'agent'

const serviceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: 'Registry-local service id' },
    name: { type: 'string', required: true, description: 'Human-readable service name' },
    port: { type: 'integer', required: true, description: 'Allocated TCP port' },
    url: { type: 'string', required: true, description: 'Derived local URL' },
    owner: { type: 'string', required: true, description: 'Owner of the lease' },
    pid: { type: 'integer', description: 'Optional dev-server process id' },
    health: {
      type: 'string',
      required: true,
      enum: ['unknown', 'ok', 'down'],
      description: 'Last observed health',
    },
    ttlMs: { type: 'number', required: true, description: 'Lease duration in ms' },
    expiresAt: { type: 'number', required: true, description: 'Expiry timestamp in ms' },
    createdAt: { type: 'number', required: true, description: 'Registration timestamp in ms' },
  },
}

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true, description: 'Stable error code' },
    message: { type: 'string', required: true, description: 'Human-readable error message' },
  },
}

const registerOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    service: serviceSchema,
    error: errorSchema,
  },
}

const listOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    services: { type: 'array', items: serviceSchema },
    error: errorSchema,
  },
}

const stopOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    released: { type: 'boolean', description: 'Whether an active lease was removed' },
    error: errorSchema,
  },
}

/**
 * Convert a thrown error into a structured tool result.
 *
 * @param {unknown} error
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function failure(error) {
  if (error instanceof RegistryError) {
    return { ok: false, error: { code: error.code, message: error.message } }
  }
  return {
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}
