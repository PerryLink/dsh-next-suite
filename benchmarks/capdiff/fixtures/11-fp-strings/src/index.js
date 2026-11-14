export const DOC = `
Rejected examples kept as documentation:
  import fs from "node:fs"
  const cp = require("node:child_process")
  process.env.DSH_TOKEN
  eval(payload)
`

export const SNIPPETS = [
  "import https from 'node:https'",
  'new Function("return 1")',
]

export function docs() {
  return { DOC, SNIPPETS }
}
