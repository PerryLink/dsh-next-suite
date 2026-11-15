# cordis-migrate

> **非官方社区工具。** 与 Cordiverse / Cordis 项目、DeepSeek 均无隶属关系。
> Apache-2.0，本仓库版本 `0.2.4`。
> **内置 24 条规则，其中 4 条标为 `experimental`。规则是社区整理，不是官方迁移表。**

Cordis 3 → 4 的**文本级迁移规则引擎**：扫描（scan）、生成计划（dry-run）、显式写入（apply `--write`）、列出规则（rules）。

纯 ESM JavaScript + JSDoc，零第三方依赖，Node `^22.19.0 || >=24.9.0`。

```sh
node packages/cordis-migrate/src/cli.js rules
node packages/cordis-migrate/src/cli.js scan ./src
node packages/cordis-migrate/src/cli.js apply ./src            # 默认 dry-run
node packages/cordis-migrate/src/cli.js apply ./src --write    # 只有显式传入才写盘
```

## 先读这一节

1. **规则是社区整理，不是官方迁移表。** 24 条规则来自 2026-11-15 对 npm 实际解包（`cordis@4.0.0-rc.13` 的 `lib/*.d.ts` / `lib/index.js` / `package.json`，以及 `cordis@3.18.1` / `@cordisjs/core@3.18.1` 源码）、相关 `@cordisjs/*` 包声明、Cordis v4 release notes，以及 DeepSeek Harness 的 Cordis 文档的交叉核对（来源见下文）。Cordis 4 仍在 RC，API 可能继续变化；规则没有覆盖别名、re-export、作用域、类型、动态构造、生成代码等真实情况。
2. **`experimental: true` 表示“只能当线索，不能当结论”。** 这些改写涉及语义近似或结构假设（例如 `ctx.config` 的 resolved/raw 差异、`ctx.set` 的清理/覆盖语义、`start()` 的误匹配、按行删除 `reactive`/`reusable` 可能误伤业务字段）。`rules` 命令和 JSON 输出都会显式标出。
3. **每条改动都必须人工确认。** `--write` 不会替你理解语义。典型反例：`Context` 可能同时作值使用；`baseDir` 与 `baseUrl` 的路径/URL 语义不同；`ctx.set` 可能原本就是覆盖而不是注册。
4. **先备份或用版本控制。** `--write` 直接覆盖文件，没有内置备份/回滚；请先看 dry-run 输出并在干净工作区操作。
5. **不要用本工具自动修改官方仓库。** 不向 `cordiverse/cordis` 或任何上游仓库提交自动改写结果；本工具不执行 git、不推送、不联网。

### 目标版本

规则以 **npm 上游 `cordis@4.0.0-rc.13`** 为准。DeepSeek Harness vendor 的 `@deepseek-ai/cordis@4.1.0` 在个别 API 上与上游不同（例如 vendor 4.1.0 的 registry 仍以 `ctx.plugin` 为主，没有 rc.13 的 `ctx.use`）；若你的迁移目标是 vendored 版本，请以该版本的类型声明为准重新核对 `context-plugin-use` 等规则。

## 为什么

Cordis 3 → 4 中有一批重复、机械、但**不能盲改**的文本变化：import 子路径、`Context` 字段、`ctx.on` 事件名、`ctx.plugin`/`ctx.inject`、service 注册、dispose/effect、config schema、HMR、package 字段。把它们做成显式规则，可以获得：

- 一条命令得到**可审阅的 diff 式清单**，而不是直接改文件；
- 规则集中在 `src/rules.js`，可替换、可扩展（库 API 接受自定义规则）；
- 默认 dry-run，`--write` 必须显式，降低误伤；
- 二进制/非法编码文件自动跳过，不会写坏资源文件；
- `rules --json` 把 id、kind、severity、experimental、evidence 一起输出，便于审计。

## 安装与运行

本包未声明已在 npm 发布；请在发布前按文末“命名核验”重新确认名称可用性。仓库内直接运行：

```sh
cd packages/cordis-migrate
npm test
node src/cli.js --help
node src/cli.js rules
```

发布后预期为 `npm i -D cordis-migrate`。本包没有运行时依赖。

## 用法

### CLI

```sh
cordis-migrate scan <dir|file> [--json]
cordis-migrate apply <dir|file> [--dry-run | --write] [--json]
cordis-migrate rules [--json]
cordis-migrate --help
cordis-migrate --version
```

- `scan`：只报告匹配；永远不写文件；即使发现匹配，退出码仍为 `0`（便于 CI 解析 JSON 后自行判定）。
- `apply`：默认 `--dry-run`。只有显式 `--write` 才写盘；`--write` 与 `--dry-run` 互斥。
- `rules`：只读地列出全部内置规则（id、kind、severity、`experimental`、description、pattern、replacement、evidence）；`--json` 额外带 `sources`。
- `--json`：stdout 只输出一个 JSON 对象，至少包含 `{ command, ok }`，并带 `notice`、`changes`、`skipped`、`summary`；`--write --json` 额外包含 `write.{written,unchanged,failures}`，写入失败时 `ok=false`；`rules --json` 带 `count`、`experimental`、`rules`、`sources`。
- 可以直接传单个文件，也可以传目录；目录会递归遍历。
- `-h` / `--help` 打印用法并 exit `0`；`-V` / `--version` 打印 `cordis-migrate 0.2.4` 并 exit `0`。

退出码：

| 码 | 含义 |
|---|---|
| `0` | 成功（包括 `scan` 发现匹配；匹配不是失败） |
| `1` | 保留：本工具没有“业务否定”状态 |
| `2` | 用法 / 输入 / IO 错误：无参数、未知命令、未知选项、目标不可读、写入失败 |

示例：

```sh
# 先看有哪些规则、哪些是 experimental
node packages/cordis-migrate/src/cli.js rules
node packages/cordis-migrate/src/cli.js rules --json > rules.json

# 机器可读扫描
node packages/cordis-migrate/src/cli.js scan ./src --json > plan.json

# 人工审阅后再写
node packages/cordis-migrate/src/cli.js apply ./src
node packages/cordis-migrate/src/cli.js apply ./src --write
```

### 库

```js
import { RULES, applySource, formatPlan, plan, scanSource } from 'cordis-migrate'
import { RULE_SOURCES, formatRules, serializeRule } from 'cordis-migrate/rules'

const matches = scanSource(code, RULES)
console.log(matches) // [{ ruleId, line, column, before, after }, ...]

const next = applySource(code, matches)
const result = plan([
  { path: 'src/index.js', content: code },
  { path: 'assets/logo.png', content: pngBuffer },
])
console.log(formatPlan(result, { json: true }))
console.log(formatRules(RULES))
```

自定义规则（字段与内置规则相同，`evidence` / `experimental` 可选）：

```js
const rule = {
  id: 'my-rule',
  kind: 'api',
  pattern: /ctx\.using\(/g,
  replacement: 'ctx.inject(',
  description: '示例：using 已废弃，改用 inject（需自行核验）。',
  severity: 'warning',
}
```

`pattern` 可以是带 `g` 的 `RegExp` 或不带 flags 的字符串（内部按 `g` 编译）；`replacement` 支持 JS 的 `$1` / `$&` 语法，或 `(match, ...captures) => string` 函数。规则按**行**匹配，不能跨行。内置规则的 `experimental` 只是审计标记，引擎不会因此拒绝执行。

## 内置规则（社区整理，非官方）

共 24 条，按 `kind` 分组。`exp` 列为 `是` 的规则带 `experimental: true`。完整的 pattern、replacement、description、evidence 请用 `cordis-migrate rules --json` 查看。

### import

| id | severity | exp | 改动（before → after） | 证据（简） |
|---|---|---|---|---|
| `import-cordis-loader` | error | — | `from 'cordis/loader'` → `from '@cordisjs/loader'` | v3 有 `./loader` 导出；v4 只导出 `.` |
| `import-cordis-group` | error | — | `from 'cordis/group'` → `from '@cordisjs/group'` | v3 有 `./group`；v4 group 是独立包 |
| `import-cordis-core` | error | — | `from '@cordisjs/core'` → `from 'cordis'` | v4 核心并入 `cordis` 根包 |
| `import-cordis-schema` | error | — | `import { Schema }` 或 `import { z } from 'cordis'` → `import Schema from 'schemastery'` | v3 再导出 Schema/z；v4 不导出 |
| `import-cordis-timer` | warning | — | `import { TimerService } from 'cordis'` → `from '@cordisjs/timer'` | v4 根包不再导出 timer |
| `import-cordisjs-logger` | warning | — | `from '@cordisjs/logger'` → `from 'cordis'`（命名导入） | v4 logger 服务并入根包 |

### package

| id | severity | exp | 改动（before → after） | 证据（简） |
|---|---|---|---|---|
| `package-plugin-prefix` | error | — | `@cordisjs/plugin-*` → `@cordisjs/*` | rc.13 release notes 与包表 |
| `package-config-entry-name` | error | — | config entry `name: @cordisjs/plugin-*` → `@cordisjs/*` | rc.13 要求 config name 用新名 |
| `package-cordis-peer` | warning | — | `"cordis": "^3.x"` → `"cordis": "^4.0.0-rc.13"` | v4 loader/hmr/group/timer/fs 统一 `^4.0.0-rc.13` |

### api / Context

| id | severity | exp | 改动（before → after） | 证据（简） |
|---|---|---|---|---|
| `context-base-dir` | warning | — | `.baseDir` → `.baseUrl` | v3 `Context.baseDir`；v4 `baseUrl?` |
| `context-root` | warning | — | `ctx.root` → `ctx[Context.root]` | v3 `root: this`；v4 `[symbols.root]` + `static root`；rc.12 notes |
| `context-config` | warning | 是 | `ctx.config` → `ctx.fiber.config` | v3 scope.resolved config；v4 Fiber.config 是**原始**输入 |
| `context-lifecycle` | warning | — | `ctx.lifecycle` → `ctx.events` | v3 已有 `get events()`；v4 `events: EventsService`；事件名另核 |
| `context-using` | warning | — | `ctx.using(` → `ctx.inject(` | v3 已 deprecated，v4 移除 |
| `context-plugin-use` | warning | — | `ctx.plugin(` → `ctx.use(` | v4 registry.d.ts 标 deprecated |
| `entry-fiber` | warning | — | `entry.fiber` → `entry.innerFiber` | rc.13 release notes |

### config

| id | severity | exp | 改动（before → after） | 证据（简） |
|---|---|---|---|---|
| `config-base-dir` | warning | — | `baseDir:` → `baseUrl:` | v4 `Loader.Config.baseUrl` |
| `config-plugin-legacy-flags` | warning | 是 | 删除独占一行的 `reactive: true` / `reusable: true` | v3 Plugin.Base 有，v4 Component.Base 无；无法限定为组件对象 |

### lifecycle

| id | severity | exp | 改动（before → after） | 证据（简） |
|---|---|---|---|---|
| `lifecycle-dispose-listener` | warning | — | `ctx.on('dispose', fn)` → `ctx.effect(() => fn)` | v4 公共 dispose 事件移除 |

> `lifecycle-internal-event-rename` 已在 2026-11-15 复核后移除：目标事件名存在，但 `internal/before-update` 的签名变成 `(this: Fiber, resolvedConfig, next)`，`internal/fork` 的 `ForkScope` 变成 `Fiber`，直接改名不是等价替换；见下文“有意未自动覆盖的断点”。

### service

| id | severity | exp | 改动（before → after） | 证据（简） |
|---|---|---|---|---|
| `service-super-immediate` | warning | — | `super(ctx, 'name', true)` → `super(ctx, 'name')` | v4 构造器去掉了第三参 |
| `service-set-provide` | warning | 是 | `ctx.set(` → `ctx.provide(` | 新注册可换；v4 `set` 仅覆盖，清理/覆盖语义需保留 |
| `service-start-init` | warning | 是 | 行首 `start() {` → `[Service.init]() {` | v4 Service 无 start/stop；会误伤普通类 |
| `service-provide-builtin` | warning | — | `ctx.provide(name, value, true)` → `ctx.provide(name, value)` | v3 第三参 builtin；v4 公共签名无第三参 |

> `service-setup-init` 已在 2026-11-15 复核后移除：v3 `Service.setup` 只在**无 ctx 的独立构造**时调用（用于创建 Context），v4 `Service.init` 是所有类插件**构造后**的初始化钩子；两者不是同一语义，无直接对应。见下文“有意未自动覆盖的断点”。

### hmr

| id | severity | exp | 改动（before → after） | 证据（简） |
|---|---|---|---|---|
| `config-hmr-watch-api` | warning | — | `ctx.hmr.watch(` → `ctx.fs.watch(` | rc.13 release notes；v4 HMR `watch.enabled` |

> 表格中的 “before → after” 是典型形态，不是完整正则；边界（别名、注释、字符串、多行）请以 `rules --json` 的 pattern 和实际 dry-run 为准。

## `experimental` 规则复核（2026-11-15）

以 npm 实际解包为准：v3 = `cordis@3.18.1` + `@cordisjs/core@3.18.1`（`src/*.ts`），v4 = `cordis@4.0.0-rc.13`（`lib/*.d.ts` / `lib/index.js` / `package.json`）。本地 `docs/cordis-primer.zh.md` 与 `docs/cordis-api/*.zh.md` 用于交叉核对。10 条原 `experimental` 规则逐条结论如下（4 条升级 stable、4 条保留 experimental、2 条删除）。

| id | 证据（v3 → v4） | 结论 | 替换是否正确 |
|---|---|---|---|
| `package-cordis-peer` | v3 `@cordisjs/plugin-hmr@0.2.6` peer `^3.18.0`；v4 `loader@1.0.0-rc.10`、`hmr@2.0.0-rc.0`、`group@1.0.1`、`timer@1.1.5`、`fs@2.0.0-rc.0` 的 `peerDependencies.cordis` 均为 `^4.0.0-rc.13`（npm view） | **stable** | 是：目标范围与 v4 生态一致 |
| `context-root` | v3 `src/context.ts:55` `root: this`；v4 `lib/context.d.ts:9` `[symbols.root]: this`、`:19` `static readonly root`，`lib/index.js:1623` `this[symbols.root] = self`；rc.12 notes | **stable** | 是：需把 `Context` 作为值导入 |
| `context-lifecycle` | v3 `src/context.ts:56` `lifecycle: Lifecycle`，`:126` 已有 `get events()`；v4 `lib/context.d.ts:13` `events: EventsService` | **stable** | 是（仅属性名）；v4 事件表已变，事件名另核 |
| `service-provide-builtin` | v3 `src/reflect.ts:12` `provide(name, value?, builtin?: boolean)`；v4 `lib/reflect.d.ts:10-11` 公共 `provide(name, value?)` 无第三参（`:52` 内部 `check?` 非公共签名） | **stable** | 是：移除布尔第三参 |
| `context-config` | v3 `src/context.ts:59` `config: any`，`src/reflect.ts:103` 混入 scope（resolved）；v4 `lib/context.d.ts` 无 config，`lib/fiber.d.ts:52` `config: any` 为原始输入（rc.11 notes） | **keep-experimental** | 部分：`ctx.fiber.config` 是 raw，不是 v3 的 resolved |
| `service-set-provide` | v3 `src/reflect.ts:9-12` `set` 注册并返回 disposer、`provide` 标 deprecated，`:116-148` set 实现；v4 `lib/reflect.d.ts:8-11` `provide` 注册、`set` 只能覆盖 | **keep-experimental** | 部分：新注册正确；清理/覆盖语义错误 |
| `service-start-init` | v3 `src/service.ts:14-15` `start()`/`stop()`；v4 `lib/service.d.ts:5` `static readonly init`，`lib/index.js:362` 构造后调用，无 start/stop | **keep-experimental** | 仅 Service 子类正确；会误伤普通类，`stop()` 无对应 |
| `config-plugin-legacy-flags` | v3 `src/registry.ts:59-60` `Plugin.Base { reactive?; reusable? }`；v4 `lib/registry.d.ts:22-28` `Component.Base` 无此二字段 | **keep-experimental** | 仅组件对象正确；按行删除无法区分同名业务字段 |
| `lifecycle-internal-event-rename` | v3 `src/events.ts:226/232/234/238`；v4 `lib/events.d.ts:53-57/63`。名称存在，但 `before-update` 形状 `(fork, config)` → `(this: Fiber, resolvedConfig, next)`，`fork` 的 `ForkScope` → `Fiber` | **remove** | 否：`before-update`/`fork` 直接改名会传入错误参数 |
| `service-setup-init` | v3 `src/service.ts:7` `static setup`，`:53` 仅无 ctx 构造时调用，`:81` `[symbols.setup]` 创建 Context；v4 `lib/service.d.ts:5` `init`，`lib/index.js:362` 构造后调用 | **remove** | 否：v3 setup 是独立构造的 Context 创建，v4 init 是构造后钩子，语义不同 |

`ctx.config` 与 `ctx.set` 两条保留原因不是“名字不存在”，而是替换后的语义不等价；`start()` 与 `reactive` 两条保留原因是文本无法限定作用域。两条删除规则已从 `RULES`、fixtures 与聚合迁移中移除，测试会断言其不再出现。

同日第二轮复核重新解包 npm 的 `cordis@4.0.0-rc.13` tarball（`dist.integrity` 为
`sha512-rYsquBfrd1U8HuaDr/1TYpdnHiuy5X2oEWJbfEveIZwysfjg3vTXJWKvTPlaPtt2VeFsAJIrzHZnymONyOr3PA==`），
四条仍不能升级：

- `context-config`：`lib/context.d.ts` 没有 `config`；`lib/fiber.d.ts:52` 的
  `config: any` 是构造时保存的原始输入，`lib/index.js:356` 的 `_resolve()` 只在
  执行回调前产生 resolved config 并作为实参传入，没有可用的
  `ctx.fiber.config` 等价读取。保留的原因是 raw/resolved 语义不同，不是 API 缺失。
- `service-set-provide`：`lib/index.js:1012-1017` 的 `set` 在未 `provide` 时直接抛
  `cannot set property ... without provide`，`:1024` 的 `provide` 才注册并返回
  disposer。把 `ctx.set(` 一律改为 `ctx.provide(` 仍会破坏覆盖/清理语义。
- `service-start-init`：`lib/service.d.ts:5` 只有 `static readonly init`，
  `lib/index.js:362` 在构造后调用 `instance[symbols.init]?.()`，没有 `start()` /
  `stop()`。pattern 只匹配行首 `start() {`，无法确认所在类是 `Service` 子类，且
  `stop()` 没有对应改写。
- `config-plugin-legacy-flags`：`lib/registry.d.ts:22-28` 的 `Component.Base` 仍无
  `reactive` / `reusable`；但按行删除仍无法区分插件/组件对象与同名业务 config
  字段。

结论：四条均保持 `experimental: true`，本轮不升级。

## 来源（2026-11-15 核对）

**本地文档（DeepSeek Harness checkout）：**

- `/mnt/d/deepseek-harness/docs/cordis-primer.zh.md`：插件/上下文/注入/事件分发/effect 约定。
- `/mnt/d/deepseek-harness/docs/cordis-api/`：`context.zh.md`、`events.zh.md`、`service.zh.md`、`registry.zh.md`、`fiber.zh.md`。
- 同一份 primer 的公开页：<https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer>。

**公开来源：**

- npm tarball 实际解包与 registry JSON（类型声明、export map、peerDependencies）：[`cordis@3.18.1`](https://registry.npmjs.org/cordis/3.18.1)、[`cordis@4.0.0-rc.13`](https://registry.npmjs.org/cordis/4.0.0-rc.13)、[`@cordisjs/core@3.18.1`](https://registry.npmjs.org/@cordisjs/core/3.18.1)、[`@cordisjs/plugin-hmr@0.2.6`](https://registry.npmjs.org/@cordisjs/plugin-hmr/0.2.6)、[`@cordisjs/loader@1.0.0-rc.10`](https://registry.npmjs.org/@cordisjs/loader/1.0.0-rc.10)、[`@cordisjs/hmr@2.0.0-rc.0`](https://registry.npmjs.org/@cordisjs/hmr/2.0.0-rc.0)。
- GitHub release notes：<https://github.com/cordiverse/cordis/releases/tag/v4.0.0-rc.13>（plugin 改名、`ctx.plugin`→`ctx.use`、HMR、`entry.fiber`）与 `v4.0.0-rc.12`（`ctx.root`）、`v4.0.0-rc.11`（`fiber.config`、internal 事件拆分）。
- Cordis 仓库 README：<https://github.com/cordiverse/cordis>（官方文档仍在建设中，README 明确 API 未稳定）。

`src/rules.js` 顶部的 `RULE_SOURCES` 与 `rules --json` 的 `sources` 是同一份可审计清单。

## 规则迁移说明（0.1.x → 0.2.4）

旧的 5 条“示例规则”已替换为 24 条带证据的规则，部分 id 变化：

| 0.1.x | 0.2.4 |
|---|---|
| `import-specifier` | `import-cordis-loader` |
| `context-type-import` | 移除（`Context` 可能同时作值，类型导入改写风险过高） |
| `dispose-listener` | `lifecycle-dispose-listener` |
| `ctx-plugin-to-use` | `context-plugin-use` |
| `config-base-dir` | 拆成 `context-base-dir`（`.baseDir`）与 `config-base-dir`（`baseDir:` 键） |

## 输出形状

`scanSource`：

```json
{ "ruleId": "context-plugin-use", "line": 5, "column": 3, "before": "ctx.plugin(", "after": "ctx.use(" }
```

行、列均为 **1-based**；列按 UTF-16 code unit 计数。`plan`：

```json
{
  "command": "scan",
  "ok": true,
  "notice": "Community-curated, unofficial Cordis 3 -> 4 migration rules ...",
  "changes": [{ "path": "src/a.js", "matches": [] }],
  "skipped": [{ "path": "assets/logo.png", "reason": "binary-extension" }],
  "summary": { "files": 2, "changedFiles": 1, "matches": 5, "skipped": 1 }
}
```

`skipped.reason` 可能是：`binary-extension`、`binary-nul`、`invalid-utf8`、`unsupported-content`、`invalid-file`（库输入问题）、`unreadable`（CLI 读取失败）。**无匹配的文本文件既不在 `changes` 也不在 `skipped`**，只计入 `summary.files`。

## 安全模型

- **默认 dry-run**：`apply` 不带 `--write` 时绝不写盘；`scan` 与 `rules` 永远只读。
- **显式写盘**：`--write` 必须由调用者传入；与 `--dry-run` 同时出现直接报错。
- **不执行**：不运行 git、npm、shell、网络请求，不安装依赖，不判断版本兼容性。
- **可能改 package.json**：`package` 类规则会匹配文本中的 `@cordisjs/plugin-*`、`"cordis": "^3.x"` 等片段；如果目标目录包含 `package.json`，dry-run 会列出来，`--write` 会按文本改写。它不是语义化的依赖安装/解析。
- **不碰二进制**：已知二进制扩展名、含 NUL 字节、非法 UTF-8 的文件都会跳过；不会做有损解码后再写回。
- **不跟随符号链接**：目录遍历时跳过 symlink，避免越界或环。
- **默认忽略**：`.git`、`node_modules`、`dist`、`build`、`coverage`、`.cache`、`.next`、`.output`、`.turbo`，以及 lockfile、`*.min.js`、`*.map`。
- **不原子写**：直接 `writeFile` 覆盖；请用版本控制或先备份。

## 限制

- 不是解析器/AST：不理解作用域、别名、类型、字符串与注释；会误报/漏报。
- 只做单行匹配：多行函数体、模板字符串内的跨行内容不会被处理。
- 重叠匹配：`scanSource` 会全部返回；`applySource` 按**最左非重叠优先**选择，其余跳过。
- 幂等性依赖“替换后不再匹配同一 `before`”。内置 24 条规则均满足（测试覆盖）；自定义规则若把旧文本重新引入，重复应用可能继续变化。
- 不处理二进制、编码转换、BOM 之外的编码；BOM 会保留，但参与第 1 行的列计数。
- 不生成备份、不自动提交、不判断“这个改动是否语义正确”。
- CLI 只使用内置 `RULES`；自定义规则目前只能通过库 API 使用。
- 大目录会一次性把文件读入内存（MVP 取舍），没有增量/流式扫描。

### 有意未自动覆盖的断点

以下变化确实存在于 v3 → v4，但没有足够窄且语义安全的文本替换，因此**故意不写成规则**（扫描时不会提示，需人工排查）：

- `ctx.on('ready', fn)` / `ctx.on('fork', fn)`：v4 移除这两个公共事件；替代写法取决于意图（fiber 就绪、inject 回调、effect），不能机械替换。
- `ctx.off(...)`、`ctx.start()` / `ctx.stop()`：v4 移除；应改为保存 `on()` 返回的 disposer / 交给 fiber 生命周期。
- `Service.setup` → `Service.init`：v3 `Service.setup` 只在无 ctx 的独立构造时调用（用于创建 Context），v4 `Service.init` 是类插件构造后的初始化钩子；没有等价替换，需按原意重写（通常是直接 `super(ctx, name)` 并改用 effect）。
- `internal/before-service` / `internal/before-update` / `internal/fork` / `internal/event` 改名：v3 `internal/before-update(fork, config)` 到 v4 `internal/update(this: Fiber, resolvedConfig, next)`、`internal/fork` 的 `ForkScope` 到 `internal/plugin` 的 `Fiber` 都改变了参数/接收者；`before-service` 的 before/after 时机也不同。不要只改名字。
- `cordis/import`、`cordis/worker` 子路径：v4 没有可直接对应的同名导出；`@cordisjs/include` / `@cordisjs/fs` 的职责与 v3 不完全相同，需按用法重写。
- `@cordisjs/plugin-logger` 等 rc.13 包表之外的 `plugin-*` 名称：不猜测目标包，保留给人工判断。
- HMR 的 `root` / `ignored` → `watch.files` 结构迁移：需要跨行/嵌套 YAML 结构，超出单行规则能力。

## 测试

```sh
cd packages/cordis-migrate
npm test
```

当前 **65 个测试**（`node --test test/*.test.js`，全部离线）：

- `test/rules.test.js`（34）：规则完整性（≥20 条、字段齐全、id 唯一、evidence 非空、experimental 类型）、每个 kind 覆盖、**每条规则一个正例 + 一个反例 + 幂等固定点，并单独断言每条 stable 规则的正反例**、别名/默认导入/类型导入/引号/JSON/YAML 变体、24 条规则聚合一次迁移、`formatRules` 文本/JSON 可序列化、来源清单、两条删除规则的回归断言。
- `test/core.test.js`（16）：scan/apply/plan/formatPlan 的引擎行为，CRLF/LF/混合行尾、重叠最左优先、陈旧匹配、二进制/非法 UTF-8 跳过、BOM、自定义规则校验、内置规则默认值。
- `test/cli.test.js`（15）：`rules` 文本/JSON/只读拒绝、`scan`、默认 dry-run、显式 `--dry-run`、`--write`、二次写入幂等、二进制不被改动、`--write --json`、冲突参数、缺失目标、`--help`/`--version`。**全部规则的 dry-run 测试确认文件字节不变；`--write` 测试断言迁移结果并再次运行确认幂等。**

CLI 测试用 `mkdtemp` 在系统临时目录创建隔离目录，`t.after` 清理；不触碰用户目录或真实仓库。

## 命名核验

2026-11-14 的初步核验（**不是**商标或法律检索）：

```sh
npm view cordis-migrate version
# npm error code E404 / Not found  → 该名字当时未在 npm 注册
```

- npm 上存在官方的 `cordis` 包（`cordis@4.0.0-rc.13` 为当前 latest），其维护者是 Cordiverse；本包**不是**其官方工具，也不代表其立场。
- 名称可用性会变化；发布前请重新核验，并确认不与既有商标/组织政策冲突。

## 非官方声明

本项目是社区实验，**不隶属于 Cordiverse / Cordis / DeepSeek**，未获其背书。“Cordis” 及相关名称归其各自权利人所有。内置规则是社区整理的迁移线索，不是官方迁移指南；标为 `experimental` 的规则尤其只应作为人工审查的起点。按本工具输出修改代码的风险由使用者承担。

## 许可

Apache-2.0，见 [LICENSE](./LICENSE)。
