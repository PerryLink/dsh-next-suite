# cordis-migrate

> **非官方社区工具。** 与 Cordiverse / Cordis 项目、DeepSeek 均无隶属关系。
> Apache-2.0，`0.1.0`，**未发布**。内置规则是**示例**，不是官方迁移表。

Cordis 3 → 4 的**文本级迁移规则引擎**：扫描（scan）、生成计划（plan / dry-run）、显式写入（apply `--write`）。

纯 ESM JavaScript + JSDoc，零第三方依赖，Node `^22.19.0 || >=24.9.0`。

```sh
node packages/cordis-migrate/src/cli.js scan ./src
node packages/cordis-migrate/src/cli.js apply ./src            # 默认 dry-run
node packages/cordis-migrate/src/cli.js apply ./src --write    # 只有显式传入才写盘
```

## 是什么

### ⚠️ 先读这一节

1. **规则是示例，不是官方迁移表。** 5 条内置规则只用于演示引擎的匹配、计划、应用与幂等行为。它们参考了 `cordis@3.18.1` / `cordis@4.0.0-rc.13` 已发布类型声明中的若干表面差异（2026-11-14 查看），但 Cordis 4 仍在 RC，API 可能继续变化；规则也没有覆盖别名、re-export、动态构造、生成代码等真实情况。
2. **每条改动都必须人工确认。** `--write` 不会替你理解语义。例如 `Context` 既可能只作类型，也可能被 `extends`；`baseDir` 与 `baseUrl` 的路径/URL 语义可能不同。
3. **不要用本工具自动修改官方仓库。** 不向 `cordiverse/cordis` 或任何上游仓库提交自动改写结果；本工具不执行 git、不推送、不联网。
4. **先备份或用版本控制。** `--write` 直接覆盖文件，没有内置备份/回滚；请先看 dry-run 输出并在干净工作区操作。

一个可离线运行的规则引擎，核心只有四个函数：

| API | 作用 |
|---|---|
| `scanSource(code, rules)` | 扫描一段源码，返回 `{ruleId, line, column, before, after}` |
| `plan(files, rules)` | 对 `[{path, content}]` 生成 `{changes, skipped, summary}`，不碰磁盘 |
| `applySource(code, matches)` | 按行应用匹配，返回新代码；重复应用保持幂等 |
| `formatPlan(plan, {json})` | 把计划渲染为人类可读文本或 JSON |

CLI 只负责遍历目录、读取/写入文件、参数解析；匹配逻辑全部在 `src/core.js`，可脱离文件系统测试。

## 为什么

Cordis 3 → 4 迁移中有一批重复、机械、但**不能盲改**的文本变化：包说明符、仅类型导入、生命周期写法、方法名、配置字段。把它们做成显式规则，可以获得：

- 一条命令得到**可审阅的 diff 式清单**，而不是直接改文件；
- 规则可替换、可扩展（库 API 接受自定义规则）；
- 默认 dry-run，`--write` 必须显式，降低误伤；
- 二进制/非法编码文件自动跳过，不会写坏资源文件。

## 安装

尚未发布到 npm。在仓库内直接运行：

```sh
cd packages/cordis-migrate
npm test
node src/cli.js --help
```

发布后（未执行）预期为 `npm i -D cordis-migrate`。本包没有运行时依赖。

## 用法

### CLI

```sh
cordis-migrate scan <dir|file> [--json]
cordis-migrate apply <dir|file> [--dry-run | --write] [--json]
cordis-migrate --help
cordis-migrate --version
```

- `scan`：只报告匹配；永远不写文件；即使发现匹配，退出码仍为 `0`（便于 CI 解析 JSON 后自行判定）。
- `apply`：默认 `--dry-run`。只有显式 `--write` 才写盘；`--write` 与 `--dry-run` 互斥。
- `--json`：stdout 只输出一个 JSON 对象，至少包含 `{ command, ok }`，并带 `notice`、`changes`、`skipped`、`summary`；`--write --json` 额外包含 `write.{written,unchanged,failures}`，写入失败时 `ok=false`。
- 可以直接传单个文件，也可以传目录；目录会递归遍历。
- `-h` / `--help` 打印用法并 exit `0`；`-V` / `--version` 打印 `cordis-migrate 0.1.0` 并 exit `0`。

退出码：

| 码 | 含义 |
|---|---|
| `0` | 成功（包括 `scan` 发现匹配；匹配不是失败） |
| `1` | 保留：本工具没有“业务否定”状态 |
| `2` | 用法 / 输入 / IO 错误：无参数、未知命令、未知选项、目标不可读、写入失败 |

示例：

```sh
# 机器可读扫描
node packages/cordis-migrate/src/cli.js scan ./src --json > plan.json

# 人工审阅后再写
node packages/cordis-migrate/src/cli.js apply ./src
node packages/cordis-migrate/src/cli.js apply ./src --write
```

### 库

```js
import { RULES, applySource, formatPlan, plan, scanSource } from 'cordis-migrate'

const matches = scanSource(code, RULES)
console.log(matches) // [{ ruleId, line, column, before, after }, ...]

const next = applySource(code, matches)
const result = plan([
  { path: 'src/index.js', content: code },
  { path: 'assets/logo.png', content: pngBuffer },
])
console.log(formatPlan(result, { json: true }))
```

自定义规则（字段与内置规则相同）：

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

`pattern` 可以是带 `g` 的 `RegExp` 或不带 flags 的字符串（内部按 `g` 编译）；`replacement` 支持 JS 的 `$1` / `$&` 语法，或 `(match, ...captures) => string` 函数。规则按**行**匹配，不能跨行。

### 内置示例规则（非官方）

| id | kind | severity | 示例改动 | 为什么必须人工确认 |
|---|---|---|---|---|
| `import-specifier` | import | error | `from 'cordis/loader'` → `from '@cordisjs/loader'` | 目标包是否已安装、版本是否匹配 |
| `context-type-import` | type-import | warning | `import { Context } from 'cordis'` → `import type { Context } ...` | `Context` 若同时作值使用会破坏运行时代码 |
| `dispose-listener` | lifecycle | warning | `ctx.on('dispose', fn)` → `ctx.effect(() => fn)` | 只匹配简单标识符回调；闭包/多行/带参回调不匹配 |
| `ctx-plugin-to-use` | api | warning | `ctx.plugin(` → `ctx.use(` | 链式返回值与重载可能不同 |
| `config-base-dir` | config | warning | `baseDir` → `baseUrl` | 目录路径与 URL 语义不同；可能命中注释/字符串/无关对象 |

规则是**加权文本替换**，不是 AST 重写。`RULES_NOTICE` 常量与 CLI 输出中都会重复这条警告。

### 输出形状

`scanSource`：

```json
{ "ruleId": "ctx-plugin-to-use", "line": 5, "column": 3, "before": "ctx.plugin(", "after": "ctx.use(" }
```

行、列均为 **1-based**；列按 UTF-16 code unit 计数。`plan`：

```json
{
  "command": "scan",
  "ok": true,
  "notice": "These rules are illustrative examples, ...",
  "changes": [{ "path": "src/a.js", "matches": [] }],
  "skipped": [{ "path": "assets/logo.png", "reason": "binary-extension" }],
  "summary": { "files": 2, "changedFiles": 1, "matches": 6, "skipped": 1 }
}
```

`skipped.reason` 可能是：`binary-extension`、`binary-nul`、`invalid-utf8`、`unsupported-content`、`invalid-file`（库输入问题）、`unreadable`（CLI 读取失败）。**无匹配的文本文件既不在 `changes` 也不在 `skipped`**，只计入 `summary.files`。

### 安全模型

- **默认 dry-run**：`apply` 不带 `--write` 时绝不写盘；`scan` 永远只读。
- **显式写盘**：`--write` 必须由调用者传入；与 `--dry-run` 同时出现直接报错。
- **不执行**：不运行 git、npm、shell、网络请求，不安装依赖，不改 `package.json`。
- **不碰二进制**：已知二进制扩展名、含 NUL 字节、非法 UTF-8 的文件都会跳过；不会做有损解码后再写回。
- **不跟随符号链接**：目录遍历时跳过 symlink，避免越界或环。
- **默认忽略**：`.git`、`node_modules`、`dist`、`build`、`coverage`、`.cache`、`.next`、`.output`、`.turbo`，以及 lockfile、`*.min.js`、`*.map`。
- **不原子写**：直接 `writeFile` 覆盖；请用版本控制或先备份。

## 限制

- 不是解析器/AST：不理解作用域、别名、类型、字符串与注释；会误报/漏报。
- 只做单行匹配：多行函数体、模板字符串内的跨行内容不会被处理。
- 重叠匹配：`scanSource` 会全部返回；`applySource` 按**最左非重叠优先**选择，其余跳过。
- 幂等性依赖“替换后不再匹配同一 `before`”。内置规则满足；自定义规则若把旧文本重新引入，重复应用可能继续变化。
- 不处理二进制、编码转换、BOM 之外的编码；BOM 会保留，但参与第 1 行的列计数。
- 不生成备份、不自动提交、不判断“这个改动是否语义正确”。
- CLI 只使用内置 `RULES`；自定义规则目前只能通过库 API 使用。
- 大目录会一次性把文件读入内存（MVP 取舍），没有增量/流式扫描。

## 命名核验

2026-11-14 做了最小核验（**不是**商标或法律检索）：

```sh
npm view cordis-migrate version
# npm error code E404 / Not found  → 该名字当前未在 npm 注册
```

- GitHub 仓库名搜索 `cordis-migrate in:name`：0 个结果。
- npm 上存在官方的 `cordis` 包（`cordis@4.0.0-rc.13` 为当前 latest），其维护者是 Cordiverse；本包**不是**其官方工具，也不代表其立场。
- 名称可用性会变化；发布前请重新核验，并确认不与既有商标/组织政策冲突。

## 非官方声明

本项目是社区实验，**不隶属于 Cordiverse / Cordis / DeepSeek**，未获其背书。“Cordis” 及相关名称归其各自权利人所有。内置规则仅为示例，不构成官方迁移指南；按本工具输出修改代码的风险由使用者承担。

## 许可

Apache-2.0，见 [LICENSE](./LICENSE)。
