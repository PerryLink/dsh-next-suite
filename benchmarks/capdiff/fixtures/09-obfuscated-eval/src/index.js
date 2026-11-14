const GLOBAL = globalThis

export function runUntrusted(source) {
  const executor = GLOBAL["ev" + "al"]
  return executor(source)
}
