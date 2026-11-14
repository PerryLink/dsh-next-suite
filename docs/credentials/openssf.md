# OpenSSF Best Practices Badge：3 仓 passing 自评清单

> **状态：draft / planned。** 尚未在 <https://bestpractices.dev> 注册项目，**没有 badge、没有 project ID、没有「passing」声明**。
> 本文件是提交前的自评底稿：按官方 **Passing** 级 criteria 分组，逐项标 `done` / `todo`，并给出证据或最小动作。
> 官方条目与完整措辞以 <https://www.bestpractices.dev/en/criteria> 为准；本文只做逐项对照，不替代官方问卷。
>
> **时效性（2026-11-14 20:20 核对）**：`dsh-next-suite` 与 `dsh-os-suite` 的 `SECURITY.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`.github/workflows/*` 已出现在 **staging tree**；公网 GitHub 是否已同步、CI 是否已首次跑绿，本文件**未确认**。表中 `✅ done*` 表示「staging 有文件」，提交 badge 前必须换成公网 URL 并去掉星号。

---

## 1. 范围与一个必要的修正

`CREDENTIALS.md` 原计划写的是「给 `dsh-os-trace`、`dsh-os-lease`、`dsh-os-quota` 三个仓申请 badge」。这三个是**包名**，不是独立仓库；它们都在 `PerryLink/dsh-os-suite` 这个 monorepo 里。OpenSSF 按 **repository URL** 注册项目，对同一个 monorepo 注册三次没有意义，也不会产生三个独立 badge。

因此本稿把「3 个仓」修正为**三个真实存在的公开仓**，一仓一个 project：

| # | 仓库 | 内容 | 许可 | 版本 / tag | 测试 | CI | SECURITY.md | CONTRIBUTING |
|---|---|---|---|---|---|---|---|---|
| 1 | <https://github.com/PerryLink/dsh-next-suite> | 8 个工具/库（capdiff、attest、supply-watch、cordis-*、xbrl、atlas） | Apache-2.0 | `0.1.1` / `v0.1.1` | 242/242 | `ci.yml`、`release.yml`（staging） | 有（staging） | 有（staging） |
| 2 | <https://github.com/PerryLink/dsh-os-suite> | 6 个治理插件（trace、lease、quota、eval、catalog、registry） | Apache-2.0 | `0.1.1` / `v0.1.1` | 90/90 | `ci.yml`、`release.yml`（staging） | 有（staging） | 有（staging） |
| 3 | <https://github.com/PerryLink/dsh-hcb> | HCB 数据/门禁子项目（矩阵、schema、CLI、证据层） | MIT | `0.5.1` / `v0.5.1` | `npm test` | `self-check.yml`、`collect.yml` | 无 | 无 |

**没有把 `dsh-hcb` 换成某个插件包的原因**：它是三者中唯一已有 CI、CHANGELOG、schema 文档和版本 tag 链的项目，最接近 passing；同时它与前两个仓的风险面不同（数据 + 静态检查），自评能暴露不同缺口。若坚持「每个插件一个 badge」，必须先拆仓，成本远高于先给三个 monorepo 过 passing。

---

## 2. 读法

- `✅ done`：仓库里已有可指认的证据（文件、命令、release、tag）。
- `✅ done*`：**staging tree 已有文件，但公网同步 / 首次 CI run 未确认**；不能直接当作 badge 的 public evidence。
- `⬜ todo`：还没有，或证据不足以在 badge 问卷里勾选。
- `➖ N/A`：官方条目允许 N/A，且本项目确实不适用；提交时**必须填 justification**，不能空着勾。
- `Cat`：官方类别 `MUST` / `SHOULD` / `SUGGESTED`。**Passing 要求全部 MUST 满足**；SHOULD/SUGGESTED 不阻断 passing，但会影响评审印象。
- 统计里的 `done` **不包含** `N/A`，但**包含** `done*`；`done*` 仍需公网 URL / CI run 才能算 public evidence。

### 2.1 当前计数（Passing criteria，共 67 项）

| 仓库 | MUST done | MUST todo | MUST N/A | SHOULD done/todo/N/A | SUGGESTED done/todo/N/A | 现在能过 passing？ |
|---|---:|---:|---:|---:|---:|---|
| dsh-next-suite | 28 | **8** | 7 | 8 / 1 / 1 | 6 / 7 / 1 | **否** |
| dsh-os-suite | 28 | **7** | 8 | 8 / 1 / 1 | 6 / 7 / 1 | **否** |
| dsh-hcb | 23 | **13** | 7 | 7 / 2 / 1 | 7 / 6 / 1 | **否** |

> `next-suite` 与 `os-suite` 的 MUST done 较多，是因为 `testatum-attest`（HMAC-SHA256）与 `dsh-os-trace`（SHA-256）真实使用了公开密码学原语，且 SECURITY/CONTRIBUTING 已落地；HCB 也用 SHA-256。但 `crypto_keylength`、lint、静态分析、secret scan 仍是 todo。**不要把「MUST 数量多」误读成「更接近 passing」**——三个仓仍分别差 8 / 7 / 13 项 MUST。

### 2.2 剩余 MUST todo（按仓库）

| 仓库 | 剩余 MUST todo | 说明 |
|---|---|---|
| dsh-next-suite | 8：`report_responses`、`warnings`、`warnings_fixed`、`know_secure_design`、`know_common_errors`、`crypto_keylength`、`no_leaked_credentials`、`static_analysis` | 除 `report_responses` 需时间外，其余 7 项可工程化；`crypto_keylength` 只影响 testatum |
| dsh-os-suite | 7：`report_responses`、`warnings`、`warnings_fixed`、`know_secure_design`、`know_common_errors`、`no_leaked_credentials`、`static_analysis` | crypto 项已判 done（dsh-os-trace 用 SHA-256）；无 testatum 的 keylength 负担 |
| dsh-hcb | 13：`interact`、`contribution`、`report_responses`、`vulnerability_report_process`、`vulnerability_report_private`、`vulnerability_report_response`、`test_policy`、`warnings`、`warnings_fixed`、`know_secure_design`、`know_common_errors`、`no_leaked_credentials`、`static_analysis` | 缺 SECURITY/CONTRIBUTING；CI 已有 |

**最小工程包（约 2–3 人日 + 等待期）**：

1. lint：加 ESLint，清零后在 CI 跑 `--max-warnings 0`（`warnings`、`warnings_fixed`）。
2. 静态分析：CodeQL 或 `eslint-plugin-security`，在 release 前跑（`static_analysis`）。
3. secret scan：`gitleaks`/`trufflehog`，CI 每次 push 跑（`no_leaked_credentials`）。
4. 维护者自评 + 一页威胁模型（`know_secure_design`、`know_common_errors`）。
5. HCB 补 `SECURITY.md` / `CONTRIBUTING.md`，并把 CI 的公网 run 链接写进本文件。
6. `report_responses` 需要真实 issue 历史：项目 2026-11-14 才发布，**最早 2027-01** 才有 2–12 个月窗口；不要编造历史。

> `done*` 的条目在公网 URL 与首次 CI run 确认前，不应向 badge 问卷声称 done。

---

## 3. 逐项自评

> 表头 `next-suite` / `os-suite` / `HCB` 分别对应 §1 的三个仓库。官方 criterion 文本为英文；表中「Evidence / action」是中文说明。`✅ done*` 见 §2 的时效性说明。

### Basics

| Criterion | Cat | next-suite | os-suite | HCB | Evidence / action |
|---|---|---|---|---|---|
| `description_good` | MUST | ✅ done | ✅ done | ✅ done | README 首段说明问题与用途 |
| `interact` | MUST | ✅ done* | ✅ done* | ⬜ todo | README 已有 Security/Contributing/Changelog 导航（next/os 为 staging）；HCB 仍缺反馈/贡献入口 |
| `contribution` | MUST | ✅ done* | ✅ done* | ⬜ todo | CONTRIBUTING.md 已落地（next/os staging）；HCB 无 |
| `contribution_requirements` | SHOULD | ✅ done* | ✅ done* | ⬜ todo | CONTRIBUTING 已写 Node 版本/测试/无构建/命名；HCB 无 |
| `floss_license` | MUST | ✅ done | ✅ done | ✅ done | Apache-2.0；HCB 为 MIT |
| `floss_license_osi` | SUGGESTED | ✅ done | ✅ done | ✅ done | OSI 认可许可 |
| `license_location` | MUST | ✅ done | ✅ done | ✅ done | 仓库根 LICENSE |
| `documentation_basics` | MUST | ✅ done | ✅ done | ✅ done | README + 每包 README/DESIGN；HCB 另有 docs/ |
| `documentation_interface` | MUST | ✅ done | ✅ done | ✅ done | CLI --help/退出码/JSON；HCB 有 JSON Schema 与 CLI 文档 |
| `sites_https` | MUST | ✅ done | ✅ done | ✅ done | GitHub、npm 均 HTTPS |
| `discussion` | MUST | ✅ done | ✅ done | ✅ done | GitHub Issues 公开可搜；HCB 另有 Announcements Discussion |
| `english` | SHOULD | ✅ done | ✅ done | ✅ done | 文档与 issue 均接受英文 |
| `maintained` | MUST | ✅ done | ✅ done | ✅ done | 2026-11-14 仍有提交与发布 |

### Change control

| Criterion | Cat | next-suite | os-suite | HCB | Evidence / action |
|---|---|---|---|---|---|
| `repo_public` | MUST | ✅ done | ✅ done | ✅ done | 公开 GitHub 仓 |
| `repo_track` | MUST | ✅ done | ✅ done | ✅ done | git 历史含作者与时间 |
| `repo_interim` | MUST | ✅ done | ✅ done | ✅ done | 有开发期提交，不是只 push 最终 release |
| `repo_distributed` | SUGGESTED | ✅ done | ✅ done | ✅ done | git |
| `version_unique` | MUST | ✅ done | ✅ done | ✅ done | 0.1.1 / HCB 0.5.1 |
| `version_semver` | SUGGESTED | ✅ done | ✅ done | ✅ done | SemVer（见 VERSIONING.md） |
| `version_tags` | SUGGESTED | ✅ done | ✅ done | ✅ done | v0.1.1；HCB v0.5.1 |
| `release_notes` | MUST | ✅ done | ✅ done | ✅ done | GitHub release v0.1.1 有摘要；HCB CHANGELOG 更完整（建议补每包 changelog） |
| `release_notes_vulns` | MUST | ➖ N/A | ➖ N/A | ➖ N/A | 无已知 CVE；每个 release 显式写「none known」 |

### Reporting

| Criterion | Cat | next-suite | os-suite | HCB | Evidence / action |
|---|---|---|---|---|---|
| `report_process` | MUST | ✅ done | ✅ done | ✅ done | GitHub Issues + package.json bugs |
| `report_tracker` | SHOULD | ✅ done | ✅ done | ✅ done | Issues 启用 |
| `report_responses` | MUST | ⬜ todo | ⬜ todo | ⬜ todo | 项目 <2 个月，尚无 2–12 个月窗口；开始记录首次响应时间 |
| `enhancement_responses` | SHOULD | ⬜ todo | ⬜ todo | ⬜ todo | 同上；建立 enhancement 标签与响应 SLA |
| `report_archive` | MUST | ✅ done | ✅ done | ✅ done | 公开 issue 历史可搜索 |
| `vulnerability_report_process` | MUST | ✅ done* | ✅ done* | ⬜ todo | SECURITY.md 已落地（next/os staging）；HCB 无 |
| `vulnerability_report_private` | MUST | ✅ done* | ✅ done* | ⬜ todo | SECURITY.md 指向 GitHub Security Advisories；HCB 无 |
| `vulnerability_report_response` | MUST | ➖ N/A | ➖ N/A | ⬜ todo | next/os：无报告历史，SECURITY.md 目标 7 天，按 N/A 记录；HCB 无渠道 |

### Quality

| Criterion | Cat | next-suite | os-suite | HCB | Evidence / action |
|---|---|---|---|---|---|
| `build` | MUST | ➖ N/A | ➖ N/A | ➖ N/A | 纯 ESM，无构建步骤；按 N/A 说明 |
| `build_common_tools` | SUGGESTED | ✅ done | ✅ done | ✅ done | Node + npm |
| `build_floss_tools` | SHOULD | ✅ done | ✅ done | ✅ done | 仅 FLOSS 工具 |
| `test` | MUST | ✅ done | ✅ done | ✅ done | 242/242、90/90；HCB npm test |
| `test_invocation` | SHOULD | ✅ done | ✅ done | ✅ done | npm test / node --test |
| `test_most` | SUGGESTED | ⬜ todo | ⬜ todo | ⬜ todo | 未测覆盖率；加 c8 并记录语句/分支覆盖 |
| `test_continuous_integration` | SUGGESTED | ⬜ todo | ⬜ todo | ✅ done | next/os workflow 已在 staging 落地，但尚未确认首次 GitHub run 绿；HCB 的 self-check.yml 已有运行记录 |
| `test_policy` | MUST | ✅ done* | ✅ done* | ⬜ todo | CONTRIBUTING 已写「Tests are required for behavior changes」；HCB 无 |
| `tests_are_added` | MUST | ✅ done | ✅ done | ✅ done | 最近功能均带测试（242/90/HCB audit-entry tests） |
| `tests_documented_added` | SUGGESTED | ⬜ todo | ⬜ todo | ⬜ todo | 在 PR 模板/CONTRIBUTING 写明 |
| `warnings` | MUST | ⬜ todo | ⬜ todo | ⬜ todo | 无 linter；加 ESLint（或等价） |
| `warnings_fixed` | MUST | ⬜ todo | ⬜ todo | ⬜ todo | 先启用再清零；CI 记录 |
| `warnings_strict` | SUGGESTED | ⬜ todo | ⬜ todo | ⬜ todo | `--max-warnings 0` |

### Security

| Criterion | Cat | next-suite | os-suite | HCB | Evidence / action |
|---|---|---|---|---|---|
| `know_secure_design` | MUST | ⬜ todo | ⬜ todo | ⬜ todo | 需维护者自评并在 badge 问卷回答；补一份威胁模型 |
| `know_common_errors` | MUST | ⬜ todo | ⬜ todo | ⬜ todo | 同上；在 SECURITY.md 写常见错误与缓解 |
| `crypto_published` | MUST | ✅ done | ✅ done | ✅ done | testatum 用 HMAC-SHA256；dsh-os-trace 与 HCB 用 SHA-256（均为公开算法） |
| `crypto_call` | SHOULD | ✅ done | ✅ done | ✅ done | 只调用 node:crypto（createHash/createHmac），不自实现 |
| `crypto_floss` | MUST | ✅ done | ✅ done | ✅ done | node:crypto 为 FLOSS |
| `crypto_keylength` | MUST | ⬜ todo | ➖ N/A | ➖ N/A | HMAC 密钥长度未强制；校验 ≥32 字节并在 README 写明 |
| `crypto_working` | MUST | ✅ done | ✅ done | ✅ done | SHA-256 / HMAC-SHA256；无 MD5/DES/RC4 |
| `crypto_weaknesses` | SHOULD | ✅ done | ✅ done | ✅ done | SHA-256 / HMAC-SHA256，无 SHA-1/CBC 等已知弱项 |
| `crypto_pfs` | SHOULD | ➖ N/A | ➖ N/A | ➖ N/A | 无密钥协商 |
| `crypto_password_storage` | MUST | ➖ N/A | ➖ N/A | ➖ N/A | 不存外部用户密码 |
| `crypto_random` | MUST | ➖ N/A | ➖ N/A | ➖ N/A | 不生成密钥/nonce |
| `delivery_mitm` | MUST | ✅ done | ✅ done | ✅ done | npm/GitHub 均 HTTPS |
| `delivery_unsigned` | MUST | ✅ done | ✅ done | ✅ done | npm/GitHub 走 HTTPS；无 HTTP 摘要 |
| `vulnerabilities_fixed_60_days` | MUST | ✅ done | ✅ done | ✅ done | 当前无已知中危及以上漏洞；持续跟踪 |
| `vulnerabilities_critical_fixed` | SHOULD | ✅ done | ✅ done | ✅ done | 当前无已知 critical；保持快速修复 |
| `no_leaked_credentials` | MUST | ⬜ todo | ⬜ todo | ⬜ todo | 应用前跑 gitleaks/trufflehog；CI 加 secret scan |

### Analysis

| Criterion | Cat | next-suite | os-suite | HCB | Evidence / action |
|---|---|---|---|---|---|
| `static_analysis` | MUST | ⬜ todo | ⬜ todo | ⬜ todo | 无静态分析；加 CodeQL 或 eslint-plugin-security |
| `static_analysis_common_vulnerabilities` | SUGGESTED | ⬜ todo | ⬜ todo | ⬜ todo | 启用安全规则集 |
| `static_analysis_fixed` | MUST | ➖ N/A | ➖ N/A | ➖ N/A | 尚无静态分析发现 |
| `static_analysis_often` | SUGGESTED | ⬜ todo | ⬜ todo | ⬜ todo | 每次 push/每日跑 |
| `dynamic_analysis` | SUGGESTED | ⬜ todo | ⬜ todo | ⬜ todo | 可对解析器加 property/fuzz 测试 |
| `dynamic_analysis_unsafe` | SUGGESTED | ➖ N/A | ➖ N/A | ➖ N/A | JavaScript，无内存不安全代码 |
| `dynamic_analysis_enable_assertions` | SUGGESTED | ✅ done | ✅ done | ✅ done | node:test 断言默认开启 |
| `dynamic_analysis_fixed` | MUST | ➖ N/A | ➖ N/A | ➖ N/A | 尚无动态分析发现 |

---

## 4. 当前工程状态与本轮仍缺项

> 本节按 2026-11-14 20:20 的 staging tree 核对。**不是**对公网 GitHub 的最终确认。

### 4.1 已在 staging tree 落地（`done*` 的依据）

| 文件 / 流程 | next-suite | os-suite | HCB | 备注 |
|---|---|---|---|---|
| `SECURITY.md` | 有 | 有 | 无 | 指向 GitHub Security Advisories；写明支持版本与 90 天披露窗口 |
| `CONTRIBUTING.md` | 有 | 有 | 无 | PR 流程、Node 版本、测试要求、无构建 |
| `CODE_OF_CONDUCT.md` | 有 | 有 | 无 | Contributor Covenant |
| CI workflow | `ci.yml` + `release.yml` | `ci.yml` + `release.yml` | `self-check.yml` + `collect.yml` | next/os 尚未确认首次 GitHub run |
| `CHANGELOG.md` | 有 | 有 | 有 | Keep a Changelog |
| Issue templates | 有 | 有 | 无 | bug / feature 表单；安全报告走 SECURITY.md |

**注意**：`done*` 只说明文件在 staging。公网 GitHub 未同步、CI 未跑绿之前，badge 问卷不能把它当作 public evidence；也不要在 README 放 badge 占位图。

### 4.2 本轮仍缺的工程项

1. **lint**：加 ESLint（`eslint:recommended`），清零后 CI 跑 `--max-warnings 0` → `warnings`、`warnings_fixed`。
2. **静态分析**：CodeQL（JS/TS）或 `eslint-plugin-security`，在 release 前跑 → `static_analysis`。
3. **secret scan**：`gitleaks` 或 `trufflehog`，每次 push 跑 → `no_leaked_credentials`。
4. **维护者自评 + 威胁模型**：明确资产、信任边界、误报风险、HMAC 占位边界 → `know_secure_design`、`know_common_errors`。
5. **首次响应记录**：`report_responses` 需要真实 issue 历史；项目太新，**最早 2027-01** 才有 2–12 个月窗口。
6. **HCB 文档**：补 `SECURITY.md` / `CONTRIBUTING.md`，并把 CI 的公网 run 链接写进本文件。
7. **next-suite 的 `crypto_keylength`**：`testatum-attest` 校验 HMAC key ≥32 字节，并在 README/SECURITY.md 写明。

### 4.3 CI 真正跑绿才算证据

`test_continuous_integration` 目前对 next/os 仍是 `⬜ todo`：workflow 文件存在 ≠ CI 已运行。第一次 push 后要：

- 打开 Actions 页面，确认 `CI` 在 Node 22.19 与 Node 24 两条矩阵都绿；
- 把 run URL 写进本文件；
- 再把该条从 `⬜ todo` 改为 `✅ done`。

### 4.4 版本与 release

- 三个仓都已有 tag：`v0.1.1` / `v0.1.1` / `v0.5.1`。
- 两个 suite 已有 `CHANGELOG.md` 与 `RELEASE.md`；HCB 有 `CHANGELOG.md`。
- `release_notes_vulns` 当前是 N/A；从下一个 release 起，如果没有已知漏洞，也显式写 `Known vulnerabilities fixed in this release: none`。

---

## 5. 申请步骤（人工执行）

> 需要 bestpractices.dev 账号（可用 GitHub 登录）。**本仓库不会代你注册、不会提交问卷、不会生成 badge。**

1. 先在三个仓完成 §4 的 MUST 项；跑一遍 `npm test`，把 CI URL 记下来。
2. 打开 <https://www.bestpractices.dev/> → **Get started** / **Add a project**。
3. 每次只填一个仓库 URL；project 名建议与仓库名一致：
   - `PerryLink/dsh-next-suite`
   - `PerryLink/dsh-os-suite`
   - `PerryLink/dsh-hcb`
4. 按 §3 的表逐项回答。`➖ N/A` 的项必须写 justification（例：`build`: "pure ESM, no build step; tests run directly with node --test"）。
5. `MUST todo` 没清零前**不要点最终提交**；可以先保存草稿。
6. 通过后记录：project ID、badge URL、通过日期。把 badge 放进对应 README 的顶部。
7. 在本文件顶部把状态从 `draft / planned` 改为：
   - `submitted`（已提交，等评审），或
   - `passing`（已通过，附 project URL 与日期）。
8. 每年或每次大版本前复评；badge 不是一劳永逸。

**时间预期**：工程动作 2–3 人日；issue 响应类 criteria 需要至少 2 个月公开历史，**最早 2027-01 之后再提交**。三个仓可以并行，但不要在同一天重复提交同一份问卷内容而不做仓库级核对。

---

## 6. 不伪造的边界

1. **没有 badge 就不放 badge。** README 里的 badge 图片必须是 bestpractices.dev 返回的真实 project ID；`<ID>` 占位符不得提交。
2. **不把 N/A 当 done。** 尤其 `build`、`crypto_*`、`release_notes_vulns`；提交时逐项写理由。
3. **不编造 issue 响应。** `report_responses` / `vulnerability_report_response` 需要真实历史；没有就等。
4. **不把「自评清单完成」说成「已通过」。** 本文件只是 draft；通过与否由 OpenSSF 的评审与 badge 页面决定。
5. **不在问卷里写未经验证的「无漏洞」。** 只写「截至某日未收到/未发现」，并给跟踪方式。

---

## 7. 参考

- OpenSSF Best Practices criteria：<https://www.bestpractices.dev/en/criteria>
- OpenSSF Best Practices 项目：<https://github.com/coreinfrastructure/best-practices-badge>
- 三个仓：
  - <https://github.com/PerryLink/dsh-next-suite>
  - <https://github.com/PerryLink/dsh-os-suite>
  - <https://github.com/PerryLink/dsh-hcb>
- 版本与发布节奏：见 [`../../VERSIONING.md`](../../VERSIONING.md)

> 再次声明：截至 2026-11-14，**没有任何一个仓获得 OpenSSF Best Practices badge**。本文中的 `done` 只表示「仓库里有可指认的证据」，不表示「badge 已授予」。
