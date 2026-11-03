# Windows 安装版交接

本轮范围只有 TangerineSkillManager，基于 main 的 `c45a350`；没有修改其他项目或业务数据格式。Windows x64 为当前目标，保留 macOS/Linux 构建结构，不宣称其实际安装已验证。

- 交付：0.1.0 当前用户 NSIS Setup 与 Portable，位于 `release/`。文件大小、SHA-256 和签名状态见 [发布清单](RELEASE_CHECKLIST.md) 与 [验证记录](VALIDATION.md)。本轮不上传安装包、不创建 Release。
- 身份：正式 app ID 为 `org.tangerineskillmanager.desktop`，安装 GUID 为 `048f50d3-d876-42d2-95f3-f0dce4cc270a`；数据位于操作系统用户数据目录的 `skill-manager`。本机目录与用户内容仅保存在本机配置中。
- 安装策略：无需管理员权限，开始菜单和 Windows 卸载入口，运行中拒绝安装/卸载，不强杀；升级与卸载默认保留配置、库、记录和同步副本。更新仍需手动下载安装。
- CI 修复：fixture 构建只传必要覆盖项，避免 electron-builder 重复合并资源数组造成并发复制失败。回归测试使用真实配置解析器。
- 本机证据：68 项单元/集成测试；正式打包 EXE 与 Portable 各 21 项桌面检查；独立测试身份安装器 6 组生命周期检查；类型/格式/构建/隐私/包内容一致性检查通过。结果仅涵盖隔离 profile，不等于干净 Windows。
- 安全边界：测试安装前校验独立身份，保护已有安装和快捷方式；检查 HKCU、无 HKLM 登记、包内内容、x64 与 renderer 安全开关；不关闭用户正在使用的便携实例。诊断 profile 和报告不提交或上传。
- 未验证：正式身份交互向导、干净 Windows 普通账号、真实历史业务数据迁移、macOS 实机安装。0.0.9 fixture 使用当前代码，仅证明安装器升级流程。公网能力本轮未重测。
- 不适用：本项目没有 Dexie、阅读记录、OCR/地图或整库 JSON 导入导出；保留现有配置 JSON、来源导入和 Skill 迁移行为，没有为跨项目清单新增无关功能。

下一项发布门槛是在独立 Windows 普通账号环境按 [验收步骤](WINDOWS_ACCEPTANCE.md) 测试正式 Setup。测试机器或虚拟机均可，不要求在正在使用的个人环境覆盖安装。不需要重复已完成的自动检查。
