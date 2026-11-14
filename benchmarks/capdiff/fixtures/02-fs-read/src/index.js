import { readFile } from "node:fs/promises"

export async function loadConfig(path) {
  const text = await readFile(path, "utf8")
  return JSON.parse(text)
}
