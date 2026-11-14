# dsh-next-suite —— 8 个「Agent 生态工具」MVP

> 社区项目，**与 DeepSeek 无隶属关系**。Apache-2.0。0.1.0，未发布。
> 目标：把 NEXT.md 的三条主线（信任层 / Cordis DX / 垂直）做成可运行、可测试、可发布的最小工具，而不是又一批治理包。

## 包

| 包 | 类型 | 一句话 |
|---|---|---|
| `dsh-capdiff` | CLI | 插件声明能力 vs 代码实际 import 的差异，输出 SARIF + 建议 manifest。 |
| `testatum-attest` | CLI | 插件 trust card：内容哈希、HMAC 签名、撤销、验证。 |
| `dsh-supply-watch` | CLI | 仿冒/拼写变体/版本异常的供应链监控。 |
| `cordis-hmr-doctor` | CLI | 解析 HMR 日志（settled/aborted/skipped）并给出诊断。 |
| `cordis-migrate` | CLI | Cordis 3→4 迁移规则引擎：扫描、dry-run、apply。 |
| `cordis-testkit` | 库 | mock context + effect 泄漏断言。 |
| `dsh-xbrl` | CLI | 财报 XBRL 事实勾稽、重述 diff。 |
| `dsh-upgrade-atlas` | CLI/数据 | DSH 升级断点图谱：记录、查询、渲染 Markdown。 |

## 约定

- 纯 ESM JavaScript + JSDoc，无构建；Node `^22.19.0 || >=24.9.0`。
- `src/core.js` 不 import 任何第三方包，测试可离线跑。
- `src/cli.js` 只做参数解析/IO，业务调 core；必须支持 `--help` 与 `--json`（适用时）。
- 测试用 `node:test`，每个包至少 8 个断言场景。
- 每个包必须有 `README.md`（是什么/为什么/安装/用法/限制/命名核验/非官方声明）、`DESIGN.md`、`LICENSE`。
- 不做：通用记忆、文档流水线、插件市场、UI 皮肤、单会话 replay。
- 不伪造外部数据/凭证；涉及 DOI/OpenSSF/FSE 的，只写可执行步骤。

## 运行

```sh
npm test
node packages/dsh-capdiff/src/cli.js --help
```

## 发布（未执行）

```sh
cd packages/dsh-capdiff && npm pack --dry-run
```
