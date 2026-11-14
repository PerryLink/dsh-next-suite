# dsh-capdiff

> 社区项目，**与 DeepSeek（深度求索）及 DeepSeek Harness 官方无隶属关系、无赞助、无背书**。
> Apache-2.0，版本 `0.1.1`，**已发布到 npm**。

## 是什么

`dsh-capdiff` 是一个**静态能力差异扫描器**：读取 DSH 插件 manifest 里的 `dsh.capabilities`，扫描源码中**静态可见**的模块引用与语言级能力使用，然后报告：

| 结果 | 含义 |
|---|---|
| `matched` | manifest 声明了，扫描也看到了 |
| `undeclared` | 代码里静态可见，但 manifest 没声明 |
| `unused` | manifest 声明了，但在被扫描文件里没看到 |

它**不执行**插件代码。它输出的是供人复核的候选差异，**不是安全审计，也不声称 `checked=safe`**。

## 为什么

DSH 插件 manifest 可以声明 `dsh.capabilities`，但声明是手写的，代码里实际 import 了什么往往没人对照。`dsh-capdiff` 用零依赖的正则启发式做第一道低成本检查：

- PR / 发版前看一眼「声明和 import 是否对得上」；
- 把差异转成 SARIF，接进代码扫描面板；
- 把「声明了但没看到」的项当成清理提示，而不是结论。

## 安装

已发布到 npm：`npx dsh-capdiff@0.1.1 --help`。也可直接从源码运行（需要 Node `^22.19.0 || >=24.9.0`）：

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
  -V, --version      版本（输出 `dsh-capdiff 0.1.0` 并 exit 0）
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
| `filesystem` | `import fs from 'node:fs'`、`require('fs/promises')` |
| `network` | `node:net`、`node:http`、`node:https`、`node:http2`、`node:tls`、`node:dgram`；`fetch` 仅作为 import specifier 映射，全局 `fetch(...)` 调用目前不扫描 |
| `process` | `node:child_process` |
| `env` | `process.env`、`process['env']` |
| `eval` | `eval(...)`、`new Function(...)` |
| `crypto` | `node:crypto` |
| `unknown` | 映射表之外的 import（含相对路径、第三方包、其他内建模块） |

声明侧会做有限规范化（大小写、`_`/空格、常见别名），例如 `fs` → `filesystem`、`http` → `network`、`child_process` → `process`、`environment_variables` → `env`。`unknown` 是兜底类别，不是真实能力；相对路径 import 也会落到 `unknown`，通常应结合上下文判断，或显式声明 `unknown`。

### 输出

人类可读摘要（默认）：

```text
dsh-capdiff 0.1.0 - static capability diff (heuristic)
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
  "version": "0.1.0",
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

**这是静态启发式，不是解析器、不是沙箱、不是审计。**

- **只报「静态可见」**。以下都可能完全看不到：
  - 计算出的 specifier：`import(name)`、`require(name)`；
  - `createRequire()`、`node:vm`、native addon、子进程里再 require；
  - `globalThis['process']['env']`、`const { env } = process`、`process['e' + 'nv']`；
  - 配置驱动 / 插件加载器在运行时加载的模块；
  - 传递依赖里的能力（本工具只扫描目标目录内的源码）。
- **`unused` 不是死代码证明**：能力可能通过动态方式使用，或只在未扫描的分支/文件中使用。
- **`matched` / 0 findings 不是安全证明**：manifest 本身可能漏声明、错声明或不可信；本工具不验证 manifest 的签名/来源，也不验证能力使用是否安全。
- **误报**：正则不解析 AST；对象方法 `eval() {}`、类方法、注释/字符串边界、正则字面量等场景可能产生误报。代码中的注释与字符串内容会被遮蔽，但模板字面量整体被遮蔽，`${process.env.X}` 这类用法会漏报；正则字面量中的引号也可能干扰遮蔽。
- **范围**：只扫描 `.js` / `.mjs` / `.cjs`；不扫描 `.ts` / `.jsx` / `.json` / native 文件；跳过 `node_modules`/`.git`，不跟随 symlink；不读取 `package.json` 的 `imports`/`exports` 语义。
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
