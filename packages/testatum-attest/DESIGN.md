# DESIGN — testatum-attest

> 状态：`0.1.0` MVP，未发布。**HMAC-SHA256 是占位签名方案，不是 sigstore /
> npm provenance 的替代品。** 本文说明它是怎么工作的、能防什么、不能防什么，
> 避免把“能验签”误读成“已建立供应链身份信任”。

## 1. 问题与范围

目标是给单个插件产物提供一份可离线核对的 trust card：

1. 把产物文件映射为一份稳定的 SHA-256 清单；
2. 对清单和卡片元数据做 HMAC-SHA256 签名；
3. 验证时重算 `rootHash`、检查签名、可选检查撤销列表和实际文件；
4. 用普通 JSON 保存，便于附带在 release 附件、CI artifact 或仓库中；
5. 可选读取 npm provenance attestation，结构性地比对 subject 摘要与
   repo/commit（不做 sigstore 验签；见 README「限制 §6」）。

范围仅限上述五项。它不解决包管理、依赖解析、构建可复现性或发布身份。

## 2. 非目标

- 不是 sigstore/cosign、npm provenance、SLSA、in-toto 的实现或替代
  （`verify-provenance` 只做 attestation 元数据匹配，不做密码学验签）；
- 不是公钥基础设施、证书链、透明日志、时间戳服务；
- 不是沙箱、杀毒软件、依赖漏洞扫描器；
- 不是包注册表或签名服务；
- 不提供法律意义上的签名、公证或不可否认性。

## 3. 威胁模型

| 场景 | 是否处理 | 说明 |
|---|---|---|
| 卡片里的文件摘要、路径、`size` 被改 | ✅ | `rootHash` 不匹配；签名也不匹配。 |
| 卡片顶层字段（name/version/createdAt/schema）被改 | ✅ | HMAC 覆盖除 `signature` 外的所有字段。 |
| 实际插件文件被改、卡片未变 | ✅（显式调用 `verifyFiles`） | 仅 `verifyCard` 不会读磁盘，必须传 `files` 或调用 `verifyFiles`。 |
| 用另一把密钥重新签名 | ✅（当验证方持有正确密钥） | HMAC 不匹配。 |
| 攻击者拿到共享密钥 | ❌ | 可以伪造任意卡片；HMAC 没有身份隔离。 |
| 重放/降级到旧版本卡片 | ❌ | 没有时间戳、单调版本、在线新鲜度检查；由调用方做版本策略。 |
| 撤销列表被篡改 | ❌ | 撤销记录本身未签名，列表真实性依赖分发渠道。 |
| 依赖、传递依赖、构建过程被投毒 | ❌ | 卡片只覆盖显式列出的文件。 |
| 密钥泄漏前签发的卡片 | ❌ | 没有密钥状态/时间戳机制；只能人工撤销并更换信任根。 |
| 文件权限、符号链接、mtime 被改 | ❌ | 只哈希字节内容；不覆盖文件元数据或链接语义。 |

一个重要的语义边界：**`verifyCard` 验证的是“卡片”，不是“安装目录”。**
要证明磁盘上的插件与卡片一致，调用方必须把实际文件交给
`verifyFiles(card, entries)`（或 `verifyCard(card, { secret, files: entries })`）。
这一步没有被 CLI 自动完成，因为 CLI 不应该假设产物的目录布局和忽略规则。

## 4. 数据模型

### 4.1 Card

```json
{
  "schema": "testatum/v1",
  "name": "demo-plugin",
  "version": "1.2.3",
  "files": [{ "path": "dist/index.js", "sha256": "<64 hex>", "size": 123 }],
  "rootHash": "<64 hex>",
  "createdAt": "2026-01-02T03:04:05.000Z",
  "signature": { "alg": "hmac-sha256", "sig": "<64 hex>", "keyId": "release-2026-11" }
}
```

- `schema` 固定为 `testatum/v1`；未知 schema 在完整性检查中报 `schema-invalid`。
- `name` / `version` 是调用方给出的身份标签，本工具不解析 semver，也不验证其
  与任何 registry 记录一致。
- `files` 是摘要清单，**不包含文件内容**；条目固定为
  `{ path, sha256, size }`。当调用方只提供预计算摘要且不提供 `size` 时，
  `size` 为 `null`，仅作为占位，不参与实际文件大小比较。
- `createdAt` 是 ISO-8601 可解析字符串；缺省时由 `createCard` 取当前时间。
  它没有被签名之外的可信时间戳证明。
- `signature` 是唯一被排除在 HMAC 载荷之外的字段（见 §6.3）。

### 4.2 Manifest 与 rootHash

```text
files_sorted = sort_by_path([{ path, sha256, size }, ...])
rootHash     = sha256_hex(canonicalJson(files_sorted))
```

- 排序键是 `path` 的 UTF-16 code unit，与 locale 无关；排序在哈希之前完成。
- 路径按传入字符串原样使用，不做 `\` → `/`、`./` 去除、大小写折叠或
  Unicode 归一化。不同写法被视为不同文件；重复路径直接拒绝。
- `size` 是字节长度（UTF-8 文本按 UTF-8 字节计算）。
- 空清单的 `rootHash = sha256("[]")`，即
  `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`。
- 清单中保留 `size` 是为了让 `verifyFiles` 能区分“摘要相同但长度记录异常”的
  卡片；摘要本身仍然是主要安全边界。

### 4.3 撤销记录

```json
{
  "schema": "testatum/revocation/v1",
  "name": "demo-plugin",
  "version": "1.2.3",
  "rootHash": "<64 hex>",
  "reason": "signing key rotated",
  "revokedAt": "2026-02-03T04:05:06.000Z"
}
```

`revokeCard` 先跑 `verifyCardIntegrity`，因此不能为结构上已损坏的卡片生成撤销
记录。撤销记录**不**包含原卡片的签名，也**不**由本工具签名。

## 5. Canonical JSON

签名和 `rootHash` 都依赖稳定序列化。实现规则：

1. 仅接受 JSON 数据模型：`null`、布尔、有限数字、字符串、数组、普通对象。
   拒绝 `undefined`、函数、Symbol、BigInt、NaN、Infinity、循环引用、Map/Set/
   Date/Buffer 等其他对象。
2. 对象键按 UTF-16 code unit 升序排列（`Array.prototype.sort` 的默认比较）；
   数组保持原顺序。
3. 无空白，字符串用 `JSON.stringify` 转义。
4. 普通对象限定为 `Object.prototype` 或 `null` 原型；避免类实例携带隐藏状态。
5. 签名载荷是“卡片去掉 `signature` 后的对象”的 canonical JSON。卡片自身的
   字段顺序、源文件里的空白和键顺序都不影响签名。

这个方案不是 RFC 8785 的完整实现（例如不处理 Unicode 归一化、浮点边界和
`toJSON`），但它对同一份 JSON 数据是确定性的，适合本工具的封闭 schema。

## 6. 签名与验证

### 6.1 签名

`signCard(card, secret | { secret, keyId })`：

1. 规范化 secret（非空字符串或 `Uint8Array`）；
2. 计算 `HMAC-SHA256(secret, signaturePayload(card))`；
3. 返回 `{ alg: "hmac-sha256", sig: <hex> }`，可选 `keyId`；
4. **不修改**输入卡片，也不把 secret 写入任何字段。

`signCard` 本身不检查卡片的 schema/rootHash；它是通用签名原语。CLI 在签名前会
调用 `verifyCardIntegrity`，拒绝结构无效的卡片。库使用者应遵循同样的顺序。

### 6.2 验证

`verifyCard(card, secret | { secret, revocations, files })` 的执行顺序：

1. `verifyCardIntegrity(card)`：
   - schema / name / version / createdAt / rootHash 的基本类型；
   - `files` 数组、路径唯一且有序、每项 `path/sha256/size` 合法；
   - 若条目内嵌 `content`（非标准扩展），重算其摘要和长度；
   - 按 §4.2 重算 `rootHash` 并比对。
2. 检查 `signature` 的形状、`alg` 和 hex `sig`。
3. 若提供了 secret，重算 HMAC 并做 constant-time 比较；
   未提供 secret 时 **fail closed**（`secret-missing`），绝不放行。
4. 若提供了 `revocations`，调用 `isRevoked`，命中则加 `revoked`。
5. 若提供了 `files`，调用 `verifyFiles` 逐项比对实际文件。

结果严格为 `{ ok: boolean, reasons: string[] }`。`ok === true` 当且仅当
`reasons` 为空。reasons 的集合语义稳定，顺序不承诺是 API。

失败原因（部分带 `:<detail>`）：

| 类别 | reasons |
|---|---|
| 卡片 | `card-invalid`, `schema-invalid`, `name-invalid`, `version-invalid`, `createdAt-invalid`, `rootHash-invalid`, `files-invalid` |
| 文件清单 | `file-invalid:<i>`, `file-path-invalid:<i>`, `file-duplicate:<path>`, `files-unsorted`, `file-digest-invalid:<path>`, `file-size-invalid:<path>`, `file-size-mismatch:<path>`, `file-content-mismatch:<path>`, `file-content-invalid:<path>`, `rootHash-mismatch` |
| 签名 | `signature-missing`, `signature-invalid`, `signature-alg-unsupported`, `signature-malformed`, `signature-keyId-invalid`, `signature-mismatch`, `secret-missing`, `secret-invalid`, `card-not-canonicalizable` |
| 撤销 | `revoked` |
| 实际文件 | `files-input-invalid`, `file-mismatch:<path>`, `file-missing:<path>`, `file-extra:<path>` |

### 6.3 `keyId` 的边界

`signature.keyId` 是给人和未来 keyring 的**提示**，当前实现：

- 不参与 HMAC 载荷（`signature` 整体被排除）；
- 不被 `verifyCard` 校验，也不会触发密钥选择；
- 可以被改动而不影响当前签名的通过/失败结果。

因此不要把 `keyId` 当作身份或授权依据。未来若引入 keyring，应把 key id/公钥
指纹纳入签名载荷并重新定义 schema。

## 7. 撤销模型

- `revokeCard` 由 `rootHash` 标识具体构建；`isRevoked` 支持：
  - 字符串 `rootHash`；
  - 撤销记录对象；
  - 数组 / `{ revocations: [...] }` 包装；
  - 兼容按 `name` + `version` 匹配的粗粒度记录（会波及同版本的其他构建）。
- 撤销列表是**外部输入**：CLI 接受 `--revocations <file>`，但列表本身的真实性
  不在本工具范围内。一个未认证的列表可以造成拒绝服务（把正常构建标成撤销），
  也可以漏掉应撤销项。
- 没有撤销列表的新鲜度、过期、单调版本或在线查询。调用方应把列表纳入发布流程，
  并在离线场景中明确使用哪个快照。

## 8. 密钥管理（MVP 的硬限制）

- 仅支持 `TESTATUM_KEY` 环境变量（CLI）或调用方传入的参数（库）；没有 keychain、
  KMS、HSM、文件权限、门限签名或密钥派生。
- 签名方和验证方共享同一个 secret；**验证者可以伪造签名**。这是 HMAC 的固有
  属性，不是实现缺陷，但决定了它不能作为公开供应链信任根。
- `keyId` 没有 keyring；轮换后旧卡片必须重签，旧 key 需要人工移除。
- 没有密钥吊销、过期、审计日志或使用次数限制。
- 环境变量可能出现在 shell 历史、CI 日志、`/proc/<pid>/environ` 和子进程中；
  CLI 只能保证自身不打印 secret，不能保证宿主环境不泄漏。
- 建议至少 32 字节随机熵；密钥长度、轮换周期、访问控制由部署方负责。

## 9. 为什么先用 HMAC，以及迁移路径

先用 HMAC 的原因：

- 只用 Node 内置 `crypto`，零依赖、离线可测；
- 能把“清单完整性 + 共享密钥认证 + 撤销 + 验证”端到端跑通；
- 边界清晰，不会让使用者误以为已经获得公钥身份或透明日志。

后续可选路径（都需要重新定义 schema 和信任模型，不能靠改一个常量完成）：

1. **Ed25519**：`crypto.sign/verify` + 公钥分发；解决“验证者可以伪造”的问题，
   但仍需要 keyring、吊销和信任根。
2. **sigstore/cosign**：OIDC 身份、Fulcio 证书、Rekor 透明日志；与本工具的
   JSON 卡片可以对接到外部签名/证明，但本仓库不实现这些服务。
3. **npm provenance / SLSA**：绑定构建系统和源码；同样需要外部基础设施。
   当前只有 `verify-provenance` 的结构性匹配（存在性、predicateType、
   subject 摘要、repo/commit），见 README「限制 §6」；不做 sigstore 验签。
4. **撤销基础设施**：签名撤销记录、版本化列表、新鲜度证明、可信分发。

在完成这些之前，README 和本文件都把 HMAC 明确标为 **MVP 占位**。

## 10. 失败模式与运维建议

- **密钥缺失**：CLI 退出码 2，不写输出文件；这是 fail closed。
- **密钥错误**：验签失败（退出码 1），不会降级为“只看 rootHash”。
- **卡片损坏/手改**：拒绝签名、拒绝撤销；验证返回具体 reasons。
- **实际文件被替换**：只有传了 `files` 才会被发现；建议发布/安装流程始终做这一步。
- **卡片被重放**：本工具不做版本新鲜度判断；调用方应固定期望的
  `name`、`version`、`rootHash` 或撤销列表快照。
- **输出目录不可写 / JSON 解析失败**：退出码 2，不产生部分写入的成功信号。
- secret 不会出现在成功输出、失败信息或生成的卡片/撤销记录中；测试对此有断言。

## 11. 测试矩阵

`node --test test/*.test.js` 覆盖（当前 43 个测试）：

- 哈希：已知 SHA-256、路径排序、输入顺序无关、重复路径、空文件、空清单、
  Unicode/字节精确性、预计算清单；
- 卡片：schema/字段形状、默认 `createdAt`、非法输入；
- 签名：确定性、不同密钥、keyId、空 secret；
- 验证：正常通过、文件摘要/路径/size 被改、文件重排、顶层字段被改、
  错误密钥、缺 secret、缺签名、坏签名、未知算法、canonical JSON 键序与
  非 JSON 值；
- 实际文件：内容不匹配、缺文件、多文件、非法输入；
- 撤销：记录形状、按 rootHash 匹配、按 name+version 兼容匹配、撤销后
  verify 返回 `revoked`；
- CLI：`--help`、sign→verify 往返、`--json`、缺密钥、错误参数、篡改、
  坏 JSON、撤销列表、无密钥撤销的警告、拒绝签名/撤销无效卡片，以及
  **输出不泄漏测试 secret**；
- provenance：真实 npm 形状的 mock（多 attestation 选 SLSA、无 attestations、
  错 repo/commit/digest）、scoped 包名、hex/base64/SRI 摘要、网络/HTTP/JSON
  错误码、`verifyPackage` 组合；
- provenance CLI：本机回环 registry 的成功/失败/缺 attestation、
  `--tarball-sha512`、网络/HTTP/坏 JSON 的退出码 2、包 spec 校验与帮助文本。

测试不访问公网、不读取真实 `TESTATUM_KEY`、临时目录在结束后清理；
provenance 测试使用注入的 mock `fetch` 与本机回环 HTTP 服务器。

## 12. 命名、非官方与许可

- 命名核验见 README 的“命名核验”一节：2026-11-14 查询 npm registry 的
  `testatum-attest` 与 `testatum` 均为 404，npm search 为 0，GitHub 仓库名搜索
  为 0；这不构成商标清关或未来可用性保证。
- `testatum` 是拉丁语/法律文书中的既有词，本包仅将其与 `attest` 组合为工具名。
- **本项目是非官方社区项目**，与 DeepSeek、DeepSeek Harness、npm、sigstore、
  OpenSSF 无隶属或背书关系。
- Apache License 2.0；见 `LICENSE`。按“现状”提供，不附带担保。

## 13. 待讨论

- 是否在 v2 中把 `keyId`/算法/时间戳纳入签名载荷；
- 撤销记录是否应默认用同一密钥签名，还是使用独立的撤销密钥；
- 是否需要 CLI 级别的“实际文件目录 → 清单”生成/比对命令（当前只在库 API 中提供）；
- 是否引入 `mode`、symlink 策略或可配置的路径归一化；
- 与 sigstore/npm provenance 的互操作格式（只做映射，不声称兼容）。
