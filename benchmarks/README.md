# 可复跑基准：dsh-capdiff 与 dsh-supply-watch

本目录是 `packages/dsh-capdiff` 与 `packages/dsh-supply-watch` 的基准，只写 `benchmarks/`，不修改任何包代码；两个 `run.mjs` 都直接调用对应包的 `src/core.js`。

- **dsh-capdiff**：17 个手写 synthetic fixture + 17 个真实语料片段（14 个工作区包 + 2 个 DSH 文档示例）。两套语料分别输出 P/R/F1。
- **dsh-supply-watch**：20 个 known 名、30 个合成变体、50 个合法名（20 个原基线 + 30 个真实 npm 包名）。真实包名单独统计 false positive。

> ⚠️ **这不是安全结论。** 样本是人工挑选的合成样本与真实代码片段，指标只描述这些样本，**不代表全量插件、全量 npm 或真实攻击面**。无 finding ≠ 安全；有 finding ≠ 恶意。两个工具都是静态/离线启发式，不是 SCA、不是沙箱、不是运行时监控。

## 目录

```text
benchmarks/
├── README.md
├── capdiff/
│   ├── run.mjs                    # 调用 core，生成 results.json + RESULTS.md
│   ├── RESULTS.md                 # 最近一次运行的两栏指标与误报/漏报清单
│   ├── results.json               # 机器可读结果（corpora.synthetic / corpora.real）
│   └── fixtures/
│       ├── <id>/                  # 17 个手写 synthetic 样本
│       │   ├── package.json       # 含 dsh.capabilities（数组或对象形式）
│       │   ├── expected.json      # declared / actual / staticVisible 真值
│       │   └── src/*.js|mjs|cjs
│       └── real/
│           ├── SOURCES.md         # 真实语料来源、修订、许可、抽取规则
│           └── real-<n>-<name>/   # 17 个真实片段
│               ├── package.json   # 为基准编写的 dsh.capabilities
│               ├── expected.json  # 真值 + source{repo,path,lines,license,url}
│               └── src/*.js
└── supply-watch/
    ├── run.mjs                    # 调用 core，生成 results.json + RESULTS.md
    ├── RESULTS.md
    ├── results.json
    └── data/
        ├── known.json             # 20 个 known（10 真实 + 10 合成）
        ├── variants.json          # 30 个合成变体（typo / separator / prefix）
        ├── legit.json             # 20 个原合法名基线
        └── legit-real.json         # 30 个真实 npm 包名（deps / DSH 插件名）
```

## 如何跑

要求 Node `^22.19.0 || >=24.9.0`，无第三方依赖，全程离线。在 `04-build/dsh-next-suite` 目录下：

```sh
node benchmarks/capdiff/run.mjs
node benchmarks/supply-watch/run.mjs
```

每次运行会**原地覆盖**：

- `benchmarks/capdiff/results.json`、`benchmarks/capdiff/RESULTS.md`
- `benchmarks/supply-watch/results.json`、`benchmarks/supply-watch/RESULTS.md`

两个 runner 在测量成功时退出码为 `0`，即使指标里包含误报/漏报；只有语料校验失败（样本数不对、`expected.json` 与 manifest 不一致、真实样本缺 source/许可、known 名单重复等）才以非 0 退出。指标中的“失败”是**被测工具的失败**，不是 runner 的失败。

结果中的 `generatedAt` 每次会变，`node` 随运行版本变化；除这两项外，同一语料与同一 Node 版本下输出是确定性的。

### capdiff 调用的 core 接口

`scanTarget` → `parseDeclared` → `diffCapabilities` → `buildFindings`。每个 fixture 的 manifest 声明与 `expected.json.declared` 会先做一致性校验；真实语料还会校验 `source` 必填字段、来源仓库、许可白名单和行数上限，避免“真值写错但指标好看”。

**两套语料的计分口径不同：**

- synthetic 沿用历史口径：`unknown` 是兜底类别，出现在 `detected` 且不在 `actual` 中时计 FP（fixture 13 因此仍为 diff）。
- real 只对 6 个 canonical 能力计分（`filesystem`、`network`、`process`、`env`、`eval`、`crypto`）；`unknown`（未映射 import）单独输出，**不计 FP**，因为工具 README 明确说 `unknown` 不是真实能力。若把 13 个带 `unknown` 的 fixture 按 synthetic 口径计 FP，real 检测 precision 会从 100% 降到 53.57%——这个数在 `RESULTS.md` 中同时给出。

### supply-watch 调用的 core 接口

`typosquatScore` 逐名打分，`severityOf` 映射等级，`watch` 走一遍完整管线并作为交叉校验；两者对“哪些候选被标记”的结论必须一致，否则 runner 报错。变体集保持 30 个合成变体；合法集拆成 `baseline` 与 `real` 两组，分别统计 FPR。

## 当前结果

以下为 **2026-11-15** 在 Node `v24.22.1` 上的实际运行结果；以各自 `RESULTS.md` 为准。

### dsh-capdiff（17 synthetic + 17 real）

两栏 P / R / F1：

| 视角 | Synthetic P | Synthetic R | Synthetic F1 | Real P | Real R | Real F1 |
|---|---:|---:|---:|---:|---:|---:|
| 能力检测（对 ground-truth `actual`） | 93.33% | 93.33% | 93.33% | 100.00% | 100.00% | 100.00% |
| 范围内检测（对 `staticVisible`） | 80.00% | 100.00% | 88.89% | 93.33% | 100.00% | 96.55% |
| 未声明 finding | 83.33% | 100.00% | 90.91% | 100.00% | 100.00% | 100.00% |
| 未使用 finding | 0.00% | n/a | n/a | 100.00% | 100.00% | 100.00% |
| 全部声明类 finding | 71.43% | 100.00% | 83.33% | 100.00% | 100.00% | 100.00% |

混淆计数：

| 视角 | Synthetic TP | Synthetic FP | Synthetic FN | Real TP | Real FP | Real FN |
|---|---:|---:|---:|---:|---:|---:|
| 能力检测 | 14 | 1 | 1 | 15 | 0 | 0 |
| 范围内检测 | 12 | 3 | 0 | 14 | 1 | 0 |
| 未声明 finding | 5 | 1 | 0 | 3 | 0 | 0 |
| 未使用 finding | 0 | 1 | 0 | 1 | 0 | 0 |
| 全部声明类 finding | 5 | 2 | 0 | 4 | 0 | 0 |

- **synthetic** 覆盖：纯安全、filesystem、network、child_process、env、eval、动态 import、混淆（计算型 import / 计算型 eval）、误报陷阱（注释、字符串、属性访问、未映射内建/相对 import）、manifest 对象形式、CommonJS `require`、多能力未声明。
- **synthetic 的 2 个故意失败**：`09-obfuscated-eval`（计算型全局 eval）与 `13-fp-unmapped-builtin`（`node:path`/相对 import 落入 `unknown`）。
- **real** 覆盖 14 个包（`dsh-next-suite` 8 个 + `dsh-os-suite` 6 个）和 2 个 DSH 文档示例；实际能力覆盖 `filesystem`、`crypto`、`env`、`network`（文档示例的全局 `fetch`）。这些包不使用 `child_process` 或 `eval`，这两种能力只由 synthetic 覆盖。
- **real 的 `unknown` 噪声**：13/17 个片段含未映射 import（`node:path`、`node:util`、相对模块、`@deepseek-ai/*`），canonical 计分不计 FP；raw 口径下会新增 13 个 `undeclared:unknown`，precision 53.57%。这是当前工具的真实边界，不应藏起来。
- **real 的声明差异是刻意设计的**：14 个上游包的 `package.json` 都没有 `dsh.capabilities`，fixture manifest 为基准编写。3 个样本故意少声明（`real-02` filesystem、`real-09`/`real-15` env），1 个故意多声明（`real-03` env），用于在真实代码上测 undeclared/unused。
- **真实语料来源/许可**：9 段 Apache-2.0 来自 `dsh-next-suite` 工作区快照（`main`，2026-11-15），6 段 Apache-2.0 来自 `dsh-os-suite` @ `cb1baa8`，2 段 MIT 来自 `deepseek-harness` docs @ `39163dd30f`。所有片段 ≤160 行（包片段 66-154 行），在顶层语句边界裁剪；两个文档示例把 TypeScript 注解剥成 JavaScript。逐条来源、许可和抽取规则见 `benchmarks/capdiff/fixtures/real/SOURCES.md`。未修改任何包代码，未下载未知许可代码。

### dsh-supply-watch（20 known / 30 variants / 50 legit）

| 判定阈值 | TP | FP | FN | TN | Precision | Recall | F1 | FPR（50 legit） | 真实名 FPR（30） |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 任意 finding（score > 0） | 27 | 1 | 3 | 49 | 96.43% | 90.00% | 93.10% | 2.00% | 0.00%（0/30） |
| 中/高（score ≥ 50） | 25 | 0 | 5 | 50 | 100.00% | 83.33% | 90.91% | 0.00% | 0.00%（0/30） |
| 仅高（score ≥ 80） | 17 | 0 | 13 | 50 | 100.00% | 56.67% | 72.34% | 0.00% | 0.00%（0/30） |

- 变体类别 recall（任意 finding）：typo `10/10`、separator `10/10`、prefix `7/10`。
- 3 个漏报是刻意保留的 prefix 类盲区：`@deepseek/dsh-xbrl`、`@evil/dsh-capdiff`（scope 包裹）与 `deepseek-harness-capdiff`（品牌展开）；现有规则不含 scope/品牌语义。
- 唯一误报仍是原 baseline 组的 `cordis-http-client`（score 44，low，known 名单里过短过泛的 `cordis` 触发 extra-segment）。30 个真实包名在 any/medium/high 三档均为 0 FP。
- 30 个真实名来自 `dsh-os-suite` 的包/lockfile 依赖、`dsh-next-suite` 的运行时依赖 `acorn`，以及 `deepseek-harness` 文档中的官方 DSH 包名；只使用包名标识，不下载 tarball。
- 对 20 个 known 名本身跑 `watch(known, known)`：0 个被标记（self-check 通过）。

## 指标口径

### capdiff

- `actual`：样本**实际**具备的 canonical 能力（含计算型 import / 全局 fetch 等真实能力）。
- `staticVisible`：其中**迁移前正则静态扫描**能看见的子集（保留为历史口径，便于前后对比）；AST 额外看见的全局 `fetch`、`fs.*` 成员调用会计入该视角的 FP，而不计入能力检测 FP。
- 检测混淆矩阵：`TP = detected ∩ actual`，`FP = detected − actual`，`FN = actual − detected`。
- 声明类 finding：`undeclared` 真值 = `actual − declared`；`unused` 真值 = `declared − actual`。工具输出与真值按 `(kind, capability)` 逐项对齐。
- `unknown` 是 capdiff 的兜底类别，不是真实能力。synthetic 沿用历史口径按 FP 计；real 不计分，单独列为 unmapped imports。
- Precision = TP/(TP+FP)，Recall = TP/(TP+FN)，F1 = 2PR/(P+R)；分母为 0 时显示 `n/a`。

### supply-watch

- 正例 = 30 个 lookalike 变体；负例 = 50 个合法名（20 baseline + 30 real）。
- “被标记”= core 的 `typosquatScore(...).score > 0`（即 `watch` 会产出 finding）。表格另给 score ≥ 50、≥ 80 两个阈值，对应 core 的 medium+ / high 等级。
- Recall = TP/30，FPR = FP/50（另列 FP/30 的真实名分组），Precision = TP/(TP+FP)，F1 = 2PR/(P+R)。
- 结果同时包含完整 30 变体表与 50 合法名表，便于逐项复核。

## 局限（必须连同数字一起读）

1. **合成 + 真实，但仍是人工挑选。** 17 个 capdiff synthetic、17 个 real 片段、30 个变体、50 个合法名都是人工挑选的；指标不是插件生态或 npm 总体的估计值，不能外推为“precision 100% / recall 100% 的工具”。
2. **real 的 100% 不代表工具完整。** 它只说明这 17 个片段里的 15 个 canonical 能力都被找到，且 13 个 `unknown` 噪声被单独识别。真实语料没有 `child_process`/`eval`，看完整边界必须结合 synthetic 的故意失败项。
3. **capdiff 是 AST 优先 + 正则回退的静态扫描。** 不执行代码；默认 acorn 解析 ESM/CJS，解析失败（TypeScript/JSX/语法错误）才回退正则。仍不覆盖 TypeScript/JSX、压缩 bundle、原生扩展、传递依赖或运行时行为；计算型 import、计算型全局 eval、`globalThis["ev"+"al"]` 仍会漏（样本 08 靠 `fs.*` 成员调用、09 仍失败）。全局 `fetch` 与 `http(s).request` 已由 AST 覆盖（样本 17 通过）。`node:path`、相对 import 会落入 `unknown` 并造成噪声（样本 13、以及 13/17 个 real 片段）。
4. **supply-watch 是离线名称相似度启发式。** 没有 registry 所有权、下载量、维护者历史、tarball、advisory 或依赖分析；known 名单由调用方手工提供，名单过时/过窄/过泛都会改变 precision/recall。scope 包裹、品牌展开、同形字、复数化、语义型仿冒并未穷尽覆盖。
5. **低分 finding 仍是 finding。** `cordis-http-client` 的 44 分是 low；如果 reviewer 只升级 medium+，这 1 个 FP 消失，但 recall 也从 90% 降到 83.33%。数字依赖阈值，不能只引用一行。
6. **没有“安全”结论。** 样本通过 ≠ 插件安全，未命中 ≠ 包可信；工具输出只是待人复核的线索（lead）。
7. **样本会漂移。** 修改 fixture 或 data 后指标会变；`RESULTS.md` 是快照，当前值以重新运行结果为准。

## 如何扩展

### 新增 capdiff synthetic fixture

在 `benchmarks/capdiff/fixtures/` 下新建目录，至少包含一个 `expected.json` 和带 `dsh.capabilities` 的 `package.json`：

```json
{
  "id": "18-example",
  "category": "filesystem",
  "description": "一句话说明",
  "declared": ["filesystem"],
  "actual": ["filesystem"],
  "staticVisible": ["filesystem"],
  "notes": "为什么这样标注",
  "limitation": null
}
```

`id` 必须与目录名一致。`package.json` 里写 `dsh.capabilities`（数组或对象形式均可）。`actual`/`staticVisible` 只使用 canonical 能力：`filesystem`、`network`、`process`、`env`、`eval`、`crypto`；`staticVisible` 必须是 `actual` 的子集。runner 会自动校验 manifest 解析结果与 `declared` 是否一致。

### 新增 capdiff real fixture

放在 `benchmarks/capdiff/fixtures/real/<id>/`，`expected.json` 增加必填的 `source`，runner 会校验仓库、许可白名单（Apache-2.0 / MIT）和行数上限：

```json
{
  "id": "real-18-example",
  "category": "real-filesystem",
  "description": "一句话说明",
  "declared": ["filesystem"],
  "actual": ["filesystem"],
  "staticVisible": ["filesystem"],
  "notes": "真实代码 + fixture manifest 的说明",
  "limitation": null,
  "source": {
    "repo": "dsh-next-suite",
    "revision": "main",
    "package": "pkg-name",
    "path": "packages/pkg-name/src/file.js",
    "lines": "1-100",
    "license": "Apache-2.0",
    "url": "https://github.com/PerryLink/dsh-next-suite/blob/main/packages/pkg-name/src/file.js",
    "transformation": "trimmed at a complete top-level statement boundary; imports and calls preserved"
  }
}
```

代码片段必须保留在完整顶层语句边界，并在文件头保留 `@benchmark-real-fixture` 来源/许可注释；同步更新 `benchmarks/capdiff/fixtures/real/SOURCES.md`。不要把真实包的整文件直接搬进来；超过 160 行的片段 runner 会拒绝。真实包的 `package.json` 通常没有 `dsh.capabilities`，fixture manifest 需显式编写，并在 `expected.json.notes` 说明这是基准声明。

### 新增 supply-watch 名单

- `data/known.json` 的 `names` 加 `{ "name", "origin": "real"|"synthetic", "note" }`；
- `data/variants.json` 的 `variants` 加 `{ "name", "category": "typo"|"separator"|"prefix", "target": "<known 中的名字>", "rationale" }`；
- `data/legit.json` 的 `legit` 加 `{ "name", "rationale" }`（原基线，20 条）；
- `data/legit-real.json` 的 `legit` 加 `{ "name", "origin": "real", "source", "rationale" }`（真实名，30 条）。

runner 强制要求 `20 / 30 / 20 / 30` 的数量、名称唯一、变体/合法名与 known 不相交、每个 `target` 存在于 known。若要做不同规模的实验，改 `run.mjs` 顶部的 `EXPECTED_*` 常量并同步更新本文档。

## 复现检查

```sh
cd 04-build/dsh-next-suite
node --check benchmarks/capdiff/run.mjs
node --check benchmarks/supply-watch/run.mjs
node benchmarks/capdiff/run.mjs
node benchmarks/supply-watch/run.mjs
find benchmarks -type f | sort
```

说明：本目录被上级仓库 `.gitignore` 的 `04-build/*` 规则忽略，所以 `git status` **不会**显示这些文件；不要用 `git status` 判断是否写入成功。本次交付只新增/修改 `benchmarks/`，`packages/dsh-capdiff/src` 与 `packages/dsh-supply-watch/src` 未被修改（可用文件列表与 mtime 核对）。
