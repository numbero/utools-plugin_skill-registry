import path from 'node:path';
import * as fs from 'node:fs/promises';
import { fail } from './errors';
export function validId(value: unknown): asserts value is string {
  fail(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value), '标识只能包含字母、数字、点、短横线和下划线，且以字母或数字开头。');
}
export function expand(value: string, home: string, base: string): string {
  fail(typeof value === 'string' && !!value.trim() && !value.includes('\0'), '请填写有效目录路径。');
  return value === '~' ? home : value.startsWith('~/') ? path.resolve(home, value.slice(2)) : path.resolve(base, value);
}
export const inside = (parent: string, child: string) => child === parent || (!path.relative(parent, child).startsWith('..' + path.sep) && path.relative(parent, child) !== '..' && !path.isAbsolute(path.relative(parent, child)));
export async function canonical(value: string): Promise<string> {
  try { return await fs.realpath(value); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const parent = path.dirname(value); if (parent === value) return value;
    return path.join(await canonical(parent), path.basename(value));
  }
}
export async function directory(value: string): Promise<string> {
  const resolved = await fs.realpath(value);
  fail((await fs.stat(resolved)).isDirectory(), `不是文件夹：${value}`);
  await fs.access(resolved, fs.constants.R_OK);
  return resolved;
}
export async function lstat(value: string) {
  try { return await fs.lstat(value); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
export async function safeTarget(value: string, root: string, center: string, home: string): Promise<string> {
  fail(typeof value === 'string' && !value.split(/[\\/]/).includes('..'), '目标目录不能包含上级路径跳转，请填写明确目录。');
  const target = await canonical(expand(value, home, root)), registry = await canonical(center);
  const stat = await lstat(target); fail(!stat || stat.isDirectory(), '目标路径已经存在，且不是文件夹。');
  fail(target !== path.parse(target).root && target !== home && target !== root, '请选择 Agent 存放 Skills 的专用目录。');
  fail(!inside(target, registry) && !inside(registry, target), '目标目录不能与中心仓库重叠，以免形成循环链接。');
  return target;
}
