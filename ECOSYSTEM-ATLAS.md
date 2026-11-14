# DSH 生态 Atlas（v1 · 64 实体）

> 2026-11-14｜实体级档案，不是插件全量目录｜每条都可被引用/更新
> 目的：给媒体、研究者、企业选型一个「可核验的实体表」，而不是又一份插件榜单。
> 口径：只收公开可访问的实体；`first_seen` 是本研究首次记录日，不是项目创建日；不收录未公开/私有项目。

---

## 0. 本次变化（种子 v0 → v1）

- **12 → 64 个实体**，原 12 条种子全部保留。
- 新增官方、框架、标准/治理、社区基础设施、发行版、运行时、代表插件、竞品八类覆盖。
- 种子中仅记到月份的日期统一记为当月 01 日（`2026-08-01` / `2026-09-01` / `2026-11-01`），**不是项目发布日期**；能取到确切日期的保留原日期。
- 不记录 star 数（会漂移且难归因）；`notes` 只写许可、关系、形态与可核验事实。
- **0 条 `unverified`**：每条都有公开 URL；站点侧限流/超时的条目已在 `notes` 明示，不属于实体不确定。

---

## 1. 字段

| 字段 | 含义 |
|---|---|
| `id` | 稳定标识（repo / 包名 / 域名） |
| `type` | official / runtime / framework / standard / community / distribution / plugin / adjacent |
| `url` | 主入口（一律 https） |
| `role` | 一句话角色 |
| `first_seen` | 本研究首次记录日期（YYYY-MM-DD） |
| `notes` | 可核验补充（许可 / 官方关系 / 形态 / 站点限制） |

`type` 口径：

- **official**：DSH 与 DeepSeek 官方仓库、API/模型/平台入口。
- **runtime**：可运行 DSH 的运行时发行（不等于官方主仓）。
- **framework**：DSH 依赖或同源的框架生态（Cordis / Koishi）。
- **standard**：跨生态标准与治理，以及 DSH 社区标准。
- **community**：市场、目录、清单、雷达、注册表等社区基础设施。
- **distribution**：把多个插件/能力打包发行的套件、企业版或客户端。
- **plugin**：有代表性的单个插件或 skill（按能力抽样，不是排行榜）。
- **adjacent**：非 DSH 的竞品/对照系，用于选型比较。

> `notes` 含 `"unverified"` 表示该条未经充分核验；本版没有此类条目。

---

## 2. 统计（type 分布）

**实体数：64**（校验下限 50）。

| type | 数量 | 占比 | 覆盖 |
|---|---:|---:|---|
| official | 6 | 9.4% | 官方：DSH 主仓、DeepSeek API/模型/平台 |
| runtime | 1 | 1.6% | 运行时：DSH runtime 发行 |
| framework | 3 | 4.7% | 框架：Cordis / Koishi |
| standard | 7 | 10.9% | 标准 / 治理：AAIF、Agent Plugins、MCP、AGENTS.md、A2A、Agent Skills、DSH 社区标准 |
| community | 12 | 18.8% | 社区基础设施：市场、目录、清单、雷达、注册表 |
| distribution | 5 | 7.8% | 发行版：治理套件、企业版、桌面端、Web 全家桶 |
| plugin | 20 | 31.3% | 代表插件：context / memory / research / search / UI / vision / IM / multi-agent / office / mobile / security |
| adjacent | 10 | 15.6% | 竞品 / 对照系：Claude Code、Codex、Cursor、Manus 等 |
| **合计** | **64** | **100%** | 占比四舍五入，合计可能略有出入 |

宿主分布：GitHub 仓库 40、npm 包页 3、其他公开站点 21。

**核验记录（2026-11-14）**：

- 40 个 GitHub URL 全部经 GitHub REST API 返回 200，且 `private=false`。
- 3 个 npm 包页经 `registry.npmjs.org` 返回 200（`dsh-context`、`dsh-capdiff`、`testatum-attest`）。
- 21 个其他 URL 中 19 个直连 2xx；`platform.deepseek.com` 返回 429（限流）、`huggingface.co/deepseek-ai` 在本网络超时（官方 V4 公告链接到该组织）。两条均已在 `notes` 注明。
- 无重复 `id`、无重复 URL；`scripts/validate-atlas.mjs --check-md` 通过。

---

## 3. 实体表

### 3.1 official（6）

| id | type | url | role | first_seen | notes |
|---|---|---|---|---|---|
| `deepseek-ai/deepseek-harness` | official | https://github.com/deepseek-ai/deepseek-harness | DSH 官方 Agent Harness 主仓 | 2026-08-13 | MIT；官方；v0.1 2026-08-13；Everything is a Plugin |
| `api-docs.deepseek.com` | official | https://api-docs.deepseek.com/ | DeepSeek API 官方文档（V4 系列/接口） | 2026-11-14 | 官方；V4-Pro/V4-Flash；1M 上下文；接口文档入口 |
| `deepseek-v4-pro-ga` | official | https://api-docs.deepseek.com/news/news260813/ | DeepSeek-V4-Pro 正式版公告 | 2026-11-14 | 官方；2026-08-13 GA；原生 OpenAI Responses API；模型名不变 |
| `platform.deepseek.com` | official | https://platform.deepseek.com/ | DeepSeek API 控制台（密钥/用量/充值） | 2026-11-14 | 官方；公开入口；本网络 GET 返回 429，属限流非下线 |
| `huggingface.co/deepseek-ai` | official | https://huggingface.co/deepseek-ai | DeepSeek 开放权重模型组织页 | 2026-11-14 | 官方；V4 系列开放权重（deepseek-v4 collection）；本网络直连超时 |
| `deepseek-ai/DeepSeek-V3.2-Exp` | official | https://github.com/deepseek-ai/DeepSeek-V3.2-Exp | DeepSeek-V3.2-Exp 开放模型仓 | 2026-11-14 | MIT；2025-09-29 发布；V4 前代稀疏注意力实验版 |

### 3.2 framework（3）

| id | type | url | role | first_seen | notes |
|---|---|---|---|---|---|
| `cordiverse/cordis` | framework | https://github.com/cordiverse/cordis | DSH 的微内核/可逆插件框架 | 2026-09-01 | MIT；DSH 依赖 Cordis 4.x；DSH topics 含 cordis |
| `koishijs/koishi` | framework | https://github.com/koishijs/koishi | Cordis 起源生态（跨平台聊天机器人框架） | 2026-09-01 | MIT；与 Cordis 同作者生态；非 DSH 本体 |
| `cordis.moe` | framework | https://cordis.moe/ | Cordis 文档站 | 2026-11-14 | 框架文档/指南入口；与 GitHub 仓互链 |

### 3.3 standard（7）

| id | type | url | role | first_seen | notes |
|---|---|---|---|---|---|
| `aaif.io` | standard | https://aaif.io/ | Agentic AI Foundation：agent 标准中立治理 | 2026-11-01 | Linux Foundation 下；托管 MCP/A2A/AGENTS.md/Agent Skills 等；2025-12 成立 |
| `agent-plugins.org` | standard | https://agent-plugins.org/ | Agent Plugins 开放打包标准（Skills + MCP） | 2026-11-14 | Spec 1.0.0 已发布、1.1.0 草案；独立治理，非 AAIF 项目 |
| `modelcontextprotocol.io` | standard | https://modelcontextprotocol.io/ | Model Context Protocol 规范/文档 | 2026-11-14 | AAIF 托管；文档版本 2026-07-28；DSH 可接 MCP |
| `agents.md` | standard | https://agents.md/ | AGENTS.md 开放指令格式 | 2026-11-14 | AAIF 托管；DSH/Codex 等读取的仓库级指令文件 |
| `a2a-protocol.org` | standard | https://a2a-protocol.org/ | Agent2Agent 跨 agent 通信协议 | 2026-11-14 | AAIF 托管；规范仓 Apache-2.0 |
| `agentskills.io` | standard | https://agentskills.io/ | Agent Skills 开放规范 | 2026-11-14 | Anthropic 捐赠 AAIF；SKILL.md 目录格式 |
| `PerryLink/dsh-standards` | standard | https://github.com/PerryLink/dsh-standards | DSH 插件 ENTRY/FLOW 一致性标准与检查器 | 2026-11-14 | 社区标准；非官方；含条款、检查器与证据规范 |

### 3.4 community（12）

| id | type | url | role | first_seen | notes |
|---|---|---|---|---|---|
| `dshmarket.com` | community | https://dshmarket.com/ | 装在 DSH 设置页内的插件市场 | 2026-08-01 | 第三方；浏览/搜索/一键安装；源码 dsh-market/dsh-market (MIT) |
| `dshfind.com` | community | https://dshfind.com/ | DSH 学习站 + 插件目录与评级 API | 2026-11-14 | 第三方；公开 REST/GraphQL 目录；源码 hikariming/dshfind |
| `dshbase.com` | community | https://dshbase.com/ | DSH 安装教程 + 插件目录站 | 2026-11-14 | 第三方；面向安装/选型的目录站 |
| `dshmarketplace.dev` | community | https://dshmarketplace.dev/ | DSH 插件目录 + Python/CLI 客户端 | 2026-11-14 | 第三方；目录站；配套 PyPI dshmarketplace |
| `awesome-dsh-plugin/awesome-dsh-plugin` | community | https://github.com/awesome-dsh-plugin/awesome-dsh-plugin | 社区插件清单（canonical awesome） | 2026-08-01 | CC0-1.0；第三方；收录型 |
| `Dominic789654/awesome-deepseek-harness` | community | https://github.com/Dominic789654/awesome-deepseek-harness | 插件/skill/MCP/profile 清单 | 2026-11-14 | 第三方；收录型；覆盖 orchestrator/UI 等形态 |
| `imsai-sh/awesome-deepseek-harness-plugins` | community | https://github.com/imsai-sh/awesome-deepseek-harness-plugins | DSH 插件商店/目录 | 2026-11-14 | MIT；第三方；收录 + 检索 |
| `libukai/awesome-deepseek-harness` | community | https://github.com/libukai/awesome-deepseek-harness | DSH 入门/资源/插件指南 | 2026-11-14 | 第三方；中文指南型 |
| `beancookie/awesome-dsh-plugin` | community | https://github.com/beancookie/awesome-dsh-plugin | 社区插件清单 | 2026-11-14 | CC0-1.0；第三方；收录型 |
| `AdamPlatin123/dsh-plugin-radar` | community | https://github.com/AdamPlatin123/dsh-plugin-radar | 插件可用性/风险雷达（公开 JSON） | 2026-11-14 | MIT；第三方；提供 latest.json/plugins-all.json |
| `realguan/dsh-plugin-market` | community | https://github.com/realguan/dsh-plugin-market | 由 awesome 清单生成的插件索引 | 2026-11-14 | MIT；第三方；jsDelivr 分发；桌面端 Community Market 源之一 |
| `vlln/plugin-registry` | community | https://github.com/vlln/plugin-registry | 早期 DSH 插件注册/控制台 + 开发 skill | 2026-11-14 | MIT；原 dsh-external/plugin-registry；console 2026-10-03 归档，skill 迁 vlln/dsh-skills |

### 3.5 distribution（5）

| id | type | url | role | first_seen | notes |
|---|---|---|---|---|---|
| `PerryLink/dsh-os-suite` | distribution | https://github.com/PerryLink/dsh-os-suite | 治理层六件套（trace/lease/quota/eval/catalog/registry） | 2026-11-14 | Apache-2.0；六件套均发布 0.1.1；非官方 |
| `PerryLink/dsh-next-suite` | distribution | https://github.com/PerryLink/dsh-next-suite | 能力差异/证明/供应链/迁移等八件套 | 2026-11-14 | Apache-2.0；8 个包均发布 0.1.1；非官方；本 atlas 所在仓 |
| `hikariming/dsh-ee` | distribution | https://github.com/hikariming/dsh-ee | DSH 自托管企业平台 | 2026-10-30 | Apache-2.0；非官方；连接企业系统与知识库 |
| `anywhere-labs/dsh-desktop` | distribution | https://github.com/anywhere-labs/dsh-desktop | DSH 开源桌面客户端 | 2026-11-14 | MIT；桌面端；Community Market 宿主；独立组织维护，非 DSH 主仓 |
| `zhu1090093659/dsh-web` | distribution | https://github.com/zhu1090093659/dsh-web | DSH Web GUI 插件/主题全家桶 | 2026-11-14 | Apache-2.0；profile 挂载；非官方 |

### 3.6 runtime（1）

| id | type | url | role | first_seen | notes |
|---|---|---|---|---|---|
| `hust-open-atom-club/oh-dsh` | runtime | https://github.com/hust-open-atom-club/oh-dsh | 社区 DSH runtime（Desktop/Web/TUI） | 2026-11-14 | MIT；社区维护；非官方 |

### 3.7 plugin（20）

> 抽样口径：context / memory / research / search / UI / vision / IM / multi-agent / office / media / mobile / discovery / DX / file-search / supply-chain-security / observability 各取代表，不追求穷举，也不构成背书。

| id | type | url | role | first_seen | notes |
|---|---|---|---|---|---|
| `bowenliang123/dsh-context` | plugin | https://www.npmjs.com/package/dsh-context | 上下文洞察/管理面板 | 2026-11-01 | Apache-2.0；npm 0.84.x；dshfind featured；非官方 |
| `omdsh-dev/dsh-mnemon` | plugin | https://github.com/omdsh-dev/dsh-mnemon | 可组合、视图式上下文与分层记忆 | 2026-11-14 | MIT；dshfind featured；context/memory |
| `1692775560/dsh-Mimir-Academic-research` | plugin | https://github.com/1692775560/dsh-Mimir-Academic-research | 科研工作台（LaTeX/arXiv/实验/GPU） | 2026-11-14 | MIT；非官方 |
| `Clearailhc/clearai-dsh` | plugin | https://github.com/Clearailhc/clearai-dsh | 证据核验的研究本体 agent preset | 2026-11-14 | Apache-2.0；以插件安装、作为 preset 使用；DSH 0.2.2 兼容；非官方 |
| `liustack/modsearch` | plugin | https://github.com/liustack/modsearch | 免费 Web 搜索插件 | 2026-11-14 | MIT；dshfind featured；非官方 |
| `omdsh-dev/DSH-better-sidebar` | plugin | https://github.com/omdsh-dev/DSH-better-sidebar | 可扩展侧边栏（文件/终端/Git/子代理） | 2026-11-14 | MIT；dshfind featured |
| `hagen666/dsh-topic-graph` | plugin | https://github.com/hagen666/dsh-topic-graph | 会话话题/阶段图谱 | 2026-11-14 | Web UI 插件；中英双语；非官方 |
| `ccch1mneyyy/dsh-TUI` | plugin | https://github.com/ccch1mneyyy/dsh-TUI | TUI 终端客户端插件 | 2026-11-14 | MIT；dshfind featured；非官方 |
| `liustack/modlens` | plugin | https://github.com/liustack/modlens | 给纯文本模型加视觉能力 | 2026-11-14 | MIT；dshfind featured |
| `xmanrui/dsh-im` | plugin | https://github.com/xmanrui/dsh-im | 接入微信/飞书/Slack 等 IM 通道 | 2026-11-14 | MIT；dshfind featured |
| `NanmiCoder/dsh-agent-teams` | plugin | https://github.com/NanmiCoder/dsh-agent-teams | 多 Agent 团队协作 | 2026-11-14 | MIT；dshfind featured |
| `dream-num/dsh-univer-office` | plugin | https://github.com/dream-num/dsh-univer-office | 对话内 Office 环境（表格/文档/幻灯片） | 2026-11-14 | Apache-2.0；dshfind featured |
| `shanliuling/dsh-image-gen` | plugin | https://github.com/shanliuling/dsh-image-gen | 对话内图像生成/编辑工作流 | 2026-11-14 | Apache-2.0；dshfind featured |
| `shaobeichen/dsh-pocket` | plugin | https://github.com/shaobeichen/dsh-pocket | 手机扫码访问本机 DSH | 2026-11-14 | GPL-2.0；dshfind featured |
| `Nagi-ovo/dsh-find-plugins` | plugin | https://github.com/Nagi-ovo/dsh-find-plugins | 搜索/安装/验证插件的 DSH skill | 2026-11-14 | BSD-3-Clause；skill 形态 |
| `vlln/dsh-skills` | plugin | https://github.com/vlln/dsh-skills | DSH 插件开发/维护 skills | 2026-11-14 | MIT；skill 仓；非官方 |
| `PerryLink/dsh-locator` | plugin | https://github.com/PerryLink/dsh-locator | 全盘文件索引/搜索 | 2026-11-09 | Apache-2.0；npm 0.16.x；跨平台 Go 引擎；非官方 |
| `dsh-capdiff` | plugin | https://www.npmjs.com/package/dsh-capdiff | 声明能力 vs 实际导入差异（SARIF） | 2026-11-14 | Apache-2.0；dsh-next-suite 包；非官方 |
| `testatum-attest` | plugin | https://www.npmjs.com/package/testatum-attest | 插件工件信任卡/签名/撤销 | 2026-11-14 | Apache-2.0；dsh-next-suite 包；非官方 |
| `Han-1413141/dsh-cost-meter` | plugin | https://github.com/Han-1413141/dsh-cost-meter | 会话/模型成本统计 | 2026-11-14 | MIT；非官方 |

### 3.8 adjacent（10）

| id | type | url | role | first_seen | notes |
|---|---|---|---|---|---|
| `claude-code` | adjacent | https://claude.com/claude-code | Anthropic 第一方 terminal coding agent | 2026-11-01 | 对照系；非 DSH |
| `codex` | adjacent | https://github.com/openai/codex | OpenAI Codex 终端 coding agent | 2026-11-01 | Apache-2.0；对照系；产品页 openai.com/codex |
| `cursor` | adjacent | https://cursor.com/ | AI-first IDE / coding agent | 2026-11-14 | 对照系；闭源商业 |
| `manus` | adjacent | https://manus.im/ | 通用 AI agent 产品 | 2026-11-14 | 对照系；闭源商业 |
| `gemini-cli` | adjacent | https://github.com/google-gemini/gemini-cli | Google 开源终端 agent | 2026-11-14 | Apache-2.0；对照系 |
| `openhands` | adjacent | https://github.com/OpenHands/OpenHands | 开源软件工程 agent 平台 | 2026-11-14 | MIT；对照系 |
| `aider` | adjacent | https://github.com/Aider-AI/aider | 终端 pair-programming agent | 2026-11-14 | Apache-2.0；对照系 |
| `cline` | adjacent | https://cline.bot/ | 开源 IDE agent | 2026-11-14 | 对照系；开源 |
| `windsurf` | adjacent | https://windsurf.com/ | AI IDE / agent | 2026-11-14 | 对照系；闭源商业 |
| `devin` | adjacent | https://devin.ai/ | 自主软件工程 agent | 2026-11-14 | 对照系；闭源商业 |

---

## 4. 覆盖地图（按任务要求）

| 要求 | 覆盖实体（示例） |
|---|---|
| 官方：DSH、DeepSeek API/模型 | `deepseek-ai/deepseek-harness`、`api-docs.deepseek.com`、`deepseek-v4-pro-ga`、`platform.deepseek.com`、`huggingface.co/deepseek-ai`、`deepseek-ai/DeepSeek-V3.2-Exp` |
| 框架：Cordis / Koishi | `cordiverse/cordis`、`koishijs/koishi`、`cordis.moe` |
| 治理/标准：AAIF、Agent Plugins、MCP | `aaif.io`、`agent-plugins.org`、`modelcontextprotocol.io`、`agents.md`、`a2a-protocol.org`、`agentskills.io`、`PerryLink/dsh-standards` |
| 社区基础设施：市场/目录/清单 | `dshmarket.com`、`dshfind.com`、`dshbase.com`、`dshmarketplace.dev`、`awesome-dsh-plugin/awesome-dsh-plugin` 等 12 条 |
| 发行版 | `PerryLink/dsh-os-suite`、`PerryLink/dsh-next-suite`、`hikariming/dsh-ee`、`anywhere-labs/dsh-desktop`、`zhu1090093659/dsh-web` |
| 代表插件 | context（`bowenliang123/dsh-context`）、memory（`omdsh-dev/dsh-mnemon`）、research（`1692775560/dsh-Mimir-Academic-research`、`Clearailhc/clearai-dsh`）、UI（`omdsh-dev/DSH-better-sidebar`、`hagen666/dsh-topic-graph`、`ccch1mneyyy/dsh-TUI`）等 20 条 |
| 竞品 | `claude-code`、`codex`、`cursor`、`manus`、`gemini-cli`、`openhands`、`aider`、`cline`、`windsurf`、`devin` |

---

## 5. 怎么用

- **媒体/研究**：引用实体时带 `id + url + first_seen`，避免「某插件」这种不可核验表述。
- **企业选型**：先看 `type` 和 `notes` 的许可/官方关系，再看功能；`official` 之外都不代表 DeepSeek 背书。
- **贡献**：新增实体必须给公开 URL、type、role、日期、notes；不接受未公开项目，不写未核实 star 数。
- **机器读取**：`data/ecosystem-atlas.json` 与本文表格同源；改一处要同步另一处并跑校验。

```sh
node scripts/validate-atlas.mjs            # JSON: 必填/URL 形状/日期/重复 id
node scripts/validate-atlas.mjs --check-md # 再加 Markdown 表格与 type 统计一致性
```

---

## 6. 后续（未完成）

- 扩到 300 实体（插件/作者/事件/时间线），但保持「每条可核验」，不灌水；
- 加 `events` 表（发布/事故/融资/标准）；
- 与 `dsh-upgrade-atlas` 的版本断点表互链；
- 生成 CSV/JSON + DOI（见 `CREDENTIALS.md`）；
- 把 `validate-atlas.mjs` 接入 CI，防止表格与 JSON 漂移。

> 这是 v1，不是全量；不要把「收录」当「背书」。竞品条目只用于对照，不代表合作或推荐。
