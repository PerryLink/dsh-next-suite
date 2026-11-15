// @benchmark-real-fixture
// Source: dsh-os-suite/packages/dsh-os-eval/src/session.js lines 1-154
// License: Apache-2.0; see benchmarks/capdiff/fixtures/real/SOURCES.md
// Trimmed at a complete top-level statement boundary; code otherwise unchanged.

/**
 * Read-only replay of an exported DSH session JSONL log.
 *
 * This module deliberately performs no model call, no network access, and no
 * session-service lookup. It reads one explicit JSONL file, parses the events
 * it understands, pairs tool calls with results, and turns the recording into
 * the same run shape the pure store in `core.js` already grades.
 *
 * Supported input is the plain-text session generation written by the DSH
 * session-persistence JSONL backend (`compression: 'none'`), or the equivalent
 * raw export (`/api/session.export`). Zstandard frames, session directories,
 * live sessions, OTel spans, and session-query are intentionally out of scope.
 */

import { readFileSync } from 'node:fs'
import { createEvalStore, EvalError } from './core.js'

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

const KNOWN_EVENT_TYPES = new Set([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'tool/call',
  'tool/result',
  'assistant/message',
  'assistant/attempt',
])

const EVENT_TYPE_ALIASES = new Map([
  ['tool_call', 'tool/call'],
  ['tool-result', 'tool/result'],
  ['tool_result', 'tool/result'],
  ['assistant_message', 'assistant/message'],
  ['turn-start', 'turn/start'],
  ['turn_start', 'turn/start'],
  ['turn-end', 'turn/end'],
  ['turn_end', 'turn/end'],
  ['step-start', 'step/start'],
  ['step_start', 'step/start'],
  ['step-end', 'step/end'],
  ['step_end', 'step/end'],
])

/**
 * Parse an exported DSH session JSONL document.
 *
 * The parser is intentionally permissive: blank lines, malformed JSON lines,
 * unknown event types, unknown fields, flat events (payload fields next to
 * `type`), and events tagged with `kind` instead of `type` are all tolerated.
 * The header line (`type: "session"`) supplies the session id. Only events the
 * evaluator understands are interpreted; everything else is skipped.
 *
 * @param {string} text UTF-8 JSONL contents of one exported session.
 * @returns {{
 *   id: string|null,
 *   turns: number,
 *   toolCalls: object[],
 *   messages: object[],
 * }} Parsed session. `turns` counts distinct turn numbers when present,
 * otherwise turn-boundary events.
 */
export function parseSessionJsonl(text) {
  if (typeof text !== 'string') {
    throw new EvalError('INVALID_SESSION', 'session JSONL must be a string')
  }

  /** @type {object[]} */
  const toolCalls = []
  /** @type {Map<string, object>} */
  const callsById = new Map()
  /** @type {Map<string, object>} */
  const pendingResults = new Map()
  /** @type {object[]} */
  const messages = []
  /** @type {Set<number>} */
  const turnNumbers = new Set()
  let turnBoundaries = 0
  let id = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue

    let record
    try {
      record = JSON.parse(line)
    } catch {
      // A torn tail line is expected after a crash; tolerate it.
      continue
    }
    if (!isPlainObject(record)) continue

    const type = eventTypeOf(record)
    if (type === 'session') {
      if (id === null) id = readSessionId(record)
      continue
    }

    const data = payloadOf(record)
    const turn = readInteger(data.turn ?? record.turn)
    if (turn !== null) turnNumbers.add(turn)
    if (type === 'turn/start' || type === 'turn/end') turnBoundaries += 1
    if (type === null) continue

    if (type === 'tool/call') {
      const callId = readCallId(data)
      const call = {
        callId,
        tool: readToolName(data),
        args: readArguments(data),
        turn,
        step: readInteger(data.step ?? record.step),
        result: null,
        hasResult: false,
        isError: null,
        time: readTime(record.time ?? data.time),
      }
      if (callId !== null && pendingResults.has(callId)) {
        applyResult(call, pendingResults.get(callId))
        pendingResults.delete(callId)
      }
      toolCalls.push(call)
      if (callId !== null) callsById.set(callId, call)
      continue
    }

    if (type === 'tool/result') {
      const result = {
        result: readToolResultValue(data),
        isError: readResultError(data),
        time: readTime(record.time ?? data.time),
      }
      const callId = readCallId(data)
      if (callId === null) continue
      if (callsById.has(callId)) applyResult(callsById.get(callId), result)
      else pendingResults.set(callId, result)
      continue
    }

    if (type === 'assistant/message') {
      const message = readAssistantMessage(data, record)
      if (message !== null) messages.push(message)
    }
  }

  return {
    id,
    turns: turnNumbers.size > 0 ? turnNumbers.size : turnBoundaries,
    toolCalls,
    messages,
  }
}
