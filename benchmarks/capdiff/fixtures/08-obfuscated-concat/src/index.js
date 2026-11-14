const MODULE_PREFIX = "node:"
const MODULE_NAME = "fs"

export async function load(path) {
  const specifier = MODULE_PREFIX + MODULE_NAME
  const fs = await import(specifier)
  return fs.readFile(path, "utf8")
}
