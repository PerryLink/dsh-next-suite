# DSH 生态 Atlas（种子版 v0）

> 2026-11-14｜实体级档案的起点，不是全量目录｜每条都可被引用/更新
> 目的：给媒体、研究者、企业选型一个「可核验的实体表」，而不是又一份插件榜单。
> 口径：只收公开可访问的实体；日期为首次记录；不收录未公开/私有项目。

---

## 0. 字段

| 字段 | 含义 |
|---|---|
| `id` | 稳定标识（repo/包名/组织名） |
| `type` | official / runtime / framework / plugin / distribution / community / standard |
| `url` | 主入口 |
| `role` | 一句话角色 |
| `first_seen` | 首次记录日期 |
| `notes` | 可核验补充（版本/许可/关系） |

---

## 1. 种子实体（12 条）

| id | type | url | role | first_seen | notes |
|---|---|---|---|---|---|
| `deepseek-ai/deepseek-harness` | official | https://github.com/deepseek-ai/deepseek-harness | DSH 官方 Agent Harness 主仓 | 2026-08-13 | MIT；v0.1 2026-08-13；桌面端 2026-09-29 |
| `cordiverse/cordis` | framework | https://github.com/cordiverse/cordis | DSH 的微内核/可逆插件框架 | 2026-09 | MIT；DSH topics 含 `cordis` |
| `koishijs/koishi` | framework | https://github.com/koishijs/koishi | Cordis 的起源生态（QQ 机器人框架） | 2026-09 | 与 Cordis 同作者生态 |
| `PerryLink/dsh-os-suite` | distribution | https://github.com/PerryLink/dsh-os-suite | 治理层六件套（trace/lease/quota/eval/catalog/registry） | 2026-11-14 | Apache-2.0；npm 0.1.1；非官方 |
| `PerryLink/dsh-locator` | plugin | https://github.com/PerryLink/dsh-locator | 全盘文件索引/搜索插件 | 2026-11-09 | 0.1.x；跨平台 Go 引擎；非官方 |
| `hikariming/dsh-ee` | distribution | https://github.com/hikariming/dsh-ee | DSH 自托管企业平台 | 2026-10-30 | Apache-2.0；非官方 |
| `dsh-market/dsh-market` | community | https://github.com/dsh-market/dsh-market | 社区插件市场/目录 | 2026-08 | 第三方；非官方 |
| `awesome-dsh-plugin/awesome-dsh-plugin` | community | https://github.com/awesome-dsh-plugin/awesome-dsh-plugin | 社区插件清单 | 2026-08 | 第三方；收录型 |
| `bowenliang123/dsh-context` | plugin | https://www.npmjs.com/package/dsh-context | 上下文洞察插件 | 2026-11 | 官方文章案例；非官方 |
| `aaif.io` | standard | https://aaif.io | Agentic AI Foundation（MCP/Agent Skills 等） | 2026-11 | Linux Foundation 下；标准治理 |
| `claude-code` | adjacent | https://claude.com/claude-code | Anthropic 的第一方 Agent Harness | 2026-11 | 对照系；非 DSH |
| `codex` | adjacent | https://openai.com/codex | OpenAI 的第一方 Agent Harness | 2026-11 | 对照系；非 DSH |

> 说明：`first_seen` 是本研究首次记录的日期，不是项目创建日期；创建日期以各自 repo/公告为准。

---

## 2. 怎么用

- **媒体/研究**：引用实体时带 `id + url + first_seen`，避免「某插件」这种不可核验表述。
- **企业选型**：先看 `type` 和 `notes` 的许可/官方关系，再看功能。
- **贡献**：新增实体必须给公开 URL、type、role、日期；不接受未公开项目。

---

## 3. 后续（未完成）

- 扩到 300 实体（插件/作者/事件/时间线）；
- 加 `events` 表（发布/事故/融资/标准）；
- 与 `dsh-upgrade-atlas` 的版本断点表互链；
- 生成 CSV/JSON + DOI（见 `CREDENTIALS.md`）。

> 这是 v0 种子，不是全量；不要把「收录」当「背书」。
