# 配置、安全与数据恢复

## 配置与数据

JSON Schema：[config/schema.json](../config/schema.json)。可移植默认配置：[config/example.json](../config/example.json)。运行时额外校验重复 key、Git 参数、元数据文件名和路径安全。

| 系统 | `{data}` 基目录 |
| --- | --- |
| Windows | 系统用户 AppData（Roaming）目录 |
| macOS | `~/Library/Application Support` |
| Linux | `$XDG_DATA_HOME`，未设置时 `~/.local/share` |

默认库为 `{data}/skill-manager/vault/skills`；`config.json`、`state.json`、备份和脱敏事件日志在 `{data}/skill-manager`。Electron 自身的窗口/缓存数据使用其标准 userData 目录。应用 UI 显示当前配置和库的实际路径。

顶层配置字段：`version: 1`、`vault.root`、`defaultSyncMode`、`agents[]`、`projects[]`、`providers[]`，以及可选的 `network.dns`。目录支持 `~`、`$HOME`、`${HOME}`、`%USERPROFILE%`、`{workspace}`、`{data}`。相对路径相对于配置目录；项目模板的相对路径相对于项目根。拒绝 `..`、网络/设备路径和当前系统无法解释的其他平台绝对路径。

修改库目录会切换库，不自动搬移旧内容。迁移 v0、保存和恢复默认前保留备份；损坏/未来版本配置不会静默覆盖。损坏所有权记录会阻止写入，请恢复 `state.json.backup-*.json`，不要删除记录来强制覆盖目标。

Git 来源记录现在额外保存 `repositorySubdirectory`，区分仓库根设置与 Skill 在该来源下的相对位置。这是兼容读取的可选字段，不改变配置版本。旧 Git 记录缺少该字段时仍可查看与同步，但更新会被安全阻止；恢复原来源并明确重新导入后才能建立完整身份记录。修改来源子目录不能悄悄替换已有 Skill。分支或标签仍可由用户显式修改。

内置 `Clear Plan` 示例只在点击“试用内置示例”后导入，不添加网络来源，也不写入 Agent。它随应用提供，不参与远程更新检查。

安装元数据规则示例：

```json
{
  "filename": "installation.json",
  "values": { "channel": "local", "managed": true }
}
```

启用后强制 copy，生成包含 `skillId`、可选 `version`、`contentHash`、`installedAt` 和 `values` 的 JSON。规则只支持声明式常量，不执行模板脚本。文件名与 Skill 原文件冲突时拒绝同步。

## 网络连接

默认配置省略 `network`，使用系统 DNS。遇到 Fake-IP 返回保留地址时，可在“设置 → 网络连接”显式保存 Cloudflare HTTPS DNS；对应配置片段为 `"network": { "dns": "cloudflare" }`。也接受 `"system"`；界面切回系统 DNS 时移除这个可选字段。保存不会测试连接或自动联网，下一次由用户发起的 Git、市场或版本查询生效，不需重启。

HTTPS DNS 只查询固定 `https://1.1.1.1/dns-query`，发送目标域名和 IPv4 查询类型；Cloudflare 会接收到这些查询及网络连接信息，不会收到 Skill 内容、市场搜索词或本机路径。实际 Git/市场/版本请求仍直连原服务并验证其 TLS 证书。没有自动回退、自定义 DNS 地址、代理认证、系统代理导入或跳过证书校验。每次 DNS 查询最多 8 秒、64 KiB；所有返回地址必须为公网地址。连接失败可切回系统 DNS，或改用本地目录来源。[服务接口说明](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)

这是 v1 配置的可选扩展：已有 v0/v1 配置无需更改，默认示例不连接第三方 DNS。启用后，旧版严格 schema 可能拒绝该字段；降级前请在新版界面切回系统 DNS，或备份后移除 `network`。来源、库及安装记录格式不变。

## 安全说明

- **内容不上传**。联网仅由用户发起：Git 请求含仓库地址，市场请求含搜索词，版本检查访问固定发行接口；可选 HTTPS DNS 查询含目标域名。不上传库内容或本机路径。
- **来源不是信任认证**。导入内容不会执行，也不作为 HTML 渲染。真正使用 Skill 的 Agent 可能执行其中指令，请自行审核来源。
- 外部文件、未知目录、被改动的受管副本、外部或失效 symlink 都视为冲突。私有安装记录与匹配标记共同决定归属，复制标记文件不能取得所有权。
- 只读来源不能作为写入目标，也不能通过路径别名绕过。相同 Agent 的只读 Skill 名称冲突会阻止同步。目录重叠、junction/symlink 祖先、路径穿越和元数据覆盖均被拒绝。
- Windows 的 symlink 模式使用目录 junction；其他平台使用目录 symlink。链接实时反映库变更。存在链接安装记录时，必须先显式卸载链接才能删除库 Skill。
- 导入仅接受普通文件与目录，拒绝 symlink、hardlink 和特殊文件；忽略来源的 `.git`。限制每个 Skill 为 32 MiB、5000 个条目、20 层目录。发现最多 8 层。Git 传输最多 64 MiB，超时 60 秒。
- Git 只接受公开 HTTPS。拒绝凭据、私网/回环地址、重定向、submodule 和源链接；不读取系统 Git 配置、不执行 hooks、不调用 shell、不禁用 TLS 验证。不支持依赖代理、认证或重定向的特殊仓库。
- 写入采用同盘暂存与 rename；崩溃可能留下 `.skill-manager-stage-*` 或 `.skill-manager-backup-*`，不会自动大范围清理。核对内容后手动恢复/清理。该方案不是跨多目录事务，单项失败不撤销其他成功项。
- 目录校验降低误删与常见并发修改风险；**不声称抵御同一 OS 用户恶意竞争系统调用**。详见 [ARCHITECTURE.md](../ARCHITECTURE.md) 和 [SECURITY.md](../SECURITY.md)。
