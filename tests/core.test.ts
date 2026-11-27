import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RegistryService, type ServiceOptions } from '../core/service';
import type { Preferences } from '../shared/types';
import { git } from '../core/git';
import { withTargetDirectories } from '../core/target-directories';
import { ProjectDocument } from '../core/project-yaml';
import { parse } from 'yaml';
import { spawnSync } from 'node:child_process';

async function fixture(t: TestContext, overrides: Partial<ServiceOptions> = {}) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'skill-registry-test-'))), home = path.join(base, 'home'), workspace = path.join(base, 'project');
  await fs.mkdir(home); await fs.mkdir(workspace); t.after(() => fs.rm(base, { recursive: true, force: true }));
  let preferences: Preferences = { recent: [] };
  const trashed: string[] = [];
  const service = new RegistryService({ home, temp: path.join(base, 'temporary'), loadPreferences: () => preferences, savePreferences: p => { preferences = p; }, trash: async file => { trashed.push(file); await fs.rename(file, path.join(base, 'trash-' + trashed.length)); }, open: async () => {}, selectDirectory: async () => null, ...overrides });
  const call = service.request.bind(service);
  await call('initializeGlobal', {}); await call('selectWorkspace', { path: workspace });
  const center = path.join(home, '.skill-registry/skills');
  async function skill(id: string, name = id) { const directory = path.join(center, id); await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Description for ${id}\n---\n# ${name}\n`); return directory; }
  async function initialize(ids: string[] = []) { await call('initializeWorkspace', { workspace }); if (ids.length) { const snapshot = await call('snapshot', { workspace }); const preview = await call('previewProject', { workspace, hash: snapshot.workspace!.hash, change: { type: 'skills', add: ids } }); await call('commit', { id: preview.id }); } }
  return { base, home, workspace, center, service, call, skill, initialize, trashed };
}
async function presetPreview(f: Awaited<ReturnType<typeof fixture>>, ids: string[]) {
  const catalog = await f.call('workspacePresets', { workspace: f.workspace });
  return f.call('previewProject', { workspace: f.workspace, hash: catalog.workspaceHash, change: { type: 'preset-targets', ids, globalHash: catalog.globalHash } });
}
test('comment switches persist target, list and member state and preserve links without fallback', async t => {
  const f = await fixture(t); await f.skill('alpha'); await f.skill('beta'); await f.initialize(['alpha']);
  const file = path.join(f.workspace, '.skill-registry/config.yaml');
  await fs.writeFile(file, '# workspace note\nskills: [alpha]\ntargets:\n  codex:\n    custom: retained\n    skills:\n      - beta\n      # - alpha\n');
  const change = async (change: any) => { const s = await f.call('snapshot', { workspace: f.workspace }); const p = await f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change }); await f.call('commit', { id: p.id }); return p; };
  let s = await f.call('snapshot', { workspace: f.workspace });
  assert.deepEqual(s.workspace!.links.map(l => l.skill), ['beta']);
  const plan = await f.call('previewLinks', { workspace: f.workspace }); await f.call('applyLinks', { id: plan.id, taskId: 'first' });
  const p = await change({ type: 'target-enabled', id: 'codex', enabled: false });
  assert.match(p.after, /# codex:/); assert.match(p.after, /#     # - alpha/); assert.doesNotMatch(p.after, /enabled:/);
  s = await f.call('snapshot', { workspace: f.workspace });
  assert.equal(s.workspace!.targets.length, 1); assert.equal(s.workspace!.targets[0].enabled, false); assert.equal(s.workspace!.links.length, 0);
  assert.equal(s.workspace!.leftovers[0].skill, 'beta');
  assert.equal((await fs.lstat(path.join(f.workspace, '.codex/skills/beta'))).isSymbolicLink(), true);
  await change({ type: 'target', id: 'codex', custom: false, members: [{ id: 'beta', enabled: true }, { id: 'alpha', enabled: false }] });
  await change({ type: 'skills', add: ['beta'] });
  assert.match(await fs.readFile(file, 'utf8'), /workspace note/);
  await change({ type: 'target-enabled', id: 'codex', enabled: true });
  s = await f.call('snapshot', { workspace: f.workspace });
  assert.equal(s.workspace!.targets[0].custom, false); assert.deepEqual(s.workspace!.targets[0].skills, ['alpha', 'beta']);
  assert.deepEqual(s.workspace!.targets[0].members!.map(m => m.enabled), [true, false]);
  await change({ type: 'target', id: 'codex', custom: true });
  assert.deepEqual(parse(await fs.readFile(file, 'utf8')).targets.codex.skills, ['beta']);
  const refs = await f.call('references', { id: 'beta', workspace: f.workspace }); assert.equal(refs.projects.length, 1);
});
test('disabled members, explicit empty lists and orphan targets remain editable and safely validated', async t => {
  const f = await fixture(t); await f.skill('alpha'); await f.skill('beta'); await f.initialize();
  const file = path.join(f.workspace, '.skill-registry/config.yaml');
  await fs.writeFile(file, 'skills: []\ntargets: {}\n  # orphan: {}\n');
  let s = await f.call('snapshot', { workspace: f.workspace });
  assert.ok(s.workspace!.config); assert.equal(s.workspace!.targets[0].enabled, false);
  await assert.rejects(f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'target-enabled', id: 'orphan', enabled: true } }), /路径/);
  const p = await f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'target', id: 'orphan', path: '', custom: true, members: [{ id: 'alpha', enabled: false }, { id: 'beta', enabled: false }] } });
  await f.call('commit', { id: p.id });
  s = await f.call('snapshot', { workspace: f.workspace });
  assert.equal(s.workspace!.targets[0].enabled, false); assert.deepEqual(s.workspace!.targets[0].skills, []);
  assert.match(s.workspace!.raw, /#   skills: \[\]/);
  assert.equal(new ProjectDocument(s.workspace!.raw).states.orphan.members.length, 2);
  const refs = await f.call('references', { id: 'alpha', workspace: f.workspace }); assert.equal(refs.projects[0].retained, true);
  const plan = await f.call('previewLinks', { workspace: f.workspace }); assert.deepEqual(plan.entries, []);
});
test('plugin comments survive CLI mutations and both applications resolve the same effective list', async t => {
  const binary = path.resolve('../skill-registry/bin/skill-registry');
  try { await fs.access(binary); } catch { t.skip('Sibling CLI checkout is not present'); return; }
  const f = await fixture(t); await f.skill('alpha'); await f.skill('beta'); await f.initialize(['alpha']);
  const file = path.join(f.workspace, '.skill-registry/config.yaml'), bootstrap = path.join(f.base, 'home.cjs');
  await fs.writeFile(bootstrap, `require('node:os').homedir = () => ${JSON.stringify(f.home)};`);
  await fs.writeFile(file, 'skills: [alpha]\ntargets: {}\n  # codex:\n  #   # skills:\n  #   #   - beta\n  #   #   # - alpha\n');
  const run = (...args: string[]) => { const result = spawnSync(process.execPath, ['--require', bootstrap, binary, ...args], { cwd: f.workspace, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout; };
  const toggle = async (enabled: boolean) => { const snapshot = await f.call('snapshot', { workspace: f.workspace }); const preview = await f.call('previewProject', { workspace: f.workspace, hash: snapshot.workspace!.hash, change: { type: 'target-enabled', id: 'codex', enabled } }); await f.call('commit', { id: preview.id }); };
  await toggle(true);
  let s = await f.call('snapshot', { workspace: f.workspace });
  assert.equal(s.workspace!.targets[0].custom, false); assert.deepEqual(s.workspace!.targets[0].members!.map(m => m.enabled), [true, false]);
  run('target', 'codex', 'add', 'beta'); await toggle(false);
  s = await f.call('snapshot', { workspace: f.workspace });
  assert.equal(s.workspace!.targets[0].enabled, false); assert.equal(s.workspace!.links.length, 0);
  const p = await f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'target-enabled', id: 'codex', enabled: true } }); await f.call('commit', { id: p.id });
  assert.match(run('target', 'list'), /Skills \(target override\): beta/);
  assert.deepEqual((await f.call('snapshot', { workspace: f.workspace })).workspace!.links.map(l => l.skill), ['beta']);
});
test('preset targets are read-only until confirmed, then create directories without deploying Skills', async t => {
  const f = await fixture(t); await f.skill('alpha'); await f.initialize(['alpha']);
  const before = await f.call('snapshot', { workspace: f.workspace });
  const catalog = await f.call('workspacePresets', { workspace: f.workspace });
  assert.equal(catalog.targets.find(t => t.id === 'claude-code')?.state, 'missing');
  assert.equal(catalog.targets.find(t => t.id === 'claude-code')?.selectable, true); // default fallback is not an existing directory
  const cancelled = await presetPreview(f, ['codex']); await f.call('discardPreview', { id: cancelled.id });
  await assert.rejects(fs.lstat(path.join(f.workspace, '.codex')));
  assert.equal((await f.call('snapshot', { workspace: f.workspace })).workspace?.hash, before.workspace?.hash);
  const preview = await presetPreview(f, ['claude-code', 'codex', 'cursor']);
  assert.equal(preview.directories?.length, 3); assert.ok(preview.directories?.every(d => !d.existed && !d.outside));
  await assert.rejects(fs.lstat(path.join(f.workspace, '.claude')));
  await f.call('commit', { id: preview.id });
  const after = await f.call('snapshot', { workspace: f.workspace });
  assert.equal(after.global.hash, before.global.hash);
  for (const id of ['claude-code', 'codex', 'cursor']) {
    assert.equal(after.workspace?.targets.find(t => t.id === id)?.source, 'explicit');
    const directory: string = preview.directories!.find(d => d.id === id)!.directory;
    assert.deepEqual(await fs.readdir(directory), []);
  }
  assert.equal(after.workspace?.links.every(l => l.status === 'missing'), true);
  await assert.rejects(fs.lstat(path.join(f.home, '.claude'))); // external home preset was not selected
});
test('preset addition preserves existing files, repairs missing explicit directories and protects custom overrides', async t => {
  const f = await fixture(t); await f.initialize(); const file = path.join(f.workspace, '.skill-registry/config.yaml');
  await fs.writeFile(file, 'skills: []\n# keep configuration\ntargets:\n  cursor:\n    path: .cursor/rules\n    custom: preserved\n  codex:\n    path: .codex/custom\n');
  await fs.mkdir(path.join(f.workspace, '.agents/skills'), { recursive: true });
  await fs.writeFile(path.join(f.workspace, '.agents/skills/keep.txt'), 'original');
  const catalog = await f.call('workspacePresets', { workspace: f.workspace });
  assert.equal(catalog.targets.find(t => t.id === 'codex')?.state, 'override');
  assert.equal(catalog.targets.find(t => t.id === 'cursor')?.state, 'missing');
  assert.equal(catalog.targets.find(t => t.id === 'agent-generic')?.state, 'existing');
  await assert.rejects(presetPreview(f, ['codex']), /自定义路径/);
  const preview = await presetPreview(f, ['cursor', 'agent-generic']); await f.call('commit', { id: preview.id });
  assert.equal(await fs.readFile(path.join(f.workspace, '.agents/skills/keep.txt'), 'utf8'), 'original');
  const raw = await fs.readFile(file, 'utf8'); assert.match(raw, /# keep configuration/); assert.match(raw, /custom: preserved/); assert.match(raw, /path: .codex\/custom/);
  const after = await f.call('workspacePresets', { workspace: f.workspace });
  assert.equal(after.targets.find(t => t.id === 'cursor')?.selectable, false);
  assert.equal(after.targets.find(t => t.id === 'agent-generic')?.state, 'configured');
});
test('preset catalog uses current global templates, including external and user-defined presets', async t => {
  const f = await fixture(t); await f.initialize();
  const snapshot = await f.call('snapshot', {});
  const raw = snapshot.global.raw + '\n';
  const { parse, stringify } = await import('yaml'); const config = parse(raw);
  config.defaults.targets.codex = { path: '.custom-codex/skills', description: 'Custom template', extra: 1 };
  config.defaults.targets['my-agent'] = { path: '.my-agent/skills' }; delete config.defaults.targets.qoder;
  await fs.writeFile(f.service.globalPath, stringify(config));
  const catalog = await f.call('workspacePresets', { workspace: f.workspace });
  assert.equal(catalog.targets.some(t => t.id === 'qoder'), false);
  assert.equal(catalog.targets.find(t => t.id === 'claude-code-home')?.outside, true);
  const preview = await presetPreview(f, ['codex', 'my-agent', 'claude-code-home']);
  assert.equal(preview.directories?.find(t => t.id === 'claude-code-home')?.directory, path.join(f.home, '.claude/skills'));
  await f.call('commit', { id: preview.id });
  const after = await f.call('snapshot', { workspace: f.workspace });
  assert.equal(after.workspace?.config?.targets?.codex.path, '.custom-codex/skills');
  assert.equal(after.workspace?.config?.targets?.codex.extra, 1);
  assert.equal((await fs.stat(path.join(f.home, '.claude/skills'))).isDirectory(), true);
  await assert.rejects(fs.lstat(path.join(f.workspace, '.codex')));
});
test('stale workspace or global configuration blocks preset directory creation before any writes', async t => {
  const f = await fixture(t); await f.initialize(); const file = path.join(f.workspace, '.skill-registry/config.yaml');
  let preview = await presetPreview(f, ['codex']); await fs.appendFile(file, '# external workspace edit\n');
  await assert.rejects(f.call('commit', { id: preview.id }), /变化|改动|修改/);
  await assert.rejects(fs.lstat(path.join(f.workspace, '.codex')));
  const catalog = await f.call('workspacePresets', { workspace: f.workspace });
  preview = await presetPreview(f, ['codex']); await fs.appendFile(f.service.globalPath, '# external global edit\n');
  await assert.rejects(f.call('commit', { id: preview.id }), /变化|改动|修改/);
  await assert.rejects(fs.lstat(path.join(f.workspace, '.codex')));
  const fresh = await f.call('snapshot', { workspace: f.workspace });
  await assert.rejects(f.call('previewProject', { workspace: f.workspace, hash: fresh.workspace!.hash, change: { type: 'preset-targets', ids: ['codex'], globalHash: catalog.globalHash } }), /预设已变化/);
});
test('preset path conflicts and redirected directory aliases are blocked without overwriting', async t => {
  const f = await fixture(t); await f.initialize();
  await fs.mkdir(path.join(f.workspace, '.cursor')); await fs.writeFile(path.join(f.workspace, '.cursor/rules'), 'keep');
  const catalog = await f.call('workspacePresets', { workspace: f.workspace });
  assert.equal(catalog.targets.find(t => t.id === 'cursor')?.state, 'blocked');
  await assert.rejects(presetPreview(f, ['cursor']), /不是文件夹/);
  const preview = await presetPreview(f, ['codex']);
  const outside = path.join(f.base, 'outside'); await fs.mkdir(outside); await fs.symlink(outside, path.join(f.workspace, '.codex'));
  await assert.rejects(f.call('commit', { id: preview.id }), /路径已变化/);
  assert.deepEqual(await fs.readdir(outside), []); assert.equal(await fs.readFile(path.join(f.workspace, '.cursor/rules'), 'utf8'), 'keep');
  assert.equal((await f.call('snapshot', { workspace: f.workspace })).workspace?.config?.targets, undefined);
});
test('failed config writes roll back only newly created empty directories and can be retried', async t => {
  const f = await fixture(t); await f.initialize(); const file = path.join(f.workspace, '.skill-registry/config.yaml');
  await fs.mkdir(path.join(f.workspace, '.cursor/rules'), { recursive: true }); await fs.writeFile(path.join(f.workspace, '.cursor/rules/keep'), 'keep');
  const preview = await presetPreview(f, ['codex', 'cursor']), before = await fs.readFile(file, 'utf8');
  await fs.mkdir(file + '.bak'); await fs.writeFile(path.join(file + '.bak', 'keep'), 'keep'); // deterministic backup replacement failure
  await assert.rejects(f.call('commit', { id: preview.id }));
  await assert.rejects(fs.lstat(path.join(f.workspace, '.codex')));
  assert.equal(await fs.readFile(path.join(f.workspace, '.cursor/rules/keep'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(file, 'utf8'), before);
  await fs.rm(file + '.bak', { recursive: true }); await f.call('commit', { id: preview.id });
  assert.equal((await fs.stat(path.join(f.workspace, '.codex/skills'))).isDirectory(), true);
});
test('directory rollback preserves files that appear during a failed save', async t => {
  const f = await fixture(t); await f.initialize();
  const target = path.join(f.workspace, '.codex/skills');
  await assert.rejects(withTargetDirectories([{ id: 'codex', path: '.codex/skills', directory: target, existed: false, outside: false }], f.workspace, f.center, f.home, async () => {
    await fs.writeFile(path.join(target, 'created-by-another-process'), 'keep');
    throw new Error('save failed');
  }), /save failed[\s\S]*已保留/);
  assert.equal(await fs.readFile(path.join(target, 'created-by-another-process'), 'utf8'), 'keep');
});
test('selection is read-only and initialization is exclusive', async t => {
  const f = await fixture(t); let s = await f.call('snapshot', { workspace: f.workspace }); assert.equal(s.workspace?.exists, false);
  await assert.rejects(fs.stat(path.join(f.workspace, '.skill-registry/config.yaml')));
  await f.initialize(); await assert.rejects(f.initialize(), /EEXIST/);
  s = await f.call('snapshot', { workspace: f.workspace }); assert.deepEqual(s.workspace?.config?.skills, []); assert.equal(s.workspace?.targets[0].source, 'default');
});
test('form changes preserve comments and unknown fields; empty targets keep preset path inheritance', async t => {
  const f = await fixture(t); await f.skill('alpha', 'Friendly title'); await f.initialize();
  const file = path.join(f.workspace, '.skill-registry/config.yaml');
  await fs.writeFile(file, '# project comment\ncustom: kept\nskills: [] # skills comment\ntargets:\n  codex: {}\ngroups:\n  legacy:\n    skills: [alpha]\n');
  const s = await f.call('snapshot', { workspace: f.workspace }); assert.equal(s.skills[0].id, 'alpha'); assert.equal(s.skills[0].name, 'Friendly title');
  const p = await f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'skills', add: ['alpha'] } });
  assert.match(p.after, /project comment/); assert.match(p.after, /skills comment/); assert.match(p.after, /custom: kept/); assert.match(p.after, /legacy/); assert.match(p.after, /codex: \{\}/);
  assert.equal((await fs.readFile(file, 'utf8')).includes('path: .codex'), false); await f.call('commit', { id: p.id }); assert.match(await fs.readFile(file + '.bak', 'utf8'), /codex: \{\}/);
});
test('external edits invalidate configuration preview and preserve disk contents', async t => {
  const f = await fixture(t); await f.skill('alpha'); await f.initialize(); const s = await f.call('snapshot', { workspace: f.workspace });
  const p = await f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'skills', add: ['alpha'] } });
  await fs.appendFile(s.workspace!.path, '# external\n'); await assert.rejects(f.call('commit', { id: p.id }), /外部修改/); assert.match(await fs.readFile(s.workspace!.path, 'utf8'), /external/);
});
test('complex YAML is readable but requires original-text editing', async t => {
  const f = await fixture(t); await f.initialize(); const file = path.join(f.workspace, '.skill-registry/config.yaml'); await fs.writeFile(file, 'skills: []\ncustom: &v [one]\ncopy: *v\n');
  const s = await f.call('snapshot', { workspace: f.workspace }); assert.equal(s.workspace?.formEditable, false);
  await assert.rejects(f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'skills', add: [] } }), /原文/);
  const p = await f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'raw', raw: s.workspace!.raw + '# safe raw edit\n' } }); await f.call('commit', { id: p.id });
});
test('explicit target union, autodetection and local overrides stay separate from presets', async t => {
  const f = await fixture(t); await f.initialize(); await fs.mkdir(path.join(f.workspace, '.codex'));
  let s = await f.call('snapshot', { workspace: f.workspace }); assert.deepEqual(s.workspace?.targets.map(t => [t.id, t.source]), [['codex', 'detected']]);
  const p = await f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'target', id: 'codex', path: '.codex/custom' } }); await f.call('commit', { id: p.id });
  s = await f.call('snapshot', { workspace: f.workspace }); assert.equal(s.workspace?.targets[0].source, 'explicit'); assert.equal(s.global.config?.defaults.targets.codex.path, '.codex/skills');
  const remove = await f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'target', id: 'codex', remove: true } }); await f.call('commit', { id: remove.id }); s = await f.call('snapshot', { workspace: f.workspace }); assert.equal(s.workspace?.targets[0].source, 'detected');
});
test('applying links is incremental and central edits are shared immediately', async t => {
  const f = await fixture(t); const source = await f.skill('alpha'); await f.initialize(['alpha']);
  let plan = await f.call('previewLinks', { workspace: f.workspace }); assert.equal(plan.entries[0].status, 'missing');
  const result = await f.call('applyLinks', { id: plan.id, taskId: 'one' }); assert.equal(result.created.length, 1);
  const link = plan.entries[0].destination; assert.equal((await fs.lstat(link)).isSymbolicLink(), true); await fs.writeFile(path.join(source, 'shared.txt'), 'v2'); assert.equal(await fs.readFile(path.join(link, 'shared.txt'), 'utf8'), 'v2');
  plan = await f.call('previewLinks', { workspace: f.workspace }); assert.equal(plan.entries[0].status, 'linked'); assert.equal((await f.call('applyLinks', { id: plan.id, taskId: 'two' })).created.length, 0);
  const s = await f.call('snapshot', { workspace: f.workspace }), p = await f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'skills', remove: ['alpha'] } }); await f.call('commit', { id: p.id });
  const after = await f.call('snapshot', { workspace: f.workspace }); assert.equal(after.workspace?.leftovers.length, 1); assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
});
test('entities, foreign symlinks, broken links and missing sources are never overwritten', async t => {
  const f = await fixture(t); for (const id of ['entity', 'foreign', 'broken', 'missing']) await f.skill(id); await f.initialize(['entity', 'foreign', 'broken', 'missing']);
  const target = path.join(f.workspace, '.claude/skills'); await fs.mkdir(target, { recursive: true }); await fs.mkdir(path.join(target, 'entity')); await fs.writeFile(path.join(target, 'entity/keep'), 'keep');
  await fs.symlink(f.base, path.join(target, 'foreign')); await fs.symlink(path.join(f.base, 'absent'), path.join(target, 'broken')); await fs.rm(path.join(f.center, 'missing'), { recursive: true });
  const plan = await f.call('previewLinks', { workspace: f.workspace }); assert.deepEqual(plan.entries.map(e => e.status), ['conflict', 'conflict', 'broken', 'source-missing']);
  const result = await f.call('applyLinks', { id: plan.id, taskId: 'safe' }); assert.equal(result.created.length, 0); assert.equal(await fs.readFile(path.join(target, 'entity/keep'), 'utf8'), 'keep'); assert.equal(await fs.readlink(path.join(target, 'foreign')), f.base);
});
test('stale link plans and symlink aliases to the center are rejected', async t => {
  const f = await fixture(t); await f.skill('alpha'); await f.initialize(['alpha']); const plan = await f.call('previewLinks', { workspace: f.workspace });
  await fs.mkdir(path.dirname(plan.entries[0].destination), { recursive: true }); await fs.mkdir(plan.entries[0].destination); await assert.rejects(f.call('applyLinks', { id: plan.id, taskId: 'stale' }), /重新预览/);
  const alias = path.join(f.base, 'alias'); await fs.symlink(f.center, alias); const s = await f.call('snapshot', { workspace: f.workspace });
  await assert.rejects(f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'target', id: 'custom', path: alias } }), /重叠/);
  await assert.rejects(f.call('prepareImport', { id: '../escape', sourceType: 'local', source: f.workspace }), /标识/);
});
test('native target picker returns a relative path without switching workspace or writing config', async t => {
  let selected: string | null = null, options: unknown;
  const f = await fixture(t, { selectDirectory: async value => { options = value; return selected; } }); await f.initialize(); const target = path.join(f.workspace, '.agents/skills'); await fs.mkdir(target, { recursive: true });
  const before = await f.call('snapshot', { workspace: f.workspace }); assert.equal(await f.call('selectDirectory', { purpose: 'target', workspace: f.workspace }), null);
  selected = target; assert.deepEqual(await f.call('selectDirectory', { purpose: 'target', workspace: f.workspace, current: '.missing/skills' }), { path: target, configPath: '.agents/skills' }); assert.equal((options as any).showHidden, true);
  const after = await f.call('snapshot', { workspace: f.workspace }); assert.equal(after.workspace?.hash, before.workspace?.hash); assert.equal(after.preferences.lastWorkspace, f.workspace);
});
test('local import is previewed, copied, and uses stable directory IDs', async t => {
  const f = await fixture(t); const source = path.join(f.base, 'source'); await fs.mkdir(source); await fs.writeFile(path.join(source, 'SKILL.md'), '---\nname: Display name\n---\n# content');
  const preview = await f.call('prepareImport', { id: 'local-copy', sourceType: 'local', source }); await assert.rejects(fs.stat(preview.destination)); await f.call('commitImport', { id: preview.id });
  await fs.writeFile(path.join(source, 'SKILL.md'), 'changed'); assert.match(await fs.readFile(path.join(preview.destination, 'SKILL.md'), 'utf8'), /Display name/);
  const s = await f.call('snapshot', {}); assert.equal(s.skills[0].id, 'local-copy'); assert.equal(s.skills[0].name, 'Display name'); await assert.rejects(f.call('prepareImport', { id: 'local-copy', sourceType: 'local', source }), /已存在/);
});
test('references gate central trash; failure never falls back to permanent deletion', async t => {
  const f = await fixture(t, { trash: async () => { throw new Error('trash unavailable'); } }); const source = await f.skill('alpha'); await f.initialize(['alpha']); const refs = await f.call('references', { id: 'alpha', workspace: f.workspace }); assert.equal(refs.projects.length, 1);
  await assert.rejects(f.call('trashSkill', { id: 'alpha', confirm: 'alpha', globalHash: refs.globalHash, force: false, workspace: f.workspace }), /引用/);
  await assert.rejects(f.call('trashSkill', { id: 'alpha', confirm: 'alpha', globalHash: refs.globalHash, force: true, workspace: f.workspace }), /trash unavailable/); assert.equal((await fs.stat(source)).isDirectory(), true);
});
test('groups remain snapshots and switching center leaves deployed links at their old source', async t => {
  const f = await fixture(t); await f.skill('alpha'); await f.skill('beta'); await f.initialize(['alpha']); const plan = await f.call('previewLinks', { workspace: f.workspace }); await f.call('applyLinks', { id: plan.id, taskId: 'apply' });
  let s = await f.call('snapshot', {}); const group = await f.call('previewGlobal', { hash: s.global.hash, change: { type: 'group', id: 'daily', skills: ['alpha', 'beta'] } }); await f.call('commit', { id: group.id });
  const next = path.join(f.base, 'new-center'); await fs.mkdir(next); await fs.cp(path.join(f.center, 'alpha'), path.join(next, 'alpha'), { recursive: true }); s = await f.call('snapshot', {}); const preview = await f.call('previewGlobal', { hash: s.global.hash, change: { type: 'center', path: next } }); await f.call('commit', { id: preview.id });
  const after = await f.call('snapshot', { workspace: f.workspace }); assert.deepEqual(after.workspace?.config?.skills, ['alpha']); assert.equal(after.workspace?.links[0].status, 'conflict'); assert.equal(await fs.readlink(plan.entries[0].destination), path.join(f.center, 'alpha'));
});
test('Git fetch and fast-forward use a real local remote; dirty worktree is protected', async t => {
  const f = await fixture(t); const source = path.join(f.base, 'git-source'), remote = path.join(f.base, 'remote.git'); await fs.mkdir(source); await git(source, ['init', '-b', 'main']); await git(source, ['config', 'user.name', 'Test']); await git(source, ['config', 'user.email', 'test@example.invalid']); await fs.writeFile(path.join(source, 'SKILL.md'), '# git skill'); await git(source, ['add', '.']); await git(source, ['commit', '-m', 'first']); await git(f.base, ['clone', '--bare', source, remote]);
  const checkout = path.join(f.center, 'git-skill'); await git(f.center, ['clone', remote, checkout]); await git(source, ['remote', 'add', 'origin', remote]); await fs.writeFile(path.join(source, 'value'), 'second'); await git(source, ['add', '.']); await git(source, ['commit', '-m', 'second']); await git(source, ['push', 'origin', 'main']);
  const status = await f.call('gitStatus', { id: 'git-skill', fetch: true }); assert.equal(status.behind, 1); assert.equal(status.checked, true);
  await fs.writeFile(path.join(checkout, 'dirty'), 'keep'); await assert.rejects(f.call('updateSkill', { id: 'git-skill', revision: status.revision, taskId: 'git' }), /未提交|未跟踪/); await fs.rm(path.join(checkout, 'dirty'));
  await f.call('updateSkill', { id: 'git-skill', revision: status.revision, taskId: 'git' }); assert.equal(await fs.readFile(path.join(checkout, 'value'), 'utf8'), 'second');
});
test('invalid YAML can be repaired using raw previews without silently losing the original', async t => {
  const f = await fixture(t); await f.initialize(); const file = path.join(f.workspace, '.skill-registry/config.yaml'); await fs.writeFile(file, 'skills: [broken\n');
  let s = await f.call('snapshot', { workspace: f.workspace }); assert.ok(s.workspace?.error);
  const project = await f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'raw', raw: 'skills: []\n' } }); await f.call('commit', { id: project.id }); assert.match(await fs.readFile(file + '.bak', 'utf8'), /broken/);
  const before = await fs.readFile(f.service.globalPath, 'utf8'); await fs.writeFile(f.service.globalPath, 'invalid: [yaml\n'); s = await f.call('snapshot', {}); assert.ok(s.global.error);
  const global = await f.call('previewGlobal', { hash: s.global.hash, change: { type: 'raw', raw: before } }); await f.call('commit', { id: global.id }); assert.ok((await f.call('snapshot', {})).global.config);
});
test('backup paths cannot follow an existing symlink and duplicate target directories are harmless', async t => {
  const f = await fixture(t); await f.skill('alpha'); await f.initialize(['alpha']); const file = path.join(f.workspace, '.skill-registry/config.yaml'), outside = path.join(f.base, 'keep'); await fs.writeFile(outside, 'unchanged'); await fs.rm(file + '.bak', { force: true }); await fs.symlink(outside, file + '.bak');
  const s = await f.call('snapshot', { workspace: f.workspace }), p = await f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'raw', raw: 'skills: [alpha]\ntargets:\n  one:\n    path: .custom/skills\n  two:\n    path: .custom/skills\n' } }); await f.call('commit', { id: p.id }); assert.equal(await fs.readFile(outside, 'utf8'), 'unchanged'); assert.equal((await fs.lstat(file + '.bak')).isSymbolicLink(), false);
  const plan = await f.call('previewLinks', { workspace: f.workspace }), result = await f.call('applyLinks', { id: plan.id, taskId: 'duplicates' }); assert.equal(result.created.length, 1); assert.equal(result.failed.length, 0); assert.equal(result.skipped.length, 1);
});
test('Git operations never fall through to an enclosing repository', async t => {
  const f = await fixture(t); await f.skill('local'); await git(f.base, ['init']); await assert.rejects(f.call('gitStatus', { id: 'local', fetch: true }), /独立 Git/);
});

test('YAML booleans are ordinary unknown fields and invalid commented paths cannot be enabled', async t => {
  const f = await fixture(t); await f.initialize(); const file = path.join(f.workspace, '.skill-registry/config.yaml');
  const raw = 'skills: []\ntargets:\n  codex:\n    enabled: false\n    enable: false\n    skills: []\n      # - missing-skill\n';
  await fs.writeFile(file, raw);
  let s = await f.call('snapshot', { workspace: f.workspace });
  assert.equal(s.workspace!.targets[0].enabled, true);
  const p = await f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'skills', add: [] } });
  assert.equal(parse(p.after).targets.codex.enabled, false);
  assert.equal(parse(p.after).targets.codex.enable, false);
  assert.doesNotMatch(p.after, /# codex:/);
  await f.call('commit', { id: p.id });
  await fs.writeFile(file, 'skills: []\ntargets: {}\n  # codex:\n  #   path: null\n');
  s = await f.call('snapshot', { workspace: f.workspace });
  assert.equal(s.workspace!.targets[0].enabled, false);
  await assert.rejects(f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'target-enabled', id: 'codex', enabled: true } }), /路径/);
  await fs.writeFile(file, 'skills: []\ntargets:\n  codex: {}\n  # codex: {}\n');
  s = await f.call('snapshot', { workspace: f.workspace });
  assert.equal(s.workspace!.config, undefined); assert.match(s.workspace!.error!, /Ambiguous/);
});


test('single-member writes preserve nested comment modes, disabled targets, unrelated fields and empty overrides', async t => {
  const f = await fixture(t); await f.skill('alpha'); await f.skill('beta'); await f.initialize();
  const file = path.join(f.workspace, '.skill-registry/config.yaml');
  await fs.writeFile(file, 'skills: [beta]\ntargets: {}\n  # codex:\n  #   custom_key: keep\n  #   # skills:\n  #   #   - alpha\n  #   #   # - beta\n');
  const toggle = async (skill: string, enabled: boolean) => {
    const s = await f.call('snapshot', { workspace: f.workspace });
    const p = await f.call('previewProject', { workspace: f.workspace, hash: s.workspace!.hash, change: { type: 'target-skill-enabled', id: 'codex', skill, enabled } });
    await f.call('commit', { id: p.id });
    return new ProjectDocument(await fs.readFile(file, 'utf8'));
  };
  let d = await toggle('alpha', false);
  assert.equal(d.states.codex.enabled, false); assert.equal(d.states.codex.custom, false);
  assert.deepEqual(d.states.codex.members.map(m => m.enabled), [false, false]);
  assert.equal(d.target('codex')!.custom_key, 'keep');
  d = await toggle('beta', true);
  assert.equal(d.states.codex.enabled, false); assert.equal(d.states.codex.custom, false);
  assert.deepEqual(d.states.codex.members.map(m => m.enabled), [false, true]);
  await fs.writeFile(file, 'skills: [beta]\ntargets:\n  codex:\n    skills: [alpha]\n');
  d = await toggle('alpha', false);
  assert.deepEqual(d.active().targets.codex.skills, []);
  assert.match(d.original, /skills: \[\]/);
});
