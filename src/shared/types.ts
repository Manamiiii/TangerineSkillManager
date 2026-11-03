import type { Config, SourceConfig, SyncMode } from './config';
export interface Provenance {
  provider: string;
  sourceKey?: string;
  location: string;
  ref?: string;
  subdirectory?: string;
  repositorySubdirectory?: string;
  commit?: string;
  importedAt: string;
}
export interface Skill {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  metadata: Record<string, unknown>;
  path: string;
  hash: string;
  modifiedAt: string;
  markdown: string;
  source?: Provenance;
}
export type ManagedStatus = 'managed' | 'external' | 'missing' | 'outdated' | 'conflict';
export interface Target {
  id: string;
  agentKey: string;
  agentName: string;
  scope: 'user' | 'project' | 'extra' | 'readonly';
  projectKey?: string;
  path: string;
  realPath?: string;
  template?: string;
  exists: boolean;
  readOnly: boolean;
  error?: string;
}
export interface ScanEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  scope: string;
  source: string;
  hash?: string;
  modifiedAt?: string;
  status: ManagedStatus;
  detail?: string;
}
export interface InstallRecord {
  id: string;
  skillId: string;
  targetId: string;
  root: string;
  path: string;
  source: string;
  mode: SyncMode;
  hash: string;
  installedHash: string;
  token: string;
  installedAt: string;
  metadataFilename?: string;
}
export interface VaultRecord {
  id: string;
  hash: string;
  source: Provenance;
  updatedAt: string;
}
export interface State {
  version: 1;
  vaults: Record<string, Record<string, VaultRecord>>;
  installations: Record<string, InstallRecord>;
}
export interface Capability {
  supported: boolean;
  reason?: string;
}
export interface ProviderInfo {
  kind: string;
  name: string;
  capabilities: Record<string, Capability>;
  trust: string;
  settings?: { locationKind: 'folder' | 'url'; ref: boolean; subdirectory: boolean };
}
export interface Candidate {
  id: string;
  name: string;
  description: string;
  version?: string;
  relativePath: string;
  problem?: string;
}
export interface SyncRequest {
  skillIds: string[];
  targetIds: string[];
  mode: SyncMode;
}
export interface PlanItem {
  id: string;
  skillId: string;
  targetId: string;
  destination: string;
  mode: SyncMode;
  action: 'install' | 'update' | 'skip' | 'conflict';
  reason: string;
  sourceHash: string;
  targetFingerprint: string;
}
export interface SyncPlan {
  id: string;
  createdAt: string;
  items: PlanItem[];
}
export interface ResultItem {
  id: string;
  skillId: string;
  destination: string;
  status: 'success' | 'skipped' | 'conflict' | 'failed';
  message: string;
}
export interface Snapshot {
  config: Config;
  configPath: string;
  vaultPath: string;
  skills: Skill[];
  targets: Target[];
  scans: ScanEntry[];
  installations: InstallRecord[];
  providers: ProviderInfo[];
  warnings: string[];
}
export interface Failure {
  code: string;
  message: string;
}
export type Reply<T> = { ok: true; value: T } | { ok: false; error: Failure };
export interface Commands {
  checkAppUpdate: { input: undefined; output: AppUpdate };
  openExternal: {
    input: { destination: 'releases' | 'skills-sh' | 'skillsmp' | 'clawhub' | 'repository'; url?: string };
    output: void;
  };
  searchMarkets: { input: { query: string; markets: Array<'github' | 'skillsmp'> }; output: MarketSearch };
  previewSkillUpdate: { input: { id: string }; output: SkillUpdatePlan };
  applySkillUpdate: { input: { planId: string }; output: Skill };
  importExample: { input: undefined; output: Skill };
  snapshot: { input: undefined; output: Snapshot };
  saveConfig: { input: Config; output: Snapshot };
  resetConfig: { input: undefined; output: Snapshot };
  chooseFolder: { input: undefined; output: string | null };
  discover: { input: { sourceKey: string }; output: Candidate[] };
  importSkill: { input: { sourceKey: string; relativePath: string }; output: Skill };
  updateSkill: { input: { id: string }; output: Skill };
  checkUpdate: {
    input: { id: string };
    output: { available: boolean; currentHash: string; latestHash: string };
  };
  removeSkill: { input: { id: string }; output: void };
  uninstall: { input: { id: string }; output: void };
  preview: { input: SyncRequest; output: SyncPlan };
  execute: { input: { planId: string }; output: ResultItem[] };
}
export interface Bridge {
  request<K extends keyof Commands>(
    command: K,
    input: Commands[K]['input'],
  ): Promise<Reply<Commands[K]['output']>>;
}
export type ProviderSettings = SourceConfig;

export interface AppUpdate {
  status: 'available' | 'current' | 'unavailable';
  currentVersion: string;
  latestVersion?: string;
  notes: string;
  checkedAt: string;
}
export interface SkillUpdatePlan {
  id: string;
  skillId: string;
  currentHash: string;
  latestHash: string;
  commit?: string;
  expiresAt: string;
  linkedTargets: number;
  changes: Array<{ path: string; action: 'added' | 'modified' | 'removed' }>;
}
export interface MarketCandidate {
  identity: string;
  name: string;
  description: string;
  repository: string;
  sourceUrl: string;
  kind: 'skill' | 'repository';
  markets: string[];
}
export interface MarketSearch {
  entries: MarketCandidate[];
  sources: Array<{
    key: string;
    status: 'success' | 'failed';
    count: number;
    message?: string;
    cached?: boolean;
  }>;
}
