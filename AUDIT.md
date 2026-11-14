# 发布前审计 — dsh-next-suite（8 包）

- 审计日期：2026-11-14（Asia/Shanghai）
- 审计对象：`packages/dsh-capdiff`、`testatum-attest`、`dsh-supply-watch`、`cordis-hmr-doctor`、`cordis-migrate`、`cordis-testkit`、`dsh-xbrl`、`dsh-upgrade-atlas`
- 审计方式：只读检查 + 临时目录冒烟；**未修改任何实现代码或 package.json**，只新增本文件。
- 环境：Linux（WSL）上的 Node `v24.22.1`、npm `11.19.1`；另用 `npx node@22.19.0` 复跑测试。npm registry 与 GitHub API 可访问。
- 结论：**需修复，不建议按现状直接发布**。功能与测试全绿，阻断项是 8 包共用的仓库链接 404，以及 CLI/README 契约不统一。

---

## 0. PASS/FAIL 总表（8 包 × 9 项）

| 包 | 1 测试 | 2 `--help` | 3 命名 | 4 打包 | 5 元数据 | 6 CLI 冒烟 | 7 描述准确 | 8 合规 | 9 一致性 |
|---|---|---|---|---|---|---|---|---|---|
| `dsh-capdiff` | PASS | PASS | PASS | PASS | **FAIL** | PASS | PASS | PASS | **FAIL** |
| `testatum-attest` | PASS | PASS | PASS | PASS | **FAIL** | PASS | PASS | PASS | **FAIL** |
| `dsh-supply-watch` | PASS | PASS | PASS | PASS | **FAIL** | PASS | PASS | PASS | **FAIL** |
| `cordis-hmr-doctor` | PASS | PASS | PASS | PASS | **FAIL** | PASS | PASS | PASS | **FAIL** |
| `cordis-migrate` | PASS | PASS | PASS | PASS | **FAIL** | PASS | PASS | PASS | **FAIL** |
| `cordis-testkit` | PASS | PASS（无 CLI，N/A） | PASS | PASS | **FAIL** | PASS（库冒烟） | PASS | PASS | **FAIL** |
| `dsh-xbrl` | PASS | PASS | PASS | PASS | **FAIL** | PASS | PASS | PASS | **FAIL** |
| `dsh-upgrade-atlas` | PASS | PASS | PASS | PASS | **FAIL** | PASS | PASS | PASS | **FAIL** |

说明：

- 第 5 项不是字段缺失，而是 `repository` / `homepage` / `bugs` 指向的仓库在公网 **404**；详见 §5、§10-F1。
- 第 9 项是套件级一致性问题（README 结构、退出码、版本参数、JSON 形状），逐包均受影响；详见 §9、§10-F2。
- 除第 5、9 项外，8 包的测试、帮助、命名、打包、冒烟、描述和合规检查均通过。

---

## 1. 测试与语法检查

### 1.1 结果

| 包 | `node --test`（包内） | `npm test`（包内） | `node --check src/*.js` |
|---|---:|---:|---|
| `dsh-capdiff` | 26/26 | 26/26 | 2/2 |
| `testatum-attest` | 25/25 | 25/25 | 2/2 |
| `dsh-supply-watch` | 45/45 | 45/45 | 2/2 |
| `cordis-hmr-doctor` | 34/34 | 34/34 | 2/2 |
| `cordis-migrate` | 26/26 | 26/26 | 2/2 |
| `cordis-testkit` | 27/27 | 27/27 | 1/1 |
| `dsh-xbrl` | 27/27 | 27/27 | 2/2 |
| `dsh-upgrade-atlas` | 32/32 | 32/32 | 2/2 |
| **合计（8 包）** | **242/242** | **242/242** | **15/15** |

- 根目录 `npm test`：**243 tests / 243 pass / 0 fail / exit 0**（Node 24.22.1）。
- `npx node@22.19.0 --test packages/*/test/*.test.js`：**243/243 pass**，说明声明的 `^22.19.0` 下限在测试层面可跑。
- 根目录 243 与 8 包 242 的差额是 `packages/_template/test/core.test.js` 的 1 个测试；根 `npm test` 的 glob 是 `packages/*/test/*.test.js`，把模板包也带进来了。模板不属于本次 8 包，详见 §11。

复现命令：

```sh
npm test
for p in dsh-capdiff testatum-attest dsh-supply-watch cordis-hmr-doctor \
         cordis-migrate cordis-testkit dsh-xbrl dsh-upgrade-atlas; do
  (cd "packages/$p" && node --test)
  (cd "packages/$p" && npm test)
done
for p in dsh-capdiff testatum-attest dsh-supply-watch cordis-hmr-doctor \
         cordis-migrate cordis-testkit dsh-xbrl dsh-upgrade-atlas; do
  for f in "packages/$p/src/"*.js; do node --check "$f"; done
done
```

### 1.2 环境备注（不是包缺陷）

- `node --test packages/<pkg>/test/`（把目录作为参数）在 Node 24.22.1 下会报
  `Cannot find module '.../test'`（目录被当作入口模块）。包内 `node --test` 与
  `node --test packages/<pkg>/test/*.test.js` 都正常；README 使用的是后者。
- 建议文档不要写“`node --test <dir>`”这种形式；当前 README 未写，无需修改代码。

---

## 2. 每个 CLI 的 `--help`

全部 7 个 CLI 均为 **exit 0、stdout 有输出、stderr 为空**。`cordis-testkit` 按任务约定无 CLI。

| CLI | exit | 输出首行 / 关键覆盖 |
|---|---:|---|
| `dsh-capdiff` | 0 | `Usage: dsh-capdiff <file-or-dir> [options]`；含 `--manifest`、`--json`、`--sarif`、`-h`、`-v`、退出码说明 |
| `testatum-attest` | 0 | `testatum-attest 0.1.0 - HMAC-signed trust cards for plugin artifacts`；含 sign/verify/revoke、`--json`、环境变量、HMAC 限制 |
| `dsh-supply-watch` | 0 | `dsh-supply-watch - offline npm name and version heuristics`；含 check/scan、`--known`、`--versions`、`--json`、安全声明 |
| `cordis-hmr-doctor` | 0 | `cordis-hmr-doctor 0.1.0 - explain Cordis HMR logs (unofficial)`；含 stdin `-`、`--json` |
| `cordis-migrate` | 0 | `cordis-migrate — Cordis 3→4 migration rule engine (unofficial)`；含 scan/apply、`--dry-run`/`--write`、退出码 |
| `dsh-xbrl` | 0 | `dsh-xbrl 0.1.0 — offline XBRL fact reconciliation and restatement diff`；含 check/diff、`--json`、退出码 |
| `dsh-upgrade-atlas` | 0 | `dsh-upgrade-atlas 0.1.0`；含 list/query/render/stats/add、`--data`、`-V`、`--version` |

结论：**PASS**。

---

## 3. 命名核验

核验日期：2026-11-14。npm Registry 全部 404；GitHub 仓库名搜索全部 `total_count: 0`。

| 名称 | `npm view <name> version` | registry HTTP | GitHub `search/repositories?q=<name>+in:name` |
|---|---|---|---|
| `dsh-capdiff` | E404 / exit 1 | 404 | HTTP 200, total_count 0 |
| `testatum-attest` | E404 / exit 1 | 404 | HTTP 200, total_count 0 |
| `dsh-supply-watch` | E404 / exit 1 | 404 | HTTP 200, total_count 0 |
| `cordis-hmr-doctor` | E404 / exit 1 | 404 | HTTP 200, total_count 0 |
| `cordis-migrate` | E404 / exit 1 | 404 | HTTP 200, total_count 0 |
| `cordis-testkit` | E404 / exit 1 | 404 | HTTP 200, total_count 0 |
| `dsh-xbrl` | E404 / exit 1 | 404 | HTTP 200, total_count 0 |
| `dsh-upgrade-atlas` | E404 / exit 1 | 404 | HTTP 200, total_count 0 |

GitHub 搜索使用未认证 API；限制为每分钟 10 次。8 次查询均返回 HTTP 200，最后一次检查 `x-ratelimit-remaining: 4`，**未因限流返回 403/429**。该结果是“当日未检索到同名”，不构成商标或名称专有性判断。

结论：**PASS**（8/8 名称当前可用性核验通过）。

---

## 4. `npm pack --dry-run --json`

| 包 | entryCount | 包含的文件 | 含 test？ | 含 tgz？ |
|---|---:|---|---|---|
| `dsh-capdiff` | 6 | `DESIGN.md`, `LICENSE`, `README.md`, `package.json`, `src/cli.js`, `src/core.js` | 否 | 否 |
| `testatum-attest` | 6 | 同上结构（`src/cli.js`, `src/core.js`） | 否 | 否 |
| `dsh-supply-watch` | 6 | 同上结构 | 否 | 否 |
| `cordis-hmr-doctor` | 6 | 同上结构 | 否 | 否 |
| `cordis-migrate` | 6 | 同上结构 | 否 | 否 |
| `cordis-testkit` | 5 | `DESIGN.md`, `LICENSE`, `README.md`, `package.json`, `src/core.js`（无 CLI，符合预期） | 否 | 否 |
| `dsh-xbrl` | 6 | 同上结构 | 否 | 否 |
| `dsh-upgrade-atlas` | 7 | 6 个标准文件 + `data/atlas.json` | 否 | 否 |

- 8 包均包含 `src/`、`README.md`、`DESIGN.md`、`LICENSE`、`package.json`；`test/`、`test/fixtures/` 和任何 `.tgz` 都没有进入 tarball。
- `dsh-upgrade-atlas` 的 `data/atlas.json` 被 `files` 显式包含，符合该包需要 bundle 数据的设计。
- 观察（非阻断）：所有文件（包括 README/LICENSE/package.json）在 tar 中 mode 为 `0755`（本机挂载权限所致）。建议发布前把非 CLI 文件改为 `0644`，CLI 保留 `0755`；不影响功能。

结论：**PASS**。

---

## 5. 元数据

### 5.1 共同字段

8 包全部满足：

- `name` = 包目录名；`version` = `0.1.0`；`license` = `Apache-2.0`；
- `type` = `module`；`engines.node` = `^22.19.0 || >=24.9.0`；
- `exports` 至少含 `"."` → `./src/core.js`；7 个 CLI 包另有 `"./cli"` → `./src/cli.js`；
- `files` 均含 `src`、`README.md`、`DESIGN.md`、`LICENSE`；
- `publishConfig.access` = `public`；无 `private: true`；
- 无 `dependencies` / `peerDependencies`。

### 5.2 `bin`、shebang、可执行位

| 包 | `bin` | 路径存在 | shebang | 可执行位 |
|---|---|---|---|---|
| `dsh-capdiff` | `dsh-capdiff` → `./src/cli.js` | 是 | `#!/usr/bin/env node` | `0755` |
| `testatum-attest` | `testatum-attest` → `./src/cli.js` | 是 | 同上 | `0755` |
| `dsh-supply-watch` | `dsh-supply-watch` → `./src/cli.js` | 是 | 同上 | `0755` |
| `cordis-hmr-doctor` | `cordis-hmr-doctor` → `./src/cli.js` | 是 | 同上 | `0755` |
| `cordis-migrate` | `cordis-migrate` → `./src/cli.js` | 是 | 同上 | `0755` |
| `cordis-testkit` | 无（库，符合预期） | N/A | N/A | N/A |
| `dsh-xbrl` | `dsh-xbrl` → `./src/cli.js` | 是 | 同上 | `0755` |
| `dsh-upgrade-atlas` | `dsh-upgrade-atlas` → `./src/cli.js` | 是 | 同上 | `0755` |

### 5.3 FAIL：`repository` / `homepage` / `bugs` 指向 404 仓库

8 包的 `package.json` 全部写：

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/PerryLink/dsh-next-suite.git",
  "directory": "packages/<name>"
},
"homepage": "https://github.com/PerryLink/dsh-next-suite/tree/main/packages/<name>#readme",
"bugs": { "url": "https://github.com/PerryLink/dsh-next-suite/issues" }
```

实测：

```text
GET https://github.com/PerryLink/dsh-next-suite
  → HTTP 404

GET https://api.github.com/repos/PerryLink/dsh-next-suite
  → HTTP 404 {"message":"Not Found"}

GET https://github.com/PerryLink/dsh-next-suite/tree/main/packages/dsh-capdiff#readme
  → HTTP 404

GET https://github.com/PerryLink/dsh-next-suite/issues
  → HTTP 404
```

同时，本工作区真实 remote 是：

```text
origin  https://gh-proxy.com/https://github.com/PerryLink/deepseek-community-hub.git
```

并且本目录被父仓 `.gitignore` 忽略：

```text
.gitignore:49:04-build/*
```

即 `04-build/dsh-next-suite` 当前不在 `deepseek-community-hub` 的 git 跟踪中，而 metadata/README 指向的 `dsh-next-suite` 在公网不可访问（404，可能未创建或未公开）。发布后 npm 页面上的 Repository / Homepage / Issues 链接会全部 404，外部用户也无法从 npm 追溯到源码提交。

**修复建议（二选一，发布前必须做）：**

1. 创建并公开 `https://github.com/PerryLink/dsh-next-suite`，把本套件放在仓库根（保持 `packages/<name>` 的 `repository.directory`），推送带版本的 commit；或
2. 保留在 `PerryLink/deepseek-community-hub`，把 8 个 `repository.directory` 改为
   `04-build/dsh-next-suite/packages/<name>`，`homepage`/`bugs` 改到该仓对应路径/Issues，并确保该目录被 git 跟踪。

修完后重跑：URL 200 检查、`npm pack --dry-run`、以及发布 dry-run。

结论：**FAIL（8/8）**。

---

## 6. 真实 CLI 冒烟

所有输入都在 `mktemp -d` 临时目录中生成；未触碰包目录或用户数据。测试 secret 是合成的，仅用于验证“不打印”。

| CLI | 最小输入 | 观察到的输出 | 退出码 |
|---|---|---|---:|
| `dsh-capdiff` | 临时插件：manifest 声明 `filesystem/network/eval`；代码 `import fs` + `process.env` | 文本/JSON/SARIF 均可读；JSON `undeclared=["env"]`、`unused=["network","eval"]`、`matched=["filesystem"]`；SARIF 2.1.0，3 条 results | 0 |
| `dsh-capdiff` 错误路径 | 不存在的目标 | `cannot scan ... path does not exist` | 1（合理） |
| `testatum-attest` | 临时 card；`TESTATUM_KEY` 注入 | `sign` 写 signed.json；`verify` 文本/JSON 均 `ok:true`；`revoke` 写记录；`verify --revocations` 返回 `revoked` 且 exit 1 | 0/1 |
| `testatum-attest` 错误路径 | 错误 key、篡改 rootHash、无 key | 分别 `signature-mismatch`、`rootHash-mismatch, signature-mismatch`、`TESTATUM_KEY is not set` | 1/1/2（合理） |
| `testatum-attest` 密钥检查 | 同一临时目录 | `grep` 合成 secret 无命中；stdout/stderr/生成的 card/revocation 均无明文密钥 | N/A |
| `dsh-supply-watch` | `check dsh-cora --known dsh-core --versions 0.0.1,1.0.0,99.0.0` | 3 条 findings（implausible-major、typosquat、placeholder）；JSON 有 `command/knownCount/findings/disclaimer` | 0 |
| `dsh-supply-watch` | 两行 names 文件 `scan --json` | `scanned:2`，findings 可解析 | 0 |
| `dsh-supply-watch` 错误路径 | 缺参数 / 不存在文件 | 用法错误 / `cannot read` | 1/1 |
| `cordis-hmr-doctor` | 4 行日志（settled/aborted×2/skipped） | 文本摘要 `Events: 4`、`settled 1/aborted 2/skipped 1`；JSON 含 events/summary/counts/causes/suggestions | 0 |
| `cordis-hmr-doctor` | stdin、空日志 | stdin 可解析；空日志输出 “No HMR events” | 0/0 |
| `cordis-hmr-doctor` 错误路径 | 缺参数 / 不可读文件 | 缺 `<log>` / `cannot read` | 1/2（与 README 一致） |
| `cordis-migrate` | 临时源码含 `cordis/loader`、`ctx.on('dispose')`、`ctx.plugin`、`baseDir` | `apply` 默认 dry-run：5 处匹配，文件字节未变（`cmp` 通过） | 0 |
| `cordis-migrate` | `--write` 后再跑一次 | 第一次写 1 个文件、5 处改动；第二次 0 匹配、0 写入，幂等 | 0/0 |
| `cordis-migrate` 错误路径 | `apply --dry-run --write` | `--write and --dry-run are mutually exclusive` | 1（合理） |
| `cordis-migrate` | 二进制文件 | `skipped: binary-extension`，未写坏资源 | 0 |
| `cordis-testkit` | 无 CLI；直接 import `src/core.js` | `createMockContext` 事件派发、`assertNoLeaks` 对泄漏抛 `ERR_CORDIS_LEAK`、`runPlugin` cleanup 正常 | N/A |
| `dsh-xbrl` | 自带 balanced fixtures | `Balance sheet [PASS]`、`Income statement [PASS]`；JSON `ok:true` | 0 |
| `dsh-xbrl` | unbalanced fixtures | `Balance sheet [FAIL]`；income 无识别概念则 `[SKIPPED]` | 1（合理） |
| `dsh-xbrl` | original/restated fixtures | `diff` 输出 added/removed/changed；JSON 可解析 | 0 |
| `dsh-xbrl` 错误路径 | 非法 JSON | `invalid JSON` | 2（合理） |
| `dsh-upgrade-atlas` | 自带 `data/atlas.json` | `stats` 总计 17；`list/query/render` 均输出；`--version` 为 0.1.0 | 0 |
| `dsh-upgrade-atlas` | 临时 data + 新 entry + 重复/非法 entry | `add` 成功；重复 id、缺字段分别 exit 1；校验在写盘前发生 | 0/1/1 |
| `dsh-upgrade-atlas` 错误路径 | 未知命令 | `unknown command` + command 列表 | 1（合理） |

结论：**PASS**。`cordis-migrate` 默认 dry-run 不写、`testatum-attest` 不打印密钥这两个关键点均已实测通过。

---

## 7. 描述准确性

逐包对照 README、`package.json` description 与实现行为；**未发现“审计意见”“签名=安全”“官方/官方背书”这类 overclaim**。

| 包 | 关键声明 | 限制是否写明 | 结果 |
|---|---|---|---|
| `dsh-capdiff` | 静态能力差异扫描；不执行代码；输出候选差异 | 明确“不是审计/沙箱”；matched/0 findings 不是安全证明；列出动态 import、TM 字符串、正则误报等限制 | PASS |
| `testatum-attest` | SHA-256 清单 + HMAC-SHA256 + 撤销 + 离线验证 | 明确 HMAC 是 MVP，不是 sigstore/npm provenance/官方发布证明；写清密钥、撤销、TOCTOU、路径等限制 | PASS |
| `dsh-supply-watch` | 离线名称相似度 + 版本异常启发式 | 明确不是安全扫描器；误报/漏报、无 registry/无 tarball 检查、findings 不失败 CI | PASS |
| `cordis-hmr-doctor` | 解析 HMR 日志并给启发式诊断 | 明确非官方、无逐行 HMR 语法、默认 logger 不打印 settled、不能重建事件 | PASS |
| `cordis-migrate` | Cordis 3→4 文本规则引擎；scan/dry-run/apply | 明确 5 条规则只是示例、非官方迁移表；非 AST、默认 dry-run、`--write` 直接覆盖无备份 | PASS |
| `cordis-testkit` | mock Cordis context + 泄漏断言 | 明确不是 drop-in：无 fiber/inject/HMR、effects 仅同步、emit 返回值是 mock 约定 | PASS |
| `dsh-xbrl` | XBRL-style 事实勾稽 + 重述 diff | 明确“Not an audit opinion / review / assurance report”；不是 XBRL XML 解析器、不取数、不做单位换算 | PASS |
| `dsh-upgrade-atlas` | DSH 升级断点图谱；17 条 curated 数据 | 明确是 map 不是 oracle；`*` 表示仍适用；不读项目、不联网、不带签名 | PASS |

额外核验：

- `dsh-upgrade-atlas` 的 `data/atlas.json` 实际 **17 条**，与 README 的 “17 curated” 一致；severity 分布 P0 2 / P1 7 / P2 6 / P3 2；每条都有 evidence。
- 17 条 evidence 中的 GitHub 链接逐条请求，均返回 HTTP 200；其中 1 条连接在读到 HTTP 200 后 body 读取超时（20s），属于网络慢，不是 404/伪造。README 的 `17 curated`、`Every bundled entry cites at least one DSH source` 与数据一致。
- 轻微措辞问题（不构成 FAIL）：`dsh-supply-watch` 的 `package.json` description 未写 “Unofficial”，但 README 顶部有明确声明；建议顺手补上，便于 npm 列表页直接看到非官方属性。

结论：**PASS（8/8）**。

---

## 8. 合规

| 检查 | 结果 |
|---|---|
| 非官方声明 | 8 个 README 都有明确 “unofficial / 非官方 / 无隶属关系” 声明；`package.json` 中 hmr/testkit/migrate 的 description 也带 unofficial 提示 |
| License | 8 包 `package.json` 均为 `Apache-2.0`；8 个 `LICENSE` 与根 `LICENSE` 的 MD5 全部一致（`3b83ef96387f14655fc854ddc3c6bd57`，完整 Apache License 2.0 文本） |
| 密钥/隐私数据 | 未发现 `ghp_`、`github_pat_`、`npm_`、`sk-...`、`AKIA...` 等凭据；未发现 `/home/...`、`/mnt/...` 或邮箱等隐私数据；`testatum-attest` 测试里的 secret 是合成常量，且 `test/` 不进入 tarball |
| core 第三方 import | 无。`dsh-capdiff/src/core.js` 仅 `node:fs/promises`、`node:path`；`testatum-attest/src/core.js` 仅 `node:crypto`；其余 core 无 import |
| core 网络 | 无。源码中没有 `node:http(s)`、`fetch`、`WebSocket`、`node:net`/`tls` 等调用；`dsh-capdiff` core 里的 `node:http` 等只是能力映射表的字符串常量，不是 import |
| 运行时依赖 | 8 包均无 `dependencies` / `peerDependencies` |

结论：**PASS（8/8）**。

---

## 9. 一致性（FAIL）

### 9.1 版本范围：一致

8 包 `engines.node` 完全相同：`^22.19.0 || >=24.9.0`；Node 24.22.1 与 22.19.0 的测试均通过。这一子项 PASS。

### 9.2 README 结构：不一致

CONTRACT 要求每个 README 覆盖“是什么 / 为什么 / 安装 / 用法 / 限制 / 命名核验 / 非官方声明”。实际标题/顺序差异明显：

| 包 | 实际标题结构（摘要） | 与统一模板的偏差 |
|---|---|---|
| `dsh-capdiff` | 为什么 → 安装与运行 → 用法 → 限制 → 命名核验 → 非官方声明 → License | 无显式“是什么”标题（开头段落承担） |
| `testatum-attest` | 是什么 → 为什么 → 安装 → 用法 → 限制 → 命名核验 → 非官方声明 → 开发与测试 → 许可证 | 基本齐全；标题用“许可证”而非“License” |
| `dsh-supply-watch` | Why → Install / run → Usage → Limitations → Name verification → Tests → License | 英文；非官方声明只在顶部 blockquote，无独立章节；标题命名与其他包不同 |
| `cordis-hmr-doctor` | What it is and why → Install and run → CLI → Limitations → Name verification → Non-official statement → Development → License | 英文；无独立“Usage”标题；合并“是什么/为什么” |
| `cordis-migrate` | 先读这一节 → 是什么 → 为什么 → 安装 → 用法 → 规则 → 输出 → 安全模型 → 限制 → 命名核验 → 非官方声明 → 许可 | 中文；结构最完整，但标题顺序/命名与其他包不同 |
| `cordis-testkit` | 为什么 → 安装与运行 → 用法 → API → 与 Cordis 的差异 → 命名核验 → License | 无显式“是什么”；非官方声明只在顶部 blockquote；限制放在“差异”里 |
| `dsh-xbrl` | 这是什么 / 不是什么 → Requirements → Install → Input format → CLI → Identity checks → Aliases → Restatement diff → Library API → Limitations → 命名核验 → 非官方 → License | 双语；无独立“为什么”；结构偏规范文档 |
| `dsh-upgrade-atlas` | What it is → Install and run → CLI → Data model → Library API → Evidence → Naming verification → Limitations → Community and license | 英文；无“为什么”；非官方声明在顶部 blockquote；没有独立“Non-official statement”章节 |

结论：内容质量整体高，但**没有统一模板**；发布为同一套件时，读者在 8 个 npm 页面会看到不同的章节命名和顺序。这属于一致性问题，不是功能缺陷。

### 9.3 CLI 参数风格与错误语义：不一致

同一组常见调用，7 个 CLI 的退出码不同：

| CLI | 不带参数 | 未知选项 | `--version` | 备注 |
|---|---:|---:|---:|---|
| `dsh-capdiff` | 1 | 1 | 0（`-v`/`--version`） | 用法/IO 统一 1 |
| `testatum-attest` | **1** | 2 | 2（不支持） | README 却写“用法错误 = 2”；无参数是唯一例外 |
| `dsh-supply-watch` | 1 | 1 | 1（不支持） | README 没有错误退出码表 |
| `cordis-hmr-doctor` | 1（缺参数） | 2 | 2（不支持） | 缺参数 1、非法参数 2，刻意区分 |
| `cordis-migrate` | 1 | 1 | 1（不支持） | 所有错误统一 1 |
| `dsh-xbrl` | 2 | 2 | 2（不支持） | 用法/IO 统一 2 |
| `dsh-upgrade-atlas` | 1 | 1 | 0（`-V`/`--version`） | 所有错误统一 1；`-V` 与 capdiff 的 `-v` 不一致 |

具体问题：

1. **`testatum-attest` 文档与实现不一致**：README 退出码表把“用法错误”定义为 2，但 `testatum-attest`（无参数）实际 exit 1。  
   证据：`README.md:173-179` 的表格；`src/cli.js:317-320` 在无 command 时打印 USAGE 并 `process.exitCode = 1`；`--help` → 0；`sign` 缺文件 → 2。
2. **`--version` 覆盖不一致**：只有 `dsh-capdiff` 和 `dsh-upgrade-atlas` 支持；其余 5 个把 `--version` 当未知选项。且短选项 `-v` vs `-V` 不统一。
3. **`dsh-supply-watch` README 没有错误退出码表**：`README.md:217` 只写了“成功也 exit 0”，没有说明缺参数/读文件失败返回 1；与其他包的“退出码”章节不一致。
4. **JSON 形状不一致**：`dsh-upgrade-atlas list/query --json` 直接输出**数组**；其余 CLI 的 `--json` 输出对象 envelope（capdiff 带 tool/version，supply 带 command，migrate 带 notice，xbrl 带 ok/statements，testatum 带 command/ok，hmr 带 events/summary）。没有统一的 `{command, ok, ...}` 契约。

### 9.4 修复建议

发布前至少统一到以下契约，并同步 7 个 README：

- 退出码：`0` 成功；`1` 业务否定结果（如 xbrl check fail、testatum verify fail）；`2` 用法/IO/输入错误。若某 CLI 不需要“业务否定”，也必须写清 `1` 与 `2` 的分工。
- 所有 CLI 支持 `-h/--help` 与 `-V/--version`（或统一 `-v`），`--help` 永远 exit 0。
- `--json` 统一为对象，至少含 `{ command, ok, ... }`；数组放在 `items`/`entries` 字段。
- README 统一 7 个一级章节：是什么 / 为什么 / 安装 / 用法 / 限制 / 命名核验 / 非官方声明；语言可中英双语，但标题含义一致。
- 修 `testatum-attest` 的 `无参数 exit 1` 与 README 的冲突；给 `dsh-supply-watch` 补退出码表。

结论：**FAIL（8/8，套件级）**。

---

## 10. FAIL 证据与修复建议（汇总）

### F1 — 阻断：仓库/主页/Issues 链接 404（8/8）

- 证据：§5.3。`https://github.com/PerryLink/dsh-next-suite`、`/repos/PerryLink/dsh-next-suite`、任一包的 `homepage`、`/issues` 均 404。
- 影响：npm 页面链接失效；源码不可追溯；发布元数据不真实。
- 修复：创建该仓并推送，或改用实际 `PerryLink/deepseek-community-hub` 的路径；确认 8 个 `repository.directory`、`homepage`、`bugs` 全部 200；确保套件目录被 git 跟踪（当前 `04-build/*` 被忽略）。
- 复验：`curl` 8 个 homepage/bugs + `npm pack --dry-run` + npm 页面预览。

### F2 — 高：CLI/README 契约不一致（8/8 受影响）

- 证据：§9.2、§9.3；特别是 `testatum-attest` 无参数 exit 1 vs README 的 2；`--version` 仅 2/7 支持；atlas `list/query --json` 是数组；supply README 无错误码表。
- 影响：CI 脚本/用户无法用同一套退出码和 JSON 解析逻辑处理 8 个工具；文档与行为不一致会直接导致误用。
- 修复：按 §9.4 的统一契约改 CLI 与 README；至少先修 testatum 文档/行为冲突、补 supply 退出码表、统一 `--version` 与 JSON envelope。

### F3 — 中：根 `npm test` / workspace 包含 `_template` 脚手架

- 证据：`packages/_template/` 仍在 `workspaces: ["packages/*"]` 内；`npm test` 的 glob 把 `packages/_template/test/core.test.js` 算进来，所以根是 **243**，8 个审计包是 **242**。模板 `package.json` 的 `name` 是 `NAME`、`description` 是 `DESC`。
- 影响：`npm publish --workspaces` / `npm pack --workspaces` 可能把占位包一起处理（至少产生噪音或失败）；测试总数被模板污染。
- 修复：把模板移到 `templates/` 或 `packages/_template` 从 workspaces 排除；根 `test` 脚本改为显式 8 包 glob，或给模板加独立脚本。发布前用 `npm publish --workspaces --dry-run` 验证只涉及 8 包。

### F4 — 低：非 CLI 文件在 tarball 中为 0755

- 证据：`npm pack --dry-run --json` 中 README/LICENSE/package.json mode 493（0755）。
- 影响：无功能影响，但包内权限不整洁。
- 修复：发布前对非 CLI 文件 `chmod 644`；`src/cli.js` 保持 755。

---

## 11. 其他观察（不阻断）

1. **Node 22.19 下限**：`npx node@22.19.0 --test packages/*/test/*.test.js` 243/243 通过；`^22.19.0 || >=24.9.0` 的声明有实测支撑（仅 Linux/WSL，未覆盖 Windows 主机）。
2. **目录参数形式的 test runner**：`node --test packages/<pkg>/test/` 在当前 Node 24 下失败，是 Node 参数语义，不是包缺陷；README 用 glob，正常。
3. **`_template`**：见 F3。
4. **无 npm publish 执行**：本审计只做了 `npm pack --dry-run`，没有执行 `npm publish`，也没有写入 registry。
5. **未改实现**：本文件之外没有修改任何源码、测试、README、package.json 或 LICENSE。

---

## 12. 结论

**需修复，不可按现状直接发布。**

- 功能面：8 包 242/242 测试通过，Node 24.22.1 与 22.19.0 均通过；15/15 源文件 `node --check` 通过；7 个 CLI `--help` 全部 exit 0；冒烟路径全部符合预期，`cordis-migrate` 默认 dry-run 不写、`testatum-attest` 不打印密钥。
- 命名面：8/8 npm E404；8/8 GitHub `total_count: 0`（未限流失败）。
- 发布阻断：F1（metadata 链接 404 + 源码未跟踪）必须先修；F2（CLI/README 契约）建议同批修；F3（模板混入 workspace/root test）应清理。F4 为整洁性问题。

**最严重 3 个问题：**

1. **8 包的 `repository`/`homepage`/`bugs` 全部指向公网 404 的 `PerryLink/dsh-next-suite`（未创建或未公开）；当前套件目录又被父仓 `.gitignore` 忽略，外部用户无法从 npm 追溯源码。**
2. **CLI 契约不统一**：无参数/未知选项的 exit code 在不同包为 1 或 2；仅 2/7 支持 `--version` 且 `-v`/`-V` 不一致；atlas 的 `list/query --json` 是数组而非对象；`testatum-attest` README 的退出码与实现冲突。
3. **README 结构未按统一模板**（“是什么/为什么/非官方声明”等章节在多个包缺失或改名），加上根 `npm test` 把 `_template` 算入（243 vs 242），套件级文档/测试边界不清晰。

修复 F1、F2，并清理 F3 后，本套件在功能与合规层面具备发布条件。

---

## 修复与发布记录（2026-11-14 19:45 +08）

| 审计项 | 修复 |
|---|---|
| **F1** 仓库/主页/Issues 404 | 已创建 `https://github.com/PerryLink/dsh-next-suite` 并推送 85 文件；homepage/bugs 均 200 |
| **F2** CLI/README 契约 | 7 个 CLI 统一 `-h/--help`、`-V/--version`；退出码 0/1/2 统一；`--json` 统一对象 envelope；README 统一 7 章；testatum/supply 退出码表修正 |
| **F3** `_template` 混入 | 已移到 `templates/_template`；根 `npm test` 242/242（8 包，不含模板） |
| **F4** 文件权限 | `src/cli.js` 755，其余 644 |
| 命名 | 8/8 npm E404、GitHub 精确名 0（发布前复核） |

**发布**：8 包 `0.1.1` 已上 npm（2026-11-14）；GitHub 仓库 + release `v0.1.1`。
- dsh-capdiff, testatum-attest, dsh-supply-watch, cordis-hmr-doctor, cordis-migrate, cordis-testkit, dsh-xbrl, dsh-upgrade-atlas
- 0.1.0 首发 README 仍写“not published”；0.1.1 修正状态并补 npm 安装命令。
