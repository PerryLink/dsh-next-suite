import { readFile } from "node:fs/promises"

export async function readManifest(path) {
  return JSON.parse(await readFile(path, "utf8"))
}
