# Dojo 讲师手册：两个可自动判分的实验

> 配套 [`../DOJO.md`](../DOJO.md)。全部代码在 `dojo/` 下，纯 ESM + Node 内置模块，
> **不需要 `npm install`、不需要网络、不依赖真实 DSH 启动**。
> 面向对象：写过 JavaScript、想给 DeepSeek Harness 写插件，但还没跑通过
> 「注册工具 → 安装 → 治理审计」链路的开发者。

---

## 0. 一页速览

| | Lab 1 · Hello Plugin | Lab 2 · Governance |
|---|---|---|
| 主题 | 一个能被 DSH 加载的最小插件，注册 `greet` 工具 | 用 mock span / lease / quota 回答三个治理问题 |
| 建议时长 | 45–60 分钟 | 120–150 分钟 |
| 代码量 | 约 150 行 | 约 1,300 行（含简化 stub） |
| 自动验收 | `npm test` → 6/6 | `npm test` → 17/17 |
| 核心命令 | `cd dojo/lab-01-hello-plugin && npm test` | `cd dojo/lab-02-governance && npm test` |
| 总验收 | `node dojo/run-all.mjs` → 2/2 labs，23 tests | 同左 |

**课程总时长**：3.5–4 小时（含 20–30 分钟复盘；赶时间可用 §8 的 90 分钟压缩版）。

**学员带走的三句话**：

1. 插件 = 导出 `name` / `inject` / `apply(ctx)` 的模块；工具通过 `ctx.tools.register` 注册。
2. trace 是**带哈希链的因果记录**，回答“谁批准了这一步”。
3. lease 管**并发写范围**，quota 管**预算**；两者都在执行前给出可审计的拒绝理由。

---

## 1. 环境与开课准备

### 1.1 环境要求

- Node.js `^22.19.0 || >=24.9.0`（当前验证环境为 `v24.22.1`）。
- 无需 `npm install`；两个 lab 的 `package.json` 都没有依赖项。
- 无需 DSH 进程。Lab 1 用 fake ctx 验证插件定义；Lab 2 用简化 stub 验证治理不变量。
- 可选：`dsh@0.2.2-rc.3`，仅用于 Lab 1 的实机挂载演示。

```sh
node --version
```

### 1.2 开课前 5 分钟自检

```sh
cd 04-build/dsh-next-suite
node dojo/run-all.mjs
```

预期输出（测试数必须一致）：

```text
Dojo run-all — 2 labs (Node v24.22.1)

PASS  [1/2] lab-01-hello-plugin (6 tests)
PASS  [2/2] lab-02-governance (17 tests)

Summary: 2/2 labs passed; 23 tests reported.
```

退出码必须为 `0`。若失败，先看 §7 的常见错误，不要直接上课。

### 1.3 实机挂载的边界（讲师必读）

Lab 1 的 starter 按 DSH `0.2.2-rc.3` 的公开 API 形状编写：
`ctx.tools.register({ name, description, parameters, output: { schema, render }, execute })`。
自动验收**不依赖** DSH 启动，所以任何机器都能判分。

本手册编写环境（Linux）上，`dsh --version` 可用、`dsh plugin --help` 可用，
但 `dsh web` 因缺少 `node-addon-require-builtin-linux-x64-gnu` 原生绑定无法启动，
因此**未完成真实 Web UI 调用验证**。在能启动 DSH 的机器上，讲师可按 §4.5 补做；
若本机同样起不来，跳过实机挂载，不影响 23 个自动测试。

---

## 2. 文件地图

```text
dojo/
├── README.md                       # 本手册
├── run-all.mjs                     # 依次跑两个 lab，输出 PASS/FAIL
├── lab-01-hello-plugin/
│   ├── package.json                # 插件 manifest（无依赖）
│   ├── cordis.patch.yml            # 把 hello 行插入 profile
│   ├── index.js                    # name / inject / apply + greet 工具
│   ├── README.md                   # 学员简版说明
│   └── test/check.mjs              # fake ctx：注册、schema、execute、render
└── lab-02-governance/
    ├── package.json                # 只有 test 脚本
    ├── check.mjs                   # 17 个断言场景
    ├── lib/core-stub.mjs           # trace/lease/quota 的简化离线 core
    └── data/
        ├── spans.json              # 审批 → 工具 → 写文件
        ├── leases.json             # 两个重叠 + 一个不重叠的租约意图
        └── quota.json              # tokens=100，80 通过、30 拒绝
```

`core-stub.mjs` 是**教学用简化实现**，不是 `dsh-os-*` 包的复制品：
它保留可观察不变量（哈希链、路径重叠、admission/consume 分离），
删掉插件装配、磁盘持久化、真实 DSH 集成。

---

## 3. 时间表（210 分钟标准版）

| 时间 | 分钟 | 环节 | 讲师动作 | 学员产出 |
|---|---:|---|---|---|
| 0:00–0:10 | 10 | 开场 | 提三个问题，不先给答案 | 写下自己的猜测 |
| 0:10–0:50 | 40 | Lab 1 讲解 + 动手 | 带读 `index.js`，演示 fake ctx | 跑通 `npm test` 6/6 |
| 0:50–1:05 | 15 | Lab 1 验收 + 扩展 | 抽查 schema / execute；讲 `output.render` | 改一处 greeting 或 render |
| 1:05–1:15 | 10 | 休息 | — | — |
| 1:15–1:40 | 25 | Lab 2 · Trace | 白板画 approval → tool → write | 解释哈希链为何能发现篡改 |
| 1:40–2:10 | 30 | Lab 2 · Lease | 画 `src/app.js` 与 `src/application.js` 的重叠差异 | 解释 CONFLICT 的 reason |
| 2:10–2:40 | 30 | Lab 2 · Quota | 区分 admit（投影）与 consume（记账） | 解释 80 ok、30 hard 的原因 |
| 2:40–2:55 | 15 | 跑 check + 排错 | 巡场，只提示不代写 | 17/17 |
| 2:55–3:20 | 25 | 复盘 | 三问回答 + 事故复盘模板 | 一页事故复盘（可选） |
| 3:20–3:30 | 10 | 总验收 | 跑 `run-all.mjs`，收尾 | 2/2 PASS |

时间不够时优先保 Lab 1 的 6 个测试和 Lab 2 的 trace + quota；lease 可只讲结论。

---

## 4. Lab 1 讲师脚本

### 4.1 开场问题（先问，不答）

1. 一个“插件”最少需要导出什么，DSH 才会加载它？
2. 工具的参数 schema 是给谁看的：模型、执行器，还是 UI？
3. 如果插件加载时 `ctx.tools` 还不存在，应该怎么办？

答案分别落在：`name` + `apply`（`inject` 可选）；模型和参数校验器都看；
用 `export const inject = ['tools']` 让 Cordis 等依赖就绪后再 `apply`。

### 4.2 带读 `index.js`

按顺序讲 5 个点：

1. `export const name = 'dsh-hello-plugin'`：插件标识，也是 `cordis.patch.yml` 里
   `name:` 要匹配的值。
2. `export const inject = ['tools']`：声明依赖，Cordis 在 `tools` 服务就绪后才调用
   `apply`。
3. `greetTool.parameters`：JSON Schema；`required: ['name']` 和
   `additionalProperties: false` 是模型最容易忽略的两处。
4. `output: { schema: { type: 'string' }, render }`：`execute` 返回**规范值**
   （string），`render` 把它变成模型可见的 `[{ type: 'text', text }]`。
5. `apply(ctx)`：调用 `ctx.tools.register`。注册本身是 effect-owned，插件卸载时
   Cordis 会自动注销；`register` 返回的 disposer 在本 lab 的 fake ctx 测试里用来
   显式验证“可注销”，真实加载时由 Cordis 管理，不需要自己保存。

> 生产插件建议用 `@deepseek-ai/dsh-tools` 的 `defineTool()`，它会根据
> `parameters` 自动校验参数。本 starter 为了“零依赖、离线可跑”手写了校验；
> 这是有意的教学取舍，不是 DSH 的推荐写法。

### 4.3 学员步骤

```sh
cd dojo/lab-01-hello-plugin
npm test
```

然后让学员做至少一个扩展：

- **扩展 A（5 分钟）**：把 `execute` 改成返回 `Hello, ${name}! 👋`，同步改测试。
- **扩展 B（15 分钟）**：增加 `output.render` 返回 Markdown 文本，例如
  `[{ type: 'text', text: '**Hello, Ada!**' }]`，并断言 render 的输出。
- **扩展 C（20 分钟）**：`apply(ctx, config)` 读取 `config.greeting`，把前缀做成可配置，
  并在 fake ctx 测试里传 `{ greeting: 'Hi' }`。

### 4.4 验收标准（Lab 1）

| # | 检查 | 通过标准 |
|---|---|---|
| 1 | `npm test` | 6 tests，0 fail，exit 0 |
| 2 | 插件身份 | `name === 'dsh-hello-plugin'`，`inject` 含 `tools` |
| 3 | 注册 | 调用 `apply(fakeCtx)` 后恰好注册 1 个 `greet` |
| 4 | schema | `parameters.required` 为 `['name']`，`name.type === 'string'` |
| 5 | execute | `execute({ name: 'Ada' })` 返回 `Hello, Ada!` |
| 6 | 失败路径 | 缺 `name` 或空白字符串会 reject |

讲师抽查：让学员解释“为什么 fake ctx 不需要 DSH”。期望答案：
我们测的是插件契约（注册了什么、schema 是什么、execute 返回什么），
不是 Cordis 的加载器或 Web UI。

### 4.5 可选：实机挂载（仅限 DSH 可启动的机器）

```sh
cd dojo/lab-01-hello-plugin
export DSH_HOME="$(mktemp -d)"
dsh plugin --profile web add "$PWD"
dsh --profile web --dump-config | grep -n hello
```

看到 `id: hello` / `dsh-hello-plugin` 即挂载成功。随后启动 Web UI，让 agent
调用 `greet`。注意：

- `DSH_HOME` 必须是临时目录，避免污染学员真实 profile。
- `dsh plugin add` 会转发给 pnpm，可能需要网络；离线课堂跳过。
- 若 `dsh web` 报原生绑定错误，记录为环境限制，不要改 lab 代码去“绕过”。

---

## 5. Lab 2 讲师脚本

### 5.1 三个问题

1. 这次操作是谁批准的？ → trace 因果链。
2. 两个 agent 为什么没有互相踩文件？ → lease 冲突检测。
3. 为什么任务被预算拦住？ → quota 的 soft/hard 判定。

先让学员在 `data/*.json` 里找证据，再跑 check 对照断言。

### 5.2 Trace：审批 → 工具 → 写文件

数据在 `data/spans.json`，三跳：

```text
span-approval  approve:workspace_apply
      │
      ▼
span-tool      workspace_apply
      │
      ▼
span-write     write_file:src/app.js
```

`lib/core-stub.mjs` 的 `createTraceStore()` 做三件事：

1. 追加 span 时，用上一条的 `hash` 作为本条的 `prevHash`；
2. 对 `canonicalJson({ ...span, prevHash })` 做 SHA-256，写入 `hash`；
3. `why(id)` 沿 `parentId` 上溯，返回**根到目标**的时间顺序链和边。

`verifyBundle()` 从 genesis 重新计算整条链。学员应能回答：

- 为什么改一个 `attrs.bytes` 就会 `HASH_MISMATCH`？因为 `attrs` 在哈希覆盖范围内。
- 为什么不能只校验最后一条的 hash？因为中间任何一条被改，后续 `prevHash` 都会断。
- `GENESIS_PREV_HASH` 为什么是 64 个 `0`？它是链的锚点，长度与 SHA-256 十六进制一致。

对应测试（5 个）：链形状、`why()` 路径、导出验证、篡改检测、未知 id。

### 5.3 Lease：重叠路径为什么会冲突

数据在 `data/leases.json`：

| 请求 | owner | paths | 预期 |
|---|---|---|---|
| A | agent-a | `src/app.js`, `src/lib/util.js` | 获得租约 |
| B | agent-b | `src/app.js` | `CONFLICT`（exact，和 A 重叠） |
| C | agent-c | `docs/readme.md` | 获得租约（不重叠） |

关键规则：

- 路径先归一化：反斜杠转 `/`，去掉 `./` 和重复斜杠；**拒绝**绝对路径、盘符、
  `.`/`..` 段。
- 重叠按**路径段**判断：`src/app.js` 与 `src/app.js`、`src/app.js/x` 重叠，
  但与 `src/application.js` **不**重叠（这正是一个常见误报源）。
- 租约只在同一 workspace 且未过期时参与冲突检测。
- `preparePatchset()` 只允许租约覆盖的路径；`commitPatchset()` 两阶段提交，
  stub 不写磁盘，只返回 `after` 内容。

对应测试（7 个）：归一化、CONFLICT、段边界、非重叠获取、两阶段提交、
越界 patchset、释放后重新获取。

### 5.4 Quota：admit 是投影，consume 才是记账

数据在 `data/quota.json`：`tokens = 100`，`softRatio = 0.8`。

| 场景 | used 前 | 请求 | projected | level | allowed | 说明 |
|---|---:|---:|---:|---|---|---|
| A：新 governor `admit(80)` | 0 | 80 | 80 | ok | true | 只投影；used 仍为 0 |
| B：同一 governor `admit(30)` | 0 | 30 | 30 | ok | true | 仍是投影，30 不超限；A 的 80 没有写入 used |
| C：先 `consume(80)` 再 `admit(30)` | 80 | 30 | 110 | hard | false | 真实记账后才拒绝 |
| D：接 C 再 `consume(30)` | 80 | 30 | 110 | hard | false | 超限已发生，仍记账并报告 `overBy=10` |

> 表中 A/B 说明 admit 的“只读投影”语义；C/D 才是课堂要解释的拒绝路径。
> 对应测试每个场景都新建 governor，避免状态串场。
>
> **与 `DOJO.md` 简写的差异（讲师必讲）**：`DOJO.md` 把验收写成“先 admit 80、
> 再 admit 30 → hard”。按真实 `dsh-os-quota` 和本 stub 的语义，admit **不记账**，
> 所以第二次 admit 30 单独看仍然是 ok；要复现 hard，必须先把 80 `consume` 掉
> （或用 80 的已用额度初始化）。这不是 bug，而是 admission control 的核心设计。

教学要点：

- **admit 不改状态**是刻意设计：它回答“如果现在花这笔，会怎样”。
- `hard` 拒绝的是 `allowed: false`；`soft` 允许但带 `degrade: true`。
- 限额是**闭区间**：花到恰好等于上限仍允许；只有严格超过才 hard。
- 软阈值是严格大于 `limit * softRatio`；80/100 恰好不算 soft。

对应测试（5 个）：80 只读通过、30 hard、consume 记账 overage、恰好到上限、
95 触发 soft。

### 5.5 运行与观察

```sh
cd dojo/lab-02-governance
npm test
```

建议让学员先只看测试名，逐条预测结果，再跑。讲师可用
`node --test --test-reporter=spec check.mjs` 获得更详细的失败堆栈。

---

## 6. 总验收与评分

### 6.1 自动验收

```sh
cd 04-build/dsh-next-suite
node dojo/run-all.mjs
```

| 验收项 | 通过标准 | 建议分值 |
|---|---|---:|
| Lab 1 自动测试 | 6/6，exit 0 | 20 |
| Lab 2 自动测试 | 17/17，exit 0 | 40 |
| `run-all.mjs` | `2/2 labs passed; 23 tests reported`，exit 0 | 20 |
| 口头三问 | 能分别用 spans / leases / quota 的证据回答 | 20 |

自动判分只认 exit code，不认“看起来对”。讲师口头部分可按证据是否引用具体字段
（`parentId`、`prevHash`、`conflicts[0].reason`、`overBy.tokens`）给分。

### 6.2 结课检查清单

- [ ] 学员能独立跑 `npm test`，不依赖讲师改代码。
- [ ] 学员能解释为什么 fake ctx 足以测 Lab 1。
- [ ] 学员能画出 approval → tool → write，并指出哈希覆盖范围。
- [ ] 学员能解释 `src/app.js` 与 `src/application.js` 为何不冲突。
- [ ] 学员能解释 admit 与 consume 的状态差异。
- [ ] 全班 `run-all.mjs` 通过。

---

## 7. 常见错误（按出现频率排序）

| # | 现象 | 原因 | 处理 |
|---|---|---|---|
| 1 | `ERR_MODULE_NOT_FOUND` / 找不到 `../index.js` | 在错误的目录跑测试 | 先 `cd dojo/lab-01-hello-plugin` 或 `cd dojo/lab-02-governance`；`run-all` 从任意目录都行 |
| 2 | `Cannot use import statement outside a module` / `require is not defined` | 缺少 `"type": "module"` 或误用 CommonJS | 保留 package.json 的 `type`；统一用 `import` |
| 3 | `ctx.tools is undefined` | `apply` 运行时依赖尚未就绪 | 保留 `export const inject = ['tools']` |
| 4 | `ctx.tools.register is not a function` | fake ctx 只实现了 `ctx.tool`，或 DSH 版本不匹配 | fake ctx 实现 `tools.register`；DSH 用 `0.2.2-rc.3` |
| 5 | `tool "greet" must declare output { schema, render }` | 少了 `output.render` | 按 `index.js` 的 output 形状补齐 |
| 6 | `--dump-config` 看不到 `hello` | YAML 缩进错误，或 `name:` 与 package name 不一致 | patch 里 `insert` 列表缩进 4 空格；两处 name 必须一致 |
| 7 | `node --test` 显示 0 tests | 路径写错，或文件名不是 `check.mjs` | 用 package.json 里的脚本，别手敲错路径 |
| 8 | lease 冲突“误报”或“漏报” | 路径没归一化，或按字符串前缀而不是路径段判断 | 先 `normalizePath()`；用 `pathsOverlap()`；注意 `src/app.js` vs `src/application.js` |
| 9 | quota 明明只请求 30 却被硬拒 | 之前的 `consume` 已经把 used 抬高；或复用了同一个 governor | 每个场景新建 governor；admit 不记账，consume 才记账 |
| 10 | 改了 JSON 后 `trace_verify` 失败 | 手改了 spans/hash，没有重算链 | 用 `createTraceStore().ingest()` 重新生成；不要手写 `hash` |
| 11 | Node 版本报错 | 低于 `22.19` | 升级 Node；`node --version` 确认 |

讲师排错原则：先让学员贴**完整命令 + 完整报错 + 当前目录**，这三样能解决
上表一半问题。不要直接替学员改代码。

---

## 8. 90 分钟压缩版

适合只做导览、不做完整动手的场合：

| 时间 | 分钟 | 内容 |
|---|---:|---|
| 0:00–0:10 | 10 | 三个问题 + 课程地图 |
| 0:10–0:30 | 20 | Lab 1：带读 `index.js`，跑 `npm test`，讲 6 个测试 |
| 0:30–0:55 | 25 | Lab 2 · Trace + Lease：跑测试，讲哈希链和段边界 |
| 0:55–1:15 | 20 | Lab 2 · Quota：admit/consume 对照表 |
| 1:15–1:30 | 15 | `run-all.mjs` + 复盘 |

压缩版仍保留两个 lab 的全部自动测试，只是不给学员独立改代码的时间。

---

## 9. 安全与边界

- Lab 2 的 stub **不写磁盘、不发网络请求、不读真实审批/租约/quota 数据**。
- 所有 mock 数据都是合成值（`sess-dojo-001`、`ws-dojo`、`agent-a/b/c`）。
- Lab 1 只注册一个纯函数工具，不读写文件、不执行 shell。
- 实机挂载必须用临时 `DSH_HOME`；不要把学员的真实 profile 当实验场。
- 本材料按 `../DOJO.md` 的约定：课程文本 CC-BY-4.0，代码 Apache-2.0。
