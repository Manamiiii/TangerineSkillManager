# Windows 程序与数据位置（0.1.1）

Windows 新默认根为 `%LOCALAPPDATA%\Tangerine`。源码 `npm start`、安装版和 Portable 使用相同数据身份。Portable 的库不跟随 EXE；不通过当前工作目录或包位置寻找另一份库。macOS/Linux 本轮保持原数据约定，仍未完成实机安装验收。

## 写入目录地图

以下均相对于该根，应用只管理自己的项目子目录。

| 内容 | 位置与行为 |
| --- | --- |
| 新装程序 | `Apps/TangerineSkillManager`，稳定 app ID / NSIS GUID 不变 |
| 配置 | `Data/TangerineSkillManager/Config/config.json`，JSON v1 格式不变 |
| 安装记录 | `Data/TangerineSkillManager/Storage/state.json`，来源和归属记录格式不变 |
| 新库 | `Data/TangerineSkillManager/Storage/vault/skills` |
| Electron profile | `Data/TangerineSkillManager/Storage/Electron`，Electron 用户级配置位置 |
| Chromium session/cache | `Data/TangerineSkillManager/Cache/Chromium`，包括浏览器会话存储和调试时的 DevToolsActivePort；Crashpad 在 `Cache/Crashpad`。本项目不在浏览器存储中保存业务数据 |
| Git / 更新暂存 | `Data/TangerineSkillManager/Cache/Git` 及其中的 `update-staging`，按需创建 |
| 配置、记录备份 | `Data/TangerineSkillManager/Backups`，按需保存修改前副本 |
| 日志 | `Data/TangerineSkillManager/Logs`，业务 events.log 只写事件码，不记录内容、路径或 URL |
| 迁移状态 | `Data/TangerineSkillManager/Runtime/layout.json` 和 `migration-complete`，用于辨别初始化与迁移中断，不可当缓存删除 |
| 应用临时位置 | `Data/TangerineSkillManager/Temp` |

新 Windows 配置的 `{data}` 指向 Storage，相对路径以 Config 为基准。`config/example.json` 仍是跨平台旧约定示例，不能覆盖现有配置。UI 显示实际配置和库路径。

真实例外包括以下位置。

- 已登记的旧程序目录原位维护，包括旧 Programs 下的应用子目录及上一轮 `Programs/Tangerine/TangerineSkillManager`，以经过归属校验的真实登记为准。安装器不会替用户搬程序目录。
- 显式选择的库、来源、项目、Agent 目标和主动导出位置保留。库/目标内的原子写临时文件、同步回收及备份必须和目标同盘，仍在相应目录内，绝不移动到共享根。
- 已迁移用户的旧库和旧路径模板保持原位置，见下节。旧 Electron profile 保留原件，但不再用作浏览器存储。UI 没有需要迁移的 localStorage/IndexedDB 业务数据，因此 Chromium profile 从新目录重新建立，不复制 cookies、缓存、锁或系统绑定数据。
- 兼容 0.1.0 的 Windows 单实例锁仍以 `%APPDATA%/tangerine-skill-manager` 为身份锚点，运行期间可在此创建 `lockfile`。在取得锁后、启动 Chromium 之前设置新 profile；锁不改成新路径，否则旧版和新版可能同时打开同一库。新启动测试允许该锁文件，拒绝此目录出现新的缓存/profile 文件；运行时实测覆盖双向排斥。
- Windows HKCU 安装/卸载登记、开始菜单、系统临时文件、Portable 解包、操作系统崩溃/安全/输入法记录由各自组件管理。应用不声称操作系统零痕迹。系统浏览器打开公开网页后使用其自己的 profile。
- 仓库的 node_modules、dist、dist-desktop、release、test-results 和隔离测试 profile 是开发/构建例外。独立构建不读取其他 checkout 或父目录规则。

卸载只移除归属已验证的本项目程序子目录和登记。Data、外部库、Agent 副本、共享 Apps/Data 根及兄弟应用均保留。

## 旧数据发现与迁移

只发现已知旧业务目录 `%APPDATA%/skill-manager`，不遍历磁盘猜测库。第一次运行 0.1.1 时，旧目录有内容就停止打开业务库，显示 `DATA_MIGRATION_REQUIRED`。不静默创建空库、不自动选择两份数据中的一份。

**本轮只用虚构数据验证迁移，没有迁移作者真实数据。** 操作现有个人库前先退出全部旧版，并备份旧业务目录与显式外部库。然后对准备使用的 0.1.1 程序执行一次显式命令。

```powershell
& '<0.1.1 程序的完整路径>' --migrate-data-layout
```

源码维护应先 `npm run build`，再在工程内运行 `node_modules/.bin/electron . --migrate-data-layout`。不要依赖 npm 将维护参数穿过复合启动脚本。

迁移过程如下。

1. 持有旧身份单实例锁，旧实例运行时新进程直接退出，不触碰迁移目录。
2. 校验旧配置版本、安装记录、路径和库可用性。损坏、不支持的版本、链接/hardlink、外部库不可用或目标已有不明内容时拒绝。
3. 写入版本化恢复记录，排他复制 config/state，逐字节校验。配置与记录原有格式不变。已有 `{data}`、相对路径保留旧解释上下文；旧默认库、显式库、项目和所有同步目标均不搬动，安装记录与 symlink/junction 仍有效。
4. 旧 `config.json` 重命名为同目录 `config.pre-tangerine.json`，原字节不变。在 `config.json` 的原位置创建带说明的保护目录。0.1.0 读取、保存和重置均会失败，防止旧版退出后再次启动写入旧业务库。旧 state、日志、备份、库和 profile 原件保留。
5. 记录完成状态。后续启动校验原件、保护目录和新配置/记录存在性，再使用集中目录。旧记录变动、保护被移除、新旧两份库或新数据缺失会停止启动，不合并、不覆盖。新的库设置和备份位于新数据空间。

迁移后不要删除旧配置保护目录或运行旧版“恢复默认”，也不要手工复制出另一份可写配置。保护针对正常使用和误操作，不是防同一账户恶意绕过的访问控制。

## 失败、恢复与回退

- `DATA_MIGRATION_INTERRUPTED` 表示已有恢复记录但未完成。保留现场，排除空间/权限问题后再次显式迁移；已有目标文件只有逐字节匹配才继续。部分文件损坏或被改过时停止，不自动重拷贝。
- `DATA_DESTINATION_OCCUPIED`、`DATA_MULTIPLE_LIBRARIES`、`DATA_COPY_CONFLICT` 表示存在不能自动判定的多份内容。分别备份并人工确定唯一来源，不通过删除 journal 或清空文件强制启动。
- `DATA_LEGACY_CHANGED` 表示旧原件、归属记录或保护被改动。不要尝试合并安装记录，也不要恢复旧程序继续写共享目标。
- 新目录中的正常配置损坏仍按原有 UI 备份恢复流程处理；配置缺失但记录存在时不会自动生成默认配置。库有管理记录而存储离线时，扫描和导入拒绝创建替代库。
- 在新版还没有修改配置/安装记录时，可以关闭所有实例，用同一程序加 `--rollback-data-layout`。它核对迁移前 hash，把完整新 Data 子目录改名为同级 `.rollback-<时间>` 存档，移除自己创建的保护文件/空目录，再恢复原 `config.json` 名称，不删除数据树。命令成功后程序退出。
- 新版已经写入配置或记录时回退拒绝（`DATA_ROLLBACK_CHANGED`），包括 v0 配置被正常升级为 v1。需要人工比对并备份后制定恢复方案，不强行降级。回退中的权限/中断问题保留存档与旧原件，需要人工恢复名称；不能仅因报错就反复执行。任何情况下都不要让两套配置同时写同一个库/目标。

## 验证边界

`npm test` 覆盖 v0/v1、空目录、冲突、损坏、外部路径、缺失库、注入复制失败、重复迁移和回退。`npm run test:layout -- '<打包程序路径>'` 先使用实际 Electron 检查临时 home/AppData，再验证新旧单实例锁、真实 profile/cache/log/temp 路径、迁移字节、copy/junction 归属、幂等预览和退出重开。没有仅靠 TEST_MODE 变量认定隔离。

安装 fixture 使用独立 GUID，验证旧普通 Programs、旧 Programs/Tangerine、新 Tangerine/Apps 三种位置。低版本 fixture 使用当前代码，只验证安装器版本处理，不能称为真实历史业务迁移。正式身份交互安装、干净 Windows 和真实用户数据迁移仍需独立验收。
