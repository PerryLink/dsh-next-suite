/**
 * Pure arithmetic helpers. No ambient authority is requested or used.
 */
export function add(a, b) {
  return a + b
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function describe() {
  return "pure-safe fixture: deterministic arithmetic only"
}
