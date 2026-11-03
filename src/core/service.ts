import path from 'node:path';
import { z } from 'zod';
import { configSchema, keySchema, type Config } from '../shared/config';
import type { Commands, Snapshot } from '../shared/types';
import { Store } from './store';
import { Vault } from './vault';
import { SyncEngine } from './sync';
import { expandPath, assertNoLinks, identity, contains, type PathContext } from './paths';
import { resolveTargets } from './targets';
import { scanTargets } from './scanner';
import { LocalFolderProvider, GitProvider, ProviderRegistry } from './providers';
import { fail } from './errors';
import { SkillUpdates } from './skill-updates';
import { MarketRegistry, GitHubMarket, SkillsMPMarket } from './markets';
import { resolvePublic, type AddressResolver } from './network';
import { createPublicJson, type JsonClient } from './public-json';
type CoreCommand = Exclude<keyof Commands, 'chooseFolder' | 'openExternal' | 'checkAppUpdate'>;
const byId = z.strictObject({ id: keySchema });
const validators = {
  searchMarkets: z.strictObject({
    query: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[\p{L}\p{N}\s._-]+$/u),
    markets: z
      .array(z.enum(['github', 'skillsmp']))
      .min(1)
      .max(2)
      .refine((v) => new Set(v).size === v.length),
  }),
  previewSkillUpdate: byId,
  applySkillUpdate: z.strictObject({ planId: z.string().uuid() }),
  importExample: z.undefined(),
  snapshot: z.undefined(),
  saveConfig: configSchema,
  resetConfig: z.undefined(),
  chooseFolder: z.undefined(),
  discover: z.strictObject({ sourceKey: keySchema }),
  importSkill: z.strictObject({ sourceKey: keySchema, relativePath: z.string().max(2048) }),
  updateSkill: byId,
  checkUpdate: byId,
  removeSkill: byId,
  uninstall: z.strictObject({ id: z.string().regex(/^[a-f0-9]{64}$/) }),
  preview: z.strictObject({
    skillIds: z.array(keySchema).min(1).max(500),
    targetIds: z.array(z.string().max(256)).min(1).max(100),
    mode: z.enum(['copy', 'symlink']),
  }),
  execute: z.strictObject({ planId: z.string().uuid() }),
};
export class ApplicationService {
  readonly store: Store;
  readonly ctx: PathContext;
  readonly providers: ProviderRegistry;
  private engines = new Map<string, SyncEngine>();
  private queue: Promise<unknown> = Promise.resolve();
  private updates = new SkillUpdates();
  private markets: MarketRegistry;
  readonly jsonClient: JsonClient;
  readonly resolveNetwork: AddressResolver;
  constructor(
    data: string,
    home: string,
    providers?: ProviderRegistry,
    private exampleDirectory?: string,
  ) {
    this.store = new Store(path.join(data, 'skill-manager'));
    this.resolveNetwork = async (host, signal) =>
      resolvePublic(host, signal, (await this.store.loadConfig()).network?.dns);
    this.jsonClient = createPublicJson(this.resolveNetwork);
    this.markets = this.makeMarkets();
    this.ctx = { data, home, base: this.store.directory };
    this.providers = providers ?? new ProviderRegistry();
    if (!providers) {
      this.providers.register(new LocalFolderProvider(this.ctx));
      this.providers.register(
        new GitProvider(path.join(this.store.directory, 'cache'), undefined, this.resolveNetwork),
      );
    }
  }
  private makeMarkets() {
    return new MarketRegistry([new GitHubMarket(this.jsonClient), new SkillsMPMarket(this.jsonClient)]);
  }
  private vault(c: Config): Vault {
    return new Vault(expandPath(c.vault.root, this.ctx), this.store);
  }
  private engine(c: Config): SyncEngine {
    const vault = this.vault(c),
      key = identity(vault.root);
    if (!this.engines.has(key)) this.engines.set(key, new SyncEngine(this.store, this.ctx, vault));
    return this.engines.get(key)!;
  }
  request<K extends CoreCommand>(command: K, raw: unknown): Promise<Commands[K]['output']> {
    if (command === 'searchMarkets') {
      const input = validators.searchMarkets.parse(raw);
      return this.markets.search(input.query, input.markets) as Promise<Commands[K]['output']>;
    }
    const run = this.queue.then(async () => {
      if (!(command in validators)) fail('INVALID_COMMAND', 'Unknown application command.');
      const input = validators[command].parse(raw);
      const value = await this.dispatch(command, input);
      await this.store.log('OPERATION_COMPLETE').catch(() => {});
      return value;
    });
    this.queue = run.catch(async () => {
      await this.store.log('OPERATION_FAILED').catch(() => {});
    });
    return run as Promise<Commands[K]['output']>;
  }
  private async snapshot(config?: Config): Promise<Snapshot> {
    const c = config ?? (await this.store.loadConfig()),
      state = await this.store.loadState(),
      vault = this.vault(c);
    const { skills, warnings } = await vault.list(),
      targets = await resolveTargets(c, this.ctx);
    warnings.push(...targets.filter((t) => t.error).map((t) => `${t.agentName}: ${t.error}`));
    const scans = await scanTargets(
      targets,
      state,
      vault.root,
      Object.fromEntries(skills.map((s) => [s.id, s.hash])),
      warnings,
    );
    for (const skill of skills) {
      const record = vault.records(state)[skill.id];
      scans.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        path: skill.path,
        scope: 'vault',
        source: skill.source?.provider ?? 'Local library',
        hash: skill.hash,
        modifiedAt: skill.modifiedAt,
        status: record ? (record.hash === skill.hash ? 'managed' : 'conflict') : 'external',
      });
    }
    return {
      config: c,
      configPath: this.store.configPath,
      vaultPath: vault.root,
      skills,
      targets,
      scans,
      installations: Object.values(state.installations),
      providers: this.providers.list(),
      warnings,
    };
  }
  private source(c: Config, key: string) {
    const source = c.providers.find((p) => p.key === key && p.enabled);
    if (!source)
      return fail(
        'SOURCE_MISSING',
        'Source is missing or disabled. Restore its configuration to update this Skill.',
      );
    return { settings: source, provider: this.providers.get(source.kind) };
  }
  private async validateVaultRoot(c: Config): Promise<void> {
    const vault = expandPath(c.vault.root, this.ctx);
    await assertNoLinks(vault);
    if (contains(vault, this.store.directory) || identity(vault) === identity(this.ctx.home))
      fail('INVALID_VAULT', 'Choose a dedicated library subdirectory, not the home or app state root.');
  }
  private async validateConfigPaths(c: Config): Promise<void> {
    await this.validateVaultRoot(c);
    for (const p of c.projects) expandPath(p.root, this.ctx);
    for (const p of c.providers.filter((p) => p.kind === 'local')) expandPath(p.location, this.ctx);
    const targets = await resolveTargets(c, this.ctx);
    const invalid = targets.find((t) => t.error);
    if (invalid) fail('INVALID_TARGET', invalid.error!);
  }
  private async dispatch(command: string, input: unknown): Promise<unknown> {
    if (command === 'resetConfig') {
      this.engines.clear();
      this.markets = this.makeMarkets();
      return this.snapshot(await this.store.reset());
    }
    const config = await this.store.loadConfig();
    if (command === 'snapshot') return this.snapshot(config);
    if (command === 'saveConfig') {
      const next = configSchema.parse(input);
      await this.validateConfigPaths(next);
      await this.store.saveConfig(next);
      if (config.network?.dns !== next.network?.dns) this.markets = this.makeMarkets();
      this.engines.clear();
      return this.snapshot(next);
    }
    if (['importExample', 'importSkill', 'updateSkill', 'applySkillUpdate', 'removeSkill'].includes(command))
      await this.validateVaultRoot(config);
    const vault = this.vault(config),
      engine = this.engine(config);
    switch (command) {
      case 'applySkillUpdate':
        return this.updates.apply(vault, config, (input as Commands['applySkillUpdate']['input']).planId);
      case 'importExample': {
        if (!this.exampleDirectory)
          fail(
            'NOT_IMPLEMENTED',
            'The bundled example is not available in this build. Import a local Skill instead.',
          );
        return vault.import(
          this.exampleDirectory,
          { provider: 'bundled', location: 'bundled:clear-plan', importedAt: new Date().toISOString() },
          'clear-plan',
        );
      }
      case 'discover': {
        const { settings, provider } = this.source(
          config,
          (input as Commands['discover']['input']).sourceKey,
        );
        return provider.discover(settings);
      }
      case 'importSkill': {
        const request = input as Commands['importSkill']['input'],
          { settings, provider } = this.source(config, request.sourceKey);
        const artifact = await provider.fetch(settings, request.relativePath);
        try {
          return await vault.import(artifact.directory, artifact.provenance, artifact.id);
        } finally {
          await artifact.dispose();
        }
      }
      case 'updateSkill':
      case 'previewSkillUpdate':
      case 'checkUpdate': {
        const skill = await vault.get((input as { id: string }).id);
        if (!skill.source?.sourceKey) fail('SOURCE_MISSING', 'This Skill has no configured source record.');
        const { settings, provider } = this.source(config, skill.source.sourceKey);
        if (settings.kind !== skill.source.provider || settings.location !== skill.source.location)
          fail(
            'SOURCE_CHANGED',
            'Source identity changed. Restore the original source or explicitly import a different Skill.',
          );
        if (
          settings.kind === 'git' &&
          (skill.source.repositorySubdirectory === undefined ||
            (settings.subdirectory || '') !== skill.source.repositorySubdirectory)
        )
          fail(
            'SOURCE_CHANGED',
            'The repository source subdirectory changed or is missing from this older source record. Restore the original source configuration or explicitly reimport this Skill.',
          );
        const relative = skill.source.subdirectory ?? '.';
        if (command === 'checkUpdate') return provider.checkUpdate(settings, relative, skill.hash);
        if (command === 'updateSkill') fail('PREVIEW_REQUIRED', '请先预览 Skill 更新，再执行该预览。');
        const artifact = await provider.fetch(settings, relative);
        try {
          return await this.updates.preview(vault, config, skill.id, artifact);
        } finally {
          await artifact.dispose();
        }
      }
      case 'removeSkill':
        return vault.remove((input as { id: string }).id);
      case 'uninstall':
        return engine.uninstall((input as { id: string }).id);
      case 'preview':
        return engine.preview(input as Commands['preview']['input'], config);
      case 'execute':
        return engine.execute((input as { planId: string }).planId);
      default:
        return fail('INVALID_COMMAND', 'Unknown application command.');
    }
  }
}
