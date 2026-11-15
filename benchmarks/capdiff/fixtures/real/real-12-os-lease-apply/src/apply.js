// @benchmark-real-fixture
// Source: dsh-os-suite/packages/dsh-os-lease/src/apply.js lines 1-126
// License: Apache-2.0; see benchmarks/capdiff/fixtures/real/SOURCES.md
// Trimmed at a complete top-level statement boundary; code otherwise unchanged.

/**
 * Filesystem applier for dsh-os-lease patchsets.
 *
 * `core.js` records *intent* only. This module is the opt-in executor: it
 * writes a prepared patchset under one explicit `root`, keeps a recoverable
 * journal of the pre-images, and can put the tree back the way it was.
 *
 * Safety model
 * ------------
 * - Every target path is normalized by `core.normalizePath` (no absolute
 *   paths, no drive letters, no `.`/`..` segments) and then re-checked to be
 *   inside the canonical `root`.
 * - Symbolic links anywhere on the target chain are refused. A link that
 *   points outside `root` is reported as PATH_ESCAPE; a link that points
 *   inside is still refused, because renaming over a link would replace the
 *   link rather than the file the caller meant to edit.
 * - Each file is written to a sibling temporary file, fsynced, then renamed
 *   over the target. A failure mid-apply triggers a best-effort restore of the
 *   entries already journaled.
 * - Concurrent applies that touch the same normalized path are excluded with
 *   `fs.open(path, 'wx')` lock files. Locks are local to one filesystem host;
 *   they are not distributed locks.
 *
 * The journal lives at `<root>/.dsh-os-lease/journal/<id>/journal.json`, with
 * pre-images in `<root>/.dsh-os-lease/journal/<id>/backups/`. The manifest
 * never stores file bodies; the backups do.
 */

import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { normalizePath } from './core.js'

export const STATE_DIRNAME = '.dsh-os-lease'
export const JOURNAL_DIRNAME = 'journal'
export const LOCK_DIRNAME = 'locks'
export const JOURNAL_FILE = 'journal.json'
export const JOURNAL_VERSION = 1

/** Stable machine-readable error codes for filesystem operations. */
export const APPLY_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_ROOT: 'INVALID_ROOT',
  INVALID_PATH: 'INVALID_PATH',
  RESERVED_PATH: 'RESERVED_PATH',
  PATH_ESCAPE: 'PATH_ESCAPE',
  SYMLINK_NOT_ALLOWED: 'SYMLINK_NOT_ALLOWED',
  NOT_A_FILE: 'NOT_A_FILE',
  DUPLICATE_PATH: 'DUPLICATE_PATH',
  ALREADY_APPLIED: 'ALREADY_APPLIED',
  LOCKED: 'LOCKED',
  LOCK_FAILED: 'LOCK_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  JOURNAL_CORRUPT: 'JOURNAL_CORRUPT',
  BACKUP_MISSING: 'BACKUP_MISSING',
  BEFORE_MISMATCH: 'BEFORE_MISMATCH',
  FS_ERROR: 'FS_ERROR',
  WRITE_FAILED: 'WRITE_FAILED',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
})

/**
 * Error thrown by the applier. `code` is intended for callers; `details` is
 * plain JSON and may carry the journal path and per-path failures.
 */
export class ApplyError extends Error {
  /**
   * @param {string} code One of {@link APPLY_ERROR_CODES}.
   * @param {string} message Human-readable explanation.
   * @param {Record<string, unknown>} [details] Optional structured context.
   */
  constructor(code, message, details) {
    super(message)
    this.name = 'ApplyError'
    /** @type {string} */
    this.code = code
    if (details !== undefined) {
      /** @type {Record<string, unknown>} */
      this.details = details
    }
  }
}

/** @param {unknown} error */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** @param {string | Buffer | Uint8Array} data */
function hashBytes(data) {
  return createHash('sha256').update(data).digest('hex')
}

/** @param {string} relativePath */
function lockFileName(relativePath) {
  return `${hashBytes(Buffer.from(relativePath, 'utf8'))}.lock`
}

/**
 * @param {string} root Canonical absolute root.
 * @param {string} candidate Absolute path to test.
 */
function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/**
 * @param {string} root
 * @param {string} candidate
 * @param {Record<string, unknown>} [details]
 */
function assertInsideRoot(root, candidate, details) {
  if (!isInsideRoot(root, candidate)) {
    throw new ApplyError(
      APPLY_ERROR_CODES.PATH_ESCAPE,
      `path "${candidate}" escapes root "${root}"`,
      { root, path: candidate, ...details },
    )
  }
}
