# FSE'27 Tool Demo / Industry：摘要草稿

> **状态：draft / planned。** 未投稿、未录用、没有投稿回执。
> 本文件只是一份 250 词英文摘要 + 中文说明 + 投稿检查表；**不声称 FSE'27 已接收，也不声称任何截止日期已核实**。
> 目标会议：ACM International Conference on the Foundations of Software Engineering (FSE'27)，Tool Demo / Industry track。

---

## 1. 投稿定位

| 项 | 选择 | 理由 |
|---|---|---|
| 首选 track | **Tool Demo** | 有可运行工具、可复现实验、开源 artifact；不需要企业落地数据 |
| 备选 track | Industry | 需要真实组织部署与失败模式；目前没有可披露的企业案例，**不建议现在投** |
| 题目 | **CapDiff: Auditing Declared vs. Actual Capabilities in Agent Plugins** | 与 npm/GitHub 上的工具名一致，避免「论文名与 artifact 名对不上」 |
| 作者 | PerryLink（独立） | 不添加未同意的合作者；投稿前确认姓名/单位/邮箱 |
| 关键词 | agent plugins; capability manifest; static analysis; software supply chain; SARIF; developer tools | — |

**诚实边界**：摘要里的每个数字都必须能由仓库里的命令复算。当前能复算的是 §4 的试点数字与 **17 例合成基准**；公开插件上的 precision/recall 还没测，所以摘要只写合成基准的 P/R，并明确它是 synthetic，**不把它写成生态指标**。

---

## 2. 英文摘要（250 words）

> 按空白分词计数为 **250 words**（2026-11-14 本机 `split(/\s+/)`）。投稿系统若按连字符/LaTeX 计数，可能差 1–3 词；提交前以系统计数为准，必要时删 `intentionally` 这类副词。

Agent plugins extend a host with tools, but they also request capabilities such as filesystem access, network egress, and process execution. In today's manifests these capabilities are hand-written, and nothing checks them against the code that actually runs. We present CapDiff, a static, zero-dependency auditor that compares a plugin's declared dsh.capabilities with capability evidence found in its source: module imports, process.env access, eval, and child-process use. CapDiff classifies each capability as matched, undeclared, or unused, reports file and line evidence, and emits SARIF for code-scanning dashboards. It never executes plugin code and treats findings as review candidates, not safety verdicts. The scanner is intentionally conservative: it reports what static analysis can see, labels everything else unknown, and never infers runtime behavior. The tool is motivated by a corpus-level gap: in the HCB v0.5.1 snapshot, 79 of 143 plugins have no capability manifest, so their risk is recorded as unknown. We contribute (i) a compact capability model and diff semantics, (ii) an Apache-2.0 implementation with JSON and SARIF output plus an offline test suite, and (iii) a pilot on 14 first-party packages (58 source files) in which no package declares capabilities and CapDiff surfaces 32 undeclared capability classes for review. A 17-fixture synthetic benchmark gives 92.3% precision and 80.0% recall at capability level; a labeled public-plugin study remains future work. Artifact, fixtures, and reproduction commands will ship with the submission. CapDiff is a first, cheap gate for plugin authors and reviewers; it complements, rather than replaces, runtime sandboxing and signed provenance.

---

## 3. 中文说明

**标题**：CapDiff：审计 Agent 插件「声明能力」与「实际能力」的差异。

**问题**：Agent 插件在 manifest 里声明 `dsh.capabilities`（文件、网络、进程、eval 等），但声明是手写的，没有任何机制对照代码里实际出现的 import 与语言级能力。少声明会让未声明的权限绕过评审；多声明会让 reviewer 被噪声淹没。通用 SAST 不理解插件 manifest，运行时沙箱又太贵、太晚。

**方法**：CapDiff 是静态、零依赖的扫描器。它读 manifest 的声明集合，扫描 `.js/.mjs/.cjs` 的模块引用与 `process.env`、`eval`、`child_process` 等使用，把每个能力归为 `matched` / `undeclared` / `unused`，给出文件+行号证据，并输出 SARIF 供 code-scanning 面板消费。它**不执行插件代码**，明确把结果定位为「供人复核的候选差异」，不是安全结论。

**贡献**：① 一个很小的能力模型与差异语义（含 `unknown` 兜底与声明侧别名规范化）；② Apache-2.0 实现，JSON/SARIF 双输出、离线测试、明确退出码；③ 与 HCB 数据集联动的试点：14 个一方包、58 个源文件、0 个声明 manifest、32 类未声明能力。

**评估**：已可复算的是试点数字与 17 例合成基准（§4）：capability-level precision 92.31%、recall 80.00%（合成样本，不能外推）。**尚未测**公开插件上的 precision/recall、跨项目误报率、reviewer 节省时间；论文投稿前必须补一个有标注的公开插件样本，否则不能把「有效」写成结论。

**Artifact**：`dsh-capdiff@0.2.5`（npm，Apache-2.0）、GitHub 仓库、`npm test`、17 例合成基准（`benchmarks/capdiff/`）；Zenodo DOI 为 **planned**，尚未分配。

**截止日期**：`CREDENTIALS.md` 里的 2027-01-26 / 2027-01-23 只是计划估计，**不是官方日期**。投稿前必须打开 FSE'27 官网核对 Important Dates；官网未发布就写「待定」，不要对外承诺。

---

## 4. 评估：哪些是真的，哪些还必须测

### 4.1 已复算（可以写进论文）

| 数字 | 来源 / 复现命令 | 备注 |
|---|---|---|
| HCB v0.5.1 快照：143 行，79 行无 capability manifest | `dsh-hcb` 的 v0.5.1 `data/matrix.json`；`summary.risk.unknown = 79` | 79 是 `risk.level=unknown` 且 reason 为 `no capability manifest` 的行。**canonical 已到 `dsh-hcb@0.14.0`；投稿前必须用冻结快照重算，不能直接沿用本行数字。** |
| HCB 123 declared / 20 checked / 0 tested | `summary.evidence` | **0 tested** 必须写进论文 |
| 14 个一方包，0 个声明 `dsh.capabilities` | `node -e` 遍历 14 个 `package.json` | 这些是 CLI/库，部分本来就不该有 manifest；论文里要说清「pilot 是工具自检，不是插件生态结论」 |
| 58 个源文件、32 类未声明能力 | `dsh-capdiff <pkg> --json` × 14；`diff.undeclared.length` 求和 | 未传 manifest 时声明为空，32 必然全部 undeclared；这是**上限**，不是生态估计 |
| CapDiff 单测 39/39 | `cd packages/dsh-capdiff && npm test` | 与 8 包 342/342 分开报 |
| 17 例合成基准：capability P=92.31% / R=80.00%；in-scope R=100% | `node benchmarks/capdiff/run.mjs`；`benchmarks/capdiff/RESULTS.md` | **合成、人工挑选**；benchmark 已进入 `v0.2.5` tag，投稿 artifact 可从该 tag 复现 |

### 4.2 投稿前必须补（当前 TODO）

| 需要的结果 | 最小实验设计 | 状态 |
|---|---|---|
| 公开插件上的 precision / recall | 从 HCB v0.5.1 的 143 行抽 30–50 个包，人工标注「代码实际能力」；跑 CapDiff；算 per-capability P/R 与混淆矩阵 | ⬜ todo（合成 17 例已完成，见 §4.1） |
| 误报来源分类 | 对每个 `undeclared` 样本标：真差异 / 正则误报 / 动态 import 漏报 / 别名不识别 | ⬜ todo |
| Reviewer 成本 | 2 名评审各自看「原始 manifest」vs「CapDiff findings」，记时间与漏项 | ⬜ todo |
| 与基线对比 | 至少一个通用 SAST（如 Semgrep 规则）或「纯人工」基线 | ⬜ todo |
| 外部有效性 | 不要只用一方包；公开插件样本要记录选取标准与版本 | ⬜ todo |
| Artifact 可复现 | 固定 npm 版本、Node 版本、fixture、脚本、期望输出 | ⬜ todo |

> 如果投稿前来不及做 4.2，**降级为 short paper / poster 或只投 workshop**，不要把这 17 例合成 P/R 写成公开插件或生态结论。Tool Demo 评审能接受「工具有限但真实」，不能接受编造评估。

---

## 5. 章节骨架（按 Tool Demo 常见 2–4 页准备，最终页数限制以官网为准）

1. **Introduction**：插件能力声明的信任缺口；一个具体 under-declaration 例子（用合成 fixture，不点名第三方）。
2. **Motivation**：HCB v0.5.1 的 79/143 unknown；为什么通用 SAST 不够。
3. **CapDiff**：manifest 解析 → 源码扫描 → 能力映射 → diff → SARIF；一张架构图。
4. **Design decisions**：零依赖、不执行、findings 不作为失败、`unknown` 兜底。
5. **Evaluation**：§4.1 的 pilot + §4.2 的标注实验（有多少写多少）。
6. **Limitations**：正则启发式、动态 import、全局 `fetch` 目前不扫描、无运行时保证。
7. **Artifact / Availability**：仓库、npm、测试命令、DOI（若已分配）。
8. **Related work**：SAST、SBOM、capability-based security、plugin sandboxing、SLSA/in-toto。
9. **Conclusion**：便宜的第一道门，不是沙箱替代品。

---

## 6. Artifact 计划

| 项 | 当前 | 投稿前目标 |
|---|---|---|
| 代码 | <https://github.com/PerryLink/dsh-next-suite>（`packages/dsh-capdiff`） | 工具在 `v0.2.5`；benchmark 已随 `v0.2.5` tag 发布，可从 tag 复现 |
| npm | `dsh-capdiff@0.2.5` | 保留 `0.2.5`；artifact 评审用 `npm pack` 的 tarball + SHA-256 |
| 许可 | Apache-2.0 | 不变 |
| 测试 | `dsh-capdiff` 39/39；全套件 342/342 | CI 跑 Node 22.19 / 24.x；benchmark 用独立命令 |
| 数据 | HCB（canonical `dsh-hcb`；本稿表格数字来自 v0.5.1 快照，投稿前重算） | Zenodo DOI（planned；见 `hcb-doi.md`，该文件已标 SUPERSEDED） |
| 标注集 | 17 个合成 fixture（`benchmarks/capdiff/fixtures/`） | 公开插件标注集 + 标注指南 + 双人一致性 |
| 复现脚本 | `node benchmarks/capdiff/run.mjs`（已可复跑） | `npm run reproduce` 或 `make artifact`，一条命令出所有表 |
| Artifact badge | 无 | 按会议 artifact 流程申请；**未申请前不写「available」** |

---

## 7. 截止日期与投稿检查表

### 7.1 截止

- **官方来源**：FSE'27 官网 / ACM FSE 系列的 Important Dates 页面（<https://conf.researchr.org/series/fse>；投稿前以它为准）。
- **本稿不确认任何日期**。`CREDENTIALS.md` 的 `2027-01-26`（Tool Demo）与 `2027-01-23`（Industry）是**计划估计**；如果官网未发布，按「待定」处理。
- 时区：AoE（Anywhere on Earth）是常见约定，但**以官网为准**；不要按本地时间卡点。

### 7.2 检查表

- [ ] 官网 Important Dates 已核对，track、页数、格式、双盲/单盲规则已确认。
- [ ] 标题、作者、单位、邮箱在投稿系统与 PDF 中一致。
- [ ] 摘要 250 词（以系统计数为准）；P/R 只引用 17 例合成基准并标明 synthetic。
- [ ] §4.1 的每个数字都有命令与输出；§4.2 未完成的结果没有写进摘要。
- [ ] Artifact 链接可访问；tag、npm 版本、DOI 状态一致。
- [ ] 第三方插件不点名（除非书面同意）；例子用合成 fixture。
- [ ] 不写「accepted」「to appear」「best paper」；不伪造投稿回执。
- [ ] 若被拒：不把摘要改成「已被 FSE 接收」；转 workshop/arXiv 时保留「under review / rejected」的真实状态。

### 7.3 Industry track 备选（不投，仅记录）

题目：**Governance Primitives for Agent Harnesses: Trace, Lease, Quota**。卖点是企业落地中的审计、租约、配额失败模式。**当前没有可披露的企业部署数据**，写出来只能停在架构层，容易被 Industry 评审判为「没有工业经验」。除非拿到书面授权的真实案例，否则优先 Tool Demo。

---

## 8. 不伪造的边界

1. **不写录用。** 没有回执就不写 `accepted`；被拒也不写 `accepted`。
2. **不写未测数字。** 合成 P/R 必须带「17-fixture synthetic」限定；公开插件 P/R、reviewer 节省时间、企业部署规模都还没测。
3. **不把 pilot 说成生态结论。** 14 个一方包不是 v0.5.1 的 143 个插件的随机样本。
4. **不点名第三方插件。** HCB 数据可以聚合引用；论文例子用合成 fixture。
5. **不把 Zenodo DOI 写成已分配。** 只有 `doi.org` 可解析后才写。
6. **不虚构截止日期。** 官网没写就写「待定」。

---

## 9. 相关文件

- CapDiff 源码：<https://github.com/PerryLink/dsh-next-suite/tree/main/packages/dsh-capdiff>
- CapDiff README：<https://github.com/PerryLink/dsh-next-suite/blob/main/packages/dsh-capdiff/README.md>
- HCB 数据集：<https://github.com/PerryLink/dsh-hcb>
- HCB DOI 草稿：[`hcb-doi.md`](hcb-doi.md)
- OpenSSF 自评：[`openssf.md`](openssf.md)
- 版本策略：[`../../VERSIONING.md`](../../VERSIONING.md)

> 本文件是**摘要草稿**，不是投稿记录。截至 2026-11-14：**未投稿、未录用、没有 DOI、没有 badge**。
