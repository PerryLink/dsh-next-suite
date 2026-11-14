export async function loadPluginData(path) {
  const fs = await import("node:fs/promises")
  return fs.readFile(path, "utf8")
}
