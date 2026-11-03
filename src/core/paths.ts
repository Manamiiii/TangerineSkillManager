import path from 'node:path';
import fs from 'node:fs/promises';
import { keySchema } from '../shared/config';
import { fail } from './errors';
export interface PathContext {
  home: string;
  data: string;
  base: string;
  workspace?: string;
  platform?: NodeJS.Platform;
}
export function skillId(value: string): string {
  return keySchema.parse(value);
}
export function expandPath(value: string, ctx: PathContext): string {
  const platform = ctx.platform ?? process.platform;
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (!value || /[\x00-\x1f]/.test(value))
    fail('INVALID_PATH', 'Path is empty or contains a control character.');
  if (value.split(/[\\/]/).includes('..'))
    fail('PATH_TRAVERSAL', 'Parent traversal (..) is not allowed in configured paths.');
  if (value.includes('{workspace}') && !ctx.workspace)
    fail('WORKSPACE_REQUIRED', 'This directory needs a selected project.');
  let result = value
    .replace(/^~(?=$|[\\/])/, ctx.home)
    .replace(/\$\{HOME\}|\$HOME(?=$|[\\/])|%USERPROFILE%/gi, ctx.home)
    .replaceAll('{data}', ctx.data)
    .replaceAll('{workspace}', ctx.workspace ?? '');
  if (/[{}]|^~|\$|%[a-z_]+%/i.test(result))
    fail(
      'INVALID_TEMPLATE',
      'Unsupported path template. Use ~, $HOME, %USERPROFILE%, {data} or {workspace}.',
    );
  if (platform !== 'win32' && (/^[a-z]:/i.test(result) || result.includes('\\')))
    fail('FOREIGN_PATH', 'This is a Windows path. Select a directory on this operating system.');
  if (platform === 'win32') {
    if (/^[\\/]{2}|^\\[?.]\\/.test(result))
      fail('NETWORK_PATH', 'Network and device paths are not supported as managed roots.');
    if (/^[a-z]:[^\\/]/i.test(result) || (/^[\\/]/.test(result) && !/^[a-z]:/i.test(result)))
      fail(
        'FOREIGN_PATH',
        'Choose an absolute drive path or a path relative to the configuration directory.',
      );
    if (result.replace(/^[a-z]:/i, '').includes(':'))
      fail('INVALID_PATH', 'Alternate data streams are not supported.');
  }
  result = p.resolve(ctx.base, result);
  return result;
}
export function identity(value: string): string {
  const p = path.resolve(value);
  return process.platform === 'win32' ? p.toLowerCase() : p;
}
export function contains(root: string, candidate: string): boolean {
  const rel = path.relative(identity(root), identity(candidate));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
export function overlaps(a: string, b: string): boolean {
  return contains(a, b) || contains(b, a);
}
export async function statOrNull(p: string) {
  try {
    return await fs.lstat(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
export async function assertNoLinks(p: string): Promise<void> {
  const absolute = path.resolve(p),
    parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await statOrNull(current);
    if (stat?.isSymbolicLink())
      fail('UNSAFE_LINK', 'A managed path contains a symbolic link or junction. Choose a real directory.');
    if (stat && current !== absolute && !stat.isDirectory())
      fail('INVALID_PATH', 'A path ancestor is not a directory.');
  }
}
export async function safeMkdir(p: string): Promise<void> {
  await assertNoLinks(p);
  await fs.mkdir(p, { recursive: true });
  await assertNoLinks(p);
}
export async function resolvedOrFuture(p: string): Promise<string> {
  if (await statOrNull(p)) return fs.realpath(p);
  const parent = path.dirname(p);
  if (parent === p) return p;
  return path.join(await resolvedOrFuture(parent), path.basename(p));
}
export async function childPath(root: string, id: string): Promise<string> {
  skillId(id);
  await assertNoLinks(root);
  const result = path.join(root, id);
  if (!contains(root, result) || identity(root) === identity(result))
    fail('PATH_TRAVERSAL', 'Invalid Skill destination.');
  return result;
}
