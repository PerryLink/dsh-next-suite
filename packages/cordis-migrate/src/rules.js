/**
 * Built-in migration rules for `cordis-migrate`.
 *
 * ⚠️ This is a COMMUNITY-CURATED list, not an official Cordis migration table.
 * It was assembled on 2026-11-15 from:
 *
 * - `cordis@3.18.1` and `cordis@4.0.0-rc.13` published type declarations and
 *   `package.json` export maps (npm);
 * - `@cordisjs/core@3.18.1`, `@cordisjs/loader@1.0.0-rc.10`,
 *   `@cordisjs/hmr@2.0.0-rc.0` declarations;
 * - the public Cordis release notes v4.0.0-rc.9 … v4.0.0-rc.13;
 * - the DeepSeek Harness `docs/cordis-primer.zh.md` and `docs/cordis-api/*`
 *   pages (read locally during the same review).
 *
 * See {@link RULE_SOURCES} for the public URLs. Cordis 4 is still a release
 * candidate: APIs may move again, and none of these rules understands aliases,
 * re-exports, scopes, types, or multi-line structures. Every proposal needs a
 * human review against the target release.
 *
 * Keep this module dependency-free: it is imported by `core.js` and is safe to
 * use in the browser and in tests.
 */

/**
 * Reminder repeated by the CLI, text plans, JSON plans and `rules --json`.
 * The wording is deliberately stable so README/tests cannot drift silently.
 */
export const RULES_NOTICE =
  'Community-curated, unofficial Cordis 3 -> 4 migration rules (not an official migration table). ' +
  'Rules marked experimental are best-effort; verify every proposal against the target Cordis release ' +
  'and review it manually. This project is unofficial.'

/**
 * Public and local sources used while collecting the rules.
 * `local` entries refer to the maintainers' checkout and are not required to
 * use the tool; they are retained so the evidence trail is auditable.
 *
 * @type {ReadonlyArray<Readonly<{id: string, title: string, url: string, note: string}>>}
 */
export const RULE_SOURCES = Object.freeze(
  [
    {
      id: 'cordis-primer',
      title: 'Cordis 入门（DeepSeek Harness 文档）',
      url: 'https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer',
      note: '事件分发模式、effect/dispose 约定；本地路径 /mnt/d/deepseek-harness/docs/cordis-primer.zh.md。',
    },
    {
      id: 'cordis-api',
      title: 'Cordis API 参考（context/events/service/registry/fiber）',
      url: 'https://deepseek-harness.github.io/deepseek-harness/reference/cordis-api/context',
      note: '同站还有 events/service/registry/fiber 页；本地路径 /mnt/d/deepseek-harness/docs/cordis-api/*.zh.md。',
    },
    {
      id: 'npm-cordis-3',
      title: 'npm cordis@3.18.1',
      url: 'https://registry.npmjs.org/cordis/3.18.1',
      note: 'v3 包导出：./loader、./group、./import、./worker、./cli；根包再导出 @cordisjs/core、Schema/z、Logger、TimerService。',
    },
    {
      id: 'npm-cordis-4',
      title: 'npm cordis@4.0.0-rc.13',
      url: 'https://registry.npmjs.org/cordis/4.0.0-rc.13',
      note: 'v4 包只导出根入口；核心、logger、fiber 等并入 cordis。',
    },
    {
      id: 'npm-cordisjs-core-3',
      title: 'npm @cordisjs/core@3.18.1',
      url: 'https://registry.npmjs.org/@cordisjs/core/3.18.1',
      note: 'v3 Context.config / ctx.set / ctx.using / Service.setup 等声明。',
    },
    {
      id: 'npm-cordisjs-loader-4',
      title: 'npm @cordisjs/loader@1.0.0-rc.10',
      url: 'https://registry.npmjs.org/@cordisjs/loader/1.0.0-rc.10',
      note: 'v4 Loader.Config.baseUrl、Entry.innerFiber。',
    },
    {
      id: 'npm-cordisjs-hmr-4',
      title: 'npm @cordisjs/hmr@2.0.0-rc.0',
      url: 'https://registry.npmjs.org/@cordisjs/hmr/2.0.0-rc.0',
      note: 'v4 HMR：watch.enabled/files，ctx.fs.watch。',
    },
    {
      id: 'release-rc13',
      title: 'Cordis v4.0.0-rc.13 release notes',
      url: 'https://github.com/cordiverse/cordis/releases/tag/v4.0.0-rc.13',
      note: 'plugin-* → @cordisjs/*；ctx.plugin → ctx.use；HMR/ctx.fs.watch；entry.fiber → entry.innerFiber。',
    },
    {
      id: 'release-rc12',
      title: 'Cordis v4.0.0-rc.12 release notes',
      url: 'https://github.com/cordiverse/cordis/releases/tag/v4.0.0-rc.12',
      note: 'ctx.root → ctx[Context.root]；Service.config 标记 → Service.metadata。',
    },
    {
      id: 'release-rc11',
      title: 'Cordis v4.0.0-rc.11 release notes',
      url: 'https://github.com/cordiverse/cordis/releases/tag/v4.0.0-rc.11',
      note: 'fiber.config 保留原始 config；internal/update、internal/commit、internal/config 拆分。',
    },
  ].map((source) => Object.freeze(source)),
)

/**
 * @typedef {'import' | 'package' | 'api' | 'config' | 'lifecycle' | 'service' | 'hmr'} RuleKind
 * @typedef {'error' | 'warning' | 'info'} RuleSeverity
 *
 * @typedef {object} Rule
 * @property {string} id Unique id used in scan results.
 * @property {RuleKind | string} kind Coarse category.
 * @property {RegExp | string} pattern Line-local pattern. Strings are compiled with `g`.
 * @property {string | ((match: string, ...captures: string[]) => string)} replacement
 *   Replacement text (JS `$1` / `$&` syntax supported) or a function.
 * @property {string} description Human-readable explanation shown in docs.
 * @property {RuleSeverity | string} severity Suggested severity.
 * @property {string} [evidence] One-line evidence trail for this rule.
 * @property {boolean} [experimental] True when the rewrite is best-effort.
 */

/**
 * The built-in rules.
 *
 * Design constraints for every entry:
 * - `pattern` matches a single line and is narrow enough that a scan is useful;
 * - `replacement` never re-introduces the matched text, so `applySource` is a
 *   fixed point after one pass (covered by test/rules.test.js);
 * - uncertain rewrites carry `experimental: true` and say why in `description`.
 *
 * @type {ReadonlyArray<Readonly<Rule>>}
 */
export const RULES = Object.freeze(
  [
    // ---------------------------------------------------------------------
    // import paths and package fields
    // ---------------------------------------------------------------------
    {
      id: 'import-cordis-loader',
      kind: 'import',
      pattern: /\bfrom\s+(['"])cordis\/loader\1/g,
      replacement: 'from $1@cordisjs/loader$1',
      description:
        'v3 的 `cordis/loader` 子路径在 v4 的包导出中已移除；改从独立包 `@cordisjs/loader` 导入（需安装 v1，并核验 Loader API）。',
      severity: 'error',
      evidence:
        "cordis@3.18.1 package.json exports['./loader']；cordis@4.0.0-rc.13 package.json 只导出 '.'。",
    },
    {
      id: 'import-cordis-group',
      kind: 'import',
      pattern: /\bfrom\s+(['"])cordis\/group\1/g,
      replacement: 'from $1@cordisjs/group$1',
      description:
        'v3 的 `cordis/group` 子路径在 v4 已移除；v4 把 config group 放在 `@cordisjs/group`（peer cordis ^4）。',
      severity: 'error',
      evidence:
        "cordis@3.18.1 exports['./group']；@cordisjs/group@1.0.1 peerDependencies.cordis='^4.0.0-rc.13'。",
    },
    {
      id: 'import-cordis-core',
      kind: 'import',
      pattern: /\bfrom\s+(['"])@cordisjs\/core\1/g,
      replacement: 'from $1cordis$1',
      description:
        'v3 的 `Context` / `Service` / `Plugin` / 事件类型来自 `@cordisjs/core`；v4 核心并入 `cordis` 根包，不再从旧 core 包导入。',
      severity: 'error',
      evidence:
        'cordis@3.18.1 lib/index.d.ts 首行 `export * from "@cordisjs/core"`；cordis@4.0.0-rc.13 lib/index.d.ts 直接导出 context/events/fiber/service。',
    },
    {
      id: 'import-cordis-schema',
      kind: 'import',
      pattern:
        /\bimport\s*\{\s*(Schema|z)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*\}\s*from\s*(['"])(?:cordis|@cordisjs\/schema)\3/g,
      replacement: (match, name, alias) => `import ${alias || name} from 'schemastery'`,
      description:
        'v3 从 `cordis` 根包或 `@cordisjs/schema` 再导出 `Schema` / `z`；v4 不再导出，config schema 直接使用 `schemastery`（实现 StandardSchemaV1）。',
      severity: 'error',
      evidence:
        "cordis@3.18.1 lib/index.ts `export { Schema, z } from '@cordisjs/schema'`；cordis@4.0.0-rc.13 lib/index.d.ts 无 Schema，registry.d.ts 使用 StandardSchemaV1。",
    },
    {
      id: 'import-cordis-timer',
      kind: 'import',
      pattern: /\bimport\s*\{\s*TimerService\s*\}\s*from\s*(['"])cordis\1/g,
      replacement: "import { TimerService } from '@cordisjs/timer'",
      description:
        'v3 的 `cordis` 根包再导出 `TimerService`；v4 从 `cordis` 移除 timer，改从 `@cordisjs/timer` 导入（v4 版本仍叫这个包名）。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 lib/index.ts 导出 TimerService；cordis@4.0.0-rc.13 lib/index.js 的 export 列表无 TimerService；@cordisjs/timer@1.1.5 peer cordis ^4。',
    },
    {
      id: 'import-cordisjs-logger',
      kind: 'import',
      pattern:
        /\bimport\s*(type\s+)?(?:\{\s*((?:Logger|LoggerService)(?:\s*,\s*(?:Logger|LoggerService))*)\s*\}|\s+(LoggerService))\s*from\s*(['"])@cordisjs\/logger\4/g,
      replacement: (match, typeKeyword, named, fallback) =>
        `import ${typeKeyword || ''}{ ${named || fallback || 'LoggerService'} } from 'cordis'`,
      description:
        'v3 的 logger 是独立包 `@cordisjs/logger`（`Logger` / `LoggerService`，默认导出 LoggerService）；v4 把 logger 服务并入 `cordis` 根包，使用命名导入。',
      severity: 'warning',
      evidence:
        'cordis@4.0.0-rc.13 lib/logger.d.ts 导出 Logger/LoggerService，lib/index.js export 列表包含二者；@cordisjs/logger 最新 0.3.3 peer @cordisjs/core ^3。',
    },
    {
      id: 'package-plugin-prefix',
      kind: 'package',
      pattern:
        /(['"])@cordisjs\/plugin-(cli-cordis|cli|env|group|hmr|http-socks|http|include|loader|logger-console|timer)\1/g,
      replacement: '$1@cordisjs/$2$1',
      description:
        'v4 rc.13 包表列出的 `@cordisjs/plugin-*` 包改名为 `@cordisjs/*`；只匹配表内包名，覆盖 import 说明符与 package.json 依赖键。未列出的 plugin-* 需人工核对（例如 plugin-logger 在 v4 并入 cordis）。',
      severity: 'error',
      evidence:
        'rc.13 release notes：Every `@cordisjs/plugin-*` package is published as `@cordisjs/*`；包表列出 cli/cli-cordis/env/group/hmr/http/http-socks/include/loader/logger-console/timer 的新旧名。',
    },
    {
      id: 'package-config-entry-name',
      kind: 'package',
      pattern:
        /(\bname["']?\s*:\s*)(["']?)@cordisjs\/plugin-(cli-cordis|cli|env|group|hmr|http-socks|http|include|loader|logger-console|timer)\2/g,
      replacement: '$1$2@cordisjs/$3$2',
      description:
        'v4 rc.13 要求 config entry 的 `name` 字段使用新包名；只匹配 rc.13 包表列出的 `@cordisjs/plugin-*`，覆盖 YAML 与 JSON 配置。',
      severity: 'error',
      evidence:
        'rc.13 release notes：Dependencies and the `name` of config entries must use the new names；包表为名称映射的一手证据。',
    },
    {
      id: 'package-cordis-peer',
      kind: 'package',
      pattern: /(["'])cordis\1(\s*:\s*)(["'])\^?3\.[^"']*\3/g,
      replacement: '$1cordis$1$2$3^4.0.0-rc.13$3',
      description:
        'v3 插件的 peerDependencies 通常写 `cordis: ^3.x`；v4 要求 `^4.0.0-rc.13`。具体范围可能需按项目调整，故标为 experimental。',
      severity: 'warning',
      evidence:
        '@cordisjs/plugin-hmr@0.2.6 peerDependencies.cordis 为 ^3.18.0；@cordisjs/hmr@2.0.0-rc.0 peerDependencies.cordis 为 ^4.0.0-rc.13。',
      experimental: true,
    },

    // ---------------------------------------------------------------------
    // Context / API surface
    // ---------------------------------------------------------------------
    {
      id: 'context-base-dir',
      kind: 'api',
      pattern: /\.baseDir\b/g,
      replacement: '.baseUrl',
      description:
        'v3 的 `Context.baseDir: string` 在 v4 变为可选的 `Context.baseUrl?: string`；目录路径与 URL 语义不同，需人工确认拼法。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 lib/index.d.ts `class Context { baseDir: string }`；cordis@4.0.0-rc.13 lib/context.d.ts `baseUrl?: string | undefined`。',
    },
    {
      id: 'config-base-dir',
      kind: 'config',
      pattern: /\bbaseDir(["']?)(\s*:)/g,
      replacement: 'baseUrl$1$2',
      description:
        'v3 的 loader/plugin 配置常用 `baseDir`；v4 的 `Loader.Config` 使用 `baseUrl`。只匹配键名（后跟冒号，兼容 YAML/JS/JSON 引号），不会改普通变量。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 lib/index.d.ts 的 Context.baseDir；@cordisjs/loader@1.0.0-rc.10 lib/index.d.ts `namespace Loader { interface Config { baseUrl?: string } }`。',
    },
    {
      id: 'context-root',
      kind: 'api',
      pattern: /\bctx\.root\b/g,
      replacement: 'ctx[Context.root]',
      description:
        'v4 rc.12 把实验性的 `ctx.root` 改为 `ctx[Context.root]`。替换后需要 `Context` 以值（非仅类型）导入。',
      severity: 'warning',
      evidence:
        'rc.12 release notes：The experimental `ctx.root` is replaced by `ctx[Context.root]`；cordis@4.0.0-rc.13 lib/context.d.ts `static readonly root: unique symbol`。',
      experimental: true,
    },
    {
      id: 'context-config',
      kind: 'api',
      pattern: /\bctx\.config\b/g,
      replacement: 'ctx.fiber.config',
      description:
        'v3 的 `Context.config` 在 v4 移到 `Fiber.config`（rc.11 起保存原始 config，而非 resolve 后的值）；只适用于插件 fiber 内的读取。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 @cordisjs/core lib/index.d.ts `interface Context { config: any }`；cordis@4.0.0-rc.13 lib/context.d.ts 无 config，lib/fiber.d.ts `Fiber.config`。',
      experimental: true,
    },
    {
      id: 'context-lifecycle',
      kind: 'api',
      pattern: /\bctx\.lifecycle\b/g,
      replacement: 'ctx.events',
      description:
        'v3 的 `ctx.lifecycle`（Lifecycle）在 v4 改名为 `ctx.events`（EventsService）；on/once/emit/parallel/serial/bail 名称基本一致，但事件表已变。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 @cordisjs/core lib/index.d.ts `lifecycle: Lifecycle`；cordis@4.0.0-rc.13 lib/context.d.ts `events: EventsService`。',
      experimental: true,
    },
    {
      id: 'context-using',
      kind: 'api',
      pattern: /\bctx\.using\(/g,
      replacement: 'ctx.inject(',
      description:
        'v3 的 `ctx.using(deps, callback)` 已标 deprecated 并建议 `ctx.inject`；v4 只保留 `ctx.inject`，语义是“依赖就绪后运行、变化时重跑”。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 @cordisjs/core lib/index.d.ts `using(...)` 注释 “@deprecated use ctx.inject() instead”；cordis@4.0.0-rc.13 lib/registry.d.ts 只有 inject/use/plugin。',
    },
    {
      id: 'context-plugin-use',
      kind: 'api',
      pattern: /\bctx\.plugin\(/g,
      replacement: 'ctx.use(',
      description:
        'v4 rc.13 把 `ctx.plugin()` 改名为 `ctx.use()`，旧方法是 deprecated 别名；链式返回值与重载需按 v4 类型核对。',
      severity: 'warning',
      evidence:
        'cordis@4.0.0-rc.13 lib/registry.d.ts：`/** @deprecated Use ctx.use() instead. */ plugin(...)`；rc.13 release notes 同条。',
    },
    {
      id: 'entry-fiber',
      kind: 'api',
      pattern: /\bentry\.fiber\b/g,
      replacement: 'entry.innerFiber',
      description:
        'v4 rc.13 把 loader entry 的 `entry.fiber` 改名为 `entry.innerFiber`（外层依赖 fiber 与组件 fiber 分离）。',
      severity: 'warning',
      evidence:
        'rc.13 release notes：`entry.fiber` is renamed to `entry.innerFiber`；@cordisjs/loader@1.0.0-rc.10 lib/config/entry.d.ts 有 `innerFiber`。',
    },

    // ---------------------------------------------------------------------
    // events and effects
    // ---------------------------------------------------------------------
    {
      id: 'lifecycle-dispose-listener',
      kind: 'lifecycle',
      pattern: /\bctx\.(on|once)\(\s*(['"])dispose\2\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g,
      replacement: 'ctx.effect(() => $3)',
      description:
        'v3 的公共 `dispose` 事件在 v4 移除；注册清理改用 `ctx.effect()`，其回调返回 disposer。只匹配简单标识符回调，闭包/多行/带参回调不会被改写。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 @cordisjs/core lib/index.d.ts Events 含 `dispose`；cordis@4.0.0-rc.13 lib/events.d.ts 公共事件表无 dispose，lib/fiber.d.ts 提供 effect。',
    },
    {
      id: 'lifecycle-internal-event-rename',
      kind: 'lifecycle',
      pattern: /\bctx\.(on|once)\(\s*(['"])internal\/(before-service|before-update|fork|event)\2/g,
      replacement: (match, method, quote, name) => {
        const next = {
          'before-service': 'internal/service',
          'before-update': 'internal/update',
          fork: 'internal/plugin',
          event: 'internal/dispatch',
        }[name]
        return `ctx.${method}(${quote}${next}${quote}`
      },
      description:
        'v4 重命名了若干 internal 事件：before-service→internal/service、before-update→internal/update、internal/fork→internal/plugin、internal/event→internal/dispatch。参数形状也可能变化，故标 experimental。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 @cordisjs/core lib/index.d.ts 与 cordis@4.0.0-rc.13 lib/events.d.ts 的 Events 接口对比（internal/before-service、internal/fork、internal/event、internal/before-update 均不在 v4）。',
      experimental: true,
    },

    // ---------------------------------------------------------------------
    // service registration and lifecycle
    // ---------------------------------------------------------------------
    {
      id: 'service-setup-init',
      kind: 'service',
      pattern: /\bService\.setup\b/g,
      replacement: 'Service.init',
      description:
        'v3 的 `Service.setup` symbol 在 v4 改名为 `Service.init`；类插件构造完成后会调用实例的 `[Service.init]()`。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 @cordisjs/core lib/index.d.ts `static readonly setup`；cordis@4.0.0-rc.13 lib/service.d.ts `static readonly init`，lib/index.js 调用 `instance[symbols.init]()`。',
      experimental: true,
    },
    {
      id: 'service-super-immediate',
      kind: 'service',
      pattern: /\bsuper\(\s*ctx\s*,\s*(['"][^'"]+['"])\s*,\s*(?:true|false)\s*\)/g,
      replacement: 'super(ctx, $1)',
      description:
        'v3 的 `Service` 构造器签名是 `(ctx, name, immediate?)`；v4 只有 `(ctx, name)`，第三参已移除。只匹配字面量服务名。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 @cordisjs/core lib/index.d.ts `constructor(ctx: C, name: string, immediate?: boolean)`；cordis@4.0.0-rc.13 lib/service.d.ts `constructor(ctx: Context, name: string)`。',
    },
    {
      id: 'service-set-provide',
      kind: 'service',
      pattern: /\bctx\.set\(/g,
      replacement: 'ctx.provide(',
      description:
        'v3 用 `ctx.set(name, value)` 注册服务（`ctx.provide` 是 deprecated 别名）；v4 反过来：`provide` 注册并返回 disposer，`set` 只能覆盖已提供服务。若原代码是覆盖语义，需人工保留 set。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 @cordisjs/core lib/index.d.ts：`provide` 标 “@deprecated use ctx.set() instead”；cordis@4.0.0-rc.13 lib/reflect.d.ts：provide 返回 Disposable，set 返回 void。',
      experimental: true,
    },
    {
      id: 'service-start-init',
      kind: 'service',
      pattern: /^([ \t]*)(async\s+)?start\(\)\s*\{/g,
      replacement: '$1$2[Service.init]() {',
      description:
        'v3 的 `Service` 子类用 `start()` / `stop()` 生命周期；v4 没有这两个方法，改用 `[Service.init]()`，清理走 effect。只匹配行首 `start() {`，可能误伤普通类。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 @cordisjs/core lib/index.d.ts `protected start(): Awaitable<void>` / `stop()`；cordis@4.0.0-rc.13 lib/service.d.ts 只有 `static readonly init`，无 start/stop。',
      experimental: true,
    },
    {
      id: 'service-provide-builtin',
      kind: 'service',
      pattern: /\bctx\.provide\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*,\s*(?:true|false)\s*\)/g,
      replacement: 'ctx.provide($1, $2)',
      description:
        'v3 的 `provide(name, value?, builtin?)` 第三参是布尔 builtin 标记；v4 第三参变成 `check?: () => boolean`，布尔值必须移除。只匹配简单实参。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 @cordisjs/core lib/index.d.ts `provide(name, value?, builtin?)`；cordis@4.0.0-rc.13 lib/reflect.d.ts `provide(name, value?, check?)`。',
      experimental: true,
    },

    // ---------------------------------------------------------------------
    // plugin metadata, config and HMR
    // ---------------------------------------------------------------------
    {
      id: 'config-plugin-legacy-flags',
      kind: 'config',
      pattern: /^[ \t]*(?:reactive|reusable)\s*:\s*(?:true|false)\s*,?[ \t]*$/g,
      replacement: '',
      description:
        'v3 的 `Plugin.Base` 有 `reactive` / `reusable` 标志；v4 的 `Component.Base` 已移除。规则删除独占一行的布尔标志，可能误删同名业务字段，故标 experimental。',
      severity: 'warning',
      evidence:
        'cordis@3.18.1 @cordisjs/core lib/index.d.ts `Plugin.Base { reactive?; reusable? }`；cordis@4.0.0-rc.13 lib/registry.d.ts `Component.Base` 无这两个字段。',
      experimental: true,
    },
    {
      id: 'config-hmr-watch-api',
      kind: 'hmr',
      pattern: /\bctx\.hmr\.watch\(/g,
      replacement: 'ctx.fs.watch(',
      description:
        'v4 rc.13 把 `ctx.hmr.watch()` 拆到 fs 服务：`ctx.fs.watch()`。HMR 的文件监听默认关闭，需在 HMR 配置中设 `watch.enabled`。',
      severity: 'warning',
      evidence:
        'rc.13 release notes：`ctx.hmr.watch()` is replaced by `ctx.fs.watch()`；@cordisjs/hmr@2.0.0-rc.0 lib/index.d.ts `Config { watch: { enabled, files, debounce } }`。',
    },
  ].map((rule) => Object.freeze(rule)),
)

/** @param {RegExp | string} pattern */
function describePattern(pattern) {
  return pattern instanceof RegExp ? `/${pattern.source}/${pattern.flags}` : pattern
}

/**
 * Convert a rule to a JSON-safe projection (RegExp -> string, functions ->
 * `[function]`). Shared by the CLI `rules` command and tests.
 *
 * @param {Readonly<Rule>} rule
 */
export function serializeRule(rule) {
  return {
    id: rule.id,
    kind: rule.kind,
    pattern: describePattern(rule.pattern),
    replacement: typeof rule.replacement === 'function' ? '[function]' : rule.replacement,
    description: rule.description,
    severity: rule.severity,
    experimental: rule.experimental === true,
    evidence: rule.evidence ?? '',
  }
}

/**
 * Render the built-in rules for `cordis-migrate rules` / `rules --json`.
 *
 * @param {ReadonlyArray<Readonly<Rule>>} [rules]
 * @param {{json?: boolean}} [options]
 * @returns {string}
 */
export function formatRules(rules = RULES, options = {}) {
  const list = rules.map(serializeRule)
  const experimental = list.filter((rule) => rule.experimental).length
  const { json = false } = options ?? {}

  if (json) {
    return JSON.stringify(
      {
        notice: RULES_NOTICE,
        count: list.length,
        experimental,
        sources: RULE_SOURCES,
        rules: list,
      },
      null,
      2,
    )
  }

  const lines = []
  lines.push(`cordis-migrate rules — ${list.length} rule(s), ${experimental} experimental`)
  lines.push('')
  lines.push(RULES_NOTICE)
  lines.push('')
  for (const rule of list) {
    const flags = rule.experimental ? ' [experimental]' : ''
    lines.push(`${rule.id}  (${rule.kind}/${rule.severity})${flags}`)
    lines.push(`  ${rule.description}`)
    lines.push(`  pattern:  ${rule.pattern}`)
    lines.push(`  replace:  ${rule.replacement}`)
    lines.push(`  evidence: ${rule.evidence}`)
    lines.push('')
  }
  lines.push('Sources:')
  for (const source of RULE_SOURCES) {
    lines.push(`  - ${source.id}: ${source.title} — ${source.url}`)
  }
  return lines.join('\n').trimEnd()
}
