import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseDocument, visit, isAlias, isMap, isScalar, isSeq, isNode, type Document } from 'yaml';
import type { ConfigFile, GlobalConfig, ProjectConfig } from '../shared/types';
import { fail, message, RegistryError } from './errors';
import { lstat, validId } from './paths';
import { ProjectDocument } from './project-yaml';
export const fingerprint = (raw: string) => createHash('sha256').update(raw).digest('hex');
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
export function defaults(): GlobalConfig {
  return { defaults: { targets: {
    'claude-code': { path: '.claude/skills', description: 'Claude Code CLI' },
    'claude-code-home': { path: '~/.claude/skills', description: 'Claude Code (home)' },
    cursor: { path: '.cursor/rules', description: 'Cursor IDE' }, codex: { path: '.codex/skills', description: 'OpenAI Codex CLI' },
    'kiro-steering': { path: '.kiro/steering', description: 'Kiro Steering' }, windsurf: { path: '.windsurf/rules', description: 'Windsurf IDE' },
    'agent-generic': { path: '.agents/skills', description: 'Generic Agent' }, qoder: { path: '.qoder/skills', description: 'Qoder AI' }
  } }, groups: {}, settings: { default_target: 'claude-code' } };
}
export function yamlDocument(raw: string): Document {
  fail(typeof raw === 'string' && Buffer.byteLength(raw) <= 2 * 1024 * 1024, '配置过大，最大支持 2 MB。');
  const doc = parseDocument(raw, { keepSourceTokens: true, uniqueKeys: true });
  fail(!doc.errors.length, 'YAML 无法解析：' + doc.errors.map(e => e.message).join('\n'), 'YAML');
  return doc;
}
export function formEditable(doc: Document): boolean {
  let safe = true;
  visit(doc, (_, node) => {
    if (isAlias(node) || (node && typeof node === 'object' && (('anchor' in node && node.anchor) || ('tag' in node && node.tag)))) safe = false;
    if (isMap(node) && node.items.some(pair => !isScalar(pair.key) || typeof pair.key.value !== 'string' || pair.key.value === '<<')) safe = false;
  });
  return safe;
}
export function setValue(doc: Document, keys: string[], value: unknown) {
  const prior = doc.getIn(keys, true), next = doc.createNode(value);
  if (isNode(prior)) { next.comment = prior.comment; next.commentBefore = prior.commentBefore; next.spaceBefore = prior.spaceBefore; }
  doc.setIn(keys, next);
}
export function setStringSequence(doc: Document, keys: string[], values: string[]) {
  const node = doc.getIn(keys, true);
  if (!isSeq(node)) { setValue(doc, keys, values); return; }
  const existing = new Map(node.items.filter(isScalar).map(item => [item.value, item]));
  node.items = values.map(value => existing.get(value) || doc.createNode(value));
}
function targets(value: unknown, presets?: GlobalConfig['defaults']['targets']): Record<string, any> {
  fail(record(value), 'targets 必须是映射。');
  const result: Record<string, any> = {};
  for (const [id, config] of Object.entries(value)) {
    validId(id); fail(record(config), `${id} 的目标配置必须是映射。`);
    const targetPath = Object.hasOwn(config, 'path') ? config.path : presets?.[id]?.path;
    fail(typeof targetPath === 'string' && !!targetPath.trim() && !targetPath.includes('\0'), `${id} 缺少有效 path，请补充路径或同名全局预设。`);
    result[id] = { ...config, path: targetPath };
  }
  return result;
}
export function globalConfig(doc: Document): GlobalConfig {
  const data = doc.toJS({ maxAliasCount: 20 });
  fail(record(data) && record(data.defaults) && record(data.settings), '全局配置需要 defaults.targets 和 settings.default_target。');
  const normalized = targets(data.defaults.targets);
  validId(data.settings.default_target);
  fail(Object.hasOwn(normalized, data.settings.default_target), '默认目标必须引用一个存在的目标预设。');
  fail(data.registry === undefined || (record(data.registry) && (data.registry.path === undefined || (typeof data.registry.path === 'string' && !!data.registry.path.trim()))), 'registry.path 必须是非空目录字符串。');
  const groups = data.groups ?? {}; fail(record(groups), 'groups 必须是映射。');
  for (const [id, group] of Object.entries(groups)) { validId(id); fail(record(group) && Array.isArray(group.skills), `分组 ${id} 需要 skills 列表。`); group.skills.forEach(validId); }
  return { ...data, defaults: { ...data.defaults, targets: normalized }, groups, settings: data.settings } as GlobalConfig;
}
export function projectConfig(doc: Document, global?: GlobalConfig): ProjectConfig {
  const editor = new ProjectDocument(String(doc)), data = editor.active();
  for (const [id, state] of Object.entries(editor.states)) {
    validId(id); const full = editor.target(id);
    fail(full?.skills === undefined || Array.isArray(full.skills), `${id} 的 skills 必须是列表，空清单写作 []。`);
    state.members.forEach(m => validId(m.id));
    fail(new Set(state.members.map(m => m.id)).size === state.members.length, `${id} 中有重复 Skill。`);
  }
  fail(record(data) && Array.isArray(data.skills), '项目配置需要 skills 列表；空清单写作 skills: []。');
  data.skills.forEach(validId);
  fail(new Set(data.skills).size === data.skills.length, 'skills 中有重复引用，请去重。');
  return { ...data, skills: data.skills, ...(data.targets !== undefined ? { targets: targets(data.targets, global?.defaults.targets) } : {}) };
}
export async function readConfig<T>(file: string, parse: (doc: Document) => T): Promise<ConfigFile<T>> {
  let raw = '';
  try {
    const stat = await lstat(file);
    if (!stat) return { path: file, exists: false, raw, hash: '', formEditable: true };
    fail(stat.isFile() || stat.isSymbolicLink(), `配置位置不是文件：${file}`);
    fail(stat.size <= 2 * 1024 * 1024, '配置文件超过 2 MB。');
    raw = await fs.readFile(file, 'utf8');
    const doc = yamlDocument(raw), config = parse(doc);
    return { path: file, exists: true, raw, hash: fingerprint(raw), config, formEditable: !stat.isSymbolicLink() && formEditable(doc), ...(stat.isSymbolicLink() ? { error: '配置文件是软链，请通过原文编辑或打开源文件维护。' } : {}) };
  } catch (e) { return { path: file, exists: true, raw, hash: raw ? fingerprint(raw) : '', error: message(e), formEditable: false }; }
}
export async function assertHash(file: string, expected: string) {
  let raw: string;
  try { raw = await fs.readFile(file, 'utf8'); } catch (e) { throw new RegistryError('CONFLICT', `配置已被移除或不可读：${file}`, { cause: message(e) }); }
  if (fingerprint(raw) !== expected) throw new RegistryError('CONFLICT', '配置已被外部修改，请比较最新内容后再保存。', { path: file, raw, hash: fingerprint(raw) });
  return raw;
}
export async function atomicWrite(file: string, raw: string, expected: string) {
  const stat = await lstat(file); fail(stat && stat.isFile() && !stat.isSymbolicLink(), '只允许直接写入普通配置文件；软链配置请打开源文件编辑。');
  const previous = await assertHash(file, expected), temporary = path.join(path.dirname(file), `.config-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx', stat.mode & 0o777);
    try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
    const backup = temporary + '.bak';
    try { await fs.writeFile(backup, previous, { flag: 'wx', mode: 0o600 }); await fs.rename(backup, file + '.bak'); }
    finally { await fs.rm(backup, { force: true }); }
    await assertHash(file, expected);
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}
export async function createConfig(file: string, raw: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'wx', 0o600);
  const identity = await handle.stat(); let complete = false;
  try { await handle.writeFile(raw); await handle.sync(); complete = true; }
  finally {
    await handle.close();
    if (!complete) {
      // Only remove our own incomplete exclusive creation, never a replacement from another process.
      const current = await lstat(file);
      if (current?.ino === identity.ino && current.dev === identity.dev && !current.isSymbolicLink()) await fs.unlink(file);
    }
  }
}
