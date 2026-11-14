# Plugin Dojo：两个可自动判分的实验

> 2026-11-14｜面向 DSH 插件作者的动手课程｜不依赖付费平台，全部本地可跑
> 目标：让学员在 1 天内完成「能装 → 能用 → 能审计」三件事；每个 lab 有明确验收。

---

## Lab 1：Hello Plugin（30–60 分钟）

**目标**：从零做一个能被 DSH 安装、注册工具、调用成功的插件。

**前置**：Node 24、`npx @deepseek-ai/dsh@0.2.2-rc.3`、一个临时 `DSH_HOME`。

**步骤**：
1. 建目录 `hello-plugin/`：
   ```
   package.json
   cordis.patch.yml
   index.js
   ```
2. `package.json`：
   ```json
   {
     "name": "dsh-hello-plugin",
     "version": "0.1.0",
     "type": "module",
     "main": "index.js",
     "files": ["index.js", "cordis.patch.yml"],
     "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
     "engines": { "dsh": ">=0.2.2-rc.3 <0.3.0" }
   }
   ```
3. `cordis.patch.yml`：
   ```yaml
   - insert:
       - id: hello
         name: dsh-hello-plugin
   ```
4. `index.js`：注册 `greet` 工具（参考 `docs/user/develop/basic/tool.md`）。
5. 临时 `DSH_HOME=$(mktemp -d)`，`dsh plugin --profile web add ./hello-plugin`，`--dump-config` 看到 `hello`。
6. 在 Web UI 里让 agent 调 `greet`。

**验收（自动）**：
- `--dump-config` 含 `dsh-hello-plugin`；
- 工具 schema 有 `name` 参数；
- 调用返回 `Hello, <name>!`。

**扩展**：给工具加 `output.render`，让它返回 markdown。

---

## Lab 2：Governance Lab（2–3 小时）

**目标**：用 `dsh-os-trace` / `dsh-os-lease` / `dsh-os-quota` 回答三个问题：
1. 这次操作是谁批准的？
2. 两个 agent 为什么没有互相踩文件？
3. 为什么任务被预算拦住？

**前置**：Lab 1 完成；安装 `dsh-os-*`（npm 0.1.1）。

**步骤**：
1. **Trace**：构造一次「审批 → 工具调用 → 写文件」的 mock span 链，跑 `trace_why`，输出因果链 + 证据包；`trace_verify` 校验哈希。
2. **Lease**：开两个 lease（同一 workspace、重叠路径），第二个应冲突；改路径后成功；`workspace_apply` 做两阶段提交。
3. **Quota**：设 `tokens=100`，先 `quota_admit` 80（ok），再 30（hard 拒绝）；`quota_consume` 记录超限。

**验收（自动）**：
- `trace_verify` 返回 `ok: true`；
- lease 冲突返回 `conflict`，不同路径返回 `acquired`；
- quota 第二次 `admit` 返回 `allowed: false`，`level: 'hard'`。

**扩展**：把三个结果导出成一份「事故复盘」Markdown。

---

## 讲师备注

- 每个 lab 的验收都可以写成 `node --test`，不要靠人眼。
- 不要用真实企业数据；用 mock facts/spans。
- 课程材料 CC-BY-4.0；代码 Apache-2.0。
- 如果要做认证，先积累 20 个学员的完成证据，再谈证书。
