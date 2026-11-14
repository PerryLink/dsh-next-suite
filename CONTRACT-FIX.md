# CONTRACT-FIX — 8 包契约一致性修复

- 日期：2026-11-14
- 范围：`packages/{dsh-capdiff,testatum-attest,dsh-supply-watch,cordis-hmr-doctor,cordis-migrate,cordis-testkit,dsh-xbrl,dsh-upgrade-atlas}`
- 未改：包名、版本、许可证、`bin` 名、核心业务算法；未引用 `templates/_template`。
- 未做：F1（repository/homepage/bugs 404）、F4（tarball 文件权限）、npm publish。

## 1. 统一契约

### 1.1 `-V` / `--version`

7 个有 CLI 的包全部支持 `-h/--help` 与 `-V/--version`：

- 输出：`<name> <version>`（例如 `dsh-xbrl 0.1.0`）
- 退出码：`0`
- 短选项统一为 `-V`；旧的 `-v`（仅 `dsh-capdiff` 使用过）已移除。

`cordis-testkit` 无 CLI，不适用。

### 1.2 退出码

| 码 | 含义 | 覆盖场景 |
|---|---|---|
| `0` | 成功 | 正常完成；findings / skipped / 空查询结果不算失败 |
| `1` | 业务否定结果 | `dsh-xbrl check` 不通过；`testatum-attest verify` 验签失败、拒绝签名/撤销、无效卡片 |
| `2` | 用法 / 输入 / IO 错误 | 无参数、未知命令、未知选项、缺文件、坏 JSON、不可读目标、写失败 |

没有业务否定状态的 5 个 CLI（`dsh-capdiff`、`dsh-supply-watch`、
`cordis-hmr-doctor`、`cordis-migrate`、`dsh-upgrade-atlas`）已在 README 中把
`1` 明确写为“保留，不使用”，避免把 findings/匹配误当失败。

### 1.3 JSON envelope

所有 `--json` 成功输出都是对象，至少包含：

```json
{ "command": "<command>", "ok": true }
```

数组字段使用 `items` / `entries`；`dsh-upgrade-atlas list/query` 由裸数组改为：

```json
{ "command": "list", "ok": true, "entries": [], "count": 0 }
```

`dsh-capdiff --sarif` 例外：输出遵循 SARIF 2.1.0（`version: "2.1.0"`），不是
套件 envelope；文档已注明。

### 1.4 README 结构

8 个 README 均含 7 个语义一级章节，顺序一致；中文包使用对应中文标题：

| 英文 | 中文 |
|---|---|
| `## What it is` | `## 是什么` |
| `## Why` | `## 为什么` |
| `## Install` | `## 安装` |
| `## Usage` | `## 用法` |
| `## Limitations` | `## 限制` |
| `## Naming` | `## 命名核验` |
| `## Non-official` | `## 非官方声明` |

`## License` / `## 许可` 作为独立许可证小节保留在末尾。原内容尽量保留，
参考性小节降为 `###`，退出码表统一为 Markdown 表格。

## 2. 逐包改动

| 包 | CLI | README | 测试 |
|---|---|---|---|
| `dsh-capdiff` | `-V`；退出码 2；JSON 加 `command/ok` | 7 章；退出码表；JSON 示例 | 2 处 exit 1→2 |
| `testatum-attest` | `-V`；无 command 由 1→2 | 修正退出码表（无参数=2）；7 章 | 无参数 1→2 |
| `dsh-supply-watch` | `-V`；usage/IO 1→2；JSON 加 `ok` | 新增完整退出码表；7 章；JSON 示例 | 4 处 1→2 |
| `cordis-hmr-doctor` | `-V`；缺参数 1→2；JSON envelope | 7 章；退出码表；`-V` 行 | 缺参数 1→2 |
| `cordis-migrate` | `-V`；全部 usage/IO/写失败 1→2；JSON 加 `command/ok` | 7 章；退出码表；JSON 形状 | 7 处 1→2 |
| `cordis-testkit` | 无 CLI | 7 章；补“无退出码契约”说明 | 未改 |
| `dsh-xbrl` | `-V`；JSON 加 `command`/`ok` | 7 章；JSON envelope 说明 | 未改（原有 1/2 已正确） |
| `dsh-upgrade-atlas` | 全部错误 1→2；list/query 改 `{command,ok,entries,count}`；其余 JSON 加 envelope | 7 章；退出码表；JSON 契约 | list/query 形状 + 4 处 1→2 |

## 3. 验证证据（2026-11-14）

```sh
# 根目录，8 包（模板已移出 packages/）
npm test
# tests 242 / pass 242 / fail 0

# 15 个源文件
for p in ...; do for f in packages/$p/src/*.js; do node --check "$f"; done; done
# 15/15 通过

# 7 个 CLI
node packages/<pkg>/src/cli.js --help     # exit 0
node packages/<pkg>/src/cli.js --version  # "<name> 0.1.0", exit 0
node packages/<pkg>/src/cli.js            # exit 2
node packages/<pkg>/src/cli.js --nope     # exit 2

# 业务否定
node packages/dsh-xbrl/src/cli.js check .../unbalanced-2024.json  # exit 1
# testatum 篡改卡片 verify -> exit 1
```

另用一次性脚本逐项校验 7 个 CLI 的 `-V`/`--help`/无参数/未知选项，以及
capdiff、supply、testatum、hmr、migrate、xbrl、atlas 的 `--json` envelope：
全部通过；`atlas list/query` 的 `entries` 为数组且 `count` 与长度一致。

README 结构检查：8/8 同时满足 7 个语义标题（中文或英文对应），且顺序为
What → Why → Install → Usage → Limitations → Naming → Non-official。

## 4. 仍存问题 / 边界

1. **F1 未修**：8 包 `repository` / `homepage` / `bugs` 仍指向公网 404 的
   `PerryLink/dsh-next-suite`。本次按要求不改 package.json 元数据。
2. **F4 未修**：tarball 中非 CLI 文件仍为 0755；本次不动文件权限。
3. **`1` 为保留码**：capdiff / supply / hmr / migrate / atlas 没有业务否定
   状态；如果未来希望“findings 即失败”，需要改产品语义，不应只改文档。
4. **`--sarif` 不是 envelope**：SARIF 有自己的标准形状，不能塞 `{command,ok}`
   而不破坏规范；已在 README 说明。
5. **测试数未变**：只更新既有断言，没有新增/删除测试，因此仍为 242，而不是
   为每个新契约新增测试；如需回归覆盖建议下一轮补测试（会改变 242 计数）。
6. 仅在 Linux/WSL + Node 24.22.1 实测；未复跑 Node 22.19 与 Windows。
