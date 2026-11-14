# VERSIONING — dsh-next-suite / dsh-os-suite 的 14 包版本与发布策略

> **状态：draft / planned。** 这是 0.1.x 线的版本策略，不是已签署的 SLA。
> 当前事实：14 个包**全部为 `0.1.1`**，2026-11-14 发布；两个 monorepo 各有一个 `v0.1.1` tag。
> 版本号的唯一事实源是各包 `package.json` 的 `version` 字段；本文件只规定**如何改**它。

---

## 1. 范围：14 个包，两个仓

| # | 包 | 仓 | 类型 | 当前版本 | Node engines | DSH engines |
|---|---|---|---|---|---|---|
| 1 | `dsh-capdiff` | dsh-next-suite | CLI | `0.1.1` | `^22.19.0 \|\| >=24.9.0` | — |
| 2 | `testatum-attest` | dsh-next-suite | CLI | `0.1.1` | 同上 | — |
| 3 | `dsh-supply-watch` | dsh-next-suite | CLI | `0.1.1` | 同上 | — |
| 4 | `cordis-hmr-doctor` | dsh-next-suite | CLI | `0.1.1` | 同上 | — |
| 5 | `cordis-migrate` | dsh-next-suite | CLI | `0.1.1` | 同上 | — |
| 6 | `cordis-testkit` | dsh-next-suite | library | `0.1.1` | 同上 | — |
| 7 | `dsh-xbrl` | dsh-next-suite | CLI | `0.1.1` | 同上 | — |
| 8 | `dsh-upgrade-atlas` | dsh-next-suite | CLI/data | `0.1.1` | 同上 | — |
| 9 | `dsh-os-trace` | dsh-os-suite | plugin | `0.1.1` | 同上 | `>=0.2.2-rc.3 <0.3.0` |
| 10 | `dsh-os-lease` | dsh-os-suite | plugin | `0.1.1` | 同上 | 同上 |
| 11 | `dsh-os-quota` | dsh-os-suite | plugin | `0.1.1` | 同上 | 同上 |
| 12 | `dsh-os-eval` | dsh-os-suite | plugin | `0.1.1` | 同上 | 同上 |
| 13 | `dsh-os-catalog` | dsh-os-suite | plugin | `0.1.1` | 同上 | 同上 |
| 14 | `dsh-os-registry` | dsh-os-suite | plugin | `0.1.1` | 同上 | 同上 |

- 两个仓：<https://github.com/PerryLink/dsh-next-suite>、<https://github.com/PerryLink/dsh-os-suite>。
- `next-suite` 的 8 个包是 CLI/库，不声明 `engines.dsh`；`os-suite` 的 6 个包是 DSH 插件，声明 `engines.dsh`。
- 许可：全部 Apache-2.0；不是 DeepSeek 官方项目。

---

## 2. 0.1.x 的语义

采用 Semantic Versioning 2.0.0 的 `0.y.z` 规则：**主版本为 0 时，公开 API 不被视为稳定**。但为了让 14 个包可一起发布，本项目对 `0.1.x` 加一层更严格的自我约束。

### 2.1 Patch（`0.1.2`、`0.1.3` …）：只做兼容修复

允许：

- 修 bug、修安全漏洞、修文档错误；
- 提升性能但不改变输出语义；
- 修正明显的误报/漏报，并在 CHANGELOG 写明「结果可能变化」；
- 增加**可选**的内部字段（不进入公开 JSON envelope 的必需部分）。

不允许：

- 删除或重命名 CLI 命令、flag、退出码；
- 改变 `--json` 成功 envelope 的 `{ "command", "ok" }` 必需字段，或把 `items` / `entries` 改名；
- 删除 `src/core.js` 的公开导出；
- 让已有 manifest 从「可解析」变成「不可解析」（除非该 manifest 本来就不符合文档）；
- 把默认行为从 dry-run 改为写入（`cordis-migrate` 尤其）。

### 2.2 Minor（`0.2.0`）：唯一允许破坏性变更的窗口

`0.y.z` 规则允许 minor 破坏兼容，但本项目要求：

- 破坏性变更**只能**进 `0.2.0` 及以后的 minor，不进 patch；
- 必须先在 `0.1.x` 的一个 patch 里**弃用**（见 §3），并给出迁移示例；
- 必须在两个仓的 release notes 与 CHANGELOG 里列出「Breaking changes」；
- 必须保留旧行为至少一个 minor 周期，或在旧行为无法保留时提供自动迁移命令/脚本；
- 变更 capability ID、JSON schema 必需字段、SARIF rule ID 的，视为破坏性变更。

允许的 minor 变更：

- 新增 capability ID、SARIF rule、CLI flag（旧 flag 保留）；
- 新增可选 manifest 字段；
- 新增包或拆分包（旧包保留 deprecated shim）；
- 改变检测启发式导致 findings 数量变化，且已在 changelog 说明。

### 2.3 公开 API 的边界

以下视为公开 API，受本节约束：

1. **CLI**：命令名、flag、退出码（`0` 成功 / `1` 业务否定或保留 / `2` 用法与 IO 错误）。
2. **JSON**：成功 envelope 至少 `{command, ok}`；数组字段用 `items` / `entries`；错误 envelope 的 `ok:false` 与错误码。
3. **SARIF**：`runs[0].tool.driver.rules` 的 rule ID（`dsh-capdiff/undeclared`、`dsh-capdiff/unused`）。
4. **库导出**：`src/core.js` 的命名导出；`package.json` 的 `exports` 映射。
5. **数据格式**：`dsh-upgrade-atlas` 的数据文件、`dsh-os-*` 的工具参数/输出 schema。
6. **包元数据**：`bin` 名、`dsh.bundle.patch`、`engines.dsh` 范围。

以下**不是**公开 API，可随 patch 变化：内部函数、日志措辞、人类可读输出的排版、测试 fixture、未文档化的 flag。

### 2.4 行为兼容 vs 输出兼容

- **输出兼容**：字段名、类型、退出码不变。
- **行为兼容**：同样的输入得到同样的语义结论。
- 修一个误报会改变 findings，属于**行为变化**；如果它只影响错误结论，可作为 patch，但必须在 CHANGELOG 写「findings may change」。
- 新增一类检测（例如开始扫描全局 `fetch`）会改变 findings 的范围，属于 **minor**，不是 patch。

---

## 3. 弃用政策

### 3.1 弃用不是删除

弃用 = 仍然可用，但明确告知将来会移除。删除 = 破坏性变更，只能进 `0.2.0`。

### 3.2 最短窗口

| 对象 | 弃用方式 | 最早移除 |
|---|---|---|
| CLI flag / 命令 | README + `--help` 标 `[deprecated]`；运行时 stderr 警告（不改变退出码） | 下一个 minor，且不早于弃用后 **90 天** |
| 库导出 | JSDoc `@deprecated` + README + CHANGELOG | 下一个 minor，且不早于 **90 天** |
| JSON 字段 | 保留字段并标 `deprecated`；新增替代字段 | 下一个 minor |
| 包整体 | npm `deprecate` 消息 + README 顶部说明 + 迁移指南 | 至少 **6 个月**；不 `unpublish` |
| 数据格式 | 提供迁移脚本；旧格式至少读一个 minor | 下一个 minor |

**安全例外**：如果保留旧行为会造成实际安全风险，可以缩短窗口，但必须：

1. 在 SECURITY.md / release notes 说明原因；
2. 给出替代方案；
3. 在移除前至少发一个 patch 警告（紧急 0-day 除外，需在 release notes 说明）。

### 3.3 弃用公告模板

```markdown
## Deprecated

- `--old-flag` (since 0.1.2): use `--new-flag`. `--old-flag` will be removed in 0.2.0.
  Migration: replace `--old-flag value` with `--new-flag value`.
```

### 3.4 npm deprecate

只对**整个包**使用 `npm deprecate`，不要用它表达单个 flag 弃用。示例：

```sh
npm deprecate dsh-old-name@'<0.2.0' "Renamed to dsh-new-name; migrate before 2027-06."
```

不要 `npm unpublish`。已发布版本是别人的锁文件依赖；撤回会造成不可复现的构建。

---

## 4. 14 包发布节奏

> 具体操作以两个仓的 `RELEASE.md` 为准：[dsh-next-suite RELEASE.md](RELEASE.md)、[dsh-os-suite RELEASE.md](../dsh-os-suite/RELEASE.md)。本文件只定**政策**，不替代发布 runbook。

### 4.1 默认：锁步发布（lockstep）

14 个包共享同一条版本线。一次 release train：

- 两个仓打**同一个版本号**的 tag（`v0.1.2` / `v0.1.2`）；
- 14 个包**全部**发布同一版本（即使某个包没有代码变化，也发布一个只含 changelog/依赖同步的 patch）；
- 这样用户看到 `0.1.2` 就知道 14 个包的组合被一起测过。

**例外（hotfix）**：只有一个包需要紧急修复时，可以只发布该包（`0.1.2`），其余保持 `0.1.1`，但必须：

1. 在 release notes 标注「partial train」；
2. 在下一个完整 train 把其余包补齐；
3. 不在文档里声称「14 包都是 0.1.2」。

### 4.2 节奏

| 类型 | 目标节奏 | 触发 | 版本 |
|---|---|---|---|
| Patch train | 每 2 周一个窗口（有变更才发） | bug/文档/小修复积累 | `0.1.(x+1)`，例如 `0.1.2` |
| Minor train | 每季度 | 新功能、弃用、行为变化 | `0.2.0` |
| Security release | 确诊后 **≤7 天** | 中危及以上、可修复 | patch；必要时 out-of-band |
| 文档/数据更新 | 随 patch train | 不改变代码行为 | patch |
| 预发布 | 需要时 | 大变更试跑 | `0.2.0-rc.1`，npm dist-tag `next` |

> 这是**目标**，不是承诺；没有 SLA。实际日期以两个仓的 release issue / GitHub Releases 为准。

### 4.3 一次 release train 的检查表

- [ ] 14 个包 `package.json` 版本一致（hotfix 例外需记录）。
- [ ] `npm test` 全绿；Node `22.19.0` 与 `24.x` 都跑过。
- [ ] `node --check` 覆盖所有 `src/*.js`（或等价的语法检查）。
- [ ] `npm pack --dry-run` 检查每个包的 `files`，确认没有把测试/临时文件打进 tarball。
- [ ] 两个仓的 CHANGELOG / release notes 写好：新增、修复、弃用、破坏性变更、已知漏洞修复。
- [ ] 两个仓按各自 `RELEASE.md` 打 annotated tag；**tag push 触发 `release.yml`**，不在本地手工 `npm publish`。
- [ ] 确认 `release.yml` 使用 `npm publish --workspaces --access public --provenance`；0.1.1 发布时未验证 provenance，下一次发布后用 `npm view <pkg>@<version> dist.attestations` 复核，再对外声称。
- [ ] `npm view <pkg> version` 与 `dist-tags.latest` 校验 14/14（或按 partial train 记录例外）。
- [ ] 在隔离 `DSH_HOME` 里做一次安装 smoke（至少 `os-suite` 6 个插件）。
- [ ] 若数据/兼容矩阵有变化，刷新 HCB 快照并记录 delta。
- [ ] 更新 `CREDENTIALS.md` / 本文件的版本引用；**不把 planned 写成 published**。

### 4.4 npm dist-tags

| tag | 用途 |
|---|---|
| `latest` | 稳定版（`0.1.x`） |
| `next` | 预发布（`0.2.0-rc.*`） |
| 其他 | 不使用；不要用 `beta` / `canary` 制造歧义 |

预发布版本**不要**打 `latest`；发布后用 `npm dist-tag ls <pkg>` 复核。

### 4.5 版本支持

- 只支持**最新**的 `0.1.x`；不为旧 patch 提供长期分支（pre-1.0 无 LTS）。
- 安全修复只保证最新版本；旧版本最多在 release notes 里提示升级。
- `os-suite` 的 `engines.dsh` 是 host 兼容声明，不是测试保证；升级 host 前先看 HCB 的 `declared-compatible` 与证据级别。

---

## 5. `0.0.0-stage` 是什么

### 5.1 现象

npm 在**首次发布**或 **staged publish** 的处理期间，registry 里可能短暂出现一个 `0.0.0-stage` 版本（本项目审计记录写作 `npm staged processing`；具体机制以 npm 文档为准）。它不是一个真实的 release，也不是 SemVer 意义上的预发布。

本项目在 2026-11 的发布审计中实际观察到过：`dsh-hcb@0.4.0` 已是 `latest`，registry 里同时有一个 `0.0.0-stage` 占位（见 `04-build/dsh-os-suite/AUDIT.md` 的记录）。审计记录显示它没有影响 `latest`；本项目没有对消失时间做精确测量，因此不写「N 分钟后消失」这类无法复算的数字。

### 5.2 规则

1. **不要安装** `pkg@0.0.0-stage`；它没有内容保证。
2. **不要引用**它到 README、release notes、论文或简历；它不是版本。
3. **不要**给它打 git tag 或 GitHub release。
4. **不要**用 `0.0.0-stage` 作为预发布通道；预发布用 `0.2.0-rc.1` + `next` dist-tag。
5. **不要**因为它出现就重复 `npm publish`；重复发布可能造成版本冲突或 2FA 卡住。
6. 若它持续 **>24 小时**仍可见：
   - 用 `npm view <pkg> dist-tags versions --json` 确认 `latest` 是否已指向正确版本；
   - 检查 npm status / 2FA 会话；
   - 联系 npm support，附包名、时间、`latest` 与 `0.0.0-stage` 的截图；
   - **不要**盲目 `npm unpublish`。

### 5.3 为什么它不该出现在文档里

`0.0.0-stage` 是 registry 的内部占位，不是项目发布的版本。把它写进「版本历史」会让读者以为项目发过 `0.0.0`，也会让锁文件/审计工具误判。**版本历史只记录 `latest` 指向的真实版本。**

---

## 6. 1.0 的门槛（不承诺日期）

进入 `1.0.0` 前至少满足：

- 公开 API 连续两个 minor 无破坏性变更；
- 14 个包的 CLI/JSON/SARIF 契约有测试覆盖；
- SECURITY.md、CONTRIBUTING.md、CI 已在公网可访问；lint、静态分析、secret scan 落地；
- 14 个包的 changelog 可追溯；
- 至少一个外部用户/项目依赖（不是自己）；
- 对 0.x 的弃用项全部完成迁移或明确保留。

未满足前，不把 `1.0` 当营销节点；`0.1.x` 也可以长期维护。

---

## 7. 相关文件

- OpenSSF 自评：[`docs/credentials/openssf.md`](docs/credentials/openssf.md)
- HCB DOI 草稿：[`docs/credentials/hcb-doi.md`](docs/credentials/hcb-doi.md)
- FSE'27 摘要草稿：[`docs/credentials/fse27.md`](docs/credentials/fse27.md)
- IETF 个人草案：[`docs/standard/agent-plugin-capabilities-00.md`](docs/standard/agent-plugin-capabilities-00.md)
- 发布审计：[`AUDIT.md`](AUDIT.md)
- 契约修复：[`CONTRACT-FIX.md`](CONTRACT-FIX.md)

> 本文件是策略草稿。当前真实版本是 **14 × `0.1.1`**；没有 `0.1.2`、没有 `0.2.0`、没有 `1.0.0`。任何「已发布新版本」的说法必须以 `npm view` 与 git tag 为准。
