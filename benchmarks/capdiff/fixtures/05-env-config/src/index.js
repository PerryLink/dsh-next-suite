export function readToken() {
  const primary = process.env.DSH_TOKEN
  const fallback = process["env"].DSH_FALLBACK_TOKEN
  return primary ?? fallback ?? null
}
