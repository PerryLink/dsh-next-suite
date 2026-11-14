# cordis-testkit —— 设计说明

> 非官方测试替身。不是 Cordis 官方实现，不隶属 cordiverse / DeepSeek。Apache-2.0。

## 1. 问题

写 Cordis 插件单测时，真实 `Context` 会把 fiber、依赖注入、服务反射、配置校验、HMR 等一起带进来。测试通常只关心三件事：

1. 我注册的 listener 能不能被事件触发？
2. 我通过 `ctx.effect()` / `ctx.plugin()` 申请的资源，在 `dispose()` 时有没有被释放？
3. 测试结束时，有没有漏掉的 listener/effect/plugin？

真运行时的这些机制会掩盖简单的泄漏：context 一销毁，所有资源都没了，测试不会告诉你**插件是否真的自己管理了生命周期**。本包用一个可观察的资源表替代运行时，专门回答上面三个问题。

## 2. 目标与非目标

### 目标

- `createMockContext()` 提供与 Cordis 形似的 `on` / `emit` / `effect` / `set` / `get` / `plugin` / `dispose`。
- 所有注册都进表，可快照、可断言。
- `dispose()` 逆序执行 cleanup、清空 listener，且重复调用幂等。
- `assertNoLeaks()` 给出**分类 + 名称**的泄漏清单，而不只是 boolean。
- 纯 ESM + JSDoc，零第三方依赖，Node 22/24 可离线跑。
- 明确声明非官方、命名状态和限制，避免被误当成 Cordis 发行版。

### 非目标

- 不做 Cordis 运行时（无 fiber、inject、service、reflect、HMR）。
- 不做异步 effect / Promise cleanup / async iterator。
- 不做事件系统的完整语义（once、prepend、parallel/serial/waterfall、过滤）。
- 不做配置 schema 校验；config 原样传给插件。
- 不做性能优化或跨线程安全；它是测试工具，单线程同步即可。

## 3. 数据模型

每个 context 持有内部状态（挂在 `Symbol.for('cordis-testkit.state')` 上，避免污染公开字段）：

```text
{
  listeners: ListenerRecord[],   // { event, callback, active }
  effects:   EffectRecord[],     // { label, active, disposed, cleanup }
  plugins:   PluginRecord[],     // { name, active, disposed, cleanup }
  cleanups:  CleanupEntry[],     // LIFO：{ kind:'effect'|'plugin', record }
  store:     Map,                // set/get
  disposed:  boolean,
  sequence:  number              // 默认 effect/plugin 名称
}
```

为什么 listener 不进 cleanup 栈？因为 listener 的「释放」只是从表中删除，没有用户 cleanup 回调；而 effect/plugin 可能带用户函数，必须在 `dispose()` 中按逆序调用。listener 表在所有 cleanup 完成后统一清空，保证 cleanup 期间仍可通过返回的 disposer 删除 listener。

`snapshot()` 只暴露活跃资源的**名称**（listener 是 event，effect 是 label，plugin 是 name），因为：

- 测试断言通常只关心「哪个资源没清」；
- 不把内部 record 暴露出去，避免测试依赖实现细节；
- 返回新数组，调用方修改快照不会污染 context。

## 4. 生命周期

### 4.1 注册

- `ctx.on(event, cb)`：校验 event 为 string/symbol、cb 为函数；压入 listener；返回幂等 disposer。
- `ctx.effect(fn, label)`：先建 record 和 LIFO entry，再**同步执行** `fn`。
  - `fn` 返回函数：保存为 cleanup。
  - 返回 `undefined` / `null`：合法的无 cleanup effect，仍算活跃资源（严格模式）。
  - 返回其他值（包括 Promise）：抛 `TypeError`，并回滚 record/entry，不留下幽灵注册。
  - `fn` 自身抛错：同样回滚后重抛。
- `ctx.plugin(plugin, config)`：校验插件形态，记录名称，同步 apply。
  - 函数插件：`plugin(ctx, config)`，`this = ctx`。
  - 对象插件：`plugin.apply(ctx, config)`，`this = plugin`。
  - 返回函数：作为 plugin cleanup；其他非空返回值抛 `TypeError`（明确不支持异步插件）。
  - apply 抛错：移除 plugin record 后重抛。已经注册到 context 的 listener/effect 仍保留，由调用方 `ctx.dispose()` 清理；`runPlugin()` 会自动做这件事。
  - 成功后压入 plugin 的 LIFO entry，使 plugin cleanup 先于它注册的 effect 执行。

`ctx.plugin()` 返回 `ctx`（便于链式调用），而不是 Cordis 的 fiber 句柄。这是已知差异，README 中列明。

### 4.2 事件

`ctx.emit(event, ...args)` 先复制 listener 数组，再逐个检查 `active` 和 event 匹配：

- emit 期间新增的 listener 不会在本轮触发；
- emit 期间被移除的 listener 会跳过；
- 某个 listener 抛错会立即中断本轮并向上抛，与 Cordis 的同步 emit 行为一致；
- `this` 绑定为 mock context，方便插件里的普通函数写法；
- 返回值是 listener 结果数组，仅为测试便利（Cordis 返回 void）。

### 4.3 释放

`ctx.dispose()`：

```text
if (already disposed) return
disposed = true
while (cleanups 非空):
  entry = cleanups.pop()          // LIFO
  if effect: disposeEffect(record)
  if plugin: disposePlugin(record)
清空 listeners（标记 inactive）
清空 effects/plugins 表
若有 cleanup 错误: 抛 AggregateError(errors, ...)
```

关键点：

- **先执行再清表**：cleanup 期间还能通过保存的 disposer 释放 listener；所有 cleanup 结束后才统一清空。
- **错误不短路**：所有 cleanup 都会跑；错误收集后一次抛出。这样即使一个 cleanup 写错，也不会让后面的资源滞留。
- **幂等**：`disposed = true` 在第一次进入时立即设置；即使第一次抛 `AggregateError`，第二次调用也直接返回。`dispose()` 也可从 cleanup 内部安全调用（空操作）。
- **record 级幂等**：`disposeEffect` / `disposePlugin` 在调用 cleanup 前先置 `disposed = true`；effect 返回的 disposer 也通过 `removed` 标记保证只执行一次。

### 4.4 泄漏判定

`assertNoLeaks(ctx)`：

1. `snapshot(ctx)`；
2. 三类都为空 → 返回；
3. 否则构造 `Error`，message 含每类的计数与名称，附 `code = 'ERR_CORDIS_LEAK'` 和 `leaks = snapshot`。

判定的是「活跃注册」而不是 `disposed` 标志，因此两种测试写法都成立：

```js
// A. 释放整个 context
ctx.dispose()
assertNoLeaks(ctx)

// B. 逐个释放，context 仍活着
const off = ctx.on('tick', fn)
off()
assertNoLeaks(ctx)
```

effect 即使没有 cleanup 也算活跃：这会让「注册了但没人负责」在测试里显形，而不是静默通过。代价是偏向严格，README 已注明。

## 5. 与 Cordis 4 的兼容面

| 能力 | Cordis 4 | cordis-testkit |
|---|---|---|
| `ctx.on` 返回 disposer | 是 | 是 |
| listener `this` | 事件派发约定 | 绑定 ctx（模拟便利） |
| `ctx.effect` 立即执行 | 是 | 是 |
| effect cleanup 逆序 | 是 | 是 |
| effect 支持 Promise/iterator | 是 | **否**（同步替身） |
| `ctx.plugin` 子 fiber | 是 | **否**，同 ctx |
| plugin 返回 cleanup | 支持 effect 语义 | 只支持同步函数 |
| `ctx.emit` 返回 | void | 结果数组（便利） |
| `ctx.plugin` 返回 | fiber 句柄 | ctx |
| inject/provide/reflect/service | 是 | 否 |
| `once`/`prepend`/`parallel`/`waterfall` | 是 | 否 |
| HMR / update / restart | 是 | 否 |
| 配置校验 | 是 | 否（原样传递） |

这张表就是本包的「不要误用」清单。需要真实行为时请用官方 `cordis`。

## 6. 命名与法律

- 官方项目：`cordiverse/cordis`；官方 npm 包：`cordis`（核验时 `4.0.0-rc.13`）。
- `cordis-testkit` 于 2026-11-14 查询 npm registry 返回 404；官方 `packages/` 列表无 `testkit`。因此它不是官方保留名或官包，只是当前未被占用的社区名。
- 同类名 `@cordisjs/testkit`、`cordis-test-utils`、`@cordisjs/test-utils`、`cordis-mock` 当时也均为 404。
- 本包不复用官方源码；官方是 MIT，本包是 Apache-2.0。名称与商标归各自权利人。
- DeepSeek Harness 生态中带 `@deepseek-ai/*testkit` scope 的包与本包无关。

更完整的查询命令与证据见 README「命名核验」。

## 7. 测试策略

测试用 `node:test`，按行为分层：

- `test/context.test.js`：on/emit、过滤与顺序、set/get、listener disposer、snapshot 副本、dispose 后禁止注册。
- `test/effects.test.js`：立即执行、cleanup、逆序、disposer 幂等、setup 失败回滚、cleanup 错误汇总、无 cleanup effect 仍计活跃。
- `test/leaks.test.js`：dispose 后通过、listener/effect/plugin 三类泄漏、清单完整性、显式释放也可通过、非法 ctx。
- `test/plugin.test.js`：函数/对象插件、config、plugin cleanup 顺序、plugin 资源释放、runPlugin、apply 失败自动清理、非法返回值。

当前共 **27 个测试**，运行：

```sh
node --test packages/cordis-testkit/test/*.test.js
node --check packages/cordis-testkit/src/core.js
```

## 8. 迭代方向（未实现）

- 可选开启的异步 effect/cleanup（保持默认同步）；
- plugin 级 dispose 句柄（当前只能整体 dispose）；
- listener options（prepend/once）与事件过滤；
- 与真实 Cordis 的 contract test（同一组断言分别在 mock 与真 ctx 上跑）；
- 更细的泄漏归因（哪个 plugin 注册了哪个资源）。

这些都需要先确认不会把「简单可预测的测试替身」做成半个运行时。当前版本刻意保持小。

## 9. License

Apache-2.0，见 [LICENSE](./LICENSE)。
