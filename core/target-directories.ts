import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { GlobalConfig, PresetDirectory, ProjectConfig, WorkspacePreset } from '../shared/types';
import { fail, message, RegistryError } from './errors';
import { canonical, expand, inside, lstat, safeTarget } from './paths';
import { targetName } from './links';
import { ProjectDocument } from './project-yaml';

export async function presetTargets(root: string, project: ProjectConfig, global: GlobalConfig, center: string, home: string, raw?: string): Promise<WorkspacePreset[]> {
  const states = raw ? new ProjectDocument(raw).states : {};
  return Promise.all(Object.entries(global.defaults.targets).map(async ([id, preset]) => {
    const result: WorkspacePreset = { id, name: targetName(id), path: preset.path, directory: expand(preset.path, home, root), existed: false, outside: false, state: 'blocked', selectable: false, reason: '', isDefault: id === global.settings.default_target };
    try {
      result.directory = await safeTarget(preset.path, root, center, home);
      result.outside = !inside(root, result.directory);
      result.existed = !!await lstat(result.directory);
      const explicit = project.targets?.[id];
      if (states[id]?.enabled === false) { result.state = 'configured'; result.reason = '目标已停用，请在目标卡片中启用'; }
      else if (explicit && await canonical(expand(explicit.path, home, root)) !== result.directory) {
        result.state = 'override'; result.reason = `已配置自定义路径：${explicit.path}`;
      } else if (explicit && result.existed) {
        result.state = 'configured'; result.reason = '已添加到工作区';
      } else {
        result.selectable = true;
        result.state = result.existed ? 'existing' : 'missing';
        result.reason = result.existed ? '目录已存在 · 添加为显式目标' : explicit ? '已配置目标 · 目录待创建' : '目录待创建';
        // Preserve an existing equivalent path and its other YAML fields when repairing it.
        if (explicit) result.path = explicit.path;
      }
    } catch (error) { result.reason = message(error); }
    return result;
  }));
}

/** Create only the selected directories, then save config. Roll back only our own empty directories. */
export async function withTargetDirectories(plans: PresetDirectory[], root: string, center: string, home: string, save: () => Promise<void>) {
  const created: { path: string; dev: number; ino: number }[] = [];
  const check = async (plan: PresetDirectory) => {
    fail(await safeTarget(plan.path, root, center, home) === plan.directory, `目标路径已变化，请重新预览：${plan.path}`, 'STALE');
  };
  const ensure = async (value: string): Promise<void> => {
    const existing = await lstat(value);
    if (existing) { fail(existing.isDirectory() && !existing.isSymbolicLink(), `目录状态已变化：${value}`, 'STALE'); return; }
    await ensure(path.dirname(value));
    fail(await canonical(path.dirname(value)) === path.dirname(value), `父目录路径已变化：${value}`, 'STALE');
    try {
      await fs.mkdir(value);
      const stat = await fs.lstat(value);
      fail(stat.isDirectory() && !stat.isSymbolicLink(), `目录状态已变化：${value}`, 'STALE');
      created.push({ path: value, dev: stat.dev, ino: stat.ino });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const stat = await fs.lstat(value);
      fail(stat.isDirectory() && !stat.isSymbolicLink(), `目录已被其他文件占用：${value}`, 'STALE');
    }
  };
  try {
    for (const plan of plans) { await check(plan); await ensure(plan.directory); await check(plan); }
    for (const plan of plans) await check(plan);
    await save();
  } catch (error) {
    const retained: string[] = [];
    for (const entry of created.reverse()) {
      try {
        const stat = await lstat(entry.path);
        if (!stat) continue;
        if (await canonical(entry.path) !== entry.path || !stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== entry.dev || stat.ino !== entry.ino) { retained.push(entry.path); continue; }
        await fs.rmdir(entry.path);
      } catch { retained.push(entry.path); }
    }
    if (retained.length) throw new RegistryError('DIRECTORY_ROLLBACK', `${message(error)}\n以下新目录已有内容或状态变化，已保留：${retained.join('、')}`);
    throw error;
  }
}
