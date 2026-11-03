import { z } from 'zod';
export const networkSchema = z.strictObject({ dns: z.enum(['system', 'cloudflare']) });
export type DnsMode = z.infer<typeof networkSchema>['dns'];

export const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/)
  .refine((v) => !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(v), 'Reserved device name');
const template = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => !/[\x00-\x1f]/.test(v), 'Control character in path');
const metadata = z.strictObject({
  filename: z
    .string()
    .regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.json$/)
    .refine(
      (v) =>
        !v.toLowerCase().startsWith('.skill-manager') && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])\./i.test(v),
      'Reserved filename',
    ),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export const agentSchema = z.strictObject({
  key: keySchema,
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  order: z.number().int().min(0),
  userDirectories: z.array(template),
  projectDirectories: z.array(template),
  extraDirectories: z.array(template),
  readOnlySources: z.array(template),
  installationMetadata: metadata.optional(),
});
export const projectSchema = z.strictObject({
  key: keySchema,
  name: z.string().trim().min(1),
  root: template,
});
export const providerSchema = z.strictObject({
  key: keySchema,
  kind: z.enum(['local', 'git', 'registry', 'npm', 'pip', 'cli']),
  name: z.string().trim().min(1),
  enabled: z.boolean(),
  location: z.string().max(4096),
  ref: z.string().max(256).optional(),
  subdirectory: z.string().max(1024).optional(),
  offline: z.boolean(),
});
export const configSchema = z
  .strictObject({
    version: z.literal(1),
    vault: z.strictObject({ root: template }),
    defaultSyncMode: z.enum(['copy', 'symlink']),
    network: networkSchema.optional(),
    agents: z.array(agentSchema).max(100),
    projects: z.array(projectSchema).max(500),
    providers: z.array(providerSchema).max(100),
  })
  .superRefine((c, ctx) => {
    for (const field of ['agents', 'projects', 'providers'] as const) {
      const keys = c[field].map((v) => v.key);
      if (new Set(keys).size !== keys.length)
        ctx.addIssue({ code: 'custom', path: [field], message: 'Keys must be unique' });
    }
    for (const [i, p] of c.providers.entries()) {
      if (p.kind === 'git') {
        try {
          const u = new URL(p.location);
          if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error();
        } catch {
          ctx.addIssue({
            code: 'custom',
            path: ['providers', i, 'location'],
            message: 'Use a public HTTPS Git URL without credentials, query or fragment',
          });
        }
      }
      if (
        p.subdirectory &&
        (p.subdirectory.split(/[\\/]/).includes('..') || /^[\\/]|^[a-z]:/i.test(p.subdirectory))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['providers', i, 'subdirectory'],
          message: 'Subdirectory must be relative and cannot traverse parents',
        });
      if (
        p.ref &&
        (!/^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/.test(p.ref) ||
          p.ref.includes('..') ||
          p.ref.endsWith('/') ||
          p.ref.endsWith('.lock'))
      )
        ctx.addIssue({ code: 'custom', path: ['providers', i, 'ref'], message: 'Invalid Git branch or tag' });
    }
  });
export type Config = z.infer<typeof configSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type Project = z.infer<typeof projectSchema>;
export type SourceConfig = z.infer<typeof providerSchema>;
export type SyncMode = Config['defaultSyncMode'];
export function defaultConfig(): Config {
  return {
    version: 1,
    vault: { root: '{data}/skill-manager/vault/skills' },
    defaultSyncMode: 'copy',
    agents: [
      {
        key: 'generic',
        name: 'Generic .agents',
        enabled: true,
        order: 0,
        userDirectories: ['~/.agents/skills'],
        projectDirectories: ['{workspace}/.agents/skills'],
        extraDirectories: [],
        readOnlySources: [],
      },
    ],
    projects: [],
    providers: [],
  };
}
