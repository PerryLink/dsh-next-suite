# DESIGN — cordis-migrate

> 非官方社区工具。与 Cordiverse / Cordis / DeepSeek 无隶属关系。Apache-2.0。
>
> **核心立场：内置规则是社区整理，不是官方迁移表；标 `experimental` 的规则尤其只是线索；工具只生成候选改动，语义正确性由人负责。**

## 1. 目标与非目标

### 目标

- 对 Cordis 3 → 4 迁移中**重复、文本可判定**的片段，提供可复现的扫描与改写建议。
- 默认安全：`apply` 默认 dry-run，`--write` 必须显式；`scan` 永不写盘。
- 纯 ESM + JSDoc + 零第三方依赖，可离线测试（`node --test`）。
- 核心（匹配/计划/应用）与 IO（遍历/读写/参数）分离，方便嵌入其它工具。
- 对二进制/非法编码文件绝不写入。

### 非目标

- **不是**官方迁移工具，不提供权威迁移表，不判断业务语义。
- **不是** AST codemod：不解析 TS/JS，不处理作用域、别名、类型、跨行结构。
- 不安装依赖、不解析依赖树、不跑测试、不提交/推送。`package` 类规则可能在 `package.json` 的**文本**中命中并改写；这不是语义化的依赖管理。
- 不自动向上游 `cordiverse/cordis` 或任何官方仓库发起改写/PR。
- 不提供回滚/备份；版本控制是使用者的责任。

## 2. 为什么是规则而不是 AST

Cordis 4 仍在 RC（`4.0.0-rc.13`），迁移细节随版本变化，且真实仓库有大量 re-export、生成代码和类型技巧。完整 AST 迁移器需要：

1. 解析 TS/JS（引入解析器依赖，违背零依赖约束）；
2. 理解类型信息与模块解析（需要编译环境，离线不可靠）；
3. 对每个 API 变化做出语义判断（本工具没有权威依据）。

规则引擎用**极小的可审计面**换取确定性：每条规则只是一个行内正则和一个替换串。代价是误报/漏报，因此：

- 内置规则标为 `warning`/`error` 并有明确的人工确认提示；
- `plan` 展示每一处 `before -> after`，先审后写；
- 不声称“跑完即迁移完成”。

## 3. 架构

```
src/rules.js         纯数据：RULES / RULE_SOURCES / RULES_NOTICE / formatRules
src/core.js          纯函数：scanSource / plan / applySource / formatPlan（从 rules.js 导入 RULES）
src/cli.js           参数解析 + 目录遍历 + fs 读写 + 输出（scan / apply / rules）
test/fixtures.js     每条规则的正例/反例/期望输出；聚合 fixture
test/rules.test.js   规则契约、逐条正反例与幂等、formatRules
test/core.test.js    纯核心单测（不碰磁盘）
test/cli.test.js     spawn CLI，用 %TEMP% 下的临时目录验证 dry-run/--write/二进制跳过/rules
```

依赖方向单向：`cli.js -> core.js -> rules.js`。`core.js` 与 `rules.js` 不 import 任何 Node API 或第三方包（`TextDecoder` 是 Node 22+ / 现代浏览器提供的全局对象）。因此核心规则与引擎可直接在浏览器/其它运行时复用。

CLI 只使用内置 `RULES`；库调用者可以传入自定义规则数组，这是有意保留的扩展点。

## 4. 数据模型与不变量

### Rule

```js
{ id, kind, pattern, replacement, description, severity, evidence?, experimental? }
```

- `pattern`：`RegExp`（推荐带 `g`）或字符串（内部按 `g` 编译），按行匹配。
- `replacement`：字符串（支持 `$1`/`$&`）或 `(match, ...captures) => string`。
- `id` 在结果与输出中标识规则；内置规则彼此唯一。
- `evidence`：内置规则必填的一行证据（版本/声明/发布说明）；自定义规则可省略。
- `experimental`：可选布尔；为 `true` 表示改写是“尽力而为”，必须人工复核。
- 五个必填字段在 `scanSource`/`plan` 入口统一校验，缺字段立即 `TypeError`；`evidence`/`experimental` 若存在也校验类型，避免“空计划看起来成功”。

### Match

```js
{ ruleId, line, column, before, after }
```

- `line`、`column` 均为 **1-based**。
- `column` 是 UTF-16 code unit 的偏移（JS 字符串索引 + 1），不是 Unicode code point 计数。
- `before` 是精确匹配文本；`after` 是替换后的文本（在扫描时算好，便于 JSON 展示）。
- `scanSource` 只返回这五个键，按 `line`、`column`、规则输入顺序稳定排序。

### Plan

```js
{
  changes: [{ path, matches }],
  skipped: [{ path, reason }],
  summary: { files, changedFiles, matches, skipped }
}
```

- `changes` 只含至少一个匹配的文件；无匹配的干净文件不在任何列表里，只计入 `summary.files`。
- `skipped` 是“无法按文本处理”的文件：二进制扩展名、NUL、非法 UTF-8、CLI 读取失败等。
- `plan` 是纯函数，不读盘、不写盘、不改变输入对象。
- JSON 输出不包含 `RegExp`，避免 `JSON.stringify` 后丢字段。

## 5. 匹配算法

1. 用 `/\r\n|\n|\r/g` 切分文本，并单独保存每个分隔符；扫描只看行内容，不把 `\r` 带进列号。
2. 每条规则克隆一个带 `g` 的 `RegExp`，每行开始前重置 `lastIndex`，避免规则状态跨文件泄漏。
3. `exec` 循环；对零长度匹配手动推进 `lastIndex`，防止死循环。
4. 零长度匹配不产出 `Match`（无法安全应用）。
5. 字符串替换的 `after` 用“对 `match[0]` 再执行一次非全局正则替换”得到；因此规则不应依赖匹配之外的上下文（lookbehind 等），内置规则均满足。
6. 排序：`line` → `column` → 规则数组顺序。稳定排序保证同一行的多个规则结果可复现。

**已知误报面**：注释、字符串字面量、正则字面量中的文本同样会被匹配。这是文本引擎的固有限制，不是 bug；需要 AST 才能消除。

## 6. 应用算法与幂等

对每个有匹配的行：

1. 只接受结构合法的 `Match`（整数 `line`/`column`、非空 `before`、字符串 `after`）。
2. 按 `column` 升序做**最左非重叠选择**：若当前匹配的起点早于上一个已选匹配的终点，跳过。相同列时保持 `scanSource` 的顺序（稳定排序）。
3. 选中的匹配按 `column` **降序**应用，从行尾向行首替换，避免左侧替换改变右侧列号。
4. 应用前检查 `line.slice(column - 1, column - 1 + before.length) === before`；不满足则跳过。这使：
   - 陈旧匹配（文件已被改过）不会被误用；
   - 对同一批匹配重复调用 `applySource` 是 no-op（幂等）。
5. 重新拼接时使用原始行分隔符数组，因此 CRLF/LF/混合行尾、末尾无换行都原样保留。

**为什么最左优先**：比“最右优先”更符合“从文件开头顺序改写”的直觉，也便于解释重叠时的取舍。代价是宽泛规则可能遮蔽后面的精确规则，规则作者应避免大范围重叠模式。

**幂等边界**：若自定义规则把 `before` 重新引入（例如 A→B、B→A 两条规则同时使用），重复应用仍可能变化。内置规则不构成循环。文档明确说明这一点。

## 7. 编码与二进制

`decodeTextContent(path, content)`：

1. 已知二进制扩展名（`BINARY_EXTENSIONS`）→ `binary-extension`；
2. 字符串含 U+0000 或字节数组含 `0x00` → `binary-nul`；
3. 字节数组用 `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`：
   - 非法 UTF-8 → `invalid-utf8`（不做有损替换后写回）；
   - `ignoreBOM: true` 保留 BOM，写回不丢字节；
4. 非字符串/字节数组/ArrayBuffer → `unsupported-content`。

BOM 会作为 U+FEFF 参与第 1 行文本，因而使该行列号 +1；这是保留字节完整性的取舍，已在 README 说明。

**为什么不用扩展名白名单**：白名单会漏掉 `.tsx`、`.mts`、`.md`、无扩展名脚本等；用“二进制扩展名 + NUL + 严格 UTF-8”作为排除条件更稳。

## 8. CLI 的取舍

- **默认 dry-run**：迁移工具的默认行为应是“展示”，不是“修改”。`--write` 必须显式出现。
- **扫描/写入互斥语义**：`scan --write`、`apply --write --dry-run` 直接报错，而不是选一个“更安全”的。
- **`rules` 只读**：列出 26 条规则及其 `kind`/`severity`/`experimental`/`evidence`；`rules --json` 额外输出来源清单。它不接受目标路径或 `--write`。
- **遍历**：递归、排序、跳过 symlink；忽略 VCS/构建/依赖目录与 lockfile、`*.min.js`、`*.map`，减少噪音和误写风险。
- **路径展示**：相对目标路径，统一 `/` 分隔符，便于跨平台 JSON 对比；实际写入使用绝对路径。
- **输出**：文本报告逐条列出 `line:column ruleId before -> after`；`--json` 输出单一 JSON 对象，`--write --json` 追加 `write.{written,unchanged,failures}`。
- **退出码**：`scan` 有匹配也返回 0（把判定留给调用方/CI 解析 JSON）；参数错误、目标不可读、写入失败返回 2。
- **读写时机**：先把所有候选文件读入内存再 plan；MVP 不做流式/大仓库优化。
- **不跟随 symlink**：避免扫描越界与写穿到目标目录之外。

## 9. 规则为什么是社区整理

26 条内置规则覆盖 import 子路径、`Context` 字段、`ctx.on` 事件名、`ctx.plugin`/`ctx.inject`、service 注册、dispose/effect、config schema、HMR 与 package 字段。每条都带一行 `evidence`，指向 2026-11-15 核对的 v3/v4 类型声明、export map 或 release notes；完整清单见 `src/rules.js` 顶部与 `RULE_SOURCES`。

目标版本是 npm 上游 `cordis@4.0.0-rc.13`。DeepSeek Harness vendor 的 `@deepseek-ai/cordis@4.1.0` 在个别 API 上不同（例如仍以 `ctx.plugin` 为主、没有 rc.13 的 `ctx.use`），以 vendored 版本为目标时需重新核对。

这些是**表面证据**，不是官方迁移文档：Cordis 4 仍在 RC，API 可能继续变化；规则也没有覆盖别名、re-export、作用域、类型与多行结构。因此 README、`RULES_NOTICE`、CLI help、plan 输出都重复同一句话：社区整理，人工确认；标 `experimental` 的规则尤其只是线索。新增规则前应：

1. 找到目标版本的**一手**变更说明/类型声明；
2. 写出“误匹配会怎样”的例子；
3. 决定是否值得自动改写，还是只应作为提示；
4. 为规则加至少一个正例与一个反例测试，并验证输出不再匹配自身；
5. 不让替换把旧文本重新引入（保持幂等）。

## 10. 安全边界：不自动改官方仓

本工具刻意**不具备**以下能力：

- 不执行 git、不创建分支/commit/PR；
- 不访问网络、不读取 registry；
- 不解析/安装依赖，不做语义化的 `package.json` 编辑（文本规则仍可能命中并改写 `package.json`，dry-run 会列出）；
- 不清理、不删除文件；
- 不对官方仓库做任何自动提交。

即使把 `--write` 指向 Cordis 官方 checkout，工具也只是按本包社区规则改文本；README 明确要求不要这样做。向上游提议变更应遵循该仓库自己的贡献流程，并由人审阅。

## 11. 测试策略

`node --test packages/cordis-migrate/test/*.test.js`，当前 65 个测试，全部离线：

- `test/rules.test.js`（34）：规则完整性（≥20 条、字段齐全、id 唯一、evidence 非空、experimental 类型）、每个 kind 覆盖、**每条规则一个正例 + 一个反例 + 幂等固定点**、别名/默认导入/类型导入/引号/JSON/YAML 变体、26 条规则聚合一次迁移、`formatRules` 文本/JSON 可序列化、来源清单。
- `test/core.test.js`（16）：scan/apply/plan/formatPlan 的引擎行为、CRLF/LF/混合行尾、重叠最左优先、陈旧匹配、二进制/非法 UTF-8 跳过、BOM、自定义规则校验、内置规则默认值。
- `test/cli.test.js`（15）：`rules` 文本/JSON/只读拒绝、scan JSON/文本、单文件、默认 dry-run、显式 `--dry-run`、`--write` 写盘、二次写入幂等、二进制不被改动、`--write --json`、冲突参数、缺失目标、`--help`/`--version`。**全部规则的 dry-run 测试断言文件字节不变；`--write` 测试断言迁移结果并再次运行确认幂等。**

CLI 测试用 `mkdtemp` 在系统临时目录创建隔离目录，`t.after` 清理；不触碰用户目录或真实仓库。

## 12. 已知限制与可能的下一步

- 只做单行文本规则；多行/结构替换需要 AST 或模板级规则。
- 列号按 UTF-16 code unit；与某些工具（按 code point）不同。
- 无交互式确认、无 diff 补丁输出（`--json` 可供上层生成）。
- 无备份/回滚；无 “只改某几个文件” 的 include/exclude 参数。
- 大仓库全量读内存；未来可改为逐文件扫描/写入。
- CLI 不支持自定义规则文件；库 API 已支持，未来可加 `--rules <file>`。
- 未做 Windows 实机 CLI 测试之外的平台矩阵；路径输出已统一 `/`。

## 13. 命名核验与发布

- `npm view cordis-migrate version` 在 2026-11-14 返回 E404（npm 上未注册）；GitHub 仓库名搜索 0 结果。
- npm 的 `cordis` 包由 Cordiverse 维护；本包不是其官方工具，README 已声明非隶属。
- 名称可用性会变化，发布前需重新核验；本仓库版本 `0.2.0`，未声明已发布。
- `package.json` 已配置 `bin`、`exports`（`.`、`./rules`、`./cli`）、`files`、`engines`、`publishConfig.access=public`；发布前应跑 `npm pack --dry-run` 检查包内容。

## 14. 许可

Apache-2.0。见 `LICENSE`。
