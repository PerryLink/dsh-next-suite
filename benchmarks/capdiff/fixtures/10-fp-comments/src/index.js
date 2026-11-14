// Historical note: an older revision used import fs from "node:fs".
// The design review asked us to remove it; the code below is the replacement.
/*
 * Rejected prototype:
 *   import { exec } from "node:child_process"
 *   const token = process.env.DSH_TOKEN
 *   eval(payload)
 */
export function status() {
  return "no ambient authority; comments only"
}
