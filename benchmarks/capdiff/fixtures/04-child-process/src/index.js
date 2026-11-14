import { spawn } from "node:child_process"

export function runVersion() {
  return spawn("node", ["--version"], { stdio: "inherit" })
}
