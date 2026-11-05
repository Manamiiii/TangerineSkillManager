import { useEffect, useState, type ReactNode } from 'react';
import licenseText from '../../LICENSE?raw';
import type { Agent, Config, Project, SourceConfig } from '../shared/config';
import type { Candidate, ResultItem, Skill, Snapshot, SyncPlan, SkillUpdatePlan } from '../shared/types';
import { AgentTemplates, AppUpdates, MarketBrowser } from './Ecosystem';
import { request } from './bridge';
import { compactPath, displayMessage } from './messages';
import { AgentEditor, Badge, Empty, Field, Icon, Modal, ProjectEditor, SourceEditor } from './components';

const navigation = [
  ['library', '本地库'],
  ['sync', '同步'],
  ['agents', 'Agent'],
  ['projects', '项目'],
  ['sources', '来源'],
  ['settings', '设置'],
] as const;
type Page = (typeof navigation)[number][0];
const labels: Record<string, string> = {
  managed: '已管理',
  external: '外部内容',
  missing: '缺失',
  outdated: '待同步更新',
  conflict: '冲突',
  install: '新增',
  update: '更新',
  skip: '跳过',
  success: '成功',
  skipped: '跳过',
  failed: '失败',
  user: '用户级',
  project: '项目级',
  extra: '额外目录',
  readonly: '只读来源',
  vault: '本地库',
  copy: '复制',
  symlink: '符号链接',
};
const tone = (s: string) =>
  ['managed', 'success'].includes(s)
    ? 'green'
    : ['conflict', 'failed'].includes(s)
      ? 'red'
      : ['outdated', 'missing', 'update'].includes(s)
        ? 'orange'
        : 'neutral';
function Status({ value }: { value: string }) {
  return <Badge tone={tone(value)}>{labels[value] ?? value}</Badge>;
}
function niceDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}
function toggle(values: string[], id: string) {
  return values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
}
export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [page, setPage] = useState<Page>('library');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [targets, setTargets] = useState<string[]>([]),
    [mode, setMode] = useState<'copy' | 'symlink'>('copy');
  const [plan, setPlan] = useState<SyncPlan>(),
    [results, setResults] = useState<ResultItem[]>([]),
    [detail, setDetail] = useState<Skill>();
  const [agentEdit, setAgentEdit] = useState<{ original?: string; value: Agent }>(),
    [projectEdit, setProjectEdit] = useState<{ original?: string; value: Project }>(),
    [sourceEdit, setSourceEdit] = useState<{ original?: string; value: SourceConfig }>();
  const [candidates, setCandidates] = useState<{ sourceKey: string; entries: Candidate[] }>(),
    [sourceQuery, setSourceQuery] = useState('');
  const [updates, setUpdates] = useState<Record<string, { available: boolean; checked: string }>>({});
  const [skillUpdate, setSkillUpdate] = useState<SkillUpdatePlan>();
  const [confirmation, setConfirmation] = useState<{
    title: string;
    body: string;
    action: () => Promise<unknown>;
  }>();
  const [settingsText, setSettingsText] = useState(''),
    [vaultDraft, setVaultDraft] = useState(''),
    [defaultMode, setDefaultMode] = useState<'copy' | 'symlink'>('copy');
  const [scope, setScope] = useState('all');
  const [dnsMode, setDnsMode] = useState<'system' | 'cloudflare'>('system');
  const applySnapshot = (value: Snapshot) => {
    setSnapshot(value);
    setSettingsText(JSON.stringify(value.config, null, 2));
    setVaultDraft(value.config.vault.root);
    setDefaultMode(value.config.defaultSyncMode);
    setDnsMode(value.config.network?.dns ?? 'system');
    setSelected((ids) => ids.filter((id) => value.skills.some((s) => s.id === id)));
    setTargets((ids) =>
      ids.filter((id) => value.targets.some((t) => t.id === id && !t.readOnly && !t.error)),
    );
    setPlan(undefined);
  };
  const refresh = async () => {
    applySnapshot(await request('snapshot', undefined));
  };
  const run = async (action: () => Promise<unknown>, message = '') => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (message) setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run(async () => {
      const s = await request('snapshot', undefined);
      applySnapshot(s);
      setMode(s.config.defaultSyncMode);
    });
  }, []);
  const save = async (config: Config) => {
    applySnapshot(await request('saveConfig', config));
  };
  const mutate = async (action: () => Promise<unknown>) => {
    await action();
    await refresh();
  };
  const confirm = (title: string, body: string, action: () => Promise<unknown>) =>
    setConfirmation({ title, body, action });
  const skills =
    snapshot?.skills.filter((s) =>
      `${s.name} ${s.description} ${s.id}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const visibleTargets = snapshot?.targets.filter((t) => scope === 'all' || t.scope === scope) ?? [];
  const heading = (title: string, subtitle: string, action?: ReactNode) => (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
  const search = (
    <label className="search">
      <Icon name="search" />
      <input
        aria-label="搜索 Skill"
        placeholder="搜索名称或描述…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </label>
  );
  const library = snapshot && (
    <>
      {heading(
        '你的 Skill，本地掌控。',
        '整理一份可信的本地库，再同步到每一个工作环境。',
        <button className="primary" onClick={() => setPage('sources')}>
          <Icon name="plus" />
          导入 Skill
        </button>,
      )}
      <div className="vault-banner">
        <div className="banner-icon">
          <Icon name="library" size={26} />
        </div>
        <div>
          <span className="eyebrow">本地库目录</span>
          <code title={snapshot.vaultPath}>{snapshot.config.vault.root}</code>
          <small>悬停查看实际目录；可在设置中修改</small>
        </div>
        <Badge tone="green">仅存储在本机</Badge>
      </div>
      <div className="toolbar spread">
        <div className="toolbar">
          <h3>
            全部 Skill <span className="count">{skills.length}</span>
          </h3>
          {selected.length > 0 && (
            <button onClick={() => setPage('sync')}>
              同步已选 {selected.length} 项<Icon name="arrow" size={16} />
            </button>
          )}
        </div>
        {search}
      </div>
      {!snapshot.skills.length ? (
        <Empty
          title="从第一份 Skill 开始"
          action={
            <div className="toolbar">
              <button
                className="primary"
                onClick={() =>
                  void run(
                    () => mutate(() => request('importExample', undefined)),
                    '已导入离线示例。下一步：确认 Agent 目录，然后预览同步。',
                  )
                }
              >
                试用内置示例
              </button>
              <button onClick={() => setPage('sources')}>
                导入自己的 Skill
                <Icon name="arrow" size={16} />
              </button>
            </div>
          }
        >
          第一步导入，第二步确认 Agent 目录，第三步预览同步。内置示例无需联网，不会自动写入任何 Agent 目录。
        </Empty>
      ) : !skills.length ? (
        <Empty title="没有匹配的 Skill">试试其他关键词。</Empty>
      ) : (
        <div className="skill-list">
          {skills.map((s) => {
            const installed = snapshot.installations.filter((i) => i.skillId === s.id),
              status = snapshot.scans.find((x) => x.scope === 'vault' && x.id === s.id)?.status ?? 'external';
            return (
              <article className="skill-card" key={s.id}>
                <input
                  type="checkbox"
                  aria-label={`选择 ${s.id}`}
                  checked={selected.includes(s.id)}
                  onChange={() => {
                    setSelected(toggle(selected, s.id));
                    setPlan(undefined);
                  }}
                />
                <div className="skill-main">
                  <div className="toolbar">
                    <button className="text-button skill-title" onClick={() => setDetail(s)}>
                      {s.name}
                    </button>
                    <Badge>{s.version ? `v${s.version}` : '未声明版本'}</Badge>
                  </div>
                  <p>{s.description || '这个 Skill 暂无描述。'}</p>
                  <div className="toolbar metadata">
                    <span>{s.source?.provider ?? '未记录来源'}</span>
                    <span>更新于 {niceDate(s.modifiedAt)}</span>
                    <Status value={status} />
                    <span className="hash">{s.hash.slice(0, 10)}</span>
                  </div>
                </div>
                <div className="skill-install">
                  <strong>{installed.length}</strong>
                  <span>个安装记录</span>
                  <div className="toolbar">
                    {[
                      ...new Set(
                        installed.map(
                          (i) => snapshot.targets.find((t) => t.id === i.targetId)?.agentName ?? i.targetId,
                        ),
                      ),
                    ]
                      .slice(0, 3)
                      .map((n) => (
                        <Badge key={n} tone="green">
                          {n}
                        </Badge>
                      ))}
                  </div>
                </div>
                <div className="skill-actions">
                  <span className="update-state">
                    {updates[s.id]
                      ? updates[s.id].available
                        ? '发现来源更新'
                        : '已检查 · 最新'
                      : s.source?.provider === 'bundled'
                        ? '应用内置示例 · 离线可用'
                        : '尚未检查更新'}
                  </span>
                  <div className="toolbar">
                    <button
                      disabled={!s.source?.sourceKey}
                      onClick={() =>
                        void run(async () => {
                          const u = await request('checkUpdate', { id: s.id });
                          setUpdates((v) => ({
                            ...v,
                            [s.id]: { available: u.available, checked: new Date().toISOString() },
                          }));
                        })
                      }
                    >
                      检查更新
                    </button>
                    {updates[s.id]?.available && (
                      <button
                        onClick={() =>
                          void run(async () => {
                            setSkillUpdate(await request('previewSkillUpdate', { id: s.id }));
                          })
                        }
                      >
                        预览更新
                      </button>
                    )}
                    <button
                      className="danger-button icon-button"
                      aria-label={`删除 ${s.id}`}
                      disabled={!s.source}
                      onClick={() =>
                        confirm(
                          '从本地库删除 Skill',
                          `仅删除本地库中的「${s.name}」。已同步的复制副本仍然保留；存在符号链接安装时将阻止删除。`,
                          () => mutate(() => request('removeSkill', { id: s.id })),
                        )
                      }
                    >
                      <Icon name="trash" size={17} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
  const sync = snapshot && (
    <>
      {heading('预览，再同步。', '选择 Skill 与目标目录。外部文件和发生变化的副本会被保留。')}
      <div className="toolbar spread">
        <div className="segmented">
          {[
            ['all', '全部范围'],
            ['user', '用户级'],
            ['project', '项目级'],
            ['readonly', '只读来源'],
          ].map(([key, label]) => (
            <button key={key} className={scope === key ? 'selected' : ''} onClick={() => setScope(key)}>
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="同步模式"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as typeof mode);
            setPlan(undefined);
          }}
        >
          <option value="copy">复制同步 · copy</option>
          <option value="symlink">符号链接 · symlink</option>
        </select>
      </div>
      {mode === 'symlink' && (
        <div className="notice warning">
          符号链接会实时反映本地库变更。需要安装元数据的 Agent 自动使用复制模式；Windows 使用目录 junction。
        </div>
      )}
      <div className="sync-layout">
        <aside className="panel target-panel">
          <h3>目标目录</h3>
          <p className="muted">已选择 {targets.length} 个</p>
          {visibleTargets.length === 0 && <p className="muted">没有目标；请添加 Agent 或绑定项目。</p>}
          {visibleTargets.map((t) => (
            <label className={`target-card ${targets.includes(t.id) ? 'active' : ''}`} key={t.id}>
              <div className="toolbar">
                <input
                  type="checkbox"
                  disabled={t.readOnly || !!t.error}
                  checked={targets.includes(t.id)}
                  onChange={() => {
                    setTargets(toggle(targets, t.id));
                    setPlan(undefined);
                  }}
                />
                <strong>{t.agentName}</strong>
                <Badge>{labels[t.scope]}</Badge>
              </div>
              {t.projectKey && (
                <small>项目：{snapshot.config.projects.find((p) => p.key === t.projectKey)?.name}</small>
              )}
              <code title={t.realPath ?? t.path}>{t.template ?? t.path}</code>
              <div className="toolbar">
                <Badge tone={t.error ? 'red' : t.exists ? 'green' : 'neutral'}>
                  {t.error ? '目录不可用' : t.exists ? '目录已存在' : '同步时创建'}
                </Badge>
              </div>
              {t.realPath && <small title={t.realPath}>悬停查看真实路径</small>}
              {t.error && <small className="error-text">{t.error}</small>}
            </label>
          ))}
        </aside>
        <section className="panel matrix-panel">
          <div className="toolbar spread">
            <h3>Skill 同步矩阵</h3>
            {search}
          </div>
          <div className="toolbar">
            <button
              onClick={() => {
                setSelected(skills.map((s) => s.id));
                setPlan(undefined);
              }}
            >
              选择筛选结果
            </button>
            <button
              onClick={() => {
                setSelected([]);
                setPlan(undefined);
              }}
            >
              清空选择
            </button>
            <span className="muted">
              {selected.length} 个 Skill × {targets.length} 个目标
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Skill</th>
                  {visibleTargets.map((t) => (
                    <th key={t.id}>
                      {t.agentName}
                      <small>{t.projectKey ?? labels[t.scope]}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {skills.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={selected.includes(s.id)}
                          onChange={() => {
                            setSelected(toggle(selected, s.id));
                            setPlan(undefined);
                          }}
                        />
                        {s.name}
                      </label>
                    </td>
                    {visibleTargets.map((t) => {
                      const record = snapshot.scans.find(
                        (x) =>
                          x.id === s.id &&
                          x.path.replaceAll('\\', '/').toLowerCase() ===
                            (t.path.replaceAll('\\', '/') + '/' + s.id).toLowerCase(),
                      );
                      return (
                        <td key={t.id}>
                          {record ? <Status value={record.status} /> : <Badge>未安装</Badge>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!skills.length && <p className="muted">本地库为空，请先导入 Skill。</p>}
          <div className="panel-footer">
            <span className="muted">
              <Icon name="shield" size={16} />
              执行前再次核对内容与归属
            </span>
            <button
              className="primary"
              disabled={!selected.length || !targets.length}
              onClick={() =>
                void run(async () => {
                  setPlan(await request('preview', { skillIds: selected, targetIds: targets, mode }));
                  setResults([]);
                })
              }
            >
              预览同步计划
              <Icon name="arrow" size={16} />
            </button>
          </div>
        </section>
      </div>
      {plan && (
        <section className="panel">
          <div className="toolbar spread">
            <div>
              <h3>同步计划</h3>
              <p className="muted">
                {plan.items.length} 项操作 · {niceDate(plan.createdAt)}
              </p>
            </div>
            <button
              className="primary"
              disabled={!plan.items.some((i) => i.action === 'install' || i.action === 'update')}
              onClick={() =>
                void run(async () => {
                  const r = await request('execute', { planId: plan.id });
                  setResults(r);
                  await refresh();
                }, '同步执行完成，请查看逐项结果。')
              }
            >
              执行计划
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Skill / 目标</th>
                  <th>模式</th>
                  <th>操作</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {plan.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.skillId}</strong>
                      <code title={i.destination}>{compactPath(i.destination, snapshot)}</code>
                    </td>
                    <td>{i.mode}</td>
                    <td>
                      <Status value={i.action} />
                    </td>
                    <td>{displayMessage(i.reason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {results.length > 0 && (
        <section className="panel">
          <h3>执行结果</h3>
          {results.map((r) => (
            <div className="result-row" key={r.id}>
              <Status value={r.status} />
              <div>
                <strong>{r.skillId}</strong>
                <code title={r.destination}>{compactPath(r.destination, snapshot)}</code>
                <small>{displayMessage(r.message)}</small>
              </div>
            </div>
          ))}
        </section>
      )}
      <details className="panel">
        <summary>扫描详情与安装记录（{snapshot.scans.length}）</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Skill / 路径</th>
                <th>范围 / 来源</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.scans.map((s, index) => {
                const record = snapshot.installations.find((i) => i.path === s.path);
                return (
                  <tr key={`${s.path}:${index}`}>
                    <td>
                      <strong>{s.name}</strong>
                      <code>{s.path}</code>
                      <small>{s.description}</small>
                      {s.hash && <small className="hash">SHA-256 {s.hash}</small>}
                      {s.modifiedAt && <small>{niceDate(s.modifiedAt)}</small>}
                    </td>
                    <td>
                      {labels[s.scope] ?? s.scope}
                      <small>{s.source}</small>
                    </td>
                    <td>
                      <Status value={s.status} />
                      <small>{displayMessage(s.detail)}</small>
                    </td>
                    <td>
                      {record && (
                        <button
                          className="danger-button"
                          onClick={() =>
                            confirm(
                              '卸载目标副本',
                              `仅移除这个已记录的安装：${record.path}。本地库内容保持不变；外部改动会阻止卸载。`,
                              () => mutate(() => request('uninstall', { id: record.id })),
                            )
                          }
                        >
                          卸载副本
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
  const agents = snapshot && (
    <>
      {heading(
        '配置你的 Agent。',
        '所有 Agent 都是可编辑配置。禁用或移除配置不会删除磁盘文件。',
        <button
          className="primary"
          onClick={() =>
            setAgentEdit({
              value: {
                key: '',
                name: '',
                enabled: true,
                order: snapshot.config.agents.length,
                userDirectories: [],
                projectDirectories: ['{workspace}/.agents/skills'],
                extraDirectories: [],
                readOnlySources: [],
              },
            })
          }
        >
          <Icon name="plus" />
          新增 Agent
        </button>,
      )}
      <AgentTemplates agents={snapshot.config.agents} edit={setAgentEdit} />
      <div className="entity-grid">
        {[...snapshot.config.agents]
          .sort((a, b) => a.order - b.order)
          .map((a, index) => (
            <article className="panel entity-card" key={a.key}>
              <div className="toolbar spread">
                <div className="toolbar">
                  <div className="entity-icon">
                    <Icon name="agents" />
                  </div>
                  <div>
                    <h3>{a.name}</h3>
                    <small>{a.key}</small>
                  </div>
                </div>
                <Badge tone={a.enabled ? 'green' : 'neutral'}>{a.enabled ? '已启用' : '已禁用'}</Badge>
              </div>
              <div className="directory-summary">
                <span>用户级目录</span>
                <code>{a.userDirectories.join('\n') || '未设置'}</code>
                <span>项目级目录</span>
                <code>{a.projectDirectories.join('\n') || '未设置'}</code>
              </div>
              <div className="toolbar metadata">
                <span>{a.extraDirectories.length} 个额外目录</span>
                <span>{a.readOnlySources.length} 个只读来源</span>
                {a.installationMetadata && <Badge>写入安装元数据</Badge>}
              </div>
              <div className="panel-footer">
                <div className="toolbar">
                  <button onClick={() => setAgentEdit({ original: a.key, value: a })}>编辑</button>
                  <button
                    onClick={() =>
                      void run(() =>
                        save({
                          ...snapshot.config,
                          agents: snapshot.config.agents.map((v) =>
                            v.key === a.key ? { ...v, enabled: !v.enabled } : v,
                          ),
                        }),
                      )
                    }
                  >
                    {a.enabled ? '禁用' : '启用'}
                  </button>
                  <button
                    className="danger-button"
                    aria-label={`移除 Agent ${a.name}`}
                    onClick={() =>
                      confirm('移除 Agent 配置', `移除「${a.name}」的配置。已安装的 Skill 不会被删除。`, () =>
                        save({
                          ...snapshot.config,
                          agents: snapshot.config.agents.filter((v) => v.key !== a.key),
                        }),
                      )
                    }
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
                <div className="toolbar">
                  {[-1, 1].map((delta) => (
                    <button
                      key={delta}
                      aria-label={`${delta === -1 ? '上移' : '下移'} ${a.name}`}
                      disabled={index + delta < 0 || index + delta >= snapshot.config.agents.length}
                      onClick={() =>
                        void run(async () => {
                          const sorted = [...snapshot.config.agents].sort((x, y) => x.order - y.order);
                          [sorted[index], sorted[index + delta]] = [sorted[index + delta], sorted[index]];
                          await save({
                            ...snapshot.config,
                            agents: sorted.map((v, i) => ({ ...v, order: i })),
                          });
                        })
                      }
                    >
                      {delta === -1 ? '↑' : '↓'}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          ))}
      </div>
      {!snapshot.config.agents.length && (
        <Empty title="尚未配置 Agent">添加 Agent，指定它读取 Skill 的目录。</Empty>
      )}
    </>
  );
  const projects = snapshot && (
    <>
      {heading(
        '让 Skill 跟随项目。',
        '绑定本地工程后，自动展开各 Agent 的 {workspace} 路径模板。',
        <button
          className="primary"
          onClick={() => setProjectEdit({ value: { key: '', name: '', root: '' } })}
        >
          <Icon name="plus" />
          绑定项目
        </button>,
      )}
      {!snapshot.config.projects.length ? (
        <Empty title="还没有绑定项目">选择任意本地工程目录；绑定操作不会修改项目内容。</Empty>
      ) : (
        snapshot.config.projects.map((p) => (
          <section className="panel" key={p.key}>
            <div className="toolbar spread">
              <div className="toolbar">
                <div className="entity-icon">
                  <Icon name="projects" />
                </div>
                <div>
                  <h3>{p.name}</h3>
                  <code>{p.root}</code>
                </div>
              </div>
              <div className="toolbar">
                <button onClick={() => setProjectEdit({ original: p.key, value: p })}>编辑</button>
                <button
                  className="danger-button"
                  onClick={() =>
                    confirm('解除项目绑定', `解除「${p.name}」的绑定，保留所有项目文件和已同步内容。`, () =>
                      save({
                        ...snapshot.config,
                        projects: snapshot.config.projects.filter((x) => x.key !== p.key),
                      }),
                    )
                  }
                >
                  解除绑定
                </button>
              </div>
            </div>
            <div className="project-targets">
              {snapshot.targets
                .filter((t) => t.projectKey === p.key)
                .map((t) => (
                  <div key={t.id}>
                    <strong>{t.agentName}</strong>
                    <code>{t.path}</code>
                    <Badge tone={t.error ? 'red' : t.exists ? 'green' : 'neutral'}>
                      {t.error ? '目录不可用' : t.exists ? '已存在' : '尚未创建'}
                    </Badge>
                    {t.realPath && <small>真实路径：{t.realPath}</small>}
                  </div>
                ))}
            </div>
          </section>
        ))
      )}
    </>
  );
  const sources = snapshot && (
    <>
      {heading(
        '来源由你选择。',
        '从本地目录或公开 Git 仓库发现 Skill，审核后导入本地库。',
        <button
          className="primary"
          onClick={() =>
            setSourceEdit({
              value: { key: '', kind: 'local', name: '', enabled: true, location: '', offline: false },
            })
          }
        >
          <Icon name="plus" />
          添加来源
        </button>,
      )}
      <MarketBrowser configure={(value) => setSourceEdit({ value })} />
      <div className="notice subtle">
        <Icon name="shield" />
        没有后台下载、账号登录或默认市场连接。Skill 内容始终作为数据处理。
      </div>
      <div className="entity-grid">
        {snapshot.config.providers.map((p) => (
          <article className="panel entity-card" key={p.key}>
            <div className="toolbar spread">
              <h3>{p.name}</h3>
              <Badge>{p.kind}</Badge>
            </div>
            <code>{p.location}</code>
            <div className="toolbar metadata">
              <Badge tone={p.enabled ? 'green' : 'neutral'}>{p.enabled ? '已启用' : '已禁用'}</Badge>
              {p.offline && <Badge>离线</Badge>}
              {p.ref && <span>{p.ref}</span>}
              {p.subdirectory && <span>{p.subdirectory}</span>}
            </div>
            <div className="panel-footer">
              <button onClick={() => setSourceEdit({ original: p.key, value: p })}>编辑</button>
              <div className="toolbar">
                <button
                  className="danger-button"
                  aria-label={`移除来源 ${p.name}`}
                  onClick={() =>
                    confirm(
                      '移除来源配置',
                      `移除「${p.name}」的配置，不会删除本地库、源文件或远程仓库。`,
                      () =>
                        save({
                          ...snapshot.config,
                          providers: snapshot.config.providers.filter((v) => v.key !== p.key),
                        }),
                    )
                  }
                >
                  <Icon name="trash" size={16} />
                </button>
                <button
                  className="primary"
                  disabled={
                    !p.enabled ||
                    !snapshot.providers.find((v) => v.kind === p.kind)?.capabilities.fetch?.supported
                  }
                  onClick={() =>
                    void run(async () =>
                      setCandidates({
                        sourceKey: p.key,
                        entries: await request('discover', { sourceKey: p.key }),
                      }),
                    )
                  }
                >
                  发现 Skill
                  <Icon name="arrow" size={16} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!snapshot.config.providers.length && (
        <Empty
          title="添加你的第一个来源"
          action={
            <button
              onClick={() =>
                setSourceEdit({
                  value: {
                    key: 'local-skills',
                    kind: 'local',
                    name: '本地 Skill',
                    enabled: true,
                    location: '',
                    offline: true,
                  },
                })
              }
            >
              选择本地目录
            </button>
          }
        >
          选择自己的 Skill 目录或公开 Git 仓库；如果只想先试用，可在本地库导入应用内置示例。
        </Empty>
      )}
      {candidates && (
        <section className="panel">
          <div className="toolbar spread">
            <h3>发现结果 · {candidates.entries.length}</h3>
            <input
              aria-label="筛选来源结果"
              placeholder="筛选名称或描述…"
              value={sourceQuery}
              onChange={(e) => setSourceQuery(e.target.value)}
            />
          </div>
          {!candidates.entries.length && <p className="muted">此来源未发现包含 SKILL.md 的目录。</p>}
          {candidates.entries
            .filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(sourceQuery.toLowerCase()))
            .map((c) => (
              <div className="candidate" key={c.relativePath}>
                <div>
                  <h3>{c.name}</h3>
                  <p>{c.description}</p>
                  <code>{c.relativePath}</code>
                  <small>导入标识：{c.id}</small>
                  {c.problem && <p className="error-text">此项无法导入：{displayMessage(c.problem)}</p>}
                </div>
                <button
                  disabled={!!c.problem || snapshot.skills.some((s) => s.id === c.id)}
                  onClick={() =>
                    void run(
                      () =>
                        mutate(() =>
                          request('importSkill', {
                            sourceKey: candidates.sourceKey,
                            relativePath: c.relativePath,
                          }),
                        ),
                      '已导入本地库，可前往同步页选择目标。',
                    )
                  }
                >
                  {c.problem
                    ? '需要修复'
                    : snapshot.skills.some((s) => s.id === c.id)
                      ? '已在本地库'
                      : '导入本地库'}
                </button>
              </div>
            ))}
        </section>
      )}
      <details className="panel">
        <summary>Provider 能力与后续扩展</summary>
        {snapshot.providers.map((p) => (
          <div className="provider-row" key={p.kind}>
            <strong>{p.name}</strong>
            <span>{p.trust}</span>
            <Badge tone={p.capabilities.fetch?.supported ? 'green' : 'neutral'}>
              {p.capabilities.fetch?.supported ? '已实现' : '尚未实现'}
            </Badge>
          </div>
        ))}
        <p className="muted">
          认证、远程删除及版本列表查询暂未实现。Git 可显式指定分支或标签；界面筛选仅搜索已发现的内容。
        </p>
      </details>
    </>
  );
  const settings = snapshot && (
    <>
      {heading('简单配置，明确边界。', '配置保存在本机。每次修改前保留备份，损坏配置不会被静默覆盖。')}
      <section className="panel settings-panel">
        <h3>本地库与同步</h3>
        <Field label="本地库根目录" hint="支持 ~、{data}；修改后切换库，不会搬移或删除原库文件。">
          <input value={vaultDraft} onChange={(e) => setVaultDraft(e.target.value)} />
        </Field>
        <button
          onClick={() =>
            void run(async () => {
              const dir = await request('chooseFolder', undefined);
              if (dir) setVaultDraft(dir);
            })
          }
        >
          选择目录
        </button>
        <Field label="默认同步模式">
          <select value={defaultMode} onChange={(e) => setDefaultMode(e.target.value as typeof defaultMode)}>
            <option value="copy">复制 · copy</option>
            <option value="symlink">符号链接 · symlink</option>
          </select>
        </Field>
        <button
          className="primary"
          onClick={() =>
            void run(
              () => save({ ...snapshot.config, vault: { root: vaultDraft }, defaultSyncMode: defaultMode }),
              '设置已保存。',
            )
          }
        >
          保存设置
        </button>
      </section>
      <section className="panel settings-panel">
        <h3>网络连接</h3>
        <p>影响公开 Git、市场搜索和应用版本查询。保存选项本身不会发起联网请求。</p>
        <Field label="域名解析方式">
          <select
            aria-label="域名解析方式"
            value={dnsMode}
            onChange={(e) => setDnsMode(e.target.value as typeof dnsMode)}
          >
            <option value="system">系统 DNS（默认）</option>
            <option value="cloudflare">Cloudflare HTTPS DNS（可选）</option>
          </select>
        </Field>
        <p className="muted">
          HTTPS DNS 可用于系统解析返回 Fake-IP 的情况。启用后，联网操作会将目标域名发送给
          Cloudflare（1.1.1.1），不发送 Skill 内容、搜索词或本机路径给 DNS 服务。 需要能够直接访问该 HTTPS
          服务及目标网站；这不是代理，不读取系统代理或修改系统 DNS。 仅支持 IPv4
          查询，不会自动切换解析方式，私网地址始终禁止。
        </p>
        <button
          className="primary"
          disabled={dnsMode === (snapshot.config.network?.dns ?? 'system')}
          onClick={() =>
            void run(async () => {
              const next = { ...snapshot.config };
              if (dnsMode === 'system') delete next.network;
              else next.network = { dns: dnsMode };
              await save(next);
            }, '网络设置已保存，下一次联网操作生效。')
          }
        >
          保存网络设置
        </button>
        <small>
          当前已保存：{snapshot.config.network?.dns === 'cloudflare' ? 'Cloudflare HTTPS DNS' : '系统 DNS'}
        </small>
      </section>
      <section className="panel">
        <h3>配置文件</h3>
        <code>{snapshot.configPath}</code>
        <details>
          <summary>高级：编辑完整配置 JSON</summary>
          <textarea
            className="code config-editor"
            aria-label="完整配置 JSON"
            rows={18}
            value={settingsText}
            onChange={(e) => setSettingsText(e.target.value)}
          />
          <button onClick={() => void run(() => save(JSON.parse(settingsText)), '配置已验证并保存。')}>
            校验并保存配置
          </button>
        </details>
      </section>
      <section className="panel">
        <h3>隐私与应用更新</h3>
        <div className="privacy-grid">
          <div>
            <Icon name="shield" />
            <strong>本地优先</strong>
            <p>无遥测，无内容上传，无账号要求。</p>
          </div>
          <div>
            <Icon name="sync" />
            <strong>主动检查更新</strong>
            <p>应用版本从 GitHub 查询，Skill 更新跟随各自来源。不会后台检查或自动安装。</p>
          </div>
        </div>
        <p className="muted">Tangerine Skill Manager 0.1.1 · GPL-3.0-only</p>
        <details>
          <summary>开源许可证 · GNU GPL v3.0</summary>
          <p>Copyright (c) 2026 Tangerine Skill Manager contributors.</p>
          <p>本软件不提供担保。你可以依照 GNU GPL 第 3 版的条款修改和再分发本软件。</p>
          <textarea aria-label="GPL v3 许可证全文" rows={12} readOnly value={licenseText} />
        </details>
        <button
          className="danger-button"
          onClick={() =>
            confirm(
              '恢复默认配置',
              '会先备份当前配置，再恢复默认设置。本地库文件和安装记录不会被删除。',
              async () => applySnapshot(await request('resetConfig', undefined)),
            )
          }
        >
          备份并恢复默认配置
        </button>
      </section>
      <AppUpdates key={snapshot.config.network?.dns ?? 'system'} />
    </>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="agents" size={26} />
          </div>
          <div>
            <strong>Tangerine</strong>
            <span>Skill Manager</span>
          </div>
        </div>
        <div className="sidebar-caption">工作空间</div>
        <nav>
          {navigation.map(([key, label]) => (
            <button
              key={key}
              aria-label={label}
              className={page === key ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setPage(key);
                setQuery('');
              }}
            >
              <Icon name={key} />
              <span>{label}</span>
              {key === 'library' && snapshot && <span className="nav-count">{snapshot.skills.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span />
            本地运行 · 无遥测
          </div>
          <span>YOUR SKILLS. YOUR CONTROL.</span>
          <small>v0.1.1 · 开源桌面应用</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <span>/</span>
            <strong>{navigation.find(([key]) => key === page)?.[1]}</strong>
          </div>
          <div className="toolbar">
            <Badge>本地优先</Badge>
            <button disabled={busy} onClick={() => void run(refresh, '扫描完成。')}>
              <Icon name="sync" size={17} />
              刷新扫描
            </button>
          </div>
        </header>
        <main>
          <div className="stats">
            {[
              [snapshot?.skills.length ?? 0, '本地库 Skill', 'library'],
              [snapshot?.config.projects.length ?? 0, '已绑定项目', 'projects'],
              [snapshot?.config.agents.filter((a) => a.enabled).length ?? 0, '已启用 Agent', 'agents'],
              [
                snapshot?.scans.filter((s) => ['outdated', 'conflict', 'missing'].includes(s.status))
                  .length ?? 0,
                '需要处理',
                'sync',
              ],
            ].map(([count, label, icon]) => (
              <div className="stat" key={String(label)}>
                <div className={`stat-icon ${icon}`}>
                  <Icon name={String(icon)} />
                </div>
                <div>
                  <strong>{count}</strong>
                  <span>{label}</span>
                </div>
              </div>
            ))}
          </div>
          {busy && (
            <div className="notice progress" role="status">
              <span className="spinner" />
              正在处理，请稍候…
            </div>
          )}
          {error && (
            <div className="notice danger" role="alert">
              <Icon name="info" />
              <div>{error}</div>
              <button aria-label="关闭错误" onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="notice success" role="status">
              <Icon name="check" />
              {notice}
            </div>
          )}
          {snapshot?.warnings.map((w, i) => (
            <div key={i} className="notice warning">
              {w}
            </div>
          ))}
          <fieldset className="page-content" disabled={busy}>
            {snapshot
              ? { library, sync, agents, projects, sources, settings }[page]
              : !busy && (
                  <Empty
                    title="暂时无法读取工作空间"
                    action={
                      <div className="toolbar">
                        <button onClick={() => void run(refresh)}>重试</button>
                        <button
                          className="danger-button"
                          onClick={() =>
                            confirm(
                              '备份并恢复默认配置',
                              '如果配置损坏，将保留原文件的备份。安装记录损坏时仍会阻止写入，请按错误信息恢复备份。',
                              async () => applySnapshot(await request('resetConfig', undefined)),
                            )
                          }
                        >
                          备份并恢复默认配置
                        </button>
                      </div>
                    }
                  >
                    请查看上方错误。原始配置和 Skill 内容会保留。
                  </Empty>
                )}
          </fieldset>
          <footer>所有写入都由你发起。外部内容与只读来源始终受到保护。</footer>
        </main>
      </div>
      {detail && (
        <Modal title={detail.name} close={() => setDetail(undefined)}>
          <div className="toolbar">
            <Badge>{detail.version ?? '未声明版本'}</Badge>
            <Badge>{detail.author ?? '未声明作者'}</Badge>
          </div>
          <Field label="内容 SHA-256">
            <code>{detail.hash}</code>
          </Field>
          <Field label="来源记录">
            <pre>{JSON.stringify(detail.source ?? { status: '未记录' }, null, 2)}</pre>
          </Field>
          <Field label="元数据">
            <pre>{JSON.stringify(detail.metadata, null, 2)}</pre>
          </Field>
          <Field label="SKILL.md（只读）">
            <pre className="markdown-preview">{detail.markdown}</pre>
          </Field>
        </Modal>
      )}
      {skillUpdate && (
        <Modal title="预览 Skill 更新" close={() => setSkillUpdate(undefined)}>
          <p>
            {skillUpdate.skillId} · {skillUpdate.changes.length} 个文件或目录变化
          </p>
          <p className="muted">
            预览有效至 {niceDate(skillUpdate.expiresAt)}。执行使用这份内容快照，不再重新下载来源。
          </p>
          {skillUpdate.commit && (
            <p>
              来源 commit：<code>{skillUpdate.commit}</code>
            </p>
          )}
          <Field label="当前内容 hash">
            <code>{skillUpdate.currentHash}</code>
          </Field>
          <Field label="更新内容 hash">
            <code>{skillUpdate.latestHash}</code>
          </Field>
          <div className="notice">
            复制副本保持原样，更新后请预览同步。
            {skillUpdate.linkedTargets > 0
              ? `注意：${skillUpdate.linkedTargets} 个已记录的符号链接目标会立即看到本地库更新。`
              : '如果你在其他地方手动创建了指向本地库的链接，它们也会随库更新。'}
          </div>
          <div className="markdown-preview">
            {skillUpdate.changes.map((c) => (
              <p key={c.path}>
                <Badge>{{ added: '新增', modified: '修改', removed: '删除' }[c.action]}</Badge>{' '}
                <code>{c.path}</code>
              </p>
            ))}
          </div>
          <div className="modal-actions">
            <button disabled={busy} onClick={() => setSkillUpdate(undefined)}>
              取消
            </button>
            <button
              className="primary"
              disabled={busy || !skillUpdate.changes.length}
              onClick={() =>
                void run(async () => {
                  const preview = skillUpdate;
                  setSkillUpdate(undefined);
                  await mutate(() => request('applySkillUpdate', { planId: preview.id }));
                  setUpdates((v) => {
                    const next = { ...v };
                    delete next[preview.skillId];
                    return next;
                  });
                }, '已应用预览中的内容；复制副本可在同步页预览更新，符号链接已引用新内容。')
              }
            >
              应用此更新
            </button>
          </div>
        </Modal>
      )}
      {agentEdit && snapshot && (
        <AgentEditor
          initial={agentEdit.value}
          close={() => setAgentEdit(undefined)}
          save={async (a) => {
            const agents = snapshot.config.agents.filter((x) => x.key !== agentEdit.original);
            await save({ ...snapshot.config, agents: [...agents, a] });
          }}
        />
      )}
      {projectEdit && snapshot && (
        <ProjectEditor
          initial={projectEdit.value}
          close={() => setProjectEdit(undefined)}
          save={async (p) => {
            await save({
              ...snapshot.config,
              projects: [...snapshot.config.projects.filter((x) => x.key !== projectEdit.original), p],
            });
          }}
        />
      )}
      {sourceEdit && snapshot && (
        <SourceEditor
          initial={sourceEdit.value}
          providers={snapshot.providers}
          close={() => setSourceEdit(undefined)}
          save={async (p) => {
            await save({
              ...snapshot.config,
              providers: [...snapshot.config.providers.filter((x) => x.key !== sourceEdit.original), p],
            });
            setCandidates(undefined);
          }}
        />
      )}
      {confirmation && (
        <Modal title={confirmation.title} close={() => setConfirmation(undefined)}>
          <p>{confirmation.body}</p>
          <div className="modal-actions">
            <button onClick={() => setConfirmation(undefined)}>取消</button>
            <button
              className="danger-solid"
              onClick={() => {
                const action = confirmation.action;
                setConfirmation(undefined);
                void run(action, '操作完成。');
              }}
            >
              确认操作
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
