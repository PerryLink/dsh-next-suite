const { execFile } = require("node:child_process")

module.exports = function run(command) {
  return execFile(command, { encoding: "utf8" })
}
