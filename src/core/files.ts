import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertNoLinks, safeMkdir, statOrNull, contains } from './paths';
import { fail } from './errors';
export const MARKER = '.skill-manager.json';
export const MAX_BYTES = 32 * 1024 * 1024;
export interface FileEntry {
  name: string;
  bytes: Buffer;
  mode: number;
  directory?: boolean;
}
export async function readTree(root: string, allowMarker = false, ignoreGit = false): Promise<FileEntry[]> {
  await assertNoLinks(root);
  const files: FileEntry[] = [];
  let total = 0;
  let count = 0;
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 20) fail('LIMIT', 'Skill exceeds the maximum directory depth (20).');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const names = new Set<string>();
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (++count > 5000) fail('LIMIT', 'Skill exceeds the maximum file/directory count (5000).');
      if (entry.name === '.git' && ignoreGit) continue;
      const lower = entry.name.toLowerCase();
      if (names.has(lower))
        fail('CASE_COLLISION', 'Skill contains names that collide on case-insensitive filesystems.');
      names.add(lower);
      if (
        /[\x00-\x1f<>:"|?*\\]/.test(entry.name) ||
        /[. ]$/.test(entry.name) ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(entry.name)
      )
        fail('INVALID_FILENAME', 'Skill contains a filename that is not portable across operating systems.');
      if (!allowMarker && lower === MARKER)
        fail('RESERVED_FILE', 'Skill contains a reserved ownership marker.');
      const full = path.join(dir, entry.name),
        st = await fs.lstat(full);
      if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile()) || (st.isFile() && st.nlink > 1))
        fail('UNSAFE_FILE', 'Skills may contain only regular files and directories, without links.');
      if (st.isDirectory()) {
        files.push({
          name: path.relative(root, full).split(path.sep).join('/'),
          bytes: Buffer.alloc(0),
          mode: st.mode & 0o777,
          directory: true,
        });
        await walk(full, depth + 1);
      } else {
        total += st.size;
        if (total > MAX_BYTES) fail('LIMIT', 'Skill exceeds the maximum size (32 MiB).');
        const bytes = await fs.readFile(full);
        if (bytes.length !== st.size)
          fail('CHANGED', 'A file changed while being read. Retry the operation.');
        files.push({
          name: path.relative(root, full).split(path.sep).join('/'),
          bytes,
          mode: st.mode & 0o777,
        });
      }
    }
  }
  await walk(root, 0);
  return files;
}
export function hashFiles(files: FileEntry[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    hash.update(
      `${file.directory ? 'd' : 'f'}:${Buffer.byteLength(file.name)}:${file.name}:${file.bytes.length}:`,
    );
    hash.update(file.bytes);
  }
  return hash.digest('hex');
}
export async function treeHash(root: string, allowMarker = false): Promise<string> {
  return hashFiles(await readTree(root, allowMarker));
}
export async function atomicJson(filename: string, value: unknown): Promise<void> {
  await safeMkdir(path.dirname(filename));
  await assertNoLinks(filename);
  const stat = await statOrNull(filename);
  if (stat && (!stat.isFile() || stat.nlink > 1))
    fail('UNSAFE_FILE', 'State/config file is not a regular private file.');
  const temporary = path.join(path.dirname(filename), `.skill-manager-write-${randomUUID()}`);
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await assertNoLinks(filename);
    await fs.rename(temporary, filename);
  } catch (e) {
    await fs.unlink(temporary).catch(() => {});
    throw e;
  }
}
export async function stageTree(root: string, files: FileEntry[]): Promise<string> {
  await safeMkdir(root);
  const staging = await fs.mkdtemp(path.join(root, '.skill-manager-stage-'));
  try {
    for (const file of files) {
      if (
        file.name
          .split('/')
          .some(
            (segment) =>
              !segment ||
              segment === '.' ||
              segment === '..' ||
              /[\x00-\x1f<>:"|?*\\]/.test(segment) ||
              /[. ]$/.test(segment) ||
              /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment),
          )
      )
        fail('INVALID_FILENAME', 'Staged content contains a non-portable or unsafe filename.');
      const dest = path.join(staging, file.name);
      if (!contains(staging, dest) || file.name.split('/').includes('..'))
        fail('PATH_TRAVERSAL', 'Unsafe staged filename.');
      if (file.directory) {
        await safeMkdir(dest);
        continue;
      }
      await safeMkdir(path.dirname(dest));
      await fs.writeFile(dest, file.bytes, { flag: 'wx', mode: file.mode & 0o755 });
    }
    return staging;
  } catch (e) {
    await removePrivateTree(root, staging).catch(() => {});
    throw e;
  }
}
// Only transaction directories generated by this process can reach recursive cleanup.
export async function removePrivateTree(root: string, dir: string, expectedHash?: string): Promise<void> {
  if (path.dirname(dir) !== root || !path.basename(dir).startsWith('.skill-manager-'))
    fail('DELETE_SCOPE', 'Cleanup escaped its transaction directory.');
  await assertNoLinks(dir);
  if (expectedHash && (await treeHash(dir, true)) !== expectedHash)
    fail('CHANGED', 'Content changed before deletion. The transaction backup was preserved.');
  // Inspect links without buffering file content (Git object caches may exceed Skill limits).
  let count = 0;
  async function verify(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (++count > 100_000) fail('LIMIT', 'Transaction cleanup limit reached; its directory was preserved.');
      const full = path.join(directory, entry.name),
        st = await fs.lstat(full);
      if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory()) || (st.isFile() && st.nlink > 1))
        fail('UNSAFE_FILE', 'Transaction content contains a link or special file and was preserved.');
      if (st.isDirectory()) await verify(full);
    }
  }
  await verify(dir);
  await fs.rm(dir, { recursive: true });
}
export async function retireDirectory(root: string, target: string, expectedHash: string): Promise<void> {
  await assertNoLinks(target);
  if ((await treeHash(target, true)) !== expectedHash)
    fail('CHANGED', 'Content changed before deletion. It was preserved.');
  const quarantine = path.join(root, `.skill-manager-retired-${randomUUID()}`);
  await fs.rename(target, quarantine);
  try {
    await removePrivateTree(root, quarantine, expectedHash);
  } catch (e) {
    if (!(await statOrNull(target))) await fs.rename(quarantine, target).catch(() => {});
    throw e;
  }
}
