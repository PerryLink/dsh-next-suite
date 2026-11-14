/**
 * Pure core for NAME.
 * No third-party imports: testable with `node --test`.
 */

/**
 * @param {string} text
 * @returns {string[]}
 */
export function lines(text) {
  return String(text).split(/\r?\n/).filter(Boolean)
}
