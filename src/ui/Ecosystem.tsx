import { useState } from 'react';
import type { Agent, SourceConfig } from '../shared/config';
import type { AppUpdate, MarketSearch } from '../shared/types';
import { agentPresets, presetDraft } from '../shared/agent-presets';
import { request } from './bridge';
import { Badge, Field } from './components';

export function AppUpdates() {
  const [result, setResult] = useState<AppUpdate>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function act(fn: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="应用版本更新">
      <h3>应用版本更新 · GitHub Releases</h3>
      <p>仅在点击时连接本项目的 GitHub 公开发行接口。便携版通过浏览器下载后手动替换，不会自动安装。</p>
      <div className="toolbar">
        <button
          disabled={busy}
          onClick={() => void act(async () => setResult(await request('checkAppUpdate', undefined)))}
        >
          {busy ? '正在处理…' : '检查应用更新'}
        </button>
        <button
          disabled={busy}
          onClick={() => void act(() => request('openExternal', { destination: 'releases' }))}
        >
          打开 GitHub 发行页
        </button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {result && (
        <div role="status">
          <p>
            当前版本 {result.currentVersion} ·{' '}
            {result.status === 'available'
              ? `发现新版 ${result.latestVersion}`
              : result.status === 'current'
                ? '没有更高的正式版本'
                : '暂无可查询的正式版本'}
          </p>
          <small>检查时间：{new Date(result.checkedAt).toLocaleString('zh-CN')} · 一分钟内复用检查结果</small>
          <pre className="markdown-preview">{result.notes || '此版本没有发行说明。'}</pre>
          <p className="muted">
            发行说明按纯文本显示。请在发行页选择对应系统和架构的产物；不自动切换到预发行版。
          </p>
        </div>
      )}
    </section>
  );
}

export function AgentTemplates({
  agents,
  edit,
}: {
  agents: Agent[];
  edit(value: { value: Agent; original?: string }): void;
}) {
  const [selected, setSelected] = useState('codex');
  const preset = agentPresets.find((p) => p.key === selected)!;
  const draft = presetDraft(selected, agents);
  return (
    <section className="panel">
      <h3>从常用 Agent 模板添加</h3>
      <Field label="Agent 模板">
        <select aria-label="Agent 模板" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {agentPresets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <p>{preset.note}</p>
      <p>
        <code>{preset.user}</code> · <code>{preset.project}</code>
      </p>
      {draft.reused && (
        <p className="notice">
          已有配置「{draft.value.name}」使用相同目录，将打开它供你编辑，避免重复创建写入目标。
        </p>
      )}
      <button onClick={() => edit(draft)}>{draft.reused ? '编辑已有目录配置' : '使用此模板'}</button>
      <small>
        模板不会自动保存或安装 Agent。兼容别名可能使其他 Agent 也读到这些 Skill；Windows 与 WSL 需分别配置。
      </small>
    </section>
  );
}

export function MarketBrowser({ configure }: { configure(source: SourceConfig): void }) {
  const [query, setQuery] = useState(''),
    [markets, setMarkets] = useState<Array<'github' | 'skillsmp'>>(['github']);
  const [results, setResults] = useState<MarketSearch>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function open(destination: 'skills-sh' | 'skillsmp' | 'clawhub' | 'repository', url?: string) {
    try {
      await request('openExternal', { destination, ...(url ? { url } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <details className="panel" aria-label="发现 Skill 市场">
      <summary>发现 Skill · 多来源搜索与市场入口</summary>
      <p>
        只向勾选的服务发送搜索词，不发送本地库、路径或配置。结果未经本工具安全认证；导入不会执行其中的脚本。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setResults(undefined);
          void request('searchMarkets', { query: query.trim(), markets })
            .then(setResults)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setBusy(false));
        }}
      >
        <Field label="市场搜索词" hint="2～120 字；使用文字、数字、空格、点、下划线或连字符。">
          <input
            minLength={2}
            maxLength={120}
            required
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <div className="toolbar">
          {(['github', 'skillsmp'] as const).map((key) => (
            <label className="check" key={key}>
              <input
                type="checkbox"
                checked={markets.includes(key)}
                onChange={(e) =>
                  setMarkets(e.target.checked ? [...markets, key] : markets.filter((v) => v !== key))
                }
              />
              {key === 'github' ? 'GitHub 主题仓库' : 'SkillsMP（实验性）'}
            </label>
          ))}
          <button className="primary" disabled={busy || !markets.length}>
            {busy ? '正在搜索…' : '搜索选中来源'}
          </button>
        </div>
      </form>
      <p className="muted">
        GitHub 搜索仓库，不保证每个结果含有 Skill。SkillsMP
        匿名接口可能限流或要求认证；不支持的响应会明确报错。
      </p>
      <div className="toolbar">
        <button onClick={() => void open('skills-sh')}>浏览 skills.sh</button>
        <button onClick={() => void open('skillsmp')}>浏览 SkillsMP</button>
        <button onClick={() => void open('clawhub')}>浏览 ClawHub</button>
      </div>
      <small>上述按钮打开系统浏览器。skills.sh、ClawHub 尚未接入应用内搜索或制品安装。</small>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {results && (
        <div aria-live="polite">
          {results.sources.map((s) => (
            <p key={s.key} className={s.status === 'failed' ? 'error-text' : 'muted'}>
              {s.key}：{s.status === 'failed' ? '搜索失败' : `${s.count} 条结果`}
              {s.cached ? '（缓存）' : ''} · {s.message}
            </p>
          ))}
          {!results.entries.length && <p>没有可展示的结果。请查看各来源状态，调整搜索词或使用浏览器入口。</p>}
          {results.entries.map((c) => (
            <div className="candidate" key={c.identity}>
              <div>
                <h3>{c.name}</h3>
                <p>{c.description}</p>
                <code>{c.sourceUrl}</code>
                <div className="toolbar">
                  {c.markets.map((m) => (
                    <Badge key={m}>{m}</Badge>
                  ))}
                  <Badge>{c.kind === 'repository' ? '仓库' : 'Skill 条目'}</Badge>
                </div>
              </div>
              <div className="toolbar">
                <button onClick={() => void open('repository', c.sourceUrl)}>查看原始来源</button>
                <button
                  onClick={() =>
                    configure({
                      key: '',
                      kind: 'git',
                      name: c.name.slice(0, 100),
                      location: c.repository,
                      enabled: true,
                      offline: false,
                    })
                  }
                >
                  配置仓库来源
                </button>
              </div>
            </div>
          ))}
          {!!results.entries.length && (
            <p className="muted">
              配置时请核对原地址中的分支和子目录；保存后点击“发现
              Skill”，选择实际目录再导入。不会猜测含斜杠的分支名，也不会自动安装。
            </p>
          )}
        </div>
      )}
    </details>
  );
}
