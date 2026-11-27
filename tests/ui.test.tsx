import { JSDOM } from 'jsdom';
import { test, afterEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RegistryService } from '../core/service';
import type { Preferences, Progress, RegistryBridge } from '../shared/types';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true });
const React = await import('react');
const { render, fireEvent, within, waitFor, cleanup, act } = await import('@testing-library/react');
const { App } = await import('../src/App');
afterEach(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); cleanup(); });
async function setup(t: TestContext, initialized = false) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'skill-registry-ui-'))), home = path.join(base, 'home'), workspace = path.join(base, 'workspace'); await fs.mkdir(home); await fs.mkdir(workspace);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let prefs: Preferences = { recent: [] }; const choices: (string | null)[] = [], calls: { method: string; input: any }[] = [], listeners = new Set<(value: Progress) => void>();
  const service = new RegistryService({ home, temp: path.join(base, 'temp'), loadPreferences: () => prefs, savePreferences: value => { prefs = value; }, trash: async file => fs.rename(file, path.join(base, 'trash')), open: async () => {}, selectDirectory: async () => choices.shift() ?? null, progress: value => listeners.forEach(listener => listener(value)) });
  await service.request('initializeGlobal', {}); await service.request('selectWorkspace', { path: workspace }); if (initialized) await service.request('initializeWorkspace', { workspace });
  const center = path.join(home, '.skill-registry/skills');
  for (const id of ['alpha', 'beta']) { await fs.mkdir(path.join(center, id)); await fs.writeFile(path.join(center, id, 'SKILL.md'), `---\nname: ${id}\ndescription: ${id} description\n---\n# ${id}\n<script>bad()</script>`); }
  const bridge: RegistryBridge = { async call(method, input) { calls.push({ method, input }); try { const data=await service.request(method,input); return { ok: true, data }; } catch (e) { return { ok: false, error: { code: (e as any).code || 'IO', message: (e as Error).message } }; } }, onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); }, onEnter() { return () => {}; } };
  window.skillRegistry = bridge;
  const view = render(<App />), sidebar = within(view.container.querySelector('.sidebar')!);
  await view.findByText(initialized ? '工作区还没有 Skill' : '此工作区尚未初始化');
  const modal = () => within(view.getByRole('dialog'));
  return { ...view, base, home, workspace, center, service, choices, calls, sidebar, modal, file: path.join(workspace, '.skill-registry/config.yaml') };
}
test('preset target selection previews directories, preserves selection on back, and creates only after confirmation', async t => {
  const v = await setup(t, true);
  fireEvent.click(v.sidebar.getByRole('button', { name: /Agent 目标/ }));
  fireEvent.click(v.getByRole('button', { name: '从预设添加' }));
  const codex = await v.modal().findByRole('checkbox', { name: 'Codex（codex）' });
  assert.equal((codex as HTMLInputElement).checked, false);
  assert.equal((v.modal().getByRole('checkbox', { name: 'Claude Code (home)（claude-code-home）' }) as HTMLInputElement).checked, false);
  assert.equal((v.modal().getByRole('button', { name: '预览添加' }) as HTMLButtonElement).disabled, true);
  fireEvent.click(codex);
  fireEvent.click(v.modal().getByRole('checkbox', { name: 'Cursor（cursor）' }));
  fireEvent.click(v.modal().getByRole('button', { name: '预览添加' }));
  await v.findByRole('dialog', { name: '预览变更' });
  assert.equal(v.modal().getAllByText('将创建').length, 2);
  assert.equal(v.modal().getByText(path.join(v.workspace, '.codex/skills')).textContent, path.join(v.workspace, '.codex/skills'));
  await assert.rejects(fs.lstat(path.join(v.workspace, '.codex')));
  fireEvent.click(v.modal().getByRole('button', { name: '返回编辑' }));
  await v.findByRole('dialog', { name: '从预设添加目标' });
  assert.equal((v.modal().getByRole('checkbox', { name: 'Codex（codex）' }) as HTMLInputElement).checked, true);
  fireEvent.click(v.modal().getByRole('button', { name: '取消' }));
  await assert.rejects(fs.lstat(path.join(v.workspace, '.codex')));
  fireEvent.click(v.getByRole('button', { name: '从预设添加' }));
  fireEvent.click(await v.modal().findByRole('checkbox', { name: 'Codex（codex）' }));
  fireEvent.click(v.modal().getByRole('button', { name: '预览添加' }));
  await v.findByRole('dialog', { name: '预览变更' });
  fireEvent.click(v.modal().getByRole('button', { name: '创建目录并添加' }));
  await waitFor(() => assert.equal(v.queryByRole('dialog') === null, true));
  assert.deepEqual(await fs.readdir(path.join(v.workspace, '.codex/skills')), []);
  assert.equal((await v.service.request('snapshot', { workspace: v.workspace })).workspace?.config?.targets?.codex.path, '.codex/skills');
  await assert.rejects(fs.lstat(path.join(v.home, '.claude')));
  await assert.rejects(fs.lstat(path.join(v.workspace, '.cursor')));
  fireEvent.click(v.getByRole('button', { name: '从预设添加' }));
  assert.equal((await v.modal().findByRole('checkbox', { name: 'Codex（codex）' }) as HTMLInputElement).disabled, true);
});
test('preset target list explains unavailable overrides and files while allowing existing directories', async t => {
  const v = await setup(t, true);
  await fs.writeFile(v.file, 'skills: []\ntargets:\n  codex:\n    path: .custom/skills\n');
  await fs.mkdir(path.join(v.workspace, '.cursor')); await fs.writeFile(path.join(v.workspace, '.cursor/rules'), 'keep');
  await fs.mkdir(path.join(v.workspace, '.agents/skills'), { recursive: true });
  await fs.writeFile(path.join(v.workspace, '.agents/skills/keep'), 'keep');
  fireEvent.click(v.sidebar.getByRole('button', { name: /Agent 目标/ })); fireEvent.click(v.getByRole('button', { name: '从预设添加' }));
  assert.equal((await v.modal().findByRole('checkbox', { name: 'Codex（codex）' }) as HTMLInputElement).disabled, true);
  assert.ok(v.modal().getByText('已配置自定义路径：.custom/skills'));
  assert.equal((v.modal().getByRole('checkbox', { name: 'Cursor（cursor）' }) as HTMLInputElement).disabled, true);
  fireEvent.click(v.modal().getByRole('checkbox', { name: 'Generic Agent（agent-generic）' }));
  fireEvent.click(v.modal().getByRole('button', { name: '预览添加' })); await v.findByRole('dialog', { name: '预览变更' });
  assert.ok(v.modal().getByText('已存在 · 保留内容'));
  fireEvent.click(v.modal().getByRole('button', { name: '添加到工作区' }));
  await waitFor(() => assert.equal(v.queryByRole('dialog') === null, true));
  assert.equal(await fs.readFile(path.join(v.workspace, '.agents/skills/keep'), 'utf8'), 'keep');
});
test('workspace initialization, adding a Skill and applying a real link are separate UI steps', async t => {
  const v = await setup(t);
  fireEvent.click(v.getByRole('button', { name: '初始化 SkillRegistory' })); assert.match(v.modal().getByText('skills: []').textContent!, /skills/); fireEvent.click(v.modal().getByRole('button', { name: '取消' })); await assert.rejects(fs.stat(v.file));
  fireEvent.click(v.getByRole('button', { name: '初始化 SkillRegistory' })); fireEvent.click(v.modal().getByRole('button', { name: '创建配置' })); await v.findByText('工作区还没有 Skill');
  fireEvent.click(v.getByRole('button', { name: '添加第一个 Skill' })); fireEvent.click(v.modal().getByRole('checkbox', { name: /alpha/ })); fireEvent.click(v.modal().getByRole('button', { name: '预览添加' })); await v.findByRole('dialog', { name: '预览变更' }); fireEvent.click(v.modal().getByRole('button', { name: '确认保存' })); await waitFor(() => assert.equal(v.queryByRole('dialog') === null, true));
  assert.match(await fs.readFile(v.file, 'utf8'), /alpha/); await assert.rejects(fs.stat(path.join(v.workspace, '.claude/skills/alpha')));
  fireEvent.click(v.getByRole('button', { name: '预览并应用' })); await v.findByRole('dialog', { name: '应用到 workspace' }); fireEvent.click(v.modal().getByRole('button', { name: '创建 1 条链接' })); await v.findByText(/创建 1 条，跳过 0 项，失败 0 项/); assert.equal((await fs.lstat(path.join(v.workspace, '.claude/skills/alpha'))).isSymbolicLink(), true);
});
test('Agent directory picker fills a draft, cancellation preserves it, and save creates only local override', async t => {
  const v = await setup(t, true); const picked = path.join(v.workspace, '.agents/skills'); await fs.mkdir(picked, { recursive: true });
  fireEvent.click(v.sidebar.getByRole('button', { name: /Agent 目标/ }));
  fireEvent.click(v.getByRole('button', { name: '配置 Claude Code' })); await v.findByRole('dialog', { name: '配置目标 · Claude Code' }); v.choices.push(picked); fireEvent.click(v.modal().getByRole('button', { name: '选择文件夹…' })); await waitFor(() => assert.equal((v.modal().getByLabelText('部署路径') as HTMLInputElement).value, '.agents/skills')); assert.equal((v.modal().getByLabelText('部署路径') as HTMLInputElement).value, '.agents/skills'); assert.equal((await v.service.request('snapshot', { workspace: v.workspace })).workspace?.config?.targets, undefined);
  fireEvent.click(v.modal().getByRole('button', { name: '取消' })); assert.equal(v.queryByRole('dialog') === null, true);
  fireEvent.click(v.getByRole('button', { name: '添加目标' })); fireEvent.change(v.modal().getByLabelText('Agent 标识'), { target: { value: 'custom-agent' } }); fireEvent.change(v.modal().getByLabelText('部署路径'), { target: { value: '.custom/skills' } });
  v.choices.push(null); fireEvent.click(v.modal().getByRole('button', { name: '选择文件夹…' })); await waitFor(() => assert.ok(v.calls.some(c => c.method === 'selectDirectory' && c.input.current === '.custom/skills'))); assert.equal((v.modal().getByLabelText('Agent 标识') as HTMLInputElement).value, 'custom-agent'); assert.equal((v.modal().getByLabelText('部署路径') as HTMLInputElement).value, '.custom/skills');
  await waitFor(() => assert.equal((v.modal().getByRole('button', { name: '选择文件夹…' }) as HTMLButtonElement).disabled, false));
  v.choices.push(picked); fireEvent.click(v.modal().getByRole('button', { name: '选择文件夹…' })); await waitFor(() => assert.equal((v.modal().getByLabelText('部署路径') as HTMLInputElement).value, '.agents/skills'));
  fireEvent.click(v.modal().getByRole('button', { name: '预览保存' })); await v.findByRole('dialog', { name: '预览变更' }); fireEvent.click(v.modal().getByRole('button', { name: '确认保存' })); await waitFor(() => assert.equal(v.queryByRole('dialog') === null, true));
  const snapshot = await v.service.request('snapshot', { workspace: v.workspace }); assert.equal(snapshot.workspace?.config?.targets?.['custom-agent'].path, '.agents/skills'); assert.equal(snapshot.global.config?.defaults.targets['custom-agent'], undefined); assert.equal(snapshot.workspace?.root, v.workspace);
});
test('open forms retain their original fingerprint when a focus refresh sees external changes', async t => {
  const v = await setup(t, true); fireEvent.click(v.sidebar.getByRole('button', { name: /Agent 目标/ })); fireEvent.click(v.getByRole('button', { name: '配置 Claude Code' }));
  fireEvent.change(v.modal().getByLabelText('部署路径'), { target: { value: '.changed/skills' } });
  await fs.appendFile(v.file, '# externally changed\n'); await act(async () => { window.dispatchEvent(new dom.window.Event('focus')); await new Promise(resolve => setTimeout(resolve, 30)); });
  fireEvent.click(v.modal().getByRole('button', { name: '预览保存' })); await v.findByText(/配置已被外部修改/); assert.equal((v.modal().getByLabelText('部署路径') as HTMLInputElement).value, '.changed/skills'); assert.match(await fs.readFile(v.file, 'utf8'), /externally changed/); assert.doesNotMatch(await fs.readFile(v.file, 'utf8'), /changed\/skills/);
});
test('dirty YAML blocks navigation and can be merged against an external version', async t => {
  const v = await setup(t, true); fireEvent.click(v.sidebar.getByRole('button', { name: '项目 YAML' }));
  const editor = v.getByLabelText('项目 YAML 配置'); fireEvent.change(editor, { target: { value: 'skills: []\nlocal: kept\n' } });
  fireEvent.click(v.sidebar.getByRole('button', { name: '设置' })); await v.findByRole('dialog', { name: '工作区配置尚未保存' }); fireEvent.click(v.modal().getByRole('button', { name: '返回编辑' })); assert.equal((v.getByLabelText('项目 YAML 配置') as HTMLTextAreaElement).value.includes('local: kept'), true);
  await fs.writeFile(v.file, 'skills: []\nexternal: kept\n'); await act(async () => { window.dispatchEvent(new dom.window.Event('focus')); await new Promise(resolve => setTimeout(resolve, 30)); });
  fireEvent.click(await v.findByRole('button', { name: '比较版本' })); await v.findByRole('dialog', { name: '比较外部配置变更' }); fireEvent.change(v.modal().getByLabelText('合并结果'), { target: { value: 'skills: []\nlocal: kept\nexternal: kept\n' } }); fireEvent.click(v.modal().getByRole('button', { name: '预览合并保存' })); await v.findByRole('dialog', { name: '预览变更' }); fireEvent.click(v.modal().getByRole('button', { name: '确认保存' })); await waitFor(() => assert.equal(v.queryByRole('dialog') === null, true)); const raw = await fs.readFile(v.file, 'utf8'); assert.match(raw, /local: kept/); assert.match(raw, /external: kept/);
});
test('both settings use the same navigation and choosing a global center never switches workspace', async t => {
  const v = await setup(t, true); fireEvent.click(v.sidebar.getByRole('button', { name: '设置' })); await v.findByRole('heading', { name: '设置', level: 1 });
  fireEvent.click(v.sidebar.getByRole('button', { name: '全局管理' })); fireEvent.click(v.sidebar.getByRole('button', { name: '设置' })); await v.findByRole('heading', { name: '设置', level: 1 }); assert.equal(v.sidebar.queryByRole('button', { name: /当前工作区/ }), null);
  const next = path.join(v.base, 'next-center'); await fs.mkdir(next); v.choices.push(next); fireEvent.click(v.getByRole('button', { name: '更改…' })); fireEvent.click(v.modal().getByRole('button', { name: '选择文件夹…' })); await waitFor(() => assert.equal((v.modal().getByLabelText('中心目录路径') as HTMLInputElement).value, next)); fireEvent.click(v.modal().getByRole('button', { name: '预览变更' })); await v.findByRole('dialog', { name: '预览变更' }); fireEvent.click(v.modal().getByRole('button', { name: '确认保存' })); await waitFor(() => assert.equal(v.queryByRole('dialog') === null, true));
  assert.equal((await v.service.request('snapshot', { workspace: v.workspace })).global.center, next); assert.equal((await v.service.request('snapshot', {})).preferences.lastWorkspace, v.workspace);
});


test('target card and switch are independent, custom members survive disable and inherit round trips', async t => {
  const v = await setup(t, true);
  fireEvent.click(v.sidebar.getByRole('button', { name: /Agent 目标/ }));
  fireEvent.click(v.getByRole('button', { name: '配置 Claude Code' }));
  fireEvent.click(v.modal().getByRole('radio', { name: /使用独立清单/ }));
  fireEvent.click(v.modal().getByRole('button', { name: '添加技能' }));
  fireEvent.click(v.modal().getByRole('checkbox', { name: /alpha/ }));
  fireEvent.click(v.modal().getByRole('checkbox', { name: /beta/ }));
  fireEvent.click(v.modal().getByRole('button', { name: '加入 2 个技能' }));
  fireEvent.click(v.modal().getByRole('switch', { name: '启用 Claude Code 的 beta' }));
  assert.equal((v.modal().getByRole('switch', { name: '启用 Claude Code 的 beta' }) as HTMLInputElement).checked, false);
  await waitFor(() => assert.equal((v.modal().getByRole('switch', { name: '启用 Claude Code 的 beta' }) as HTMLInputElement).disabled, false));
  assert.match(await fs.readFile(v.file, 'utf8'), /# - beta/);
  assert.ok(v.getByRole('dialog', { name: '配置目标 · Claude Code' }));
  fireEvent.click(v.modal().getByRole('button', { name: '预览保存' }));
  await v.findByRole('dialog', { name: '预览变更' });
  fireEvent.click(v.modal().getByRole('button', { name: '确认保存' }));
  await waitFor(() => assert.equal(v.queryByRole('dialog') === null, true));
  assert.match(await fs.readFile(v.file, 'utf8'), /# - beta/);
  fireEvent.click(v.getByRole('switch', { name: '启用 Claude Code' }));
  assert.equal(v.queryByRole('dialog') === null, true);
  await waitFor(() => assert.equal((v.getByRole('switch', { name: '启用 Claude Code' }) as HTMLInputElement).disabled, false));
  assert.equal((v.getByRole('switch', { name: '启用 Claude Code' }) as HTMLInputElement).checked, false);
  assert.match(await fs.readFile(v.file, 'utf8'), /# claude-code:/);
  fireEvent.click(v.getByRole('button', { name: '配置 Claude Code' }));
  assert.equal((v.modal().getByRole('switch', { name: '启用 Claude Code 的 beta' }) as HTMLInputElement).checked, false);
  fireEvent.click(v.modal().getByRole('radio', { name: /继承工作区默认清单/ }));
  fireEvent.click(v.modal().getByRole('button', { name: '添加技能' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.ok(v.modal().getByRole('button', { name: '添加技能' }));
  fireEvent.click(v.modal().getByRole('button', { name: '预览保存' }));
  await v.findByRole('dialog', { name: '预览变更' });
  fireEvent.click(v.modal().getByRole('button', { name: '返回编辑' }));
  await v.findByRole('dialog', { name: '配置目标 · Claude Code' });
  assert.equal((v.modal().getByRole('radio', { name: /继承工作区默认清单/ }) as HTMLInputElement).checked, true);
  fireEvent.click(v.modal().getByRole('button', { name: '取消' }));
  assert.equal((v.getByRole('switch', { name: '启用 Claude Code' }) as HTMLInputElement).checked, false);
});

test('target switches save immediately without dialogs and restore state after a failed save', async t => {
  const v = await setup(t, true);
  fireEvent.click(v.sidebar.getByRole('button', { name: /Agent 目标/ }));
  const bridge = window.skillRegistry!, original = await fs.readFile(v.file, 'utf8');
  let release: (() => void) | undefined;
  window.skillRegistry = { ...bridge, async call(method, input) {
    if (method === 'commit') {
      await new Promise<void>(resolve => { release = resolve; });
      return { ok: false, error: { code: 'IO', message: '测试保存失败，请重试' } };
    }
    return bridge.call(method, input);
  } };
  fireEvent.click(v.getByRole('switch', { name: '启用 Claude Code' }));
  assert.equal((v.getByRole('switch', { name: '启用 Claude Code' }) as HTMLInputElement).checked, false);
  assert.equal((v.getByRole('switch', { name: '启用 Claude Code' }) as HTMLInputElement).disabled, true);
  assert.equal(v.queryByRole('dialog') === null, true);
  await waitFor(() => assert.equal(typeof release, 'function'));
  await act(async () => { release!(); });
  await v.findByText('测试保存失败，请重试');
  await waitFor(() => assert.equal((v.getByRole('switch', { name: '启用 Claude Code' }) as HTMLInputElement).disabled, false));
  assert.equal((v.getByRole('switch', { name: '启用 Claude Code' }) as HTMLInputElement).checked, true);
  assert.equal(await fs.readFile(v.file, 'utf8'), original);
  window.skillRegistry = bridge;
  for (const enabled of [false, true]) {
    fireEvent.click(v.getByRole('switch', { name: '启用 Claude Code' }));
    assert.equal(v.queryByRole('dialog') === null, true);
    await waitFor(() => assert.equal((v.getByRole('switch', { name: '启用 Claude Code' }) as HTMLInputElement).disabled, false));
    assert.equal((v.getByRole('switch', { name: '启用 Claude Code' }) as HTMLInputElement).checked, enabled);
    const snapshot = await v.service.request('snapshot', { workspace: v.workspace });
    assert.equal(snapshot.workspace!.targets.find(target => target.id === 'claude-code')!.enabled, enabled);
  }
});

test('member switches persist only their row and preserve the rest of the form draft', async t => {
  const v = await setup(t, true);
  await fs.writeFile(v.file, 'skills: []\ntargets:\n  codex:\n    skills: [alpha, beta]\n');
  fireEvent.click(v.getByRole('button', { name: '刷新配置' }));
  await waitFor(() => assert.equal((v.getByRole('button', { name: '刷新配置' }) as HTMLButtonElement).disabled, false));
  fireEvent.click(v.sidebar.getByRole('button', { name: /Agent 目标/ }));
  fireEvent.click(v.getByRole('button', { name: '配置 Codex' }));
  fireEvent.change(v.modal().getByLabelText('部署路径'), { target: { value: '.draft/skills' } });
  fireEvent.click(v.modal().getByRole('radio', { name: /继承工作区默认清单/ }));
  fireEvent.click(v.modal().getByRole('button', { name: '从 Codex 移除 beta' }));
  fireEvent.click(v.modal().getByRole('switch', { name: '启用 Codex 的 alpha' }));
  await waitFor(() => assert.equal((v.modal().getByRole('switch', { name: '启用 Codex 的 alpha' }) as HTMLInputElement).disabled, false));
  const stored = await v.service.request('snapshot', { workspace: v.workspace });
  assert.deepEqual(stored.workspace!.targets[0].members, [{ id: 'alpha', enabled: false }, { id: 'beta', enabled: true }]);
  assert.equal(stored.workspace!.targets[0].path, '.codex/skills');
  assert.equal(stored.workspace!.targets[0].custom, true);
  assert.equal((v.modal().getByLabelText('部署路径') as HTMLInputElement).value, '.draft/skills');
  assert.equal((v.modal().getByRole('radio', { name: /继承工作区默认清单/ }) as HTMLInputElement).checked, true);
  assert.equal(v.modal().queryByRole('switch', { name: '启用 Codex 的 beta' }) === null, true);
  fireEvent.click(v.modal().getByRole('button', { name: '预览保存' }));
  await v.findByRole('dialog', { name: '预览变更' }); // An owned member save must advance the form fingerprint.
  fireEvent.click(v.modal().getByRole('button', { name: '返回编辑' }));
  await v.findByRole('dialog', { name: '配置目标 · Codex' });
  fireEvent.click(v.modal().getByRole('button', { name: '取消' }));
  fireEvent.click(v.getByRole('button', { name: '配置 Codex' }));
  assert.equal((v.modal().getByRole('switch', { name: '启用 Codex 的 alpha' }) as HTMLInputElement).checked, false);
  assert.ok(v.modal().getByRole('switch', { name: '启用 Codex 的 beta' }));
  fireEvent.click(v.modal().getByRole('switch', { name: '启用 Codex 的 alpha' }));
  await waitFor(() => assert.equal((v.modal().getByRole('switch', { name: '启用 Codex 的 alpha' }) as HTMLInputElement).disabled, false));
  assert.equal((v.modal().getByRole('switch', { name: '启用 Codex 的 alpha' }) as HTMLInputElement).checked, true);
  const enabledAgain = await v.service.request('snapshot', { workspace: v.workspace });
  assert.deepEqual(enabledAgain.workspace!.targets[0].skills, ['alpha', 'beta']);
});

test('member switches roll back failed writes and reject external edits without discarding drafts', async t => {
  const v = await setup(t, true);
  await fs.writeFile(v.file, 'skills: []\ntargets:\n  codex:\n    skills: [alpha]\n');
  fireEvent.click(v.getByRole('button', { name: '刷新配置' }));
  await waitFor(() => assert.equal((v.getByRole('button', { name: '刷新配置' }) as HTMLButtonElement).disabled, false));
  fireEvent.click(v.sidebar.getByRole('button', { name: /Agent 目标/ }));
  fireEvent.click(v.getByRole('button', { name: '配置 Codex' }));
  const bridge = window.skillRegistry!, before = await fs.readFile(v.file, 'utf8');
  window.skillRegistry = { ...bridge, async call(method, input) {
    if (method === 'commit') return { ok: false, error: { code: 'IO', message: '测试技能状态保存失败' } };
    return bridge.call(method, input);
  } };
  fireEvent.click(v.modal().getByRole('switch', { name: '启用 Codex 的 alpha' }));
  await v.modal().findByText('测试技能状态保存失败');
  await waitFor(() => assert.equal((v.modal().getByRole('switch', { name: '启用 Codex 的 alpha' }) as HTMLInputElement).disabled, false));
  assert.equal((v.modal().getByRole('switch', { name: '启用 Codex 的 alpha' }) as HTMLInputElement).checked, true);
  assert.equal(await fs.readFile(v.file, 'utf8'), before);
  window.skillRegistry = bridge;
  fireEvent.change(v.modal().getByLabelText('部署路径'), { target: { value: '.my-draft/skills' } });
  await fs.appendFile(v.file, '# external edit\n');
  fireEvent.click(v.modal().getByRole('switch', { name: '启用 Codex 的 alpha' }));
  await v.modal().findByText(/配置已被外部修改/);
  assert.equal((v.modal().getByLabelText('部署路径') as HTMLInputElement).value, '.my-draft/skills');
  assert.match(await fs.readFile(v.file, 'utf8'), /external edit/);
  assert.doesNotMatch(await fs.readFile(v.file, 'utf8'), /# - alpha/);
});
