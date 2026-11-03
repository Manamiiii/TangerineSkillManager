# 干净 Windows 验收步骤

**当前状态：尚未在干净 Windows 环境执行。** 本文是待执行步骤，不是通过报告。本机临时 APPDATA/USERPROFILE、空 PATH 和便携 EXE 自动验收已经通过，但它们仍共享宿主系统组件。

## 环境与准备

- 使用可恢复的 Windows x64 虚拟机或没有项目配置的测试机器，记录实际系统版本和 build。优先使用普通非管理员账号。
- 不预装 Node、npm、Git、任何 Agent 或专用 CLI，不复制开发者的 AppData、证书、配置或凭据。
- 只提供本轮候选便携 EXE 和对应 `SHA256SUMS.txt`；先核对文件名、字节数与 SHA-256。可用系统 PowerShell 的 `Get-FileHash -LiteralPath '<EXE路径>' -Algorithm SHA256`，无需安装工具。
- 使用文件管理器新建 `%USERPROFILE%\SkillManager-Acceptance`，其下建 `source`、`target`、`project` 三个文件夹。所有试验只用这些目录和新账号的应用配置，不能选择工作文件。
- 未签名包可能出现系统提示或阻止。记录实际提示和下载途径；不要关闭安全软件、安装未知证书或更改系统安全策略来制造通过结果。若阻止启动，记录失败并交回维护者处理分发问题。

## A. 离线启动与本地同步（Windows 首版必要）

在无网络连接的测试环境中执行 A、B、D；联网能力只在 C 单独验证。

| 步骤 | 操作 | 预期结果 |
| --- | --- | --- |
| A1 | 从文件管理器直接打开便携 EXE，不传测试或调试参数 | 正常打开中文界面；不要求账号、管理员权限、Node、Git 或联网下载运行时 |
| A2 | 在空本地库点击“试用内置示例” | 出现 Clear Plan；只导入本地库，没有自动写入 Agent 目录 |
| A3 | 到 Agent 页禁用默认 Generic .agents；新增 `acceptance`，显示名称为“验收 Agent”，用户目录为 `~/SkillManager-Acceptance/target`，项目目录为 `{workspace}/.agents/skills` | 保存成功；目录可编辑；没有依赖某个真实 Agent 软件 |
| A4 | 绑定 `project` 文件夹，项目标识为 `acceptance-project` | 项目出现；能查看项目和目标目录状态 |
| A5 | 在 `target` 中用记事本创建 `keep.txt`，写入 `external neighbor` | 这是本工具未管理的文件，后续必须保留 |
| A6 | 选择 Clear Plan，在同步页只选验收 Agent 的用户级和项目级目标，使用 copy，预览后执行 | 预览显示新增；执行两个目标均成功；`target/clear-plan/SKILL.md` 和 `project/.agents/skills/clear-plan/SKILL.md` 存在；`keep.txt` 不变 |
| A7 | 再次预览相同选择 | 显示内容一致或跳过，没有重复新增或要求覆盖 |
| A8 | 退出程序，再直接打开同一个 EXE | 本地库、Agent、项目及安装状态保留；可继续扫描和使用 |

如果系统隐藏文件扩展名，应核对实际名称，避免产生 `SKILL.md.txt` 或 `keep.txt.txt`。

## B. 来源、更新、冲突与删除保护（必要）

在 `source` 中创建 `acceptance-example` 文件夹，用记事本以 UTF-8 保存以下内容为 `SKILL.md`：

```markdown
---
name: Acceptance Example
description: Local acceptance fixture
version: 1.0.0
author: Community
---

# Acceptance Example
Describe a short plan before changing files.
```

| 步骤 | 操作 | 预期结果 |
| --- | --- | --- |
| B1 | 添加本地目录来源，选择 `source`，发现并导入 `acceptance-example` | 本地库显示名称、描述、版本和来源；原目录内容未改动 |
| B2 | 修改源 `SKILL.md` 的 version 为 `2.0.0`，增加一行正文；在库中检查、预览并应用更新 | 显示可更新；预览列出 `SKILL.md` 变化；应用后库内容更新，不自动同步 copy 目标 |
| B3 | 在已安装的 `target/clear-plan` 中手工添加 `external-note.txt`，再预览 Clear Plan 同步 | 用户级副本显示冲突；不会覆盖或删除手工添加的文件；项目级副本仍可独立显示正常 |
| B4 | 在扫描详情里选择被修改的用户级副本“卸载副本”，核对目标后确认 | 操作拒绝或报告冲突，`clear-plan` 及新增文件均保留；不能误报卸载成功 |
| B5 | 只卸载未修改的项目级 Clear Plan 副本 | 该副本被删除；用户级冲突副本、`keep.txt`、源 `SKILL.md` 均保留 |
| B6 | 删除库中的 `acceptance-example`，核对确认信息后执行 | 库条目消失；`source/acceptance-example/SKILL.md` 保留 |

junction、外部 symlink、路径穿越、元数据冲突和并发计划失效已有自动测试，不要求在干净机器安装额外工具来重复全部案例。若发现异常，保留测试目录和日志，不强制删除归属记录或外部内容。

## C. 联网和失败反馈（独立记录）

1. 恢复测试环境的正常网络，保留“系统 DNS”。主动检查应用版本、搜索市场并尝试公开 Git 来源。记录成功或具体错误；不将网络错误解释为“没有更新”。
2. 如果出现保留地址/Fake-IP 错误，在“设置 → 网络连接”阅读说明后显式选择 Cloudflare HTTPS DNS 并保存。保存本身不应触发搜索或导入；退出重开后选项应保留。若系统 DNS 已可用，此分支可作为可选覆盖，未执行则明确标注。
3. 主动检查应用更新。当前仓库没有正式发行版时，预期显示暂无可查询的正式版本。以后已有 Release 时按真实版本判断；不能要求每次都得到同一结果。
4. 在“来源 → 发现 Skill”选中 GitHub、SkillsMP，搜索 `testing`。预期展示结果，或分别说明限流、认证、网络错误；具体数量不作为长期固定门槛。记录各市场的实际结果。
5. 添加公开 Git 来源 `https://github.com/obra/superpowers.git`，ref 为 `main`，子目录为 `skills/writing-plans`，发现并导入。预期得到 `writing-plans` 和 commit 来源记录；内容未变时检查更新应报告无需更新。若上游改变目录或内容，记录实际变化，不为通过而虚报结果。
6. 切回系统 DNS 并保存，确认当前已保存状态恢复。断网后再次打开本地库并扫描、预览已有 Skill，应仍能使用。市场请求失败不能使库内容消失。

HTTPS DNS 不是代理，无法保证所有网络可达。此前本机通过的联网结果不能代替本次环境的记录。

## D. 配置损坏恢复（仅在可丢弃测试环境，必要）

1. 从“设置 → 配置文件”记录实际路径，退出应用；复制 `config.json` 为一个单独的测试备份，保留 `state.json` 和库文件。
2. 只将这个测试账号的 `config.json` 内容改成 `{`，再打开应用。预期出现可理解的配置错误，原文件仍保持损坏内容，不能静默恢复为空配置。
3. 使用界面的“备份并恢复默认配置”。预期生成含原损坏内容的备份，恢复默认配置并可再次使用；库文件与安装记录不被删除。被重置的 Agent/项目绑定不要求自动恢复。
4. 不删除真实账号文件。测试结束后由环境管理者按虚拟机/测试账号的清理流程收尾；不要让应用强制清理前述冲突目录。

## 结果记录模板

复制以下内容填写，不留隐含的“默认通过”。截图或日志在分享前移除账号名、绝对路径和非测试内容。

```text
测试日期：
执行者：
Windows 版本 / build / 架构：
环境类型：全新虚拟机 / 独立测试机器 / 其他（说明）
普通非管理员账号：是 / 否
未安装 Node、Git、Agent CLI：已核对 / 未核对
候选版本 / 文件名 / 字节数：
候选 SHA-256：
签名状态 / 下载途径 / 系统提示：

A1–A8：逐项填写 通过 / 失败 / 未执行，并写实际现象
B1–B6：逐项填写 通过 / 失败 / 未执行，并写实际现象
C：系统 DNS、可选 HTTPS DNS、版本、两个市场、Git、断网本地使用分别记录
D1–D3：逐项填写 通过 / 失败 / 未执行，并写实际现象

未预期写入、删除、联网或权限请求：无 / 有（说明）
失败复现步骤及脱敏证据：
未执行项目和原因：
结论：通过该环境验收 / 失败 / 不完整
```

没有实际执行 A、B、D，或出现数据保护失败，不能标为该环境验收通过。C 的外部服务失败独立记录和判断；作者仍须在授权发布时知晓真实限制。
