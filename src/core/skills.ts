import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import type { Skill } from '../shared/types';
import { readTree, hashFiles } from './files';
import { skillId, statOrNull } from './paths';
import { fail, publicError } from './errors';
export function parseSkillMarkdown(markdown: string): {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  metadata: Record<string, unknown>;
} {
  const normalized = markdown.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  if (!normalized.startsWith('---\n')) return { metadata: {} };
  const end = normalized.indexOf('\n---', 4);
  if (end < 0 || !/^\n---(?:\n|$)/.test(normalized.slice(end)))
    fail('MARKDOWN_INVALID', 'SKILL.md front matter has no closing delimiter.');
  const doc = parseDocument(normalized.slice(4, end), { uniqueKeys: true });
  if (doc.errors.length) fail('MARKDOWN_INVALID', 'SKILL.md contains invalid YAML front matter.');
  let obj: unknown;
  try {
    obj = doc.toJS({ maxAliasCount: 20 });
  } catch {
    fail('MARKDOWN_INVALID', 'SKILL.md contains excessive YAML aliases.');
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    fail('MARKDOWN_INVALID', 'Skill front matter must be an object.');
  const meta = obj as Record<string, unknown>;
  for (const key of ['name', 'description', 'version', 'author']) {
    if (
      meta[key] !== undefined &&
      typeof meta[key] !== 'string' &&
      !(key === 'version' && typeof meta[key] === 'number')
    )
      fail('MARKDOWN_INVALID', `${key} must be text.`);
  }
  return {
    name: meta.name as string | undefined,
    description: meta.description as string | undefined,
    version: meta.version === undefined ? undefined : String(meta.version),
    author: meta.author as string | undefined,
    metadata: meta,
  };
}
export async function readSkill(
  directory: string,
  id = path.basename(directory),
  ignoreGit = false,
): Promise<Skill> {
  skillId(id);
  const files = await readTree(directory, false, ignoreGit);
  const entry = files.find((f) => f.name === 'SKILL.md');
  if (!entry || entry.directory)
    fail('NOT_A_SKILL', 'This directory does not contain a regular SKILL.md file.');
  if (entry.bytes.length > 1024 * 1024) fail('LIMIT', 'SKILL.md exceeds 1 MiB.');
  const markdown = entry.bytes.toString('utf8'),
    parsed = parseSkillMarkdown(markdown);
  const modifiedAt = (await fs.stat(path.join(directory, 'SKILL.md'))).mtime.toISOString();
  return {
    id,
    name: parsed.name || id,
    description: parsed.description || '',
    version: parsed.version,
    author: parsed.author,
    metadata: parsed.metadata,
    path: directory,
    hash: hashFiles(files),
    modifiedAt,
    markdown,
  };
}
export async function discoverSkills(
  root: string,
  maxDepth = 8,
): Promise<{ directories: string[]; warnings: string[] }> {
  const directories: string[] = [],
    warnings: string[] = [];
  let count = 0;
  async function walk(dir: string, depth: number): Promise<void> {
    if (++count > 5000 || depth > maxDepth) {
      warnings.push('Discovery limit reached. Select a narrower source folder.');
      return;
    }
    try {
      const st = await statOrNull(dir);
      if (!st || st.isSymbolicLink() || !st.isDirectory()) return;
      if (await statOrNull(path.join(dir, 'SKILL.md'))) {
        directories.push(dir);
        return;
      }
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (count > 5000) break;
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
          await walk(path.join(dir, e.name), depth + 1);
      }
    } catch (e) {
      warnings.push(publicError(e).message);
    }
  }
  await walk(root, 0);
  return { directories, warnings };
}
