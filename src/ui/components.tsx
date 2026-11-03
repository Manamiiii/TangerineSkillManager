import { useState, useRef, useEffect, type ReactNode, type FormEvent } from 'react';
import type { Agent, Project, SourceConfig } from '../shared/config';
import type { ProviderInfo } from '../shared/types';
import { request } from './bridge';
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    library: 'M4 7h16v14H4z M3 3h18v4H3z M9 12h6',
    sync: 'M20 7a8 8 0 0 0-14-2L3 8 M3 3v5h5 M4 17a8 8 0 0 0 14 2l3-3 M21 21v-5h-5',
    agents: 'm12 3 10 5-10 5L2 8z M2 12l10 5 10-5 M2 16l10 5 10-5',
    projects: 'M3 5h6l2 3h10v12H3z',
    sources: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 6 5 12 0 18-5-6-5-12 0-18',
    settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
    plus: 'M12 5v14 M5 12h14',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    shield: 'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6',
    close: 'm6 6 12 12 M6 18 18 6',
    check: 'm5 12 4 4L19 6',
    info: 'M12 11v6 M12 7v1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.library} />
    </svg>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name="library" size={30} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({ title, children, close }: { title: string; children: ReactNode; close(): void }) {
  const modal = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (
      modal.current?.querySelector<HTMLElement>('input, textarea, select') ??
      modal.current?.querySelector<HTMLElement>('button')
    )?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
        if (e.key === 'Tab') {
          const nodes = Array.from(
            modal.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary',
            ) ?? [],
          ).filter((n) => n.getClientRects().length);
          const first = nodes[0],
            last = nodes.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <section ref={modal} className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-title">
          <h2>{title}</h2>
          <button aria-label="关闭" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
const lines = (s: string) =>
  s
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);
type EditProps<T> = { initial: T; save(value: T): Promise<void>; close(): void };
export function AgentEditor({ initial, save, close }: EditProps<Agent>) {
  const [agent, set] = useState(() => ({
      ...initial,
      key: initial.key || `agent-${crypto.randomUUID().slice(0, 8)}`,
    })),
    [metadata, setMetadata] = useState(
      initial.installationMetadata ? JSON.stringify(initial.installationMetadata, null, 2) : '',
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await save({ ...agent, installationMetadata: metadata.trim() ? JSON.parse(metadata) : undefined });
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="配置 Agent" close={close}>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="form-grid">
            <Field label="唯一标识" hint="已自动生成，也可使用小写字母、数字和连字符修改">
              <input required value={agent.key} onChange={(e) => set({ ...agent, key: e.target.value })} />
            </Field>
            <Field label="显示名称">
              <input required value={agent.name} onChange={(e) => set({ ...agent, name: e.target.value })} />
            </Field>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={agent.enabled}
              onChange={(e) => set({ ...agent, enabled: e.target.checked })}
            />
            启用此 Agent
          </label>
          <Field label="用户级目录" hint="每行一个目录，例如 ~/.agents/skills">
            <textarea
              rows={2}
              value={agent.userDirectories.join('\n')}
              onChange={(e) => set({ ...agent, userDirectories: lines(e.target.value) })}
            />
          </Field>
          <Field label="项目级目录" hint="每行一个目录，使用 {workspace} 引用已绑定项目">
            <textarea
              rows={2}
              value={agent.projectDirectories.join('\n')}
              onChange={(e) => set({ ...agent, projectDirectories: lines(e.target.value) })}
            />
          </Field>
          <details>
            <summary>高级配置：额外目录、只读来源和安装元数据</summary>
            <Field label="额外目录">
              <textarea
                rows={2}
                value={agent.extraDirectories.join('\n')}
                onChange={(e) => set({ ...agent, extraDirectories: lines(e.target.value) })}
              />
            </Field>
            <Field label="只读来源" hint="只用于发现和冲突提示，不能作为同步目标">
              <textarea
                rows={2}
                value={agent.readOnlySources.join('\n')}
                onChange={(e) => set({ ...agent, readOnlySources: lines(e.target.value) })}
              />
            </Field>
            <Field
              label="安装元数据 JSON"
              hint={
                '留空关闭；示例：{"filename":"install.json","values":{"channel":"local"}}。启用后自动使用 copy。'
              }
            >
              <textarea
                className="code"
                rows={5}
                value={metadata}
                onChange={(e) => setMetadata(e.target.value)}
              />
            </Field>
          </details>
          {error && (
            <div role="alert" className="notice danger">
              {error}
            </div>
          )}
          <div className="modal-actions">
            <button type="button" onClick={close}>
              取消
            </button>
            <button className="primary" type="submit">
              保存 Agent
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
export function ProjectEditor({ initial, save, close }: EditProps<Project>) {
  const [value, set] = useState(() => ({
      ...initial,
      key: initial.key || `project-${crypto.randomUUID().slice(0, 8)}`,
    })),
    [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await save(value);
      close();
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <Modal title="绑定项目" close={close}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="项目标识">
            <input required value={value.key} onChange={(e) => set({ ...value, key: e.target.value })} />
          </Field>
          <Field label="项目名称">
            <input required value={value.name} onChange={(e) => set({ ...value, name: e.target.value })} />
          </Field>
        </div>
        <Field label="项目目录">
          <input required value={value.root} onChange={(e) => set({ ...value, root: e.target.value })} />
        </Field>
        <button
          type="button"
          onClick={() =>
            void request('chooseFolder', undefined)
              .then((root) => root && set({ ...value, root }))
              .catch((e) => setError(String(e)))
          }
        >
          选择本地目录
        </button>
        {error && (
          <div className="notice danger" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={close}>
            取消
          </button>
          <button className="primary">保存项目</button>
        </div>
      </form>
    </Modal>
  );
}
export function SourceEditor({
  initial,
  providers,
  save,
  close,
}: EditProps<SourceConfig> & { providers: ProviderInfo[] }) {
  const [value, set] = useState(() => ({
      ...initial,
      key: initial.key || `source-${crypto.randomUUID().slice(0, 8)}`,
    })),
    [error, setError] = useState('');
  const fields = providers.find((p) => p.kind === value.kind)?.settings;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await save(value);
      close();
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <Modal title="配置来源" close={close}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="来源标识" hint="已自动生成，无需记住或手动填写">
            <input required value={value.key} onChange={(e) => set({ ...value, key: e.target.value })} />
          </Field>
          <Field label="显示名称">
            <input required value={value.name} onChange={(e) => set({ ...value, name: e.target.value })} />
          </Field>
        </div>
        <Field label="Provider">
          <select
            aria-label="Provider"
            value={value.kind}
            onChange={(e) =>
              set({
                ...value,
                kind: e.target.value as SourceConfig['kind'],
                ref: undefined,
                subdirectory: undefined,
              })
            }
          >
            {providers.map((p) => (
              <option key={p.kind} value={p.kind} disabled={!p.capabilities.fetch?.supported}>
                {p.name}
                {!p.capabilities.fetch?.supported ? ' · 尚未实现' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="位置" hint="本地目录路径或公开 HTTPS Git 仓库 URL；不接受账号密码或 token">
          <input
            required
            value={value.location}
            onChange={(e) => set({ ...value, location: e.target.value })}
          />
        </Field>
        {fields?.locationKind === 'folder' && (
          <button
            type="button"
            onClick={() =>
              void request('chooseFolder', undefined)
                .then(
                  (location) =>
                    location &&
                    set({
                      ...value,
                      location,
                      name: value.name || location.split(/[\\/]/).filter(Boolean).at(-1) || '本地 Skill',
                    }),
                )
                .catch((e) => setError(String(e)))
            }
          >
            选择本地目录
          </button>
        )}
        {(fields?.ref || fields?.subdirectory) && (
          <div className="form-grid">
            <Field label="分支 / 标签（可选）">
              <input
                value={value.ref ?? ''}
                onChange={(e) => set({ ...value, ref: e.target.value || undefined })}
              />
            </Field>
            <Field label="仓库子目录（可选）">
              <input
                value={value.subdirectory ?? ''}
                onChange={(e) => set({ ...value, subdirectory: e.target.value || undefined })}
              />
            </Field>
          </div>
        )}
        <div className="toolbar">
          <label className="check">
            <input
              type="checkbox"
              checked={value.enabled}
              onChange={(e) => set({ ...value, enabled: e.target.checked })}
            />
            启用来源
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={value.offline}
              onChange={(e) => set({ ...value, offline: e.target.checked })}
            />
            离线模式
          </label>
        </div>
        <p className="muted">
          导入只会复制文件，不会执行 Skill 中的指令或脚本。公开 Git 来源仅在你发起操作时联网。
        </p>
        {error && (
          <div className="notice danger" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={close}>
            取消
          </button>
          <button className="primary">保存来源</button>
        </div>
      </form>
    </Modal>
  );
}
