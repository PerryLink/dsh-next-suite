# testatum 从 HMAC 升级到 Sigstore：可行性与分阶段方案

> 结论先行：**不做“整体替换”，做“分阶段叠加”**。
> `testatum-attest` 的默认路径仍是 HMAC（零依赖、离线、确定性）；
> Sigstore 只作为**可选、按次启用**的密码学验签层，且必须显式钉住
> Fulcio 身份（issuer + SAN），否则“验签通过”并不证明是谁签的。
>
> 本文件记录 2026-11-15 的调研与实测。被测版本：`sigstore@5.0.1`、
> Node `24.22.1`、npm `11.19.1`；真实样本为
> `registry.npmjs.org` 上 `sigstore@5.0.1` 的 npm provenance bundle。

---

## 1. 结论（TL;DR）

| 问题 | 结论 |
|---|---|
| 能不能做？ | **能**，`sigstore.verify` 可以直接验 npm provenance 的 DSSE bundle；已用真实 bundle 跑通。 |
| 要不要现在做？ | **分阶段**：先做库级 opt-in，不接 CLI、不改默认行为；CLI 放到下一阶段。 |
| 能不能完全替代 HMAC？ | **不能，也不应该**。Sigstore 只覆盖“有 provenance 的 npm 包”，且需要 OIDC/Fulcio/TUF；HMAC 仍覆盖私有插件、本地产物、离线场景。 |
| `npm audit signatures` 包装？ | **不做**。它是“已安装依赖树”的审计器，不验单个 bundle，且**不校验签名者身份**，无法满足“这个包由该仓库的该 workflow 发布”的问题。 |
| 依赖代价 | `sigstore@5.0.1` 装完 **54 个包、约 14 MB**；Node 要求 `^22.22.2 || ^24.15.0 || >=26`，高于本包当前的 `^22.19.0 || >=24.9.0`。 |
| 离线可用？ | 密码学验证本身可离线；但 `sigstore.verify` **每次都走 TUF**。只有“预热缓存 + 未过期 + `tufForceCache: true`”才能离线；冷缓存/缓存过期必须联网。 |
| 最小可做版本 | `src/sigstore.js`：动态 `import('sigstore')`、`verifyBundle(bundle, {identity, issuer,...})`、`verifyNpmAttestation(document, ...)`、fail-closed 身份策略、mock 单测。**不改 `provenance.js`、不改默认 CLI 行为。** |

---

## 2. `sigstore@5.0.1` 的 API 事实

### 2.1 函数签名

官方 README 写的是：

```js
verify(bundle[, payload][, options])
```

- `bundle`：JSON 形式的 Sigstore bundle（`SerializedBundle`）。
- `payload`：**仅 `messageSignature` bundle 需要**（`Buffer`）；DSSE bundle
  不需要，因为 payload 在 bundle 里。
- `options`：身份、阈值、TUF 等。

所以任务里写的两参数形式：

```js
await sigstore.verify(bundle, {
  certificateIdentityEmail: '...',
  certificateIssuer: '...',
  ctLogThreshold: 1,
  tlogThreshold: 1,
})
```

是**合法**的：源码用 `Buffer.isBuffer(dataOrOptions)` 判断第二个参数是
payload 还是 options（见 `packages/client/src/sigstore.ts`）。完整签名仍建议
按官方文档理解，避免把 `Buffer` 误传成 options。

### 2.2 `VerifyOptions` 的实际字段

官方 README 列出的字段：

| 字段 | 含义 |
|---|---|
| `certificateIdentityEmail` | 期望的 SAN **邮箱**；按**正则**匹配，不是 glob；精确匹配要自己加 `^...$`。与 `certificateIssuer` 一起用；若同时给 URI，email **优先**。 |
| `certificateIdentityURI` | 期望的 SAN **URI**；同样是正则；与 `certificateIssuer` 一起用。GitHub Actions / GitLab CI 的 npm provenance 用这个。 |
| `certificateIssuer` | 证书 issuer 扩展（OID 1.3.6.1.4.1.57264.1.1）必须**精确等于**该值。 |
| `certificateOIDs` | 额外的证书 OID/值对；本方案不需要。 |
| `ctLogThreshold` | 签名证书必须出现在多少个 CT log 上；默认 **1**。 |
| `tlogThreshold` | 签名必须出现在多少个 Rekor 透明日志上；默认 **1**。 |
| `keySelector` | 非 Fulcio（keyed）bundle 用；npm provenance 不需要。 |

README 未列、但 5.0.1 的 `VerifyOptions` 源码里确实存在、且 `verify()` 会传给
`@sigstore/tuf` 的 TUF 选项：

| 字段 | 含义 |
|---|---|
| `tufCachePath` | TUF 缓存目录；默认在平台应用数据目录下的 `sigstore-js`（Linux `$XDG_DATA_HOME/sigstore-js` 或 `~/.local/share/sigstore-js`；Windows `%LOCALAPPDATA%\sigstore-js\Data`；macOS `~/Library/Application Support/sigstore-js`）。 |
| `tufRootPath` | 初始 TUF root（`root.json`）路径；默认用包里内嵌的 public-good root。 |
| `tufMirrorURL` | TUF 仓库地址；默认 `https://tuf-repo-cdn.sigstore.dev`。 |
| `tufForceCache` | 为 `true` 时，**只要缓存元数据未过期**就不下载；这是离线验证的关键开关。 |
| `retry` / `timeout` | 传给 TUF/HTTP 的重试与超时；默认 `{ retries: 2 }`、`5000ms`。 |

### 2.3 Bundle 格式

一个 bundle 是 JSON，核心结构：

```json
{
  "mediaType": "application/vnd.dev.sigstore.bundle.v0.3+json",
  "verificationMaterial": {
    "certificate": { "rawBytes": "<base64 DER>" },
    "tlogEntries": [ { "logIndex": "...", "logId": {...}, "kindVersion": {...},
                       "integratedTime": "...", "inclusionPromise": {...},
                       "inclusionProof": {...}, "canonicalizedBody": "..." } ],
    "timestampVerificationData": { "rfc3161Timestamps": [] }
  },
  "dsseEnvelope": {
    "payloadType": "application/vnd.in-toto+json",
    "payload": "<base64 in-toto statement>",
    "signatures": [ { "sig": "<base64>", "keyid": "" } ]
  }
}
```

要点：

- 版本：`0.1`、`0.2`、`0.3` 都有支持；本次 npm 样本发的是
  `application/vnd.dev.sigstore.bundle.v0.3+json`，用**单张证书**
  （`verificationMaterial.certificate`），不是证书链。
- `dsseEnvelope` 用于 attestation；`messageSignature` 用于对 artifact 的
  普通签名，验证时必须另给 `payload`（原始字节），因为 bundle 里只有
  `messageDigest`。
- npm attestation 端点返回的是：
  `{ "attestations": [ { "predicateType": "...", "bundle": { ... } } ] }`。
  要验的是 `entry.bundle`，**不是整个 attestation 文档**。
- npm registry 的 `dist.signatures`（registry signature）**不是** Sigstore
  bundle，而是 registry 自己的 ECDSA 密钥签名；`sigstore.verify` 不处理它。
- 实测的真实 npm bundle：1 个 `tlogEntries`（`kind: dsse`，同时有
  `inclusionPromise` 和 `inclusionProof`）、0 个 RFC3161 timestamp、DSSE
  单签名。默认 `tlogThreshold=1` / `ctLogThreshold=1` 刚好满足；
  **把阈值改成 2 会失败**（实测 `TLOG_ERROR` / `CERTIFICATE_ERROR`）。

---

## 3. 联网、TUF 与 Rekor：到底必须联网吗？

### 3.1 验证时会发生什么

`sigstore.verify` 的实际调用链（5.0.1 源码）：

```js
const trustedRoot = await tuf.getTrustedRoot({
  mirrorURL: options.tufMirrorURL,
  rootPath: options.tufRootPath,
  cachePath: options.tufCachePath,
  forceCache: options.tufForceCache,
  retry: options.retry ?? DEFAULT_RETRY,
  timeout: options.timeout ?? DEFAULT_TIMEOUT,
})
const trustMaterial = toTrustMaterial(trustedRoot, keyFinder)
const verifier = new Verifier(trustMaterial, { ctlogThreshold, tlogThreshold })
```

因此：

- **TUF 是唯一默认的联网点**。每次 `verify()` 都调用 `getTrustedRoot`；
  它会读缓存/刷新 TUF 元数据，拉 `trusted_root.json`。
- **Rekor 不联网**：bundle 自带 inclusion promise / inclusion proof，
  `@sigstore/verify` 用 TUF 里的 Rekor 公钥在本地验。
- **Fulcio 不联网**：证书和链在 bundle/trusted root 里。
- **CT log 不联网**：SCT 在证书里，CT log 公钥在 trusted root 里。
- 结论：**密码学验证离线可行，TUF 信任根获取是联网点**。这也解释了为什么
  `sigstore.verify` 没有“直接传 trusted_root.json”的选项——要真正离线，
  要么预热缓存，要么绕过 `sigstore` 直接用 `@sigstore/verify`。

### 3.2 实测：冷缓存、热缓存、断网

2026-11-15，用 `sigstore@5.0.1` + 真实 `sigstore@5.0.1` npm provenance bundle：

| 场景 | 结果 |
|---|---|
| 冷缓存（默认 TUF） | 通过；约 **3.9s**，生成约 **48 KB** 缓存（root/timestamp/snapshot/targets + `trusted_root.json`）。 |
| 热缓存 + `tufForceCache: true` | 通过；约 **13–31ms**，无网络请求。 |
| 热缓存 + `tufForceCache: true` + 把 `tufMirrorURL` 指向不可达的 `127.0.0.1:9` | **仍通过**（31ms）——证明确实可以离线。 |
| **冷**缓存 + `tufForceCache: true`（无本地缓存） | 仍会下载并填充缓存（约 1.06s）；`forceCache` 不能凭空变出信任根。 |
| TUF 元数据过期（timestamp 过期）且无网络 | 会尝试刷新；离线失败。实测缓存里 `timestamp.json` 的 `expires` 是 **2026-11-22**（调研日 2026-11-15，约 7 天）；root 到 2027-04-22，snapshot/targets 更久。**不要把 7 天当保证**，它是 TUF 元数据的新鲜度。 |

可操作结论：

- 如果测试/CI 要离线：**先在线跑一次**把 TUF 缓存预热到指定
  `tufCachePath`，之后用 `tufForceCache: true`；缓存过期前必须再联网刷新。
- 如果要求“发布后任意时间、任意机器可离线验证”：`sigstore.verify` 不够，
  需要 `@sigstore/verify` + 自带/固定 `trusted_root.json`（并自行承担信任根
  更新与过期策略），成本明显更高。
- 不要把 `tufForceCache: true` 当成“安全离线模式”的充分条件：冷缓存会下载，
  过期缓存会刷新；它只是“缓存可用时别联网”。

---

## 4. 两条路线评估

### 路线 ①：`sigstore.verify` 直接验 bundle（推荐）

**做法**：从 npm attestation 文档里选 SLSA/provenance 条目，把
`entry.bundle` 交给 `sigstore.verify`，同时给
`certificateIdentityURI` / `certificateIssuer`（或 email/issuer）和
`tufCachePath`。

**优点**

- 真正验证 DSSE 签名、Fulcio 证书链、SCT、Rekor inclusion、时间戳。
- 可精确钉住“哪个仓库的哪个 workflow”；这是 `npm audit signatures`
  给不了的。
- 单 bundle、纯函数式输入；适合做库 API / `--sigstore` 开关。
- 已有真实 bundle 跑通；错误码清晰（`PolicyError` / `VerificationError` /
  `TUFError`）。

**缺点/坑**

- `sigstore` 是可选依赖；没装时要给出明确错误，而不是让默认路径崩。
- TUF 是联网点；离线要预热缓存/固定信任根。
- **必须钉身份**：不传身份时 `sigstore.verify` 只证明“某个 Fulcio 身份签了”，
  不证明“期望的仓库/ workflow 签了”。本方案的封装默认 fail closed。
- 邮箱身份对 CI 不适用：GitHub Actions 的 npm provenance SAN 是
  `https://github.com/OWNER/REPO/.github/workflows/WORKFLOW.yml@refs/...`，
  不是邮箱。实测用 `certificateIdentityEmail` 会得到
  `PolicyError: UNTRUSTED_SIGNER_ERROR`。
- 阈值不要乱调高：本次 npm 样本只有 1 个 tlog / 1 个 SCT；`2` 会失败。
- `sigstore.verify` 不校验 subject 与 tarball 的绑定；必须继续用
  `verifyProvenance` 检查 subject SHA-512 / repo / commit，否则“签名有效”
  可能是另一个 artifact 的 bundle。

**结论**：**这是唯一值得做的核心路线**，但要包一层“身份必填 + 错误映射 +
可选依赖”的适配器。

### 路线 ②：包装 `npm audit signatures`

**它做什么**（npm 11.19.1 实测 + 源码）：

- 针对**已安装依赖树**（`node_modules` + lockfile），不是单个 bundle；
  全局包不支持。
- 验证 registry signature（`dist.signatures`，registry 自己的 ECDSA key），
  以及 provenance attestation（`sigstore.verify`）。
- 会把 attestation 的 subject PURL 与 tarball integrity 绑定
  （`EATTESTATIONSUBJECT`），验证失败报 `EATTESTATIONVERIFY`。
- 默认输出计数；`--json` 是 `{ invalid, missing }`；
  `--json --include-attestations` 才附完整 bundle。
- 没有 attestation 的包也能通过（它只在 registry 提供签名 key 时要求
  registry signature；没有 provenance 不算失败）。

**它不做什么**（关键）：

- **不钉身份**。npm 的 pacote 调用只传
  `{ tufCachePath, tufForceCache: true, keySelector }`，没有
  `certificateIdentityURI` / `certificateIdentityEmail` /
  `certificateIssuer`。所以它能证明“某个 Fulcio 身份签了”，不能证明
  “`PerryLink/dsh-next-suite` 的 release workflow 签了”。
- 不校验 repo / commit / buildType；只做 PURL + tarball 摘要绑定。
- 不是“验一个 bundle”的 API：要先把包装出来，依赖 lockfile 和安装树。
- 默认 JSON 不返回每个包的逐条 verdict（除非 `--include-attestations`），
  不适合作为 `verify-provenance` 的机器可读结果。
- 在线：启动时 `initTUF`，每个包 `pacote.manifest`；没有文档化的离线模式。
- 版本漂移：npm 11.19.1 内置的是 **sigstore 4.1.1**，不是 5.0.1；行为随
  npm 版本变化，CI 结果可能和本地不一致。
- 慢：实测 54 个包约 2s（热缓存），首次约 5.6s；不适合每次验单卡。

**结论**：**不做包装**。它可以作为 CI 的“已安装依赖树”补充检查，但不能
替代本工具的 per-bundle 身份策略；把 npm CLI 当库用还会引入版本/输出/
退出码耦合。

---

## 5. 依赖、体积、离线、测试夹具、失败模式

### 5.1 依赖与体积（实测）

| 项 | 数值 |
|---|---|
| `sigstore@5.0.1` tarball | 10,563 B |
| `sigstore@5.0.1` unpacked | 38,468 B |
| 完整安装 | `npm install sigstore@5.0.1` → **54 个包**，`node_modules` 约 **14 MB** |
| 直接依赖 | `@sigstore/tuf`、`@sigstore/core`、`@sigstore/sign`、`@sigstore/bundle`、`@sigstore/verify`、`@sigstore/protobuf-specs` |
| 传递依赖 | `tuf-js`、`@tufjs/*`、`make-fetch-happen`、`@npmcli/*`、`minimatch`、`glob`、`lru-cache` 等 |
| install script | 实测安装树中 **没有** `preinstall`/`install`/`postinstall` 脚本 |
| 许可证 | MIT / ISC / Apache-2.0 / BSD-2-Clause / BlueOak-1.0.0（均为宽松许可；发布前仍应做法务复核） |
| Node engines | `^22.22.2 || ^24.15.0 || >=26.0.0`；本包当前 `^22.19.0 || >=24.9.0` → **不兼容区间存在** |

对本项目意味着：

- `testatum-attest` 目前是**零运行时依赖**；把 `sigstore` 放进
  `dependencies` 会让安装体积从“几乎为零”变成 ~14 MB，并扩大供应链面。
- 正确做法是 **optional peer dependency + 动态 import**：
  不装也能用 HMAC；装了才启用 `--sigstore`/`verifyBundle`。
- 但 optional peer 仍需要用户 Node 版本满足要求；在 Node 22.19–22.22.1、
  24.9–24.14、以及 25.x 上会装不上/跑不了。要么在文档里写清，要么下一阶段
  考虑用更老的 sigstore 4.x（API 类似但同样有 TUF/依赖成本），或提升 engines
  并接受 breaking change。

### 5.2 测试夹具

- **单元测试**：用注入的 `importer` 返回 mock `{ verify }`，完全离线；
  本仓库新增的 13 个测试即此模式，`node --test` 约 96ms。
- **集成测试（不建议放进默认 `npm test`）**：
  - 真实 bundle 可以从 `https://registry.npmjs.org/-/npm/v1/attestations/<pkg>@<version>`
    抓取（公开数据，不含私钥）；但 TUF 信任根会过期/轮换。
  - 冷缓存会联网；热缓存需要把 ~48 KB 的 TUF 缓存作为 fixture 提交，
    且 `timestamp.json` 约 7 天过期——**不适合作为长期 CI 夹具**。
  - 更稳的做法：本地 TUF mirror + 固定 root，或只用 mock 单测 + 定期人工
    集成测试。
- 如果一定要提交真实 bundle，注意它包含证书、Rekor 条目、payload；这些是
  公开信息，但仍应避免把测试与某个具体 registry 账号绑定。

### 5.3 失败模式（封装层稳定 reason code）

| reason | 触发 | 是否基础设施错误 |
|---|---|---|
| `sigstore-not-installed`（抛 `SigstoreUnavailableError`） | 没装 `sigstore`，动态 import 失败 | 是（CLI 建议 exit 2） |
| `identity-required` | 没给 `certificateIdentityURI` / `certificateIdentityEmail`，且没开 `allowUnpinnedIdentity` | 否（策略拒绝） |
| `issuer-required` | 给了身份但没给 `certificateIssuer` | 否 |
| `identity-mismatch` | `PolicyError` / `UNTRUSTED_SIGNER_ERROR`：SAN 或 issuer 不匹配 | 否 |
| `signature-invalid` | DSSE/message 签名不对 | 否 |
| `certificate-invalid` | 证书链/有效期/SCT/`ctLogThreshold` 失败 | 否 |
| `tlog-invalid` | Rekor inclusion/body/`tlogThreshold` 失败 | 否 |
| `timestamp-invalid` | RFC3161 或 tlog 时间戳失败 | 否 |
| `bundle-invalid` | `ValidationError`：bundle 结构不合法 | 否 |
| `bundle-media-type-unsupported` | 不是 Sigstore bundle media type | 否 |
| `bundle-verification-material-missing` | 缺 `verificationMaterial` | 否 |
| `bundle-content-missing` | 既无 `dsseEnvelope` 也无 `messageSignature` | 否 |
| `bundle-payload-missing` | DSSE payload 为空 | 否 |
| `bundle-signature-missing` | 没有签名/签名数为 0 或 >1 | 否 |
| `payload-required` | `messageSignature` bundle 没给 `Buffer` payload | 否 |
| `tuf-error` | `TUFError` / `TUF_*`：TUF 刷新、缓存、目标读取失败 | 是（exit 2） |
| `sigstore-error` | 其他未分类错误 | 是（保守 exit 2） |
| `no-provenance-bundle` | attestation 文档里没有带 bundle 的 SLSA/provenance 条目 | 否 |
| `artifact-binding-not-checked`（warning） | 只验了 bundle，没验 subject/tarball/repo/commit | 不是失败，但必须配合 `verifyProvenance` |

还有一些“不是错误但会被误解”的情况：

- `tlogThreshold: 0` / `ctLogThreshold: 0` 会**关闭**对应检查；封装会警告
  `threshold-zero-disables-check`。
- 同时给 email 和 URI：`sigstore` 会优先 email；封装会警告
  `identity-email-takes-precedence`。
- `allowUnpinnedIdentity: true` 会通过，但只是“某个 Fulcio 身份签了”；
  封装会警告 `identity-not-pinned`。
- Sigstore 验证**不检查**：证书吊销/CRL/OCSP、包是否恶意、版本是否最新、
  是否回滚、subject 是否等于你要的 tarball、repo/commit 是否匹配、
  registry 是否被 MITM。这些要么由 `verifyProvenance` 做，要么明确不做。

---

## 6. 需要什么身份（Fulcio OIDC）

Sigstore keyless 签名时，Fulcio 用 OIDC token 签发**短生命周期证书**，身份放在
证书 SAN 里；验证方必须提供“期望的 SAN + issuer”，否则只能证明
“某个 Fulcio 身份签了”。

### 6.1 CI / npm provenance（最常见）

| 场景 | `certificateIssuer` | 期望的 SAN（用 `certificateIdentityURI` 或 `certificateIdentityEmail` 传入） |
|---|---|---|
| GitHub Actions | `https://token.actions.githubusercontent.com` | `https://github.com/OWNER/REPO/.github/workflows/WORKFLOW.yml@refs/heads/BRANCH`（或 `@refs/tags/v1.2.3`） |
| GitLab CI | `https://gitlab.com` | `https://gitlab.com/PROJECT_PATH//CI_CONFIG_PATH@REF_PATH` |
| Google（交互式） | `https://accounts.google.com` | 邮箱，如 `user@example.com` |
| Microsoft（交互式） | `https://login.microsoftonline.com` | 邮箱 |

交互式登录（Dex/Google/Microsoft）的 issuer 由 Fulcio/Dex 配置决定，不要照抄
CI 的 issuer；上表 CI 两行是 npm provenance 最常用的组合。

注意：

- **npm provenance 的 GitHub Actions 身份是 URI，不是邮箱**。实测
  `certificateIdentityEmail` 对 npm 的真实 bundle 会失败；必须用
  `certificateIdentityURI`。
- issuer 是**字符串精确相等**；SAN 是**正则**匹配（不是 glob，也不是字符串相等）。
  写 GitHub Actions 身份时对 `https://`、`/`、`.`、`@` 做转义，或至少
  加 `^...$` 锚定，避免子串误匹配。
- GitHub Actions 需要 `permissions: id-token: write`；GitLab 需要
  `id_tokens: SIGSTORE_ID_TOKEN: aud: sigstore`。npm 的
  `npm publish --provenance` 只在受支持的 CI 中生成 attestation。
- 身份不是“包名”或“npm 用户名”；它是**构建该包的 CI workflow/仓库/ref**。

### 6.2 示例（GitHub Actions）

```js
const verdict = await verifyNpmAttestation(document, {
  certificateIdentityURI:
    '^https://github\\.com/PerryLink/dsh-next-suite/\\.github/workflows/release\\.yml@refs/tags/v0\\.2\\.1$',
  certificateIssuer: 'https://token.actions.githubusercontent.com',
  tufCachePath: '/var/cache/sigstore-js', // 可选；预热后可配合 tufForceCache
  tufForceCache: true,
})
```

如果 workflow 文件名/分支/tag 变了，这个正则必须同步更新；否则会得到
`identity-mismatch`。这不是 bug，而是策略。

---

## 7. 为什么 HMAC 仍是默认

1. **覆盖面**：Sigstore 只能验“有 npm provenance bundle 的包”。私有插件、
   本地构建、非 npm 产物、未开 provenance 的包都没有 bundle；HMAC 仍覆盖
   这些场景。
2. **零依赖/离线/确定性**：HMAC 只用 `node:crypto`，不联网、不读 TUF、
   不需要 OIDC，`node --test` 即可跑；对插件加载这种高频、离线、确定性
   场景更合适。
3. **威胁模型不同**：HMAC 证明“持有共享密钥的人认可这份清单”，不证明
   “是谁”；Sigstore 证明“某个 Fulcio 身份签了”。前者适合私有分发，
   后者适合公开发布；两者不是替代关系，而是叠加关系。
4. **成本**：14 MB / 54 个包、Node 版本上移、TUF 联网/缓存新鲜度、身份
   正则维护、bundle 版本兼容——这些不该强加给所有用户。
5. **假安全感**：如果只调 `sigstore.verify(bundle)` 不钉身份，任何有效
   Fulcio 签名都能过；这比“明确说 HMAC 是 MVP”更危险。默认路径必须
   fail closed，且必须把“未绑定 subject/repo/commit”讲清楚。
6. **现有结构检查仍然必要**：`verifyProvenance` 的 subject SHA-512、
   repo、commit 匹配是“artifact 绑定”；Sigstore 只保证“bundle 本身没被
   篡改”。两者缺一不可。

---

## 8. 分阶段方案与最小版本

### Phase 0（本次，已完成）

- 新增 `docs/sigstore.md`（本文）。
- 新增 `packages/testatum-attest/src/sigstore.js`：
  - 动态 `import('sigstore')`，不把它变成硬依赖；
  - `selectProvenanceBundle(document, { predicateType })`；
  - `verifyBundle(bundle, options)`：身份必填、issuer 必填、阈值/TUF 选项、
    错误映射、`SigstoreUnavailableError`；
  - `verifyNpmAttestation(document, options)`：选 bundle + 验签，并明确警告
    `artifact-binding-not-checked`。
- 新增 `packages/testatum-attest/test/sigstore.test.js`：mock importer +
  mock bundle，**不联网**；13 个用例。
- **不改** `provenance.js`、`core.js`、`cli.js` 的现有行为；默认 `npm test`
  不受影响（新测试只在 `test/sigstore.test.js`，由现有 `test/*.test.js`
  脚本自动纳入）。

**为什么本次没接 CLI**：任务的文件边界是“只写 docs + 可选 `src/sigstore.js`”，
而 `verify-provenance` 当前拿不到 raw bundle（`fetchAttestation` 只返回解码后的
subject/predicate）。要加 `--sigstore`，必须先做下面 Phase 1 的 bundle 透出；
否则只能偷偷改 `provenance.js` 或重复请求。为了不越界、也不改变默认行为，
本次只落库级验证器；CLI 接线放在下一阶段。

### Phase 1（下一阶段，建议）

1. `package.json`：
   - `peerDependencies: { "sigstore": "^5.0.1" }`
   - `peerDependenciesMeta: { "sigstore": { "optional": true } }`
   - `exports` 增加 `./sigstore`
   - 文档写清 Node engines 差异；是否提升 engines 需要维护者决定。
2. CLI：`verify-provenance ... --sigstore`
   - 需要把 raw bundle 暴露给验签层。当前 `fetchAttestation` 只返回解码后的
     subject/predicate，**不返回 bundle**；两条路：
     a. 在 `sigstore.js` 里按 `result.attestation.url` 再取一次 attestation
        JSON（不改 `provenance.js`，但多一次 GET）；
     b. 给 `fetchAttestation` 增加一个**可选** `bundle` 字段（additive，
        但要改 `provenance.js`，本次按约束不做）。
   - 推荐 a：`fetchAttestationDocument(url, { fetchImpl })` 放进
     `sigstore.js`，CLI 用 `result.attestation.url` 调它。
3. CLI 参数（建议）：
   ```sh
   testatum-attest verify-provenance pkg@1.2.3 --sigstore \
     --certificate-identity-uri '^https://github\.com/OWNER/REPO/\.github/workflows/release\.yml@refs/tags/v1\.2\.3$' \
     --certificate-issuer https://token.actions.githubusercontent.com \
     --tuf-cache ~/.cache/sigstore-js --tuf-force-cache
   ```
   - 不给身份/issuer → exit 2（策略配置错误）；
   - 签名/身份失败 → exit 1；
   - TUF/未安装 → exit 2；
   - 默认（不带 `--sigstore`）输出与退出码完全不变。
4. 集成测试：至少一个真实 bundle + 热 TUF 缓存的 nightly job；默认单测继续
   用 mock，避免 7 天过期的 timestamp 污染 CI。

### Phase 2（可选，真离线/私有部署）

- 如果要求“任意机器、离线、长期可验”：不要用 `sigstore.verify` 的 TUF 路径，
  改用 `@sigstore/verify` + `@sigstore/bundle` + 固定/自管的
  `trusted_root.json`；自行负责信任根轮换与过期。
- 如果只要求 CI 离线：预热 `tufCachePath` + `tufForceCache: true` 即可；
  在缓存过期前刷新。

### 最小可做版本（MVP）

```js
// 本阶段是源码内导入；Phase 1 再加 package.json 的 exports "./sigstore"
import { verifyNpmAttestation } from './src/sigstore.js'

const document = await (await fetch(attestationUrl)).json()
const verdict = await verifyNpmAttestation(document, {
  certificateIdentityURI: '^https://github\\.com/OWNER/REPO/\\.github/workflows/release\\.yml@refs/tags/v1\\.2\\.3$',
  certificateIssuer: 'https://token.actions.githubusercontent.com',
  tufCachePath: process.env.SIGSTORE_TUF_CACHE,
  tufForceCache: true,
})

if (!verdict.ok) {
  console.error(verdict.reasons, verdict.error)
  process.exit(verdict.fatal ? 2 : 1)
}
// 关键：还要用 provenance.js 的 verifyProvenance 绑定 subject / repo / commit
```

**MVP 的边界**：验 bundle + 钉身份 + 错误分类；不 fetch registry、不检查
subject/tarball、不做撤销/新鲜度、不保证离线（除非缓存预热）。这就是
“可做的最小版本”，也是本阶段实际落地的代码。

---

## 9. 实测记录（可复现）

环境：Node `v24.22.1`，npm `11.19.1`，`sigstore@5.0.1`，2026-11-15。

```sh
# 1) 真实 npm provenance bundle
curl -sS https://registry.npmjs.org/-/npm/v1/attestations/sigstore@5.0.1 -o att.json

# 2) 直接验签（热缓存 + forceCache）
node --input-type=module -e '
import fs from "node:fs";
import { verify } from "sigstore";
const doc = JSON.parse(fs.readFileSync("att.json", "utf8"));
const b = doc.attestations.find(a => /slsa/.test(a.predicateType)).bundle;
console.log(await verify(b, {
  tufCachePath: "/tmp/sigstore-tuf-cache",
  tufForceCache: true,
  certificateIdentityURI: "^https://github\\.com/sigstore/sigstore-js/\\.github/workflows/release\\.yml@refs/heads/main$",
  certificateIssuer: "https://token.actions.githubusercontent.com",
}));
'
# => 通过，identity SAN = https://github.com/sigstore/sigstore-js/.github/workflows/release.yml@refs/heads/main

# 3) 反例
#    certificateIdentityEmail: "nobody@example.com"
#      => PolicyError / UNTRUSTED_SIGNER_ERROR
#    tlogThreshold: 2          => VerificationError / TLOG_ERROR
#    ctLogThreshold: 2         => VerificationError / CERTIFICATE_ERROR
#    TUF 冷缓存或缓存过期 + 离线 => TUFError（需要先预热缓存）

# 4) npm audit signatures（对比路线 ②）
npm audit signatures --registry=https://registry.npmjs.org
# => audited 54 packages in 2s
#    54 packages have verified registry signatures
#    28 packages have verified attestations
npm audit signatures --json --include-attestations
# => { invalid: [], missing: [], verified: [ { name, version, attestationBundles, ... } ] }
```

关键观察：

- 真实 bundle 的 `mediaType` 是
  `application/vnd.dev.sigstore.bundle.v0.3+json`；`verificationMaterial`
  只有单证书 + 1 个 tlog entry + 0 个 RFC3161 timestamp。
- `sigstore.verify` 的 TUF 冷启动约 3.9s；热缓存 + `tufForceCache` 约
  13–31ms；TUF 缓存约 48 KB。
- npm 11.19.1 内置 `sigstore@4.1.1`，不是 5.0.1；`npm audit signatures`
  不传身份选项，因此不能替代 per-bundle 身份策略。

---

## 10. 参考来源

- `sigstore` npm 包与 README（`verify(bundle[, payload][, options])`、身份/阈值选项）：
  <https://www.npmjs.com/package/sigstore> ·
  <https://github.com/sigstore/sigstore-js/tree/main/packages/client#readme>
- 5.0.1 的 `VerifyOptions` / TUF 选项源码：
  <https://github.com/sigstore/sigstore-js/blob/main/packages/client/src/config.ts> ·
  <https://github.com/sigstore/sigstore-js/blob/main/packages/client/src/sigstore.ts>
- Sigstore bundle 格式（v0.1/v0.2/v0.3、verification material、DSSE）：
  <https://docs.sigstore.dev/about/bundle/>
- Fulcio OIDC 身份（GitHub Actions / GitLab / email）：
  <https://docs.sigstore.dev/certificate_authority/oidc-in-fulcio/> ·
  <https://docs.sigstore.dev/quickstart/verification-cheat-sheet/>
- TUF / 信任根：
  <https://theupdateframework.io/> ·
  <https://tuf-repo-cdn.sigstore.dev>
- npm audit signatures 文档：
  <https://docs.npmjs.com/cli/v11/commands/npm-audit#audit-signatures>
- npm provenance 文档：
  <https://docs.npmjs.com/generating-provenance-statements>
- npm attestation 规范：
  <https://github.com/npm/attestation/tree/main/specs/publish/v0.1>

---

## 11. 一句话回答“做/不做/分阶段”

**分阶段做**：现在只做“可选库 + mock 测试 + 文档”，默认 HMAC 不变；
下一阶段再接 CLI 和 optional peer。不要把 `sigstore` 变成硬依赖，不要用
`npm audit signatures` 包装替代身份策略，也不要在没有钉住 Fulcio
issuer/SAN 的情况下把“验签通过”当成“发布者可信”。
