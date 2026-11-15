/**
 * Shared, dependency-free fixtures for the cordis-migrate tests.
 *
 * `RULE_CASES` is the canonical positive/negative/idempotency table: every
 * built-in rule must have exactly one entry here, and the aggregate fixture is
 * built from it so the CLI dry-run/idempotency tests exercise every rule.
 *
 * Keep this file out of `test/*.test.js`: `node --test test/*.test.js` will not
 * execute it directly.
 */

/**
 * @typedef {object} RuleCase
 * @property {string} id built-in rule id
 * @property {string} positive a single line that must match
 * @property {string} expected the exact output of applySource(positive)
 * @property {string} negative a line that must not match
 */

/** @type {ReadonlyArray<Readonly<RuleCase>>} */
export const RULE_CASES = Object.freeze(
  [
    {
      id: 'import-cordis-loader',
      positive: "import Loader from 'cordis/loader'\n",
      expected: "import Loader from '@cordisjs/loader'\n",
      negative: "import Loader from '@cordisjs/loader'\n",
    },
    {
      id: 'import-cordis-group',
      positive: "import Group from 'cordis/group'\n",
      expected: "import Group from '@cordisjs/group'\n",
      negative: "import Group from '@cordisjs/group'\n",
    },
    {
      id: 'import-cordis-core',
      positive: "import { Service } from '@cordisjs/core'\n",
      expected: "import { Service } from 'cordis'\n",
      negative: "import { Service } from 'cordis'\n",
    },
    {
      id: 'import-cordis-schema',
      positive: "import { Schema } from 'cordis'\n",
      expected: "import Schema from 'schemastery'\n",
      negative: "import Schema from 'schemastery'\n",
    },
    {
      id: 'import-cordis-timer',
      positive: "import { TimerService } from 'cordis'\n",
      expected: "import { TimerService } from '@cordisjs/timer'\n",
      negative: "import { TimerService } from '@cordisjs/timer'\n",
    },
    {
      id: 'import-cordisjs-logger',
      positive: "import { Logger, LoggerService } from '@cordisjs/logger'\n",
      expected: "import { Logger, LoggerService } from 'cordis'\n",
      negative: "import { Logger, LoggerService } from 'cordis'\n",
    },
    {
      id: 'package-plugin-prefix',
      positive: '"@cordisjs/plugin-hmr": "^1.1.2"\n',
      expected: '"@cordisjs/hmr": "^1.1.2"\n',
      negative: '"@cordisjs/hmr": "^2.0.0-rc.0"\n',
    },
    {
      id: 'package-config-entry-name',
      positive: 'name: @cordisjs/plugin-loader\n',
      expected: 'name: @cordisjs/loader\n',
      negative: 'name: @cordisjs/loader\n',
    },
    {
      id: 'package-cordis-peer',
      positive: '"cordis": "^3.18.1"\n',
      expected: '"cordis": "^4.0.0-rc.13"\n',
      negative: '"cordis": "^4.0.0-rc.13"\n',
    },
    {
      id: 'context-base-dir',
      positive: 'const dir = ctx.baseDir\n',
      expected: 'const dir = ctx.baseUrl\n',
      negative: "const baseDir = './src'\n",
    },
    {
      id: 'config-base-dir',
      positive: "baseDir: './src'\n",
      expected: "baseUrl: './src'\n",
      negative: "const baseDir = './src'\n",
    },
    {
      id: 'context-root',
      positive: 'const root = ctx.root\n',
      expected: 'const root = ctx[Context.root]\n',
      negative: 'const root = ctx[Context.root]\n',
    },
    {
      id: 'context-config',
      positive: 'const config = ctx.config\n',
      expected: 'const config = ctx.fiber.config\n',
      negative: 'const config = ctx.fiber.config\n',
    },
    {
      id: 'context-lifecycle',
      positive: "ctx.lifecycle.on('ready', fn)\n",
      expected: "ctx.events.on('ready', fn)\n",
      negative: "ctx.events.on('ready', fn)\n",
    },
    {
      id: 'context-using',
      positive: "ctx.using(['foo'], (ctx) => {})\n",
      expected: "ctx.inject(['foo'], (ctx) => {})\n",
      negative: "ctx.inject(['foo'], (ctx) => {})\n",
    },
    {
      id: 'context-plugin-use',
      positive: 'ctx.plugin(foo)\n',
      expected: 'ctx.use(foo)\n',
      negative: 'ctx.use(foo)\n',
    },
    {
      id: 'entry-fiber',
      positive: 'const fiber = entry.fiber\n',
      expected: 'const fiber = entry.innerFiber\n',
      negative: 'const fiber = entry.innerFiber\n',
    },
    {
      id: 'lifecycle-dispose-listener',
      positive: "ctx.on('dispose', cleanup)\n",
      expected: 'ctx.effect(() => cleanup)\n',
      negative: 'ctx.effect(() => cleanup)\n',
    },
    {
      id: 'lifecycle-internal-event-rename',
      positive: "ctx.on('internal/before-service', (name) => {})\n",
      expected: "ctx.on('internal/service', (name) => {})\n",
      negative: "ctx.on('internal/service', (name) => {})\n",
    },
    {
      id: 'service-setup-init',
      positive: 'Service.setup\n',
      expected: 'Service.init\n',
      negative: 'Service.init\n',
    },
    {
      id: 'service-super-immediate',
      positive: "super(ctx, 'foo', true)\n",
      expected: "super(ctx, 'foo')\n",
      negative: "super(ctx, 'foo')\n",
    },
    {
      id: 'service-set-provide',
      positive: "ctx.set('foo', bar)\n",
      expected: "ctx.provide('foo', bar)\n",
      negative: "ctx.provide('foo', bar)\n",
    },
    {
      id: 'service-start-init',
      positive: '  async start() {\n',
      expected: '  async [Service.init]() {\n',
      negative: '  startTime() {\n',
    },
    {
      id: 'service-provide-builtin',
      positive: "ctx.provide('foo', bar, true)\n",
      expected: "ctx.provide('foo', bar)\n",
      negative: "ctx.provide('foo', bar)\n",
    },
    {
      id: 'config-plugin-legacy-flags',
      positive: '  reactive: true,\n',
      expected: '\n',
      negative: 'reactiveThing: true\n',
    },
    {
      id: 'config-hmr-watch-api',
      positive: "ctx.hmr.watch('src')\n",
      expected: "ctx.fs.watch('src')\n",
      negative: "ctx.fs.watch('src')\n",
    },
  ].map((entry) => Object.freeze(entry)),
)

/** Every rule's positive example, concatenated. */
export const ALL_RULES_FIXTURE = RULE_CASES.map((entry) => entry.positive).join('')

/** The expected result of applying every built-in rule once. */
export const ALL_RULES_MIGRATED = RULE_CASES.map((entry) => entry.expected).join('')

/** A small self-contained sample used by CLI scan/apply tests. */
export const SAMPLE = [
  "import { Schema } from 'cordis'",
  "import Loader from 'cordis/loader'",
  '',
  'export function apply(ctx) {',
  '  ctx.plugin(foo)',
  "  ctx.on('dispose', cleanup)",
  '  const dir = ctx.baseDir',
  '}',
].join('\n')

/** The expected migration of {@link SAMPLE} (one pass, all rules). */
export const SAMPLE_MIGRATED = [
  "import Schema from 'schemastery'",
  "import Loader from '@cordisjs/loader'",
  '',
  'export function apply(ctx) {',
  '  ctx.use(foo)',
  '  ctx.effect(() => cleanup)',
  '  const dir = ctx.baseUrl',
  '}',
].join('\n')
