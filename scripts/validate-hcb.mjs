import { readFileSync } from 'node:fs'

const p = new URL('../data/hcb/matrix.csv', import.meta.url)
const lines = readFileSync(p, 'utf8').trim().split(/\r?\n/)
const EXPECTED_HEADER =
  'package,version,host,node,host_supported,install_ok,dump_config_ok,tests_pass,tests_total,license,repo,date'
const header = lines.shift().split(',')
if (header.join(',') !== EXPECTED_HEADER) {
  throw new Error('unexpected HCB header')
}

const CHECK_VALUES = new Set(['true', 'false', 'not-tested', 'unsupported'])
const SUPPORT_VALUES = new Set(['true', 'false'])
// Node floors from each host checkout's package.json. This keeps
// host_supported honest even if a row is edited by hand.
const HOST_NODE_FLOOR = new Map([['0.2.2-rc.3', [24, 9, 0]]])
const atLeastNode = (node, floor) => {
  const [major, minor, patch] = node.split('.').map(Number)
  const [floorMajor, floorMinor, floorPatch] = floor
  return (
    major > floorMajor ||
    (major === floorMajor &&
      (minor > floorMinor || (minor === floorMinor && patch >= floorPatch)))
  )
}
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const NODE_RE = /^\d+\.\d+\.\d+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const REPO_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+$/
const isCount = (value) => /^\d+$/.test(value)

const seen = new Set()
const nodes = new Set()
const versions = new Set()
let n = 0

for (const line of lines) {
  if (line.trim() === '') continue
  const cols = line.split(',')
  if (cols.length !== header.length) throw new Error(`bad column count: ${line}`)

  const [
    packageName,
    version,
    host,
    node,
    hostSupported,
    installOk,
    dumpConfigOk,
    testsPass,
    testsTotal,
    license,
    repo,
    date,
  ] = cols

  if (!packageName) throw new Error(`empty package: ${line}`)
  if (!VERSION_RE.test(version)) throw new Error(`bad version: ${packageName}`)
  if (!host) throw new Error(`empty host: ${packageName}`)
  if (!NODE_RE.test(node)) throw new Error(`bad node: ${packageName} ${node}`)
  if (!SUPPORT_VALUES.has(hostSupported)) {
    throw new Error(`host_supported must be true or false: ${packageName} ${hostSupported}`)
  }
  const hostChecks = [
    ['install_ok', installOk],
    ['dump_config_ok', dumpConfigOk],
  ]
  for (const [field, value] of hostChecks) {
    if (!CHECK_VALUES.has(value)) {
      throw new Error(
        `${field} must be true, false, not-tested, or unsupported: ${packageName} ${value}`,
      )
    }
  }
  if (hostSupported === 'false') {
    for (const [field, value] of hostChecks) {
      if (value !== 'unsupported') {
        throw new Error(
          `${field} must be unsupported when host_supported=false: ${packageName} ${value}`,
        )
      }
    }
  } else if (hostChecks.some(([, value]) => value === 'unsupported')) {
    throw new Error(`unsupported is only valid when host_supported=false: ${packageName}`)
  }
  const floor = HOST_NODE_FLOOR.get(host)
  if (floor && (hostSupported === 'true') !== atLeastNode(node, floor)) {
    throw new Error(
      `host_supported=${hostSupported} contradicts host ${host} Node floor ${floor.join('.')} for Node ${node}: ${packageName}`,
    )
  }

  const passCounted = isCount(testsPass)
  const totalCounted = isCount(testsTotal)
  if (!passCounted && testsPass !== 'not-tested') {
    throw new Error(`bad tests_pass: ${packageName} ${testsPass}`)
  }
  if (!totalCounted && testsTotal !== 'not-tested') {
    throw new Error(`bad tests_total: ${packageName} ${testsTotal}`)
  }
  if (passCounted !== totalCounted) {
    throw new Error(`tests_pass and tests_total must both be counts or both not-tested: ${packageName}`)
  }
  if (passCounted && Number(testsPass) > Number(testsTotal)) {
    throw new Error(`tests pass > total: ${packageName}`)
  }

  if (!license) throw new Error(`empty license: ${packageName}`)
  if (!REPO_RE.test(repo)) throw new Error(`bad repo: ${packageName} ${repo}`)
  if (!DATE_RE.test(date)) throw new Error(`bad date: ${packageName} ${date}`)

  const key = [packageName, version, host, node].join('|')
  if (seen.has(key)) throw new Error(`duplicate row: ${key}`)
  seen.add(key)
  nodes.add(node)
  versions.add(version)
  n++
}

if (n === 0) throw new Error('HCB matrix has no data rows')

console.log(
  `HCB v0: ${n} rows valid (${seen.size} unique package/version/host/node; versions ${[...versions]
    .sort()
    .join(', ')}; nodes ${[...nodes].sort().join(', ')})`,
)
