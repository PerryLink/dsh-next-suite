# DESIGN — dsh-capdiff

> 状态：0.1.x。默认使用 acorn AST（可选依赖），解析失败或依赖缺失时回退到 Node 内建正则扫描器。
> 本文说明「为什么这样实现」，以及它**故意不做**什么。

## 1. 目标

给定一个 DSH 插件目录和一份 manifest，回答：

1. 代码里静态可见的能力，manifest 声明了吗？（`undeclared`）
2. manifest 声明的能力，在扫描文件里看得到吗？（`unused`）
3. 两边都有的能力是哪些？（`matched`）

输出三种形态：人类摘要、JSON、SARIF 2.1.0。作为 CI/PR 的**第一道提示**，而不是安全判定。

## 2. 非目标

- 不做运行时沙箱、不执行插件代码、不发起网络请求。
- 不做完整语义分析 / 类型检查；AST 只做语法级匹配，不做作用域与绑定解析。
- 不验证 manifest 的真实性、签名或来源；manifest 在本工具眼里只是不可信输入。
- 不证明插件安全，不输出「checked / safe」结论。
- 不做依赖树分析（不递归 `node_modules`，也不分析传递依赖）。

## 3. 架构与流水线

```text
CLI (src/cli.js)
  parseArgs / read manifest / print
        │
        ▼
core (src/core.js)
  scanTarget(target)
    ├─ collectSourceFiles()      递归收集 .js/.mjs/.cjs
    ├─ analyzeSource(code)
    │    ├─ analyzeAst()         acorn AST（优先）
    │    ├─ analyzeSourceRegex() 解析失败 / 无 acorn 时回退
    │    │    ├─ extractImports()     正则 + 注释/字符串遮蔽
    │    │    └─ collectCapabilityEvidence()
    │    └─ capabilities        去重、保持首次出现顺序
    └─ 聚合跨文件的 capabilities + firstEvidence
  parseDeclared(manifest)
  diffCapabilities(declared, actual)
  buildFindings(diff, firstEvidence)
  toSarif(findings)
```

`ast.js` 通过 `createRequire` **同步**加载 acorn：`analyzeSource()` 保持同步 API，未安装 acorn 时也只是回退到正则，不会让包在 import 阶段直接崩溃。`capability.js` 存放两侧共用的映射表，避免 AST 与 core 循环依赖；core 继续 re-export `CAPABILITY_MAP` / `capabilityForSpecifier`。`src/cli.js` 只做参数解析、文件读取与输出，业务逻辑都在 core。因此 `node --test` 可离线运行。

## 4. 数据模型

```js
// extractImports() 的一项
{ specifier: 'node:fs', kind: 'static', index: 42 }
// kind: 'static' | 'dynamic' | 'require' | 're-export'

// collectCapabilityEvidence() 的一项（内部/导出）
{
  capability: 'env',
  origin: 'code',          // 'import' | 'code'
  kind: 'usage',           // import 时保留静态种类
  specifier: null,         // code 证据没有 specifier
  evidence: 'process.env',
  index: 120,
  line: 7
}

// diffCapabilities()
{
  matched: ['filesystem'],
  undeclared: ['env'],
  unused: ['network']
}

// buildFindings() 的一项
{ kind: 'undeclared', capability: 'env', file: 'src/a.js', line: 7,
  evidence: 'process.env', message: '...' }
```

所有数组都保持确定性顺序：import/能力证据按源码偏移，`matched`/`unused` 按声明顺序，`undeclared` 按实际检测顺序。重复能力折叠为一项。

## 5. 静态提取（AST 优先，正则回退）

`analyzeAst()` 用 acorn 解析（`sourceType: 'module'`、`ecmaVersion: 'latest'`、`allowHashBang`；失败后按 `script` 重试以覆盖常见 CJS），然后遍历节点：

| AST 节点 | 结果 |
|---|---|
| `ImportDeclaration` | `static` import |
| `ExportNamedDeclaration` / `ExportAllDeclaration`（有 source） | `re-export` |
| `ImportExpression` | `dynamic` import：任何 `import(...)` 都把 `dynamic` 置 `true`；字符串字面量 specifier 入 `imports`，计算值不猜 |
| `CallExpression` 且 callee 为 `require` | `require`；字面量 specifier 入 `imports` |
| `MemberExpression` `process.env` / `process['env']` | capability `env` |
| `MemberExpression` `fs.*` / `child_process.*` | `filesystem` / `process` |
| `CallExpression` `eval(...)` / `new Function(...)` | `eval` |
| `CallExpression` `fetch(...)` / `http(s).request(...)` | `network` |

`imports` 的 kind 与旧版一致：`static` / `dynamic` / `require` / `re-export`。

正则路径只作为回退，覆盖同样四类 kind：

| kind | 正则覆盖 |
|---|---|
| `static` | `import x from 'm'`、`import {a} from 'm'`、`import * as n from 'm'`、`import 'm'` |
| `dynamic` | `import('m')`（字符串字面量） |
| `require` | `require('m')`（字符串字面量） |
| `re-export` | `export {a} from 'm'`、`export * from 'm'`、`export * as n from 'm'` |

回退实现细节：

- 关键字前用 `(?<![\w$.])`，避免把 `foo.import(...)` / `foo.require(...)` 当作模块加载。
- `import` 子句字符集限制为标识符、空白、`{}`、`,`、`*`，避免在畸形源码里 `[\s\S]*?` 跨行吞掉无关文本。
- 副作用 import 的 `(?!\()` 防止把 `import ('m')` 重复记成 static 与 dynamic。
- `maskNonCode()` 把注释、字符串、模板字面量内容替换成空格，**长度与换行不变**。所有 match 再检查起始字符在原文与遮蔽文本中是否一致，从而跳过注释/字符串里的假 import 与假 `eval`。
- `index` 是语句关键字在源码中的 UTF-16 偏移；行号由 `lineOfIndex()` 换算（1-based）。

已知盲区：计算出的 specifier（`import(name)` / `require(name)`）、TypeScript/JSX（会触发回退）、混淆代码、作用域/绑定解析（同名局部变量、别名导入）、`createRequire`、正则字面量与模板 `${...}`（仅回退路径存在此盲区）。详见 §10。

## 6. 能力映射

`CAPABILITY_MAP` 是显式表：

- `node:fs` / `fs` / `fs/promises` → `filesystem`
- `node:net` / `net` / `node:http(s)` / `http(s)` / `http2` / `tls` / `dgram` / `fetch` → `network`
- `node:child_process` / `child_process` → `process`
- `node:crypto` / `crypto` → `crypto`
- 语言级：`process.env` → `env`；`eval`、`new Function` → `eval`

查找顺序：精确匹配 → 去掉 `node:` 再匹配 → 取 specifier 第一段匹配（因此 `node:fs/promises` 继承 `fs`）→ 否则 `unknown`。`unknown` 是有意保留的兜底：它既覆盖第三方包，也覆盖相对路径 import，提醒复核而不是假装不存在。

语言级检测在 AST 路径上覆盖 `process.env` / `process['env']`（含模板 `${...}` 内的用法）、`fs.*` / `child_process.*` 成员访问、`eval(...)`、`new Function(...)`、`fetch(...)`、`http(s).request(...)`；`obj.eval(...)` / `obj.fetch(...)` 不会被误判为全局调用。正则回退只覆盖 `process.env`、`process['env']`、`eval(...)`、`new Function(...)`，且用 lookbehind 排除 `obj.eval(...)`；两条路径都不处理 `(0, eval)`、`globalThis.eval`、`const { env } = process`、`process['e'+'nv']` 等变体。AST 不做作用域解析，因此局部同名 `fs` / `fetch` 可能误报，别名导入的成员调用可能漏报。

## 7. 声明解析与规范化

`parseDeclared()` 支持：

- `{ dsh: { capabilities: [...] } }`
- `{ dsh: { capabilities: { network: true, filesystem: false } } }`（truthy 才声明）
- `{ capabilities: [...] }`（脚本便利）
- 直接数组
- 数组元素 `{ capability | name | id | type }`，或 `{ network: true }`

规范化规则：

1. 去空白、转小写；
2. 精确命中 `CAPABILITY_MAP` 的 specifier 先映射（避免 `node:child_process` 中的 `_` 被折叠破坏）；
3. 空白/下划线折叠为 `-` 后查规范名与别名表（`fs`→`filesystem`、`http`→`network`、`environment_variables`→`env` 等）；
4. 未知自定义名保留为小写 token，不擅自归入 `unknown`。

声明顺序保留，重复项折叠。`diffCapabilities()` 对 declared/actual 再做一次同样的规范化，所以手写 `'fs'` 与 `'filesystem'` 能正确匹配。

## 8. 差异与 SARIF

`diffCapabilities()` 是纯集合运算：

- `matched = declared ∩ actual`
- `undeclared = actual − declared`
- `unused = declared − actual`

`buildFindings()` 把 `undeclared` 关联到该能力的首个证据（文件 + 行 + 触发文本），把 `unused` 关联到 manifest（若 CLI 已知）。`toSarif()` 输出：

- `version: "2.1.0"`、`$schema`；
- `runs[0].tool.driver.name = "dsh-capdiff"`；
- 规则 `dsh-capdiff/undeclared`（level `warning`）与 `dsh-capdiff/unused`（level `note`）；
- 每结果带 `ruleId`、`ruleIndex`、`message.text`、`properties.capability/kind`；
- 有文件时带 `physicalLocation.artifactLocation.uri`，有行号时带 `region.startLine`。

为什么 `undeclared` 不是 `error`：静态启发式有误报，且 manifest 可能只是尚未更新。工具应提示复核，不应把启发式当 blocker；CI 可用 JSON 的 `diff.undeclared` 自定义退出策略。

## 9. CLI contract

- `--json` 与 `--sarif` 互斥（同时给出 → exit 1），避免输出格式歧义。
- 未给出 `--manifest`：声明视为空集合，实际检测全部进入 `undeclared`；不自动猜 manifest 路径，避免错误归属。
- 目标不存在/不是可读路径、manifest 读不到或非法 JSON → stderr + exit 1。
- 扫描成功但存在 findings → 仍 exit 0；是否失败交给 CI 判断。
- 人类输出固定包含 heuristic 免责声明；JSON 的 `findings` 保留机器可读的 file/line/evidence。

## 10. 误报 / 漏报模型

| 类型 | 例子 | 结果 |
|---|---|---|
| 误报 | 同名局部变量/对象：`const fs = ...`、`const fetch = ...` | AST 不做绑定解析，可能多报 |
| 误报 | 正则回退时的对象/类方法 `eval() {}`、正则字面量边界 | 可能多报；AST 路径不会 |
| 误报 | 类型/死代码中的 import、仅测试用的 `node:fs` | 多报 |
| 误报 | manifest 用未收录的自定义名声明已知能力 | 可能出现 `undeclared` + `unused` 并存 |
| 漏报 | `import(name)`、`require(name)`、`createRequire()` | specifier 不可知；AST 仅置 `dynamic=true` |
| 漏报 | 别名导入的成员调用（`const fsx = require('node:fs'); fsx.readFile(...)`） | 看不到 `filesystem` |
| 漏报 | TypeScript / JSX / 混淆代码 | AST 解析失败后回退正则，覆盖不完整 |
| 漏报 | 模板中的 `${process.env.X}`（仅回退路径） | 正则整段遮蔽模板；AST 能看到 |
| 漏报 | `globalThis.process.env`、`const { env } = process`、`process['e'+'nv']` | 看不到 |
| 漏报 | `eval` 别名、`(0, eval)`、`Function(...)`（不带 `new`）、`node:vm`、native addon | 看不到 |
| 漏报 | 运行时从配置/网络加载的模块 | 看不到 |

因此 `matched` 只表示「声明与静态可见集合一致」；0 findings 只表示「当前启发式没发现差异」。两者都**不是**安全结论，也不覆盖「声明了但实际滥用」的情形。

## 11. 安全与信任边界

- 输入源码与 manifest 都按不可信文本处理；CLI 只读文件，不执行、不 eval、不联网。
- 本工具不验证 manifest 签名；信任链是另一个问题。若需要内容哈希/签名/撤销，应配合 `testatum-attest` 一类工具（本仓库另一包，未在此依赖）。
- SARIF 中的路径可能暴露本地目录结构；共享报告前请自行裁剪（CLI 不自动做绝对/相对路径策略之外的脱敏）。

## 12. 测试

`test/` 共 39 个 `node:test` 用例：

- `core.test.js`：静态/动态/require/re-export 提取、注释与字符串过滤、映射表、别名、`env`/`eval`、声明解析、diff、行号、SARIF、findings。
- `ast.test.js`：AST 静态/动态/require/re-export、`process.env`、`fs.*` / `child_process.*`、`eval` / `new Function`、`fetch` / `http(s).request`、属性误报、hashbang/CJS、解析失败回退、无 acorn 回退、与正则结果对比、benchmark fixtures 解析。
- `scan.test.js`：临时目录递归、扩展名过滤、`node_modules`/`.git` 跳过、跨文件证据聚合、空目录。
- `cli.test.js`：`--help`/`--version`、目录 + `--json`、`--sarif`、非法 manifest、互斥参数。

临时目录使用 `os.tmpdir()` + `mkdtemp`，测试结束在 `t.after` 中先断言路径位于 tmpdir 下再 `rm -rf`。验收命令：

```sh
cd packages/dsh-capdiff
node --check src/*.js
node --test test/*.test.js
node src/cli.js --help
```

## 13. 未来工作（不阻塞 0.1.x）

- 作用域/绑定解析：消除同名局部变量误报，识别别名导入的成员调用。
- TypeScript / JSX 解析器（或先剥离类型再交给 acorn），降低回退到正则的比例。
- 可配置 ignore glob、测试目录排除、baseline 与 SARIF fingerprints。
- 扩展语言级模式：`globalThis.process.env`、解构、`node:vm`、`globalThis.fetch`。
- 校验 manifest schema / 版本，报告未知声明名。
- 与 attestation 工具联动：把 manifest 签名状态带进报告。
