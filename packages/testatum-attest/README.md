# testatum-attest

> 社区项目，**与 DeepSeek 无隶属关系**。Apache-2.0。版本 `0.1.0`，**未发布**。
>
> **HMAC 是 MVP 占位方案，不是 sigstore / npm provenance 的替代品。**
> 它解决“离线核对一份文件清单有没有被改过、是不是我签的”，不解决身份、
> 透明日志、公钥信任根、密钥托管这些供应链信任问题。详见
> [限制](#限制) 与 [DESIGN.md](./DESIGN.md)。

`testatum-attest` 给插件产物做一张 **trust card（信任卡）**：

- 把每个文件的 SHA-256 按路径排序，算出一个 `rootHash`；
- 用调用方传入的共享密钥做 HMAC-SHA256 签名；
- 支持撤销记录（revocation list）和离线验证；
- 不依赖数据库、网络、第三方包，只用 Node 内置 `node:crypto`。

## 是什么

一张签名后的 trust card 是一个普通 JSON 文件：

```json
{
  "schema": "testatum/v1",
  "name": "demo-plugin",
  "version": "1.2.3",
  "files": [
    {
      "path": "src/a.js",
      "sha256": "a3b135bcfeaabda5d6780642cf256059889ad4649c9ba4f7a4d5d6e83a68b402",
      "size": 19
    },
    {
      "path": "src/b.js",
      "sha256": "3ff509f2d3ce95bd2f50301b27308a893abc24a103a74ead45581920fabe03e6",
      "size": 17
    }
  ],
  "rootHash": "66789bd978f7915cd118aee915e33c6dd6463e96fdd85df89a98f40e47cc3625",
  "createdAt": "2026-01-02T03:04:05.000Z",
  "signature": {
    "alg": "hmac-sha256",
    "sig": "89c95e726440fc8317493e844839886dd2ced54584da4cbb13dcef95fc6d4b6e",
    "keyId": "release-2026-11"
  }
}
```

约定：

- `files` 按 `path` 的 UTF-16 code unit 升序排列，条目形状固定为
  `{ path, sha256, size }`；`path` 是调用方给的原始字符串，不做平台路径归一化。
- `rootHash = sha256(canonicalJson(files))`。
- `signature.sig = HMAC-SHA256(secret, canonicalJson(card 去掉 signature))`。
- canonical JSON：对象键递归排序、无空白、数组保持顺序；不支持
  `undefined` / 函数 / Symbol / BigInt / NaN / Infinity / 循环引用。
- 卡片只存摘要，不存文件内容；验签本身只需要卡片。要确认**实际文件**与卡片
  一致，需重新拿到原始文件并调用 `verifyFiles`（见下文）。

## 为什么

1. **挡住清单和卡片字段被改**：任何文件摘要/路径/size 或顶层字段变化都会
   让 `rootHash` 或 HMAC 失败。要同时挡住“实际文件被换、卡片没换”，再把磁盘
   字节交给 `verifyFiles` 逐项比对。
2. **离线、可审计、零依赖**：`node --test` 就能跑；不要求 CI 联网。
3. **撤销可独立分发**：撤销记录只引用 `rootHash`，不需要重新签原卡片。
4. **给后续升级留位置**：HMAC MVP 的边界写清楚了，后续可以换成
   Ed25519 / sigstore / npm provenance，而不是假装已经拥有那些保证。

## 安装

尚未发布到 npm；在本仓库里直接运行：

```sh
cd packages/testatum-attest
node --test test/*.test.js
node src/cli.js --help
```

若要从其他项目引用，可先本地打包：

```sh
cd packages/testatum-attest
npm pack
# 在目标项目：npm install /path/to/testatum-attest-0.1.0.tgz
```

要求 Node `^22.19.0 || >=24.9.0`，纯 ESM，无运行时依赖。

## 用法

### 库 API

```js
import { readFile } from 'node:fs/promises'
import {
  attachSignature,
  createCard,
  signCard,
  verifyCard,
} from 'testatum-attest'

const card = createCard({
  name: 'demo-plugin',
  version: '1.2.3',
  files: [
    { path: 'dist/index.js', content: await readFile('dist/index.js') },
    { path: 'dist/a.js', content: await readFile('dist/a.js') },
  ],
})

// 注意：secret 由调用方提供，库不会读环境变量，也不会把它写进卡片。
const signed = attachSignature(
  card,
  signCard(card, { secret: process.env.TESTATUM_KEY, keyId: 'release-2026-11' }),
)

const result = verifyCard(signed, {
  secret: process.env.TESTATUM_KEY,
  // 可选：把卡片绑定到磁盘上的真实文件
  files: [
    { path: 'dist/index.js', content: await readFile('dist/index.js') },
    { path: 'dist/a.js', content: await readFile('dist/a.js') },
  ],
})
if (!result.ok) {
  console.error('verification failed:', result.reasons)
}
```

`verifyCard(card)` 需要共享密钥才能验 HMAC；API 因此是
`verifyCard(card, secretOrOptions)`。不传 secret 会返回
`{ ok: false, reasons: ['secret-missing'] }`（fail closed），而不是静默通过。
只做哈希/结构检查（不验签）时用 `verifyCardIntegrity(card)`。

主要导出：

| 导出 | 作用 |
|---|---|
| `hashFiles(entries)` | `[{path, content}]` → 按 path 排序的 `{files, rootHash}`；也接受 `{path, sha256, size}` 预计算条目。 |
| `createCard({name, version, files, createdAt})` | 生成 `testatum/v1` 未签名卡片；`createdAt` 缺省为当前时间。 |
| `signCard(card, secret \| {secret, keyId})` | 返回 `{alg:'hmac-sha256', sig, keyId?}`；不修改卡片。 |
| `attachSignature(card, signature)` | 返回带 `signature` 字段的新卡片。 |
| `verifyCard(card, secret \| {secret, revocations, files})` | 重算清单/`rootHash` 并验 HMAC，返回 `{ok, reasons[]}`；传 `files` 可同时绑定真实文件。 |
| `verifyCardIntegrity(card)` | 仅检查结构、排序、内容（若卡片内嵌 content）和 `rootHash`，不验签。 |
| `verifyFiles(card, entries)` | 对实际文件做 `hashFiles`，与卡片清单逐项比对（`file-mismatch` / `file-missing` / `file-extra`）。 |
| `revokeCard(card, {reason, revokedAt})` | 生成撤销记录；要求卡片本身结构有效。 |
| `isRevoked(card, list)` | 在撤销列表里按 `rootHash` 匹配（兼容按 name+version 的粗粒度记录）。 |
| `canonicalJson(value)` | 稳定键序 JSON 序列化。 |
| `sha256Hex(data)` | 字符串按 UTF-8、字节数组按原字节计算 SHA-256 hex。 |

### CLI

```sh
# 密钥只从环境变量读取；不要把真实密钥写进 shell 历史或提交到仓库。
export TESTATUM_KEY="$(cat /run/secrets/testatum-key)"

node src/cli.js sign card.json --out signed.json --key-id release-2026-11
node src/cli.js verify signed.json
node src/cli.js verify signed.json --json

node src/cli.js revoke signed.json --reason "signing key rotated" --out revoked.json
node src/cli.js verify signed.json --revocations revoked.json --json
```

- `sign`：读取未签名 card，拒绝 `rootHash`/清单不一致的卡片，写出附带
  `signature` 的 JSON。必须给 `--out`。
- `verify`：重算 `rootHash`、验签；可选 `--revocations <list.json>`。
- `revoke`：生成 `testatum/revocation/v1` 记录。给了 `--out` 就写文件，
  否则输出到 stdout。`TESTATUM_KEY` 存在时会先验证卡片签名；不存在时只检查
  卡片结构，并在 stderr 明确警告“撤销记录本身未认证”。
- `--json`：结构化输出；每个命令输出一个对象，至少包含
  `{ command, ok, ... }`（`sign` / `verify` / `revoke`）。
- `--help` / `-h`：完整用法；`-V` / `--version`：输出
  `testatum-attest 0.1.0` 并 exit 0。

退出码：

| 码 | 含义 |
|---|---|
| `0` | 成功 / 验证通过 |
| `1` | 业务否定：验证失败、签名不匹配、卡片无效、拒绝签名或拒绝撤销 |
| `2` | 用法 / 输入 / IO 错误：无参数、未知命令、未知选项、`sign`/`verify` 缺少 `TESTATUM_KEY`、读文件 / 写文件 / JSON 解析错误 |

环境变量：

- `TESTATUM_KEY`：共享 HMAC 密钥，`sign` / `verify` 必需；`revoke` 可选。
  **CLI 永远不会打印它的值**，也不会写进任何输出文件。
- `TESTATUM_KEY_ID`：可选默认 key id，仅作为提示记录，不是密钥，也不被验签方信任。

### 撤销记录

```json
{
  "schema": "testatum/revocation/v1",
  "name": "demo-plugin",
  "version": "1.2.3",
  "rootHash": "66789bd978f7915cd118aee915e33c6dd6463e96fdd85df89a98f40e47cc3625",
  "reason": "signing key rotated",
  "revokedAt": "2026-02-03T04:05:06.000Z"
}
```

`verify --revocations` 接受数组、`{ "revocations": [...] }`，或单条记录。
记录本身**没有签名**；撤销列表的真实性必须通过另一个可信渠道解决
（例如随 release notes 发布、由 CI 以可信身份托管）。这是 MVP 的已知缺口，
不要把它当成一个完整的撤销基础设施。

## 限制

### 1. HMAC 是 MVP 占位，不是 sigstore / npm provenance

- 共享密钥意味着**能验签的人也能伪造签名**。它证明“某个持有密钥的人
  认可了这份清单”，不能安全地证明“是哪个主体”。
- 没有公钥、OIDC 身份绑定、证书链、透明日志（Rekor）、时间戳或
  SLSA/in-toto 证明。
- **不是** sigstore/cosign 的替代品，**不是** npm provenance 的替代品，
  也**不是**“官方发布”的证明。
- 签名被截获/密钥泄漏后，攻击者可以生成任意卡片；本工具没有在线密钥状态
  可以阻止这一点。
- `keyId` 只是签名里的一个未认证提示，`verifyCard` 不校验它，也没有 keyring。

### 2. 密钥管理限制

- 密钥只通过 `TESTATUM_KEY` 环境变量传入；不支持文件、系统 keychain、KMS、
  HSM、硬件令牌、门限签名或密钥派生。
- 环境变量可能出现在 shell 历史、CI 日志、`/proc/<pid>/environ` 或子进程环境中；
  本工具只能保证**自身输出不打印**，不能保证运行环境不泄漏。
- 没有轮换工具：轮换后旧卡片必须用新密钥重签；没有密钥吊销/过期机制。
- 没有密钥长度强制；建议至少 32 字节随机值（256-bit entropy），例如
  `crypto.randomBytes(32).toString('base64url')`。密钥强度和生命周期由使用者负责。
- 验签方必须事先通过可信渠道得到同一个密钥；本工具不提供密钥分发。

### 3. 撤销限制

- 撤销记录没有签名，也没有时间新鲜度、在线查询或防重放机制；列表本身的
  完整性和分发是使用者的问题。
- `rootHash` 精确匹配某一次构建；要撤销“所有版本”需要逐条列出，或使用
  name+version 粗粒度记录（会波及同版本的其他构建，属于保守但可能过宽的行为）。
- 密钥丢失后无法撤回已经泄漏的卡片意义；撤销 ≠ 密钥作废。

### 4. 哈希与清单限制

- 只对文件字节做哈希；不覆盖文件权限、所有者、符号链接语义、mtime、
  构建环境、依赖树、传递依赖或签名者身份。
- `path` 是原始字符串，不做 Windows/Unix 路径归一化；不同路径写法会产生不同
  清单。建议统一使用 `/` 分隔的相对路径。
- 卡片不嵌入文件内容；`verifyCard` 默认只证明“卡片自身一致且签名有效”，
  **不会去读插件目录**。要证明实际文件与卡片一致，必须用
  `verifyFiles(card, entries)` 或 `verifyCard(card, { secret, files: entries })`。
  CLI 的 `verify` 只验证卡片 JSON，不读取插件文件。
- 验证者必须自己拿到原始文件或在可信渠道拿到清单。从“计算哈希”到“真正加载
  文件”之间仍存在 TOCTOU 风险。
- SHA-256 的碰撞抗性是本工具的安全假设；本工具不解包、不扫描、不判断
  文件是否恶意。
- 空文件合法（`size: 0`）；空文件列表的 `rootHash` 是 `sha256("[]")`。

### 5. 非目标

不是包注册表、不是沙箱、不是恶意软件扫描器、不是构建可复现性工具、不是
法律意义上的签名/公证，也不提供任何形式的担保。

## 命名核验

核验日期：**2026-11-14**。核验目的是避免与已发布包/项目重名，不是商标检索。

| 检查 | 结果 |
|---|---|
| npm registry：`https://registry.npmjs.org/testatum-attest` | HTTP **404**，`{"error":"Not found"}` |
| npm registry：`https://registry.npmjs.org/testatum` | HTTP **404**，`{"error":"Not found"}` |
| npm search API：`https://registry.npmjs.org/-/v1/search?text=testatum&size=20` | `total: 0`，无同名包 |
| GitHub repo search：`https://api.github.com/search/repositories?q=testatum-attest+in:name` | `total_count: 0` |

结论与边界：

- 以上只说明 2026-11-14 当时**未查到同名 npm 包或 GitHub 仓库**，不保证未来不被占用。
  发布前应重新执行上述查询，并额外做商标/法务检索。
- `testatum` 是拉丁语/英美法律文书中的既有词（attestation clause 等），
  本包把 `testatum` 与 `attest` 组合成工具名，不主张对该词的所有权。
- 本工具名为 `testatum-attest`，与 DeepSeek、DSH、npm、sigstore、OpenSSF
  均无隶属或背书关系。

## 非官方声明

本项目是社区项目，**不是 DeepSeek 官方项目，也不是 DeepSeek Harness 官方组件**；
未获 DeepSeek 或任何其他组织的认可或背书。项目中的观点、实现和缺陷由社区
维护者负责，不代表任何官方立场。

### 开发与测试

```sh
node --test test/*.test.js
node --check src/core.js
node --check src/cli.js
node src/cli.js --help
```

测试全部离线运行，不读取真实密钥，不访问网络；CLI 测试使用临时目录和注入的
测试密钥。

## 许可证

Apache License 2.0，见 [LICENSE](./LICENSE)。按“现状”提供，不附带任何明示或
默示担保。
