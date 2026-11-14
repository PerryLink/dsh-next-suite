# cordis-testkit

## 是什么

> **非官方项目**：这是社区独立编写的 **Cordis 测试替身（test double）**，不是 Cordis 官方实现，也不由 cordiverse / Cordis 作者背书。  
> 与 DeepSeek 同样没有隶属关系。本包代码使用 **Apache-2.0**；Cordis 本身是 cordiverse 的 MIT 项目。

`cordis-testkit` 给 Cordis 插件测试提供两件事：

1. **一个可预测的 mock context**：可以手动 `emit` 事件、注册/释放 listener、effect 和 plugin；
2. **资源泄漏断言**：`assertNoLeaks(ctx)` 会列出没清理的 listener / effect / plugin，并让测试失败。

它面向单元测试，不试图复刻 Cordis 运行时。

## 为什么

Cordis 插件的约定是「通过 `ctx` 注册的东西，由 `ctx.dispose()` 统一释放」。但用一个真实 Cordis 实例测插件，会同时引入 fiber、依赖注入、服务反射、配置解析等大量与本次测试无关的行为。很多泄漏（忘了 return effect cleanup、listener 没随插件释放）在普通断言里也看不出来。

这个包把 `ctx` 缩成一张资源表：

- 测试需要的事件派发：`on` / `emit`；
- 测试需要的生命周期：`effect` / `plugin` / `dispose`；
- 测试需要的状态：`set` / `get` / `snapshot`；
- 测试需要的验收：`assertNoLeaks`。

## 安装

0.1.3，**已发布到 npm**（`npm i cordis-testkit@0.1.3`）。也可在本仓库内直接使用：

```sh
cd packages/cordis-testkit
npm test
node --check src/core.js
```

发布后才可用：

```sh
npm install --save-dev cordis-testkit
```

要求 Node `^22.19.0 || >=24.9.0`。纯 ESM，无第三方依赖，可离线测试。

本包**没有 CLI**，因此没有进程退出码契约；测试通过/失败由 `node:test` 与
`assertNoLeaks` 抛错决定（`error.code = 'ERR_CORDIS_LEAK'`）。

## 用法

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertNoLeaks,
  createMockContext,
  runPlugin,
  snapshot,
} from 'cordis-testkit'

test('plugin registers and releases its timer', () => {
  const ctx = runPlugin((inner, config) => {
    inner.effect(() => {
      const timer = setInterval(() => {}, config.interval)
      return () => clearInterval(timer)
    }, 'timer')
  }, { interval: 1000 })

  assert.deepEqual(snapshot(ctx).effects, ['timer'])
  ctx.dispose()
  assertNoLeaks(ctx)
})
```

事件：

```js
const ctx = createMockContext()
const seen = []

ctx.on('ready', (value) => seen.push(value))
ctx.emit('ready', 42)
assert.deepEqual(seen, [42])

ctx.dispose()
assertNoLeaks(ctx)
```

泄漏测试（故意失败）：

```js
const ctx = createMockContext()
ctx.on('tick', () => {})

assert.throws(
  () => assertNoLeaks(ctx),
  (error) => {
    assert.equal(error.code, 'ERR_CORDIS_LEAK')
    assert.match(error.message, /listener/)
    assert.match(error.message, /tick/)
    return true
  },
)
```

`error.leaks` 是结构化清单：

```js
{ listeners: ['tick'], effects: [], plugins: [], disposed: false }
```

### API

| API | 说明 |
|---|---|
| `createMockContext()` | 创建 `MockContext`。所有注册都记录在 context 内。 |
| `ctx.on(event, cb)` | 注册 listener。`event` 为 string 或 symbol；返回幂等 disposer。 |
| `ctx.emit(event, ...args)` | 同步派发。listener 以 `ctx` 为 `this`。返回 listener 返回值数组（见「与 Cordis 的差异」）。 |
| `ctx.effect(fn, label?)` | 立即执行 `fn`，接收其同步 cleanup。返回幂等 disposer。默认标签 `effect#N`。 |
| `ctx.set(key, value)` / `ctx.get(key)` | 简单的 `Map` 存储，用于断言插件读到的配置/服务。 |
| `ctx.plugin(plugin, config?)` | 同步应用函数插件或 `{ name, apply }` 对象插件，记录 plugin 名称。返回 `ctx`。 |
| `ctx.dispose()` | 逆序释放 cleanup，清空 listener/effect/plugin 表。幂等。cleanup 错误汇总为 `AggregateError`。 |
| `snapshot(ctx)` | 返回 `{ listeners, effects, plugins, disposed }`；数组只含**仍活跃**资源，且是副本。 |
| `assertNoLeaks(ctx)` | 有活跃 listener/effect/plugin 时抛 `Error`，带分类清单；全部释放则通过。 |
| `runPlugin(plugin, config?)` | `createMockContext()` + `ctx.plugin()`，返回 live ctx；apply 抛错时先释放半成品再抛出。 |

### 释放顺序

`dispose()` 维护一条 LIFO cleanup 栈：

1. effect 的 cleanup 按**注册逆序**执行（后注册先清理）；
2. plugin 成功 apply 后登记自己的 cleanup，因此它会先于它注册的 effect 执行；
3. 所有 cleanup 跑完后才清空 listener 表；
4. 某个 cleanup 抛错不会中断其余 cleanup；全部跑完后抛 `AggregateError`，`error.code = 'ERR_CORDIS_DISPOSE'`。
5. 第一次 `dispose()` 即使抛错，context 也已标记 disposed，后续调用直接返回（幂等）。

### 泄漏判定

`assertNoLeaks(ctx)` 检查的是**仍活跃的注册**，不是「是否调用过 dispose」：

- `ctx.dispose()` 之后一定通过；
- 从未 dispose、但每个 listener/effect 都用返回的 disposer 释放了，也通过；
- 一个 effect 即使没有返回 cleanup，只要没释放仍算活跃资源（严格模式，避免「注册了却没人管」）；
- plugin 只要 apply 成功、尚未 dispose，就算活跃 plugin。

## 限制

### 与 Cordis 的差异（重要限制）

这是为测试写的**同步替身**，不是 drop-in replacement：

- **没有 fiber / 子 context / scope**：插件拿到的是同一个 context，不是 Cordis fork 出来的子 context。
- **没有依赖注入**：`inject`、`provide`、service、`reflect`、配置 schema 校验、logger 均未实现。
- **effects 仅同步**：只接受「返回 cleanup 函数或 undefined/null」；Promise、async cleanup、iterator/async iterator 会抛 `TypeError`。
- **不支持热重载**：没有 `ctx.update()`、`restart()`、`fiber.await()`、HMR 语义。
- **事件能力有限**：没有 `once`、`prepend`、`parallel`/`serial`/`bail`/`waterfall`、事件过滤和 `internal/*` 生命周期事件。
- **返回值是 mock 的便利约定**：`ctx.emit()` 返回 listener 返回值数组（Cordis 返回 void）；`ctx.plugin()` 返回 `ctx`（Cordis 返回 fiber 句柄）。
- **listener 的 `this`**：本实现绑定为 `ctx`；这不是 Cordis 公开保证的一部分。
- **单线程、无并发保护**：不要跨测试共享一个 context。
- **不能证明真实资源已释放**：它只追踪通过 mock context 注册的 listener/effect/plugin；定时器、socket、文件句柄等需要插件自己的 cleanup 去释放，替身只能证明 cleanup 被调用了。

如果测试需要真实的 Cordis 行为（fiber、inject、HMR），请用官方 `cordis` 运行时，而不是本包。

## 命名核验

核验日期：**2026-11-14**。结论：`cordis-testkit` 当时**未在 npm 注册**，也不是 Cordis 官方包名，但这是一个非保留名称，未来仍可能被他人占用；本包与官方无关联。

证据与命令：

```sh
npm view cordis-testkit version
# npm error 404 Not Found - GET https://registry.npmjs.org/cordis-testkit

npm view cordis version
# 4.0.0-rc.13   （cordiverse 官方包）

npm view @cordisjs/testkit version
npm view cordis-test-utils version
npm view @cordisjs/test-utils version
npm view cordis-mock version
# 以上均 404（核验当日）
```

- 官方仓库：<https://github.com/cordiverse/cordis>；官方 npm 包名是 `cordis`，不是 `cordis-testkit`。
- 官方仓库 `packages/` 目录（核验当日）为：`cli-cordis, cli, core, create, env, fs-node, fs, group, hmr, http-socks, http, include, loader, logger-console, package-manager, timer`，其中没有 `testkit`。
- DeepSeek Harness 生态里另有 `@deepseek-ai/dsh-tool-testkit`、`@deepseek-ai/dsh-agent-loop-testkit` 等带 scope 的包，与本包无关；本包也不代表 DeepSeek。
- 本项目只借用公开 API 形状做测试替身，不复用官方源码。官方 Cordis 为 MIT；本包为 Apache-2.0。

如果上游未来发布同名/近似名包，应以官方命名为准，本包可随时更名。

## 非官方声明

本项目是社区独立项目，**不是 Cordis 官方实现**，也不由 cordiverse / Cordis
作者或 DeepSeek 背书。`cordis`、`Cordis` 等名称属于其各自权利人；本包仅作为
非官方的社区测试工具。Cordis 本身是 MIT 项目，本包使用 Apache-2.0。

## License

Apache-2.0，见 [LICENSE](./LICENSE)。

`cordis`、`Cordis` 等名称属于其各自权利人。本包仅为非官方的社区测试工具。
