# HCB 数据集：Zenodo 元数据、发布步骤与引用格式

> **状态：draft / planned。** 本文件是提交前的可执行草稿，**不是**已发布记录。
> 截至 2026-11-14：**DOI 未分配**、**Zenodo record 未创建**、**没有对外提交**。
> 数据集的代码仓为 <https://github.com/PerryLink/dsh-hcb>（2026-11 由 `dsh-compat-baseline` 改名）。
> 项目为独立社区项目，**与 DeepSeek 无隶属、无赞助、无背书**。
>
> **口径说明**：`CREDENTIALS.md` 里的「192 包安装数据」是早期计划口径；本文件与 Zenodo 元数据以 **HCB v0.5.1 的 143 行**为准，不把 192 写进数据集描述。

| 项目 | 当前值 | 证据 / 说明 |
|---|---|---|
| 文件状态 | **draft / planned** | 本文件；不是 Zenodo 记录状态 |
| 数据集名 | HCB — Host Compatibility Baseline for DeepSeek Harness plugins | `README.md`、`CITATION.cff` |
| 数据集版本 | `0.5.1` | `CHANGELOG.md`；git tag `v0.5.1` |
| 数据快照日 | 2026-11-14 | `data/matrix.json` 的 `generatedAt` |
| 记录数 | 143 个插件 × 10 个近期 host | `data/matrix.json` |
| 证据层 | declared 123 / checked 20 / tested 0 | `data/matrix.json.summary.evidence` |
| 代码许可 | **MIT** | 仓库根 `LICENSE`（1,083 B） |
| 数据许可 | **待定**：当前只有 MIT；`CC-BY-4.0` 尚未生效 | 见 §2 的「许可冲突」 |
| DOI | **未分配**（占位：`<DOI to be assigned>`） | 未创建 Zenodo deposition |
| Zenodo record | **未创建** | 需 Zenodo 账号 |

**不要**在任何 README、简历、论文或 npm 页面写「已获 DOI」，直到 §4.3 的发布与 §7 的验收都通过并把真实值回填到本文件。

---

## 1. 要存什么（deposit payload）

建议把 **可复现的数据快照 + 机器可读 schema + 口径文档 + 证据报告** 打成一个版本化压缩包，而不是只上传一个 `matrix.json`。

| 路径 | 内容 | 是否入包 |
|---|---|---|
| `data/matrix.json` | 143 行插件兼容矩阵；含 `standards`、`evidence`、`risk`、`gate` | 必须 |
| `data/hosts.json` | 39 个 DSH release 的 tag → version → date | 必须 |
| `data/roster.json` | 112 个 dsh-kit 家族包 + external 的规范名单 | 必须 |
| `data/coverage.json` | 对 roster 的覆盖结果 | 必须 |
| `data/tracks.json` | ENTRY / FLOW / BOOST 各状态计数 | 必须 |
| `data/capabilities.json` | capability / risk 聚合 | 必须 |
| `schema/hcb.schema.json` | v0.5 JSON Schema | 必须 |
| `docs/TRACKS.md` | ENTRY/FLOW/BOOST 三轨定义与「skip ≠ pass」规则 | 必须 |
| `docs/EVIDENCE.md` | declared / checked / tested 证据契约与复跑方法 | 必须 |
| `evidence/**/report.json` | 20 个 `checked` 行的原始 checker 报告 | 建议 |
| `scripts/collect.mjs`、`validate.mjs`、`coverage.mjs` | 采集/校验/覆盖复跑脚本 | 建议 |
| `README.md`、`CHANGELOG.md`、`CITATION.cff`、`LICENSE`、`NOTICE.md` | 说明、版本、引用、许可、第三方声明 | 必须 |
| `.git/`、`node_modules/`、npm cache、本地绝对路径 | 运行产物 | **禁止** |
| 任何 token、私钥、`.env`、私有包名 | 凭据/私有数据 | **禁止** |

**入包前必须做**：

1. `npm run validate` 通过；`npm run coverage` 输出与 `data/coverage.json` 一致。
2. `npm test` 通过（含 `scripts/audit-entry.test.mjs`）。
3. 对 `evidence/**/report.json` 做一次绝对路径与用户名清洗（checker 输出可能含 `/home/...` 或 `/mnt/...`）。
4. `gitleaks detect --no-git --source .`（或等价扫描）无命中；人工复核 `evidence/` 与 `data/` 中的 URL、路径、主机名。
5. 生成 `SHA256SUMS`，并在 `DEPOSIT-README.md` 写明：快照日、commit/tag、复跑命令、字段口径。
6. 冻结后**不再改数据**；后续修订发新版本（`0.5.2` / `0.6.0`），不要覆盖已发布 DOI 的文件。

建议的包名与结构：

```text
hcb-v0.5.1-2026-11-14.zip
├── DEPOSIT-README.md
├── SHA256SUMS
├── LICENSE
├── NOTICE.md
├── CITATION.cff
├── README.md
├── CHANGELOG.md
├── data/
├── schema/
├── docs/
├── evidence/
└── scripts/
```

---

## 2. Zenodo 元数据（可直接填写）

> Zenodo 的 `Description` 支持有限 HTML；下面给出一份纯文本口径和一份 HTML 版本。**发布前二者只选其一**，不要同时粘。

### 2.1 字段表

| Zenodo 字段 | 建议值 | 备注 |
|---|---|---|
| Upload type | **Dataset** | 不是 Software；代码仓另作为 related identifier |
| Title | `HCB: Host Compatibility Baseline for DeepSeek Harness plugins` | 与 `CITATION.cff` 一致 |
| Version | `0.5.1` | 与 git tag 一致 |
| Publication date | `2026-11-14`（数据快照日） | 若实际发布日晚于快照日，在 description 里同时写 snapshot date |
| Creators | `PerryLink`（独立开发者/维护者） | 不添加未同意的合作者；ORCID 有则填，没有就留空，**不要编** |
| Affiliation | `Independent` | 不写 DeepSeek 或任何未授权单位 |
| Language | `English` | 数据字段与文档均为英文 |
| License | **MIT**（当前仓库许可） | 见下方「许可冲突」；在许可证正式变更前不要选 CC-BY-4.0 |
| Keywords | `DeepSeek Harness; DSH; agent plugins; plugin compatibility; capability manifest; compatibility matrix; software supply chain; dependency metadata; reproducible dataset` | 分号分隔 |
| Related identifiers | 见 §2.2 | 全部使用真实 URL |
| Contributors | 可留空 | 不把工具/社区写成作者 |
| Funding | 无 | 不虚构基金号 |
| Notes | `Independent community dataset. Not affiliated with, sponsored by, or endorsed by DeepSeek. Declared compatibility is package-author metadata, not a runtime test.` | 与 README 的 non-affiliation 一致 |

### 2.2 Related identifiers

| Relation | Identifier | 说明 |
|---|---|---|
| Is supplement to | `https://github.com/PerryLink/dsh-hcb` | 数据集对应的代码/工具仓 |
| Is documented by | `https://github.com/PerryLink/dsh-hcb/blob/v0.5.1/README.md` | 使用说明与口径 |
| Is documented by | `https://github.com/PerryLink/dsh-hcb/blob/v0.5.1/docs/EVIDENCE.md` | declared/checked/tested 证据契约 |
| Is part of | `https://github.com/PerryLink/dsh-standards` | ENTRY/FLOW/BOOST 模型与 `dsh-levels/1` 的规范来源（HCB 只做 consumer mapping） |
| Is related to | `https://github.com/deepseek-ai/deepseek-harness` | 被观测的 host 项目；**不表示隶属或背书** |
| Is related to | `https://www.npmjs.com/package/dsh-hcb` | 数据集附带的 CLI 包（若发布版本与数据快照对应） |
| Cites | `<无>` | 不引用未发表/未核实的来源 |

> 如果 Zenodo 的关系类型里没有完全对应项，选最接近的 `Is related to`，并在 `Notes` 里用一句话解释；不要为了「看起来正式」而编造关系。

### 2.3 Description（纯文本，可直接粘）

```text
HCB (Host Compatibility Baseline) is a reproducible snapshot of how DeepSeek Harness (DSH) plugins declare compatibility with DSH host releases, and of what independent checks have actually been performed.

This dataset contains 143 plugin rows and 10 recent DSH host releases (selected from 39 catalogued releases). Each row records the plugin's declared engines.dsh range, the declared capability surface (dsh.capabilities), DSH-ENTRY/FLOW/BOOST declarations (dsh.standards / dsh-levels/1), the evidence level (declared, checked, or tested), a capability-risk bucket, and an hcb-gate/1 review heuristic.

Key distinctions:
- "declared-compatible" is the package author's claim from npm metadata. It is not a runtime test.
- "checked" means a named checker examined the published tarball statically. It is not a boot and not runtime evidence.
- "tested" means a real DSH host booted the plugin. In v0.5.1, tested = 0.
- "unknown" means the metadata does not answer the question; it is not a failure.
- The gate is a compatibility/risk heuristic, not a quality grade, certification, or security guarantee.

Snapshot summary (2026-11-14): 123 declared-compatible / 20 unknown / 0 declared-incompatible; evidence declared 123 / checked 20 / tested 0; risk high 2 / medium 62 / unknown 79; gate blocked 1 / review 21 / pilot 121 / production-candidate 0.

The dataset is an independent community project. It is not affiliated with, sponsored by, or endorsed by DeepSeek. Plugin names and npm metadata are public facts; inclusion does not imply endorsement. No private packages, credentials, or customer data are included.

Files include the matrix (JSON), host list, roster, coverage, track counts, capability aggregation, JSON Schema, methodology/evidence documents, checker reports for the checked rows, and the collection/validation scripts. See DEPOSIT-README.md for the exact snapshot, commit/tag, checksums, and reproduction commands.
```

### 2.4 Description（HTML 版本，可选）

```html
<p><strong>HCB (Host Compatibility Baseline)</strong> is a reproducible snapshot of how DeepSeek Harness (DSH) plugins declare compatibility with DSH host releases, and of what independent checks have actually been performed.</p>
<p>This dataset contains <strong>143 plugin rows</strong> and <strong>10 recent DSH host releases</strong> (selected from 39 catalogued releases). Each row records the declared <code>engines.dsh</code> range, the declared capability surface (<code>dsh.capabilities</code>), DSH-ENTRY/FLOW/BOOST declarations (<code>dsh.standards</code> / <code>dsh-levels/1</code>), the evidence level (<code>declared</code>, <code>checked</code>, or <code>tested</code>), a capability-risk bucket, and an <code>hcb-gate/1</code> review heuristic.</p>
<ul>
<li><strong>declared-compatible</strong> is the package author's claim from npm metadata; it is not a runtime test.</li>
<li><strong>checked</strong> means a named checker examined the published tarball statically; it is not a boot.</li>
<li><strong>tested</strong> means a real DSH host booted the plugin. In v0.5.1, tested = 0.</li>
<li><strong>unknown</strong> means the metadata does not answer the question; it is not a failure.</li>
<li>The gate is a compatibility/risk heuristic, not a quality grade, certification, or security guarantee.</li>
</ul>
<p>Snapshot summary (2026-11-14): 123 declared-compatible / 20 unknown / 0 declared-incompatible; evidence declared 123 / checked 20 / tested 0; risk high 2 / medium 62 / unknown 79; gate blocked 1 / review 21 / pilot 121 / production-candidate 0.</p>
<p>Independent community project. Not affiliated with, sponsored by, or endorsed by DeepSeek. Plugin names and npm metadata are public facts; inclusion does not imply endorsement. No private packages, credentials, or customer data are included.</p>
```

### 2.5 许可冲突（发布前必须解决）

- 仓库 `LICENSE` 是 **MIT**，`CITATION.cff` 也写 `license: MIT`；但 `CREDENTIALS.md` 旧计划写的是 **CC-BY-4.0**。
- **当前草稿按 MIT 填 Zenodo**，因为这是仓库里唯一真实存在的许可。
- 若确实要把「数据」以 CC-BY-4.0 发布，必须先做一次显式变更，而不是只在 Zenodo 下拉框里选：
  1. 在仓库根新增 `LICENSE-DATA`（CC-BY-4.0 全文）或把 `LICENSE` 改为双许可说明；
  2. 更新 `CITATION.cff` 的 `license`；
  3. 更新 `README.md` 的 License 节；
  4. 在 `NOTICE.md` 说明「代码 MIT / 数据 CC-BY-4.0」的边界；
  5. 再提交 Zenodo，并在 description 里写清 dual licensing。
- 在完成上述变更前，**不要**对外说「数据是 CC-BY-4.0」。

---

## 3. 数据字段表

### 3.1 顶层对象

| 字段 | 类型 | 说明 | 示例 |
|---|---|---|---|
| `schemaVersion` | string | 数据格式版本 | `"0.5"` |
| `generatedAt` | ISO-8601 string | 采集时间 | `"2026-11-14T08:25:14.752Z"` |
| `evidenceUpdatedAt` | ISO-8601 string | 最后一次证据合并时间 | `"2026-11-14T11:18:39.019Z"` |
| `latestHost` | string | 矩阵使用的最新 host 版本 | `"0.2.2-rc.3"` |
| `summary` | object | 聚合计数（见 §3.2） | — |
| `rows` | array | 143 个插件行（见 §3.3） | — |

### 3.2 `summary` 对象

| 字段 | 类型 | 说明 |
|---|---|---|
| `hosts` / `hostsRecent` | integer | 目录中 host 总数 / 进入矩阵的近期 host 数（39 / 10） |
| `plugins` | integer | 行数（143） |
| `compat` | object | `compatible` / `incompatible` / `unknown` 计数 |
| `gate` | object | `blocked` / `review` / `pilot` / `production-candidate` 计数 |
| `standardsDeclared` | integer | 声明了 `dsh.standards` 的插件数（3） |
| `entry` / `flow` / `boost` | object | 三轨各状态计数 |
| `risk` | object | `low` / `medium` / `high` / `unknown` 计数 |
| `byGroup` | object | 按 `mainline-default` / `mainline-opt-in` / `catalog-only` / `domain` / `external` 分组 |
| `evidence` | object | `declared` / `checked` / `tested` 计数（123 / 20 / 0） |

### 3.3 `rows[]` 单个插件行

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | npm 包名 |
| `version` | string | 是 | 被观测的已发布版本 |
| `declaredRange` | string \| null | 否 | `engines.dsh` 原始范围；无声明为 `null` |
| `rangeValid` | boolean | 否 | 该范围能否被解析 |
| `manifestVersion` | integer \| null | 否 | `dsh.manifestVersion`（如存在） |
| `capabilities` | string[] | 否 | `dsh.capabilities` 声明的能力 ID |
| `repository` | string | 否 | npm 元数据中的 repository URL |
| `publishedAt` | ISO-8601 string | 否 | npm 发布时间 |
| `downloadsLastWeek` | integer \| null | 否 | 采集时的周下载量（仅作上下文，不是质量指标） |
| `hosts` | object | 是 | `hostVersion → declared-compatible \| declared-incompatible \| unknown` |
| `standards.source` | enum | 是 | `package.json#dsh.standards` 或 `not-declared` |
| `standards.schema` | string \| null | 否 | 声明所用的 `dsh-levels/*` schema |
| `standards.entry.status` | enum | 是 | `runtime` / `recognized` / `static` / `blocked` / `failed` / `not-run` / `stale` / `unknown` |
| `standards.entry.declaredStatus` | enum | 否 | 作者声明的 ENTRY 状态（与实测/检查状态分开保存） |
| `standards.entry.evidence` | boolean | 是 | 该 ENTRY 状态是否有证据 |
| `standards.flow.status` | enum | 是 | `runtime` / `manual` / `not-run` / `failed` / `stale` / `unknown` |
| `standards.boost.status` | enum | 是 | `measured` / `not-measured` / `failed` / `stale` / `unknown` |
| `evidence.source` | enum | 是 | `declared` / `checked` / `tested` |
| `evidence.checkedAt` | ISO-8601 \| null | 是 | checked/tested 的时间；declared 必须为 `null` |
| `evidence.host` | string \| null | 是 | 检查/测试所用 host 版本 |
| `evidence.checker` | string \| null | 是 | 检查器与版本，例如 `dsh-standards@1.6.10` |
| `evidence.reportPath` | string \| null | 是 | 原始报告相对路径 |
| `risk.level` | enum | 是 | `low` / `medium` / `high` / `unknown` |
| `risk.capabilities` | string[] | 否 | 参与风险判断的能力 |
| `risk.reasons` | string[] | 否 | 风险理由 |
| `gate.decision` | enum | 是 | `blocked` / `review` / `pilot` / `production-candidate` |
| `gate.reasons` | string[] | 否 | 门禁理由 |
| `scope` | enum | 否 | `family` / `external` |
| `group` | enum | 否 | `mainline-default` / `mainline-opt-in` / `catalog-only` / `domain` / `external` |

> `declared-compatible` / `checked` / `tested` 的区别是本数据集的核心。**不要把 `declared-compatible` 读成「在 rc.3 上测过」**；`checked` 也只意味着「静态看过已发布 tarball」，不是 boot。

### 3.4 配套文件

| 文件 | 说明 |
|---|---|
| `data/hosts.json` | 39 个 DSH release：tag、version、date；矩阵只取最近 10 个 |
| `data/roster.json` | 112 个 dsh-kit 家族包（34 mainline-default / 53 opt-in / 10 catalog-only / 15 domain）+ external |
| `data/coverage.json` | roster 覆盖率（112/112 family + 31 external） |
| `data/tracks.json` | 三轨计数与 gate 计数 |
| `data/capabilities.json` | capability 到 risk 的聚合 |
| `schema/hcb.schema.json` | JSON Schema v0.5（顶层 + row + evidence 条件约束） |
| `docs/TRACKS.md` | 三轨定义、状态语义、非评分原则 |
| `docs/EVIDENCE.md` | 证据契约、复跑命令、失败/blocked 语义 |
| `evidence/**/report.json` | 20 个 checked 行的原始报告 |

---

## 4. 发布步骤（Zenodo，人工执行）

> **前置：** Zenodo 账号（建议用长期机构/个人邮箱，并开启 2FA）；GitHub 仓库写权限；本文件 §2.5 的许可决定已完成。
> **本仓库不会代你登录、不会上传、不会创建 DOI。** 下列步骤在浏览器或 Zenodo API 中人工完成。

### 4.1 冻结

- [ ] 确认 `git tag v0.5.1` 指向要发布的数据快照；`git status` 干净。
- [ ] 记录 `git rev-parse HEAD` 与 tag 的 peeled SHA；写入 `DEPOSIT-README.md`。
- [ ] 跑 `npm test`、`npm run validate`、`npm run coverage`；把命令与结果写入 `DEPOSIT-README.md`。
- [ ] 重新计算 `SHA256SUMS`，确认与包内文件一致。
- [ ] 完成 §1 的脱敏与 `gitleaks` 扫描。
- [ ] 生成 zip，记录 zip 的 SHA-256。

### 4.2 创建 deposition

- [ ] 登录 <https://zenodo.org/> → **New upload**。
- [ ] Upload type 选 **Dataset**。
- [ ] 上传 zip；等 checksum 完成。
- [ ] 填 §2.1 的 Title / Version / Publication date / Creators / Language / Keywords / License / Notes。
- [ ] 粘 §2.3 的 Description（或 §2.4 HTML，二选一）。
- [ ] 加 §2.2 的 Related identifiers。
- [ ] 预览：确认作者、许可、版本、related identifiers 没有指向 404。

### 4.3 发布与 DOI

- [ ] 点 **Publish**（发布后文件不可改；只能发新版本）。
- [ ] 记录 **version DOI**（`10.5281/zenodo.<version>`）与 **concept DOI**（`10.5281/zenodo.<concept>`）。
- [ ] 用 `https://doi.org/<DOI>` 验证可解析；用 `https://api.datacite.org/dois/<DOI>` 检查元数据。
- [ ] 把 DOI、record URL、发布日期回填到本文件顶部表格与 §5。
- [ ] 更新仓库 `CITATION.cff` 的 `doi`（有 DOI 后才加；不要提前提交占位 DOI）。
- [ ] 在 `README.md` 顶部加一行 `DOI: ...`；在 npm 包 README 同步。
- [ ] 确认 GitHub release `v0.5.1` 存在；如需，把 zip 作为 release asset（与 Zenodo 文件保持一致）。
- [ ] 在 `CREDENTIALS.md` 的 HCB 行把状态从 `planned` 改为 `published` **并附 DOI URL**；在此之前保持 `draft/planned`。

### 4.4 发布后

- [ ] 用另一台机器/无登录窗口打开 DOI，确认无权限墙。
- [ ] 检查 DataCite 元数据里的 license、related identifiers、creator 拼写。
- [ ] 若发现错误：Zenodo 允许编辑元数据（不换 DOI）；文件错误必须发新版本，并在 changelog 说明。
- [ ] 若需要撤回：先联系 Zenodo support；**不要**假设 DOI 可以删除。可把 record 改为 restricted，或按 Zenodo 支持的方式发布说明。

---

## 5. 引用格式（DOI 分配后替换占位符）

### 5.1 版本引用（推荐）

> PerryLink. (2026). *HCB: Host Compatibility Baseline for DeepSeek Harness plugins* (Version 0.5.1) [Data set]. Zenodo. https://doi.org/`<DOI to be assigned>`

### 5.2 所有版本（concept DOI）

> PerryLink. (2026). *HCB: Host Compatibility Baseline for DeepSeek Harness plugins* [Data set]. Zenodo. https://doi.org/`<concept DOI to be assigned>`

### 5.3 BibTeX

```bibtex
@dataset{perrylink_hcb_2026,
  author       = {PerryLink},
  title        = {HCB: Host Compatibility Baseline for DeepSeek Harness plugins},
  year         = {2026},
  version      = {0.5.1},
  publisher    = {Zenodo},
  doi          = {<DOI to be assigned>},
  url          = {https://github.com/PerryLink/dsh-hcb},
  note         = {Independent community dataset; not affiliated with DeepSeek}
}
```

### 5.4 CITATION.cff（发布后）

```yaml
cff-version: 1.2.0
message: "If you use this dataset, cite it as below."
title: "HCB: Host Compatibility Baseline for DeepSeek Harness plugins"
authors:
  - family-names: "PerryLink"
version: 0.5.1
date-released: 2026-11-14
license: MIT
doi: <DOI to be assigned>
url: "https://github.com/PerryLink/dsh-hcb"
```

> `CITATION.cff` 的 `doi` 字段只接受真实 DOI。**在 DOI 存在前不要提交这一行**；保留当前不带 DOI 的版本。

### 5.5 正文引用建议

- 首次出现：*HCB v0.5.1 (PerryLink, 2026; DOI ...)*。
- 说明口径时必须带一句：*"declared compatibility is package-author metadata, not a runtime test; tested = 0 in this snapshot."*
- 不要写「HCB 证明某插件可用」；只能写「某插件声明覆盖某 host 范围」或「某行有 checked 证据」。

---

## 6. 口径、伦理与限制

1. **declared ≠ tested。** 123 行是 `declared`，20 行是 `checked`，0 行是 `tested`。这是数据集最重要的限制，必须出现在 Zenodo description 和任何二次引用里。
2. **`unknown` 不是失败。** 20 个插件没有 `engines.dsh`；79 个没有 capability manifest；这只说明元数据不足。
3. **不点名贬损第三方。** 插件名是公开 npm 事实；可以列名做数据，但不要写「X 不安全」。风险等级是启发式，不是审计结论。
4. **不做排名。** HCB 明确「not a score」；不要把 gate 的 `pilot/review` 当质量排行榜。
5. **不包含私有数据。** 私有包、内部 token、客户数据、未公开路线图一律不入包。
6. **第三方 opt-out。** 若某个包作者要求从数据集中移除，开 issue 记录；下一版本移除并在 changelog 说明。已发布 DOI 的旧版本不追改文件，只发新版本。
7. **非官方。** Zenodo description、README、论文引用处都必须保留 non-affiliation 声明。
8. **数据可复算。** 每个数字都应能由 `data/*.json` 重算；`DEPOSIT-README.md` 给出命令。不要只给截图。

---

## 7. 验收清单（全部满足才算「已发布」）

- [ ] DOI 可解析（`https://doi.org/...` 返回 Zenodo record，不是 404）。
- [ ] DataCite 元数据含 title、creator、version、license、related identifiers。
- [ ] record 内含 `DEPOSIT-README.md`、`SHA256SUMS`、`LICENSE`、`schema`、`docs`、`data`。
- [ ] description 明确写 `declared / checked / tested` 的区别与 `tested = 0`。
- [ ] README、CITATION.cff、npm 页面、CREDENTIALS.md 的 DOI 完全一致。
- [ ] 至少 1 个外部引用（论文/博客/工具）——**这是后续目标，不是发布前提**；没有就写 `no external citation yet`，不要编。
- [ ] 本文件顶部状态从 `draft / planned` 改为 `published`，并附日期与 DOI。

---

## 8. 相关链接

- 仓库：<https://github.com/PerryLink/dsh-hcb>
- 数据目录：<https://github.com/PerryLink/dsh-hcb/tree/main/data>
- 证据契约：<https://github.com/PerryLink/dsh-hcb/blob/main/docs/EVIDENCE.md>
- 三轨定义：<https://github.com/PerryLink/dsh-hcb/blob/main/docs/TRACKS.md>
- 上游 host：<https://github.com/deepseek-ai/deepseek-harness>
- 规范来源：<https://github.com/PerryLink/dsh-standards>
- Zenodo：<https://zenodo.org/>
- DataCite DOI API：<https://api.datacite.org/>

> 本文件只描述如何发布与如何引用；**没有创建任何 Zenodo record，也没有分配 DOI**。任何「已获 DOI」的说法都必须以可解析的 `doi.org` 链接为准。
