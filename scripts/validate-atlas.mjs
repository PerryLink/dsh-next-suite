#!/usr/bin/env node
/**
 * Validate data/ecosystem-atlas.json.
 *
 * Default (offline) checks:
 *   - required fields: id, type, url, role, first_seen, notes
 *   - type is one of the atlas types
 *   - url is an absolute https URL with a public-looking host and the
 *     expected shape for GitHub repo / npm package URLs
 *   - first_seen is a valid YYYY-MM-DD date and not in the future
 *   - no duplicate id and no duplicate url (case-insensitive)
 *   - at least 50 entities (the atlas floor)
 *
 * --check-md also cross-checks ECOSYSTEM-ATLAS.md: every JSON entity appears
 * exactly once in the entity tables with the same type/url, and the type
 * distribution table matches the JSON.
 *
 * No network access and no dependencies. Exit 0 = pass, 1 = fail.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_PATH = join(ROOT, 'data', 'ecosystem-atlas.json');
const MD_PATH = join(ROOT, 'ECOSYSTEM-ATLAS.md');
const MIN_ENTITIES = 50;
const TYPES = ['official', 'runtime', 'framework', 'standard', 'community', 'distribution', 'plugin', 'adjacent'];
const TYPE_SET = new Set(TYPES);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

function checkUrl(raw, where) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    err(`${where}: not a valid URL: ${JSON.stringify(raw)}`);
    return;
  }
  if (u.protocol !== 'https:') err(`${where}: URL must use https, got ${u.protocol}`);
  if (u.username || u.password) err(`${where}: URL must not contain credentials`);
  if (u.port) err(`${where}: URL must not pin a port`);
  if (/\s/.test(raw)) err(`${where}: URL contains whitespace`);

  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.invalid')) {
    err(`${where}: URL host is not public-looking: ${host}`);
  }
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    err(`${where}: URL host is a private address: ${host}`);
  }
  if (/^(example\.(com|org|net)|.*\.example)$/.test(host)) {
    err(`${where}: URL host is a documentation placeholder: ${host}`);
  }

  if (host === 'github.com' && !/^\/[^/]+\/[^/]+\/?$/.test(u.pathname)) {
    err(`${where}: GitHub URL must point at a repository root (got ${u.pathname})`);
  }
  if (host === 'www.npmjs.com' && !/^\/package\/[^/]+\/?$/.test(u.pathname)) {
    err(`${where}: npm URL must point at a package page (got ${u.pathname})`);
  }
  if (host === 'www.npmjs.com' && u.pathname.split('/')[2] === '') {
    err(`${where}: npm package name is empty`);
  }
}

// ---------- load ----------
let raw;
try {
  raw = readFileSync(JSON_PATH, 'utf8');
} catch (e) {
  console.error(`FAIL: cannot read ${JSON_PATH}: ${e.message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (e) {
  console.error(`FAIL: invalid JSON in ${JSON_PATH}: ${e.message}`);
  process.exit(1);
}

const entities = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entities) ? parsed.entities : null;
if (!entities) {
  console.error('FAIL: JSON must be an array of entities (or an object with an entities array)');
  process.exit(1);
}
if (entities.length < MIN_ENTITIES) {
  err(`entity count ${entities.length} is below the atlas floor of ${MIN_ENTITIES}`);
}

const required = ['id', 'type', 'url', 'role', 'first_seen', 'notes'];
const ids = new Map();
const urls = new Map();
const typeCounts = Object.fromEntries(TYPES.map((t) => [t, 0]));
const hostCounts = {};
const now = Date.now();

entities.forEach((e, i) => {
  const where = `entities[${i}]`;
  if (!isObject(e)) {
    err(`${where}: must be an object`);
    return;
  }
  for (const key of required) {
    if (!(key in e)) err(`${where}: missing required field "${key}"`);
  }
  if (typeof e.id !== 'string' || e.id.trim() === '') {
    err(`${where}: id must be a non-empty string`);
  } else {
    const id = e.id.trim();
    if (id !== e.id) err(`${where}: id has leading/trailing whitespace`);
    if (!ID_RE.test(id)) err(`${where}: id has invalid characters: ${JSON.stringify(id)}`);
    const k = id.toLowerCase();
    if (ids.has(k)) err(`${where}: duplicate id "${id}" (first at entities[${ids.get(k)}])`);
    else ids.set(k, i);
  }
  if (typeof e.type !== 'string' || !TYPE_SET.has(e.type)) {
    err(`${where}: type must be one of ${TYPES.join(', ')}; got ${JSON.stringify(e.type)}`);
  } else typeCounts[e.type] += 1;
  if (typeof e.role !== 'string' || e.role.trim() === '') err(`${where}: role must be a non-empty string`);
  if (typeof e.notes !== 'string' || e.notes.trim() === '') err(`${where}: notes must be a non-empty string`);
  else if (/\bunverified\b/i.test(e.notes)) warn(`${where}: notes is marked unverified (${e.id})`);

  if (typeof e.first_seen !== 'string' || !validDate(e.first_seen)) {
    err(`${where}: first_seen must be a real YYYY-MM-DD date; got ${JSON.stringify(e.first_seen)}`);
  } else if (new Date(`${e.first_seen}T00:00:00Z`).getTime() > now + FUTURE_SLACK_MS) {
    err(`${where}: first_seen is in the future: ${e.first_seen}`);
  }

  if (typeof e.url !== 'string' || e.url.trim() === '') {
    err(`${where}: url must be a non-empty string`);
  } else {
    checkUrl(e.url, where);
    try {
      const k = normalizeUrl(e.url);
      if (urls.has(k)) err(`${where}: duplicate url "${e.url}" (first at entities[${urls.get(k)}])`);
      else urls.set(k, i);
      hostCounts[new URL(e.url).hostname] = (hostCounts[new URL(e.url).hostname] || 0) + 1;
    } catch {
      /* checkUrl already reported it */
    }
  }
});

if (entities.length > 0 && ids.size !== entities.length) {
  err(`unique id count ${ids.size} != entity count ${entities.length}`);
}

// ---------- optional markdown cross-check ----------
let md = null;
if (process.argv.includes('--check-md')) {
  try {
    md = readFileSync(MD_PATH, 'utf8');
  } catch (e) {
    err(`--check-md: cannot read ${MD_PATH}: ${e.message}`);
  }
}

let mdEntities = null;
if (md) {
  const rowRe = /^\|\s*`([^`]+)`\s*\|\s*(official|runtime|framework|standard|community|distribution|plugin|adjacent)\s*\|\s*(https:\/\/[^|\s]+)\s*\|/gm;
  mdEntities = new Map();
  for (const m of md.matchAll(rowRe)) {
    const [, id, type, url] = m;
    if (mdEntities.has(id)) err(`--check-md: duplicate table row for id "${id}"`);
    mdEntities.set(id, { type, url });
  }
  if (mdEntities.size !== entities.length) {
    err(`--check-md: table has ${mdEntities.size} entities, JSON has ${entities.length}`);
  }
  for (const e of entities) {
    const row = mdEntities.get(e.id);
    if (!row) {
      err(`--check-md: entity "${e.id}" is missing from the markdown table`);
      continue;
    }
    if (row.type !== e.type) err(`--check-md: "${e.id}" type is ${row.type} in markdown, ${e.type} in JSON`);
    if (row.url.replace(/\/$/, '') !== e.url.replace(/\/$/, '')) {
      err(`--check-md: "${e.id}" url differs between markdown and JSON`);
    }
  }

  const statRe = /^\|\s*(official|runtime|framework|standard|community|distribution|plugin|adjacent)\s*\|\s*(\d+)\s*\|/gm;
  const mdCounts = Object.fromEntries(TYPES.map((t) => [t, 0]));
  let statRows = 0;
  for (const m of md.matchAll(statRe)) {
    mdCounts[m[1]] = Number(m[2]);
    statRows += 1;
  }
  if (statRows !== TYPES.length) {
    err(`--check-md: expected ${TYPES.length} type-distribution rows in markdown, found ${statRows}`);
  }
  for (const t of TYPES) {
    if (mdCounts[t] !== typeCounts[t]) {
      err(`--check-md: type "${t}" count is ${mdCounts[t]} in markdown, ${typeCounts[t]} in JSON`);
    }
  }
}

// ---------- report ----------
const total = entities.length;
const hostSummary = Object.entries(hostCounts)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([h, n]) => `${h}=${n}`)
  .join(', ');
const typeSummary = TYPES.filter((t) => typeCounts[t] > 0)
  .map((t) => `${t}=${typeCounts[t]}`)
  .join(', ');

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: errors.length === 0, total, typeCounts, hostCounts, warnings, errors }, null, 2));
} else {
  console.log(`Atlas: ${total} entities (floor ${MIN_ENTITIES})`);
  console.log(`Types: ${typeSummary}`);
  console.log(`Hosts: ${hostSummary}`);
  if (mdEntities) console.log(`Markdown cross-check: ${mdEntities.size} table rows matched`);
  if (warnings.length) {
    console.log(`Warnings (${warnings.length}):`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (errors.length) {
    console.error(`FAIL: ${errors.length} error(s)`);
    for (const e of errors) console.error(`  - ${e}`);
  } else {
    console.log('PASS: required fields, URL shape, dates, and uniqueness are valid.');
  }
}

process.exit(errors.length === 0 ? 0 : 1);
