# 90 天可拿到的凭证：申请清单（不伪造结果）

> 2026-11-14｜对象 PerryLink｜原则：只做「真实可提交」的第一步；不虚构 DOI、badge、论文录用或职称。
> 这些是 `NEXT.md` 里「职业凭证」线的执行版；和代码工具分开，避免把「申请中」写成「已获得」。

---

## 1. HCB 数据集 DOI（最快 2–6 周）

**做什么**：把已有的 DSH/Cordis 兼容矩阵整理成可引用数据集，发布到 Zenodo，拿 DOI。

**已有资产**：`PerryLink/dsh-hcb` 的 HCB 数据集（canonical；当前 `0.14.0`）；本套件的 24 行 host-service seed；14 个一方包的 capdiff 语料。**不要**再引用早期「192 包安装数据」口径。

**步骤**：
1. 冻结一版数据：`atlas.csv`/`matrix.json` + `README.md`（字段、口径、日期、许可 CC-BY-4.0）。
2. 去重/脱敏：不包含私有包、token、内部路径。
3. Zenodo → New upload → 填 title/description/authors/license → 发布 → 得 DOI。
4. 把 DOI 写进 `dsh-upgrade-atlas`/`dsh-os-suite` README 和简历。

**验收**：DOI 可解析；数据集有字段说明；至少 1 个外部引用（论文/博客/工具）。

**风险**：数据口径被质疑 → 先写清「官方口径 vs 社区口径」；不要声称「全量」。

---

## 2. OpenSSF Best Practices Badge（2–4 周/仓，先做 3 个）

**做什么**：给 3 个仓申请 OpenSSF passing badge，作为「工程可信度」的第三方凭证。

**候选**：`dsh-os-trace`、`dsh-os-lease`、`dsh-os-quota`（或 `dsh-capdiff`）。

**步骤**：
1. 在 https://bestpractices.dev 注册项目，填 repo URL。
2. 按 passing 级要求补：README、LICENSE、SECURITY.md、CI、测试、发布流程、漏洞报告渠道。
3. 逐项自评 → 提交 → 获得 badge → 把 badge 放进 README。

**验收**：badge 页面可访问；至少 3 个仓通过 passing。

**风险**：为过 badge 堆文档 → 只补真实存在的流程；不要抄模板。

---

## 3. FSE'27 Tool Demo / Industry 论文（1 月截稿）

**做什么**：投 1 篇工具演示或工业经验论文，把 `dsh-os-suite`/`dsh-capdiff` 变成可引用成果。

**截止**：Tool Demo 约 **2027-01-26**；Industry 约 **2027-01-23**（以官网为准）。

**选题（二选一）**：
- Tool Demo：**“CapDiff: Auditing Declared vs Actual Capabilities in Agent Plugins”**——工具架构 + 在冻结的 HCB 快照上的发现（快照版本与行数在投稿前重算，不引用早期的 192 包口径）。
- Industry：**“Governance Primitives for Agent Harnesses: Trace, Lease, Quota”**——企业落地经验 + 失败模式。

**需要材料**：2–4 页工具论文/经验论文、demo 视频、可复现实验、 artifact 链接。

**验收**：投稿回执；无论录用与否，arXiv/Zenodo 预印本可引用。

**风险**：数据涉及第三方插件 → 匿名化/聚合；不要点名。

---

## 4. IETF I-D / W3C Agent Protocol CG（2–4 周）

**做什么**：把「插件能力声明/撤销/兼容」写成一份 Internet-Draft 或 W3C CG 提案，占一个「提案人」位置。

**步骤**：
1. 选一个窄题：**Agent Plugin Capability Manifest**（能力/权限/撤销/兼容字段）。
2. 按 IETF 模板写 5–8 页：问题、术语、字段、安全考虑、IANA/注册表（如适用）。
3. 提交到 IETF Datatracker（`draft-perrylink-...-00`）；或在 W3C CG 发提案。
4. 公开征求 3–5 位实现者反馈；迭代 -01。

**验收**：Datatracker 有草案页；至少 3 条外部反馈。

**风险**：个人提交被无视 → 先找 AAIF/Agent Plugins 的实现者联署；不要自称「标准」。

---

## 5. 北京 AI 职称材料（6–12 个月准备）

**做什么**：把开源贡献映射到职称评审的「成果条件」，而不是临时凑材料。

**需要**：
- 北京劳动关系/社保（按当地要求）；
- 3 个落地场景（企业/行业案例）；
- 开源贡献证明（repo、release、badge、DOI）；
- 标准/论文/专利（至少 1 项）；
- 单位盖章/答辩。

**行动**：先做 1 个企业案例 + 1 个 DOI + 1 个 badge；职称公告出来再对齐条目。

**风险**：政策变化 → 以当年公告为准；不要相信「包过」。

---

## 6. 12 个月日历

| 时间 | 动作 |
|---|---|
| 2026-12 | HCB 数据集冻结；Zenodo DOI |
| 2027-01 | OpenSSF badge 第 1 个；FSE'27 投稿 |
| 2027-02 | OpenSSF badge 第 2–3 个；IETF -00 |
| 2027-03 | FSE 结果；DOI 引用跟踪 |
| 2027-Q2 | 标准 -01；职称材料清单 |
| 2027-Q3 | 第 2 篇论文/工具 demo |
| 2027-Q4 | 职称申报（如条件满足） |

---

## 7. 纪律

1. 不伪造 DOI/badge/录用/职称。
2. 不把「申请中」写成「已获得」。
3. 不在公开材料里点名第三方插件/企业，除非获得书面同意。
4. 每个凭证都要有可解析链接和日期。
