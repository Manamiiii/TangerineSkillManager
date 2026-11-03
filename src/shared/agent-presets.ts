import type { Agent } from './config';

// Configuration recipes only: neither discovery rules nor synchronization policy depend on this list.
export const agentPresets = [
  {
    key: 'codex',
    name: 'Codex',
    user: '~/.agents/skills',
    project: '{workspace}/.agents/skills',
    note: '与通用 .agents 共用目录；其他兼容 Agent 也可能读取此目录。',
  },
  {
    key: 'claude-code',
    name: 'Claude Code',
    user: '~/.claude/skills',
    project: '{workspace}/.claude/skills',
    note: '用于本地 Claude Code，不会上传到 Claude 网页版。',
  },
  {
    key: 'cursor',
    name: 'Cursor',
    user: '~/.cursor/skills',
    project: '{workspace}/.cursor/skills',
    note: '本机目录；云端或远程环境需要单独配置。',
  },
  {
    key: 'github-copilot',
    name: 'GitHub Copilot',
    user: '~/.copilot/skills',
    project: '{workspace}/.github/skills',
    note: '用于本地 Copilot；云端需由用户将项目 Skill 提交到对应仓库。',
  },
  {
    key: 'gemini-cli',
    name: 'Gemini CLI',
    user: '~/.gemini/skills',
    project: '{workspace}/.gemini/skills',
    note: '同作用域的 .agents/skills 内容可能优先于本目录。',
  },
  {
    key: 'opencode',
    name: 'OpenCode',
    user: '~/.config/opencode/skills',
    project: '{workspace}/.opencode/skills',
    note: '使用自定义配置位置时，请按实际设置修改用户级目录。',
  },
  {
    key: 'cline',
    name: 'Cline',
    user: '~/.cline/skills',
    project: '{workspace}/.cline/skills',
    note: '目录同步后，仍需在 Agent 内确认 Skill 是否启用。',
  },
] as const;
export function presetDraft(
  key: string,
  agents: Agent[],
): { value: Agent; original?: string; reused: boolean } {
  const preset = agentPresets.find((p) => p.key === key);
  if (!preset) throw new Error('Unknown Agent template');
  const normalized = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const existing = agents.find(
    (a) =>
      a.userDirectories.some((s) => normalized(s) === normalized(preset.user)) ||
      a.projectDirectories.some((s) => normalized(s) === normalized(preset.project)),
  );
  if (existing) return { value: structuredClone(existing), original: existing.key, reused: true };
  let unique = preset.key as string,
    n = 2;
  while (agents.some((a) => a.key === unique)) unique = `${preset.key}-${n++}`;
  return {
    reused: false,
    value: {
      key: unique,
      name: preset.name,
      enabled: true,
      order: Math.max(-1, ...agents.map((a) => a.order)) + 1,
      userDirectories: [preset.user],
      projectDirectories: [preset.project],
      extraDirectories: [],
      readOnlySources: [],
    },
  };
}
