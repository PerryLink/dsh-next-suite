# 可复跑基准：dsh-capdiff 与 dsh-supply-watch

本目录是 `packages/dsh-capdiff` 与 `packages/dsh-supply-watch` 的**合成样本基准**。只写 `benchmarks/`，不修改任何包代码；两个 `run.mjs` 都直接调用对应包的 `src/core.js`。

> ⚠️ **这不是安全结论。** 样本是手写的合成样本，指标只描述这些样本，**不代表全量插件、全量 npm 或真实攻击面**。无 finding ≠ 安全；有 finding ≠ 恶意。两个工具都是静态/离线启发式，不是 SCA、不是沙箱、不是运行时监控。

## 目录

```text
benchmarks/
├── README.md
├── capdiff/
│   ├── run.mjs                 # 调用 core，生成 results.json + RESULTS.md
│   ├── RESULTS.md              # 最近一次运行的指标与误报/漏报清单
│   ├── results.json            # 机器可读结果
│   └── fixtures/               # 17 个插件样本
│       └── <id>/
│           ├── package.json    # 含 dsh.capabilities（数组或对象形式）
│           ├── expected.json   # declared / actual / staticVisible 真值
│           └── src/*.js|mjs|cjs
└── supply-watch/
    ├── run.mjs                 # 调用 core，生成 results.json + RESULTS.md
    ├── RESULTS.md
    ├── results.json
    └── data/
        ├── known.json          # 20 个 known 包名（10 真实 + 10 合成）
        ├── variants.json       # 30 个变体（typo / separator / prefix）
        └── legit.json          # 20 个合法名
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

两个 runner 在测量成功时退出码为 `0`，即使指标里包含误报/漏报；只有语料校验失败（样本数不对、`expected.json` 与 manifest 不一致、known 名单重复等）才以非 0 退出。指标中的“失败”是**被测工具的失败**，不是 runner 的失败。

结果中的 `generatedAt` 每次会变，`node` 随运行版本变化；除这两项外，同一语料与同一 Node 版本下输出是确定性的。

### capdiff 调用的 core 接口

`scanTarget` → `parseDeclared` → `diffCapabilities` → `buildFindings`。每个 fixture 的 manifest 声明与 `expected.json.declared` 会先做一致性校验，不一致直接报错，避免“真值写错但指标好看”。

### supply-watch 调用的 core 接口

`typosquatScore` 逐名打分，`severityOf` 映射等级，`watch` 走一遍完整管线并作为交叉校验；两者对“哪些候选被标记”的结论必须一致，否则 runner 报错。

## 当前结果

以下为 **2026-11-14** 在 Node `v24.22.1` 上的实际运行结果；以各自 `RESULTS.md` 为准。

### dsh-capdiff（17 个 fixture）

| 视角 | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|
| 能力检测（对 ground-truth `actual`） | 12 | 1 | 3 | 92.31% | 80.00% | 85.71% |
| 范围内检测（对 `staticVisible`） | 12 | 1 | 0 | 92.31% | 100.00% | 96.00% |
| 未声明 finding | 4 | 1 | 1 | 80.00% | 80.00% | 80.00% |
| 未使用 finding | 0 | 2 | 0 | 0.00% | n/a | n/a |
| 全部声明类 finding | 4 | 3 | 1 | 57.14% | 80.00% | 66.67% |

- 17 个样本覆盖：纯安全、filesystem、network、child_process、env、eval、动态 import、混淆（计算型 import / 计算型 eval）、误报陷阱（注释、字符串、属性访问、未映射内建/相对 import）、manifest 对象形式、CommonJS `require`、多能力未声明。
- **4 个样本故意失败**，用于量化已知边界：`08-obfuscated-concat`、`09-obfuscated-eval`（计算型构造不可见）、`13-fp-unmapped-builtin`（`node:path`/相对 import 落入 `unknown`）、`17-global-fetch`（全局 `fetch` 不扫描）。
- `staticVisible` 视角的 recall 100% 只说明“正则能看见的部分没漏”，**不说明工具完整**；完整视角 recall 是 80.00%。

### dsh-supply-watch（20 known / 30 variants / 20 legit）

| 判定阈值 | TP | FP | FN | TN | Precision | Recall | F1 | FPR |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 任意 finding（score > 0） | 27 | 1 | 3 | 19 | 96.43% | 90.00% | 93.10% | 5.00% |
| 中/高（score ≥ 50） | 25 | 0 | 5 | 20 | 100.00% | 83.33% | 90.91% | 0.00% |
| 仅高（score ≥ 80） | 17 | 0 | 13 | 20 | 100.00% | 56.67% | 72.34% | 0.00% |

- 变体类别 recall（任意 finding）：typo `10/10`、separator `10/10`、prefix `7/10`。
- 3 个漏报是刻意保留的 prefix 类盲区：`@deepseek/dsh-xbrl`、`@evil/dsh-capdiff`（scope 包裹）与 `deepseek-harness-capdiff`（品牌展开）；现有规则不含 scope/品牌语义。
- 1 个误报：`cordis-http-client`，score 44（low），原因是 known 名单里有个过短过泛的 `cordis`，触发 “extra segment” 启发式。中/高阈值下无误报。
- 对 20 个 known 名本身跑 `watch(known, known)`：0 个被标记（self-check 通过）。

## 指标口径

### capdiff

- `actual`：样本**实际**具备的能力（含计算型 import / 全局 fetch 等真实能力）。
- `staticVisible`：其中**正则静态扫描应能看见**的子集；两者之差就是已声明的范围外构造。
- 检测混淆矩阵：`TP = detected ∩ actual`，`FP = detected − actual`，`FN = actual − detected`。
- 声明类 finding：`undeclared` 真值 = `actual − declared`；`unused` 真值 = `declared − actual`。工具输出与真值按 `(kind, capability)` 逐项对齐。
- `unknown` 是 capdiff 的兜底类别，不是真实能力；它出现在 `detected` 中且不在 `actual` 中时，按 FP 计。
- Precision = TP/(TP+FP)，Recall = TP/(TP+FN)，F1 = 2PR/(P+R)；分母为 0 时显示 `n/a`。

### supply-watch

- 正例 = 30 个 lookalike 变体；负例 = 20 个合法名。
- “被标记”= core 的 `typosquatScore(...).score > 0`（即 `watch` 会产出 finding）。表格另给 score ≥ 50、≥ 80 两个阈值，对应 core 的 medium+ / high 等级。
- Recall = TP/30，FPR = FP/20，Precision = TP/(TP+FP)，F1 = 2PR/(P+R)。
- 结果同时包含完整 30 变体表与 20 合法名表，便于逐项复核。

## 局限（必须连同数字一起读）

1. **合成、人工挑选，不是全量。** 17 个 capdiff 样本、30 个变体、20 个合法名都是手写的；指标不是插件生态或 npm 总体的估计值，不能外推为“precision 92%/recall 90% 的工具”。
2. **capdiff 是正则静态扫描。** 不执行代码，不解析 AST，不覆盖 TypeScript/JSX、压缩 bundle、原生扩展、传递依赖或运行时行为；计算型 import、`globalThis["ev"+"al"]`、全局 `fetch` 都会漏（样本 08/09/17 已量化）。`node:path`、相对 import 会落入 `unknown` 并造成噪声（样本 13）。
3. **supply-watch 是离线名称相似度启发式。** 没有 registry 所有权、下载量、维护者历史、tarball、advisory 或依赖分析；known 名单由调用方手工提供，名单过时/过窄/过泛都会改变 precision/recall。scope 包裹、品牌展开、同形字、复数化、语义型仿冒并未穷尽覆盖。
4. **低分 finding 仍是 finding。** `cordis-http-client` 的 44 分是 low；如果 reviewer 只升级 medium+，这 1 个 FP 消失，但 recall 也从 90% 降到 83.33%。数字依赖阈值，不能只引用一行。
5. **没有“安全”结论。** 样本通过 ≠ 插件安全，未命中 ≠ 包可信；工具输出只是待人复核的线索（lead）。
6. **样本会漂移。** 修改 fixture 或 data 后指标会变；`RESULTS.md` 是快照，当前值以重新运行结果为准。

## 如何扩展

### 新增 capdiff fixture

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

### 新增 supply-watch 名单

- `data/known.json` 的 `names` 加 `{ "name", "origin": "real"|"synthetic", "note" }`；
- `data/variants.json` 的 `variants` 加 `{ "name", "category": "typo"|"separator"|"prefix", "target": "<known 中的名字>", "rationale" }`；
- `data/legit.json` 的 `legit` 加 `{ "name", "rationale" }`。

runner 强制要求 `20 / 30 / 20` 的数量、名称唯一、变体/合法名与 known 不相交、每个 `target` 存在于 known。若要做不同规模的实验，改 `run.mjs` 顶部的 `EXPECTED_*` 常量并同步更新本文档。

## 复现检查

```sh
cd 04-build/dsh-next-suite
node --check benchmarks/capdiff/run.mjs
node --check benchmarks/supply-watch/run.mjs
node benchmarks/capdiff/run.mjs
node benchmarks/supply-watch/run.mjs
find benchmarks -type f | sort
```

说明：本目录被上级仓库 `.gitignore` 的 `04-build/*` 规则忽略，所以 `git status` **不会**显示这些文件；不要用 `git status` 判断是否写入成功。本次交付只新增 `benchmarks/`，`packages/dsh-capdiff/src` 与 `packages/dsh-supply-watch/src` 未被修改（可用文件列表与 mtime 核对）。
