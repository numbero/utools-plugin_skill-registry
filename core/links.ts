import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { EffectiveTarget, GlobalConfig, LinkEntry, ProjectConfig } from '../shared/types';
import { canonical, expand, inside, lstat, safeTarget } from './paths';
import { message } from './errors';
import { ProjectDocument } from './project-yaml';
const names: Record<string, string> = { 'claude-code': 'Claude Code', 'claude-code-home': 'Claude Code (home)', codex: 'Codex', cursor: 'Cursor', 'agent-generic': 'Generic Agent', windsurf: 'Windsurf', qoder: 'Qoder', 'kiro-steering': 'Kiro' };
export const targetName = (id: string) => names[id] || id;
export async function resolveTargets(root: string, config: ProjectConfig, global: GlobalConfig, center: string, home: string, raw?: string): Promise<EffectiveTarget[]> {
  const states = raw ? new ProjectDocument(raw) : undefined;
  const selected = new Map<string, { path: string; source: EffectiveTarget['source'] }>();
  for (const [id, target] of Object.entries(config.targets || {})) selected.set(id, { path: target.path, source: 'explicit' });
  for (const [id, state] of Object.entries(states?.states || {})) if (!state.enabled) selected.set(id, { path: states?.target(id)?.path ?? global.defaults.targets[id]?.path ?? '', source: 'explicit' });
  for (const [id, preset] of Object.entries(global.defaults.targets)) {
    if (selected.has(id) || preset.path.startsWith('~') || path.isAbsolute(preset.path)) continue;
    const marker = preset.path.split(/[\\/]/)[0];
    if (marker && marker !== '.' && marker !== '..') {
      try { if ((await fs.stat(path.join(root, marker))).isDirectory()) selected.set(id, { path: preset.path, source: 'detected' }); } catch { /* absent marker */ }
    }
  }
  if (!selected.size) { const id = global.settings.default_target, preset = global.defaults.targets[id]; if (preset) selected.set(id, { path: preset.path, source: 'default' }); }
  return Promise.all([...selected].map(async ([id, target]) => {
    const state = states?.states[id], enabled = state?.enabled !== false;
    const skills = state?.custom ? state.members.filter(m => m.enabled).map(m => m.id) : config.skills;
    const directory = target.path ? expand(target.path, home, root) : '';
    let error: string | undefined;
    try { if (enabled) await safeTarget(target.path, root, center, home); } catch (e) { error = message(e); }
    return { id, name: targetName(id), ...target, directory, enabled, custom: state?.custom || false, savedCustom: !!states?.target(id) && Object.prototype.hasOwnProperty.call(states.target(id), 'skills'), members: state?.members || [], skills, outside: !inside(root, await canonical(directory).catch(() => directory)), error };
  }));
}
export async function inspectLink(skill: string, target: EffectiveTarget, center: string): Promise<LinkEntry> {
  const source = path.join(center, skill), destination = path.join(target.directory, skill);
  const entry: LinkEntry = { skill, target: target.id, source, destination, status: 'missing', reason: '尚未创建链接', outside: target.outside };
  if (target.error) return { ...entry, status: 'conflict', reason: target.error };
  try {
    const resolvedSource = await fs.realpath(source), resolvedCenter = await canonical(center);
    if (!inside(resolvedCenter, resolvedSource) || !(await fs.stat(source)).isDirectory() || !(await fs.stat(path.join(source, 'SKILL.md'))).isFile()) return { ...entry, status: 'source-missing', reason: '中心源目录无效或已指向中心以外' };
  } catch { return { ...entry, status: 'source-missing', reason: '中心源目录或 SKILL.md 缺失' }; }
  const stat = await lstat(destination);
  if (!stat) return entry;
  if (!stat.isSymbolicLink()) return { ...entry, status: 'conflict', reason: '已有同名实体文件或目录，保留并跳过' };
  const actual = path.resolve(path.dirname(destination), await fs.readlink(destination));
  try {
    if (await fs.realpath(destination) === await fs.realpath(source)) return { ...entry, status: 'linked', reason: '已正确链接', actual };
    return { ...entry, status: 'conflict', reason: '已有链接指向其他位置，保留并跳过', actual };
  } catch { return { ...entry, status: 'broken', reason: '已有软链已断开，保留并跳过', actual }; }
}
export async function inspectLinks(skills: string[], targets: EffectiveTarget[], center: string) {
  const links: LinkEntry[] = [], leftovers: LinkEntry[] = [];
  for (const target of targets) {
    const expected = target.enabled === false ? [] : target.skills ?? skills;
    for (const skill of expected) {
      try { links.push(await inspectLink(skill, target, center)); }
      catch (e) { links.push({ skill, target: target.id, source: path.join(center, skill), destination: path.join(target.directory, skill), status: 'conflict', reason: message(e), outside: target.outside }); }
    }
    if (target.error || !target.directory) continue;
    try {
      for (const entry of await fs.readdir(target.directory, { withFileTypes: true })) {
        if (!entry.isSymbolicLink() || expected.includes(entry.name)) continue;
        const destination = path.join(target.directory, entry.name), actual = path.resolve(target.directory, await fs.readlink(destination));
        if (inside(await canonical(center), await canonical(actual))) leftovers.push({ skill: entry.name, target: target.id, source: actual, destination, actual, status: 'leftover', reason: target.enabled === false ? '目标已停用，现有链接保留' : '当前清单未选用，现有链接保留', outside: target.outside });
      }
    } catch { /* nonexistent or inaccessible directories are described by expected entries */ }
  }
  return { links, leftovers };
}
