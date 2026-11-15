# dsh-capdiff

> 社区项目，**与 DeepSeek（深度求索）及 DeepSeek Harness 官方无隶属关系、无赞助、无背书**。
> Apache-2.0，版本 `0.2.1`，**已发布到 npm**。

## 是什么

`dsh-capdiff` 是一个**静态能力差异扫描器**：读取 DSH 插件 manifest 里的 `dsh.capabilities`，扫描源码中**静态可见**的模块引用与语言级能力使用，然后报告：

| 结果 | 含义 |
|---|---|
| `matched` | manifest 声明了，扫描也看到了 |
| `undeclared` | 代码里静态可见，但 manifest 没声明 |
| `unused` | manifest 声明了，但在被扫描文件里没看到 |

它**不执行**插件代码。它输出的是供人复核的候选差异，**不是安全审计，也不声称 `checked=safe`**。

## 为什么

DSH 插件 manifest 可以声明 `dsh.capabilities`，但声明是手写的，代码里实际 import 了什么往往没人对照。`dsh-capdiff` 用 acorn AST（优先）+ 正则（回退）做第一道低成本检查：

- PR / 发版前看一眼「声明和 import 是否对得上」；
- 把差异转成 SARIF，接进代码扫描面板；
- 把「声明了但没看到」的项当成清理提示，而不是结论。

## 安装

已发布到 npm：`npx dsh-capdiff@0.2.1 --help`。也可直接从源码运行（需要 Node `^22.19.0 || >=24.9.0`）：

```sh
node packages/dsh-capdiff/src/cli.js <file-or-dir> [--manifest path] [--json|--sarif]
```

作为 npm `bin` 使用（本地 `npm link` 或在该包目录 `npm install -g .` 之后）：

```sh
dsh-capdiff ./my-plugin --manifest ./my-plugin/plugin.json
```

离线测试：

```sh
cd packages/dsh-capdiff && npm test
# 或仓库根目录：
node --test packages/dsh-capdiff/test/*.test.js
```

## 用法

```text
dsh-capdiff <file-or-dir> [options]

  --manifest <path>  manifest JSON（含 dsh.capabilities）
  --json             输出机器可读 JSON
  --sarif            输出 SARIF 2.1.0
  -h, --help         帮助
  -V, --version      版本（输出 `dsh-capdiff 0.2.1` 并 exit 0）
```

- 目标是目录时递归扫描 `.js` / `.mjs` / `.cjs`，跳过任意层级的 `node_modules` 与 `.git`，不跟随 symlink。
- 未传 `--manifest` 时声明集合为空，所有检测到的能力都会成为 `undeclared`；人类可读输出会提示这一点。
- 是否在 CI 中失败由调用方根据 `diff.undeclared` 或 SARIF 决定，本工具不把 findings 当作失败。

退出码：

| 码 | 含义 |
|---|---|
| `0` | 扫描完成（**即使有 findings**） |
| `1` | 保留：本工具没有“业务否定”状态 |
| `2` | 用法、输入、manifest 或 IO 错误（无参数、未知选项、缺文件） |

### manifest 格式

数组：

```json
{
  "name": "example-plugin",
  "dsh": {
    "capabilities": ["filesystem", "network"]
  }
}
```

对象（truthy 表示声明，`false`/`0`/`null` 表示未声明）：

```json
{
  "dsh": {
    "capabilities": {
      "filesystem": true,
      "network": {
        "outbound": ["api.example.com"]
      },
      "eval": false
    }
  }
}
```

为了方便脚本调用，`manifest.capabilities` 和直接传入的声明数组也会被接受；数组元素除了字符串，也可以是 `{ "capability": "network" }` / `{ "name": "network" }` 形式的对象。

### 能力映射

| capability | 静态触发示例 |
|---|---|
| `filesystem` | `import fs from 'node:fs'`、`require('fs/promises')`、`fs.readFileSync(...)`（AST） |
| `network` | `node:net`、`node:http`、`node:https`、`node:http2`、`node:tls`、`node:dgram`；`fetch(...)`、`http.request(...)`、`https.request(...)`（AST） |
| `process` | `node:child_process`、`child_process.exec(...)`（AST） |
| `env` | `process.env`、`process['env']`（含模板 `${process.env.X}` 中的用法，AST） |
| `eval` | `eval(...)`、`new Function(...)`（AST 不会把 `obj.eval(...)` 当作全局 eval） |
| `crypto` | `node:crypto` |
| `unknown` | 映射表之外的 import（含相对路径、第三方包、其他内建模块） |

声明侧会做有限规范化（大小写、`_`/空格、常见别名），例如 `fs` → `filesystem`、`http` → `network`、`child_process` → `process`、`environment_variables` → `env`。`unknown` 是兜底类别，不是真实能力；相对路径 import 也会落到 `unknown`，通常应结合上下文判断，或显式声明 `unknown`。

### 分析路径（AST 与正则回退）

默认路径用 [acorn](https://github.com/acornjs/acorn) 解析：

- `sourceType: 'module'`、`ecmaVersion: 'latest'`、`allowHashBang`；模块解析失败时会再按 `script` 重试一次，以覆盖常见 CommonJS 文件。
- 遍历 `ImportDeclaration` / `ExportNamedDeclaration` / `ExportAllDeclaration` / `ImportExpression`、`require(...)`、`process.env`、`fs.*` / `child_process.*`、`eval(...)` / `new Function(...)`、`fetch(...)` / `http(s).request(...)`。
- 只把**字面量** specifier 记入 `imports`；`import(name)` / `require(name)` 这类计算值不猜，AST 结果里的 `dynamic` 会置为 `true`（任何 `import(...)` 也算运行时加载），提示静态解析可能不完整。

解析失败（TypeScript、JSX、语法错误）或 acorn 未安装时，`analyzeSource` 自动回退到原有正则扫描器，返回结构不变。程序化调用可直接使用 `dsh-capdiff/ast` 的 `analyzeAst(code, { filename })`；它返回 `{ imports, capabilities, dynamic, observations }`，失败时额外带 `parseError`。

### 输出

人类可读摘要（默认）：

```text
dsh-capdiff 0.2.1 - static capability diff (heuristic)
Target:   examples/my-plugin
Manifest: examples/my-plugin/plugin.json
Files:    2 source file(s) scanned
Declared: filesystem, network
Detected: env, filesystem, network

Undeclared (1) - used in code, absent from manifest:
  - env (src/index.js:12, process.env)

Matched (2): filesystem, network

Note: static heuristic only - "matched" and zero findings are not proof of safety.
```

`--json` 输出目标、文件数、`declared`、`actual`、`diff` 与 `findings`：

```json
{
  "command": "scan",
  "ok": true,
  "tool": "dsh-capdiff",
  "version": "0.2.1",
  "target": "/abs/path/my-plugin",
  "manifest": "/abs/path/my-plugin/plugin.json",
  "filesScanned": 2,
  "declared": ["filesystem", "network"],
  "actual": ["env", "filesystem", "network"],
  "diff": {
    "matched": ["filesystem", "network"],
    "undeclared": ["env"],
    "unused": []
  },
  "findings": [
    {
      "kind": "undeclared",
      "capability": "env",
      "file": "src/index.js",
      "line": 12,
      "evidence": "process.env",
      "message": "..."
    }
  ]
}
```

`--sarif` 输出最小 SARIF 2.1.0：`runs[0].tool.driver.rules` 只有 `dsh-capdiff/undeclared`（`warning`）与 `dsh-capdiff/unused`（`note`）两条规则，按需出现；`locations` 指向首个证据文件与行号（`unused` 指向 manifest，若已知）。

## 限制

**这是静态启发式，不是完整语义分析器、不是沙箱、不是审计。**

- **AST 覆盖常见语法，不覆盖 TypeScript / JSX / 混淆代码**。默认用 acorn（ESM，失败后按 CJS script 重试）解析常见 `.js` / `.mjs` / `.cjs`；遇到 `.ts` / `.tsx` / `.jsx`、语法扩展或畸形源码时解析失败，会自动回退到正则扫描器，能力集合可能因此不完整。
- **AST 不做作用域/绑定解析**。按名字匹配 `fs.*`、`child_process.*`、`fetch(...)`、`http(s).request(...)`，同名局部变量可能造成误报；反过来，别名导入（`import { readFile as read }`、`const fsx = require('node:fs')`）的成员调用不会被识别。
- **动态变量仍然漏报**。`import(name)`、`require(name)` 只把 `dynamic` 置为 `true`，不会猜 specifier；`process[envName]`、`process['e' + 'nv']`、`globalThis['process']['env']`、`const { env } = process`、`globalThis['ev' + 'al']`、`(0, eval)(...)`、不带 `new` 的 `Function(...)` 同样看不到。
- **运行时加载看不到**：`createRequire()`、`node:vm`、native addon、子进程里再 require、配置/插件加载器在运行时加载的模块，以及传递依赖里的能力（本工具只扫描目标目录内的源码）。
- **`unused` 不是死代码证明**：能力可能通过动态方式使用，或只在未扫描的分支/文件中使用。
- **`matched` / 0 findings 不是安全证明**：manifest 本身可能漏声明、错声明或不可信；本工具不验证 manifest 的签名/来源，也不验证能力使用是否安全。
- **正则回退有已知误报/漏报**：回退路径不解析 AST，对象/类方法 `eval() {}`、正则字面量中的引号等可能干扰遮蔽；模板字面量整体被遮蔽，`${process.env.X}` 会漏报。默认 AST 路径没有这两个问题，但回退时仍存在。
- **范围**：只扫描 `.js` / `.mjs` / `.cjs`；不扫描 `.ts` / `.tsx` / `.jsx` / `.json` / native 文件；跳过 `node_modules`/`.git`，不跟随 symlink；不读取 `package.json` 的 `imports`/`exports` 语义。
- **声明规范化是有限的**：未知的自定义能力名会保留（小写、空白/下划线折叠），不会自动变成某个已知类别。

因此：**「没有差异」只能说明「这两个集合在当前启发式下一致」，不能说明插件安全。**

## 命名核验

核验日期：**2026-11-14**（Asia/Shanghai）。

- npm Registry：`GET https://registry.npmjs.org/dsh-capdiff` → **HTTP 404**（`{"error":"Not found"}`），当前 npm 上无同名包。
- GitHub：`GET https://api.github.com/search/repositories?q=dsh-capdiff+in:name` → **`total_count: 0`**，当前仓库名搜索无同名仓库。

核验命令可复现：

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/dsh-capdiff
curl -sS 'https://api.github.com/search/repositories?q=dsh-capdiff+in:name'
```

以上只表示该日期这两个索引中没有同名项，**不构成商标或名称专有性判断**；发布前应重新核验。

## 非官方声明

这是一个社区工具，不隶属于 DeepSeek（深度求索）或 DeepSeek Harness 官方，也未获得其赞助或背书。“DeepSeek Harness”“DSH”仅用于说明兼容对象。

## License

Apache-2.0，见 [LICENSE](./LICENSE)。
