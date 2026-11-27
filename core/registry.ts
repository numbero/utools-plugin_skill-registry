import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import type { Skill } from '../shared/types';
import { fail, message } from './errors';
import { lstat, validId } from './paths';
export async function readSkill(directory: string) {
  const file = path.join(directory, 'SKILL.md'), stat = await fs.stat(file);
  fail(stat.isFile() && stat.size <= 2 * 1024 * 1024, 'SKILL.md 不可读或超过 2 MB。');
  const markdown = await fs.readFile(file, 'utf8');
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  let name = path.basename(directory), description = '';
  if (match) {
    const doc = parseDocument(match[1]);
    if (!doc.errors.length) {
      const meta = doc.toJS({ maxAliasCount: 10 });
      if (typeof meta?.name === 'string') name = meta.name;
      if (typeof meta?.description === 'string') description = meta.description;
    }
  }
  return { name, description, markdown };
}
export async function listRegistry(center: string): Promise<Skill[]> {
  const result: Skill[] = [];
  for (const entry of await fs.readdir(center, { withFileTypes: true })) {
    if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith('.')) continue;
    try { validId(entry.name); } catch { continue; }
    const directory = path.join(center, entry.name);
    if (!(await lstat(path.join(directory, 'SKILL.md')))) continue;
    try {
      const info = await readSkill(directory);
      result.push({ id: entry.name, name: info.name, description: info.description, directory, isGit: !!(await lstat(path.join(directory, '.git'))), references: 0, groupReferences: 0 });
    } catch (e) { result.push({ id: entry.name, name: entry.name, description: '', directory, isGit: false, references: 0, groupReferences: 0, error: message(e) }); }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
