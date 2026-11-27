import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import type { GitStatus } from '../shared/types';
import { fail, message, RegistryError } from './errors';
const execute = promisify(execFile);
export async function git(cwd: string, args: string[], timeout = 30000): Promise<string> {
  try {
    const result = await execute('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, timeout, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true });
    return result.stdout.trim();
  } catch (e) {
    const error = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    throw new RegistryError('GIT', error.code === 'ENOENT' ? '未找到系统 Git；本地配置和复制导入仍可使用。' : error.killed ? 'Git 操作超时，请检查网络和凭据后重试。' : (error.stderr || message(e)).slice(0, 3000));
  }
}
export async function gitStatus(directory: string, id: string, fetch: boolean): Promise<GitStatus> {
  try { await fs.lstat(path.join(directory, '.git')); } catch { throw new RegistryError('GIT', '此 Skill 没有独立 Git 元数据，无法更新。'); }
  fail(await fs.realpath(await git(directory, ['rev-parse', '--show-toplevel'])) === await fs.realpath(directory), '此 Skill 不是独立的 Git 仓库根目录。');
  const revision = await git(directory, ['rev-parse', 'HEAD']);
  const branch = await git(directory, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = !!(await git(directory, ['status', '--porcelain', '--untracked-files=normal']));
  let remote = '', ahead = 0, behind = 0, error: string | undefined;
  try {
    const remoteName = await git(directory, ['config', '--get', `branch.${branch}.remote`]);
    fail(remoteName && remoteName !== '.' && !remoteName.startsWith('-'), '当前分支没有可更新的远端。');
    remote = await git(directory, ['remote', 'get-url', remoteName]);
    if (fetch) await git(directory, ['fetch', '--prune', '--', remoteName], 60000);
    const counts = await git(directory, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
    [ahead, behind] = counts.split(/\s+/).map(Number);
  } catch (e) { error = message(e); }
  if (branch === 'HEAD') error = '仓库当前处于游离 HEAD，请先在 Git 中切换到跟踪远端的分支。';
  return { id, revision, branch, remote, dirty, ahead, behind, checked: fetch && !error, error };
}
export async function updateGit(directory: string, id: string, revision: string) {
  const status = await gitStatus(directory, id, true);
  fail(status.revision === revision, '本地版本已改变，请重新检查更新。', 'CONFLICT');
  fail(!status.error, status.error || '无法检查远端。');
  fail(!status.dirty, 'Git 工作区有未提交或未跟踪文件，请先打开目录处理。');
  fail(!(status.ahead && status.behind), '本地和远端已分叉，无法安全快进；请在 Git 中处理。');
  if (status.behind) await git(directory, ['merge', '--ff-only', '@{upstream}']);
  return gitStatus(directory, id, false);
}
export async function cloneGit(source: string, parent: string, destination: string) {
  fail(typeof source === 'string' && /^(https?:\/\/|ssh:\/\/|git@)/.test(source) && !/[\r\n\0#]/.test(source), '请输入 HTTPS 或 SSH 仓库根地址；首期不支持 Git 子目录导入。');
  await git(parent, ['clone', '--no-recurse-submodules', '--', source, destination], 60000);
}
