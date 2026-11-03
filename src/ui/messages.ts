import type { Snapshot } from '../shared/types';
const messages: Record<string, string> = {
  'New installation.': '将在这个目标中新建安装。',
  'Synchronized.': '同步完成。',
  'Already synchronized.': '内容一致，无需重复同步。',
  'Installation metadata requires a copy.': '这个 Agent 需要安装元数据，将自动使用复制模式。',
  'Replace this unchanged managed installation.': '将更新本工具管理且未被外部修改的副本。',
  'Existing content is external or has changed. It will be preserved.':
    '目标已有外部内容或被修改的副本，已保留。请换一个目标目录或自行核对内容。',
  'Source or destination changed after preview. Preview again.':
    '预览后来源或目标发生变化，请刷新并重新预览。',
  'External symbolic link; not followed or modified.': '外部符号链接：只显示记录，不跟随或修改。',
  'Read-only source. Discovery only.': '只读来源：仅用于发现与冲突提示。',
  'Recorded installation is missing.': '安装记录对应的目录已缺失。可重新预览同步以恢复。',
  'Recorded library Skill is missing.': '本地库中的文件已缺失。请从原来源重新导入。',
  'This Agent already exposes a Skill with the same ID from a read-only source. It cannot be shadowed by synchronization.':
    '这个 Agent 的只读来源中已有同名 Skill，已阻止重复覆盖。',
};
export function displayMessage(message?: string): string {
  return message ? (messages[message] ?? message) : '';
}
export const errorHelp: Record<string, string> = {
  PRIVATE_NETWORK:
    '公开服务域名解析到了私有或保留地址，已阻止连接。某些 Fake-IP 代理会造成这种情况；可在“设置 → 网络连接”显式选择 HTTPS DNS 后重试，或先下载仓库再通过本地目录导入。',
  CONFIG_INVALID: '配置文件损坏，原文件已保留。可修复文件，或使用“备份并恢复默认配置”。',
  CONFIG_VERSION: '配置版本不兼容。请使用兼容版本，或先备份再恢复默认配置。',
  STATE_INVALID: '安装归属记录损坏，已阻止写入。请从 state.json.backup 文件恢复，不要删除记录来强制覆盖。',
  SOURCE_CHANGED:
    '来源身份发生变化，已阻止更新。请恢复原仓库与子目录配置；旧记录缺少来源信息时需明确重新导入。',
  SOURCE_MISSING: '原来源不存在、被禁用或没有更新记录。请在“来源”中恢复原配置。',
  OFFLINE: '来源处于离线模式。联网来源需要关闭离线模式后再试；已导入内容仍可使用。',
  TIMEOUT: '请求超时，请检查网络后重试。获取 Git 来源时也可选用更小的仓库。',
  GIT_FAILED: '无法读取公开仓库。请核对 URL、分支或标签、子目录以及网络连接。',
  NETWORK: '无法连接公开服务。请检查网络和系统证书设置。',
  PLAN_EXPIRED: '计划已失效或执行过，请重新预览。',
  LINKED_INSTALLS: '请先在“同步 → 扫描详情与安装记录”中卸载该 Skill 的符号链接，再从本地库删除。',
  PERMISSION: '没有足够的目录权限。请选择当前用户可写的目录，无需以管理员身份运行整个应用。',
  DISK_FULL: '磁盘空间不足，请释放空间后重试。',
};
export function compactPath(actual: string, snapshot: Snapshot): string {
  const paths = [
    { root: snapshot.vaultPath, label: snapshot.config.vault.root },
    ...snapshot.targets.map((t) => ({ root: t.path, label: t.template ?? t.path })),
  ].sort((a, b) => b.root.length - a.root.length);
  const normal = actual.replaceAll('\\', '/').toLowerCase();
  for (const p of paths) {
    const base = p.root.replaceAll('\\', '/').toLowerCase();
    if (normal === base || normal.startsWith(base + '/'))
      return p.label + actual.slice(p.root.length).replaceAll('\\', '/');
  }
  return actual;
}
