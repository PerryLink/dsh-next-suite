import path from "node:path"
import { helper } from "./helper.js"

export function assetPath(root, name) {
  return helper(path.join(root, "assets", name))
}
