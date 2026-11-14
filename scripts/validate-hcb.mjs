import { readFileSync } from 'node:fs'
const p = new URL('../data/hcb/matrix.csv', import.meta.url)
const lines = readFileSync(p, 'utf8').trim().split(/\r?\n/)
const header = lines.shift().split(',')
if (header.join(',') !== 'package,version,host,node,install_ok,dump_config_ok,tests_pass,tests_total,license,repo,date') {
  throw new Error('unexpected HCB header')
}
let n = 0
for (const line of lines) {
  const cols = line.split(',')
  if (cols.length !== header.length) throw new Error(`bad column count: ${line}`)
  if (!/^\d+\.\d+\.\d+/.test(cols[1])) throw new Error(`bad version: ${cols[0]}`)
  if (Number(cols[6]) > Number(cols[7])) throw new Error(`tests pass > total: ${cols[0]}`)
  n++
}
console.log(`HCB v0: ${n} rows valid`)
