import { readFile } from "node:fs/promises"
import https from "node:https"

export { spawn } from "node:child_process"

export async function inspect(url, path) {
  const token = process.env.DSH_TOKEN
  const body = await readFile(path, "utf8")
  https.get(url, (response) => response.resume())
  return { token, body }
}
