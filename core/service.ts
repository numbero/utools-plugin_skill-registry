import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stringify } from 'yaml';
import type { ChangePreview, ConfigFile, EffectiveTarget, GlobalChange, GlobalConfig, ImportPreview, LinkPlan, Method, Preferences, PresetDirectory, Progress, ProjectConfig, ReferenceInfo, Requests, Snapshot, TaskResult, WorkspacePresets } from '../shared/types';
import { assertHash, atomicWrite, createConfig, defaults, fingerprint, formEditable, globalConfig, projectConfig, readConfig, setStringSequence, setValue, yamlDocument } from './config';
import { fail, message, RegistryError } from './errors';
import { canonical, directory, expand, inside, lstat, safeTarget, validId } from './paths';
import { inspectLink, inspectLinks, resolveTargets } from './links';
import { listRegistry, readSkill } from './registry';
import { cloneGit, gitStatus, updateGit } from './git';
import { presetTargets, withTargetDirectories } from './target-directories';
import { ProjectDocument } from './project-yaml';

export interface ServiceOptions {
  home: string;
  temp: string;
  loadPreferences(): Preferences;
  savePreferences(preferences: Preferences): void;
  trash(file: string): Promise<void>;
  open(file: string): Promise<void>;
  selectDirectory(options: { title: string; defaultPath: string; showHidden: boolean }): Promise<string | null>;
  progress?(progress: Progress): void;
}
interface PendingConfig { kind: 'config'; expires: number; preview: ChangePreview; hash: string; globalHash: string; workspace?: string }
interface PendingImport { kind: 'import'; expires: number; preview: ImportPreview; globalHash: string; stage: string }
interface PendingLinks { kind: 'links'; expires: number; plan: LinkPlan; signature: string }
type Pending = PendingConfig | PendingImport | PendingLinks;
export class RegistryService {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, Pending>();
  private cancelled = new Set<string>();
  private preferences: Preferences;
  readonly globalPath: string;
  constructor(private options: ServiceOptions) {
    this.globalPath = path.join(options.home, '.skill-registry/global.yaml');
    const stored = options.loadPreferences();
    this.preferences = { recent: Array.isArray(stored?.recent) ? stored.recent.filter(w => w && typeof w.path === 'string' && typeof w.name === 'string').slice(0, 40) : [] };
    if (typeof stored?.lastWorkspace === 'string') this.preferences.lastWorkspace = stored.lastWorkspace;
    if (['workspace', 'global'].includes(stored?.scope || '')) this.preferences.scope = stored.scope;
    if (['skills', 'targets', 'yaml', 'settings'].includes(stored?.workspacePage || '')) this.preferences.workspacePage = stored.workspacePage;
    if (['registry', 'groups', 'presets', 'settings'].includes(stored?.globalPage || '')) this.preferences.globalPage = stored.globalPage;
  }
  request<K extends Method>(method: K, input: Requests[K]['input']): Promise<Requests[K]['output']> {
    if (method === 'cancelTask') { this.cancelled.add((input as Requests['cancelTask']['input']).taskId); return Promise.resolve(undefined as Requests[K]['output']); }
    const operation = this.queue.then(() => this.dispatch(method, input));
    this.queue = operation.catch(() => {});
    return operation as Promise<Requests[K]['output']>;
  }
  private async workspace(value: string) {
    fail(typeof value === 'string' && (path.isAbsolute(value) || value.startsWith('~/') || value === '~'), '请选择或输入工作区的绝对目录路径。');
    return directory(expand(value, this.options.home, this.options.home));
  }
  private configPath(root: string) { return path.join(root, '.skill-registry/config.yaml'); }
  private async global() { return readConfig(this.globalPath, globalConfig); }
  private requireGlobal(file: ConfigFile<GlobalConfig>): GlobalConfig { fail(file.exists && file.config, file.error || '请先初始化全局中心。', 'GLOBAL_CONFIG'); return file.config; }
  private center(config?: GlobalConfig) { return expand(config?.registry?.path || 'skills', this.options.home, path.dirname(this.globalPath)); }
  private savePreferences() { this.options.savePreferences(structuredClone(this.preferences)); }
  private async project(root: string, global?: GlobalConfig) { return readConfig(this.configPath(root), doc => projectConfig(doc, global)); }
  private async cleanPending() {
    for (const [id, item] of this.pending) {
      if (item.expires < Date.now() || this.pending.size > 40) {
        if (item.kind === 'import') await fs.rm(path.dirname(item.stage), { recursive: true, force: true });
        this.pending.delete(id);
      }
    }
  }
  private async knownProjects(global?: GlobalConfig, current?: string) {
    const projects: { path: string; name: string; skills: string[]; active: string[] }[] = [], unavailable: { path: string; error: string }[] = [];
    const paths = [...new Set([...this.preferences.recent.map(w => w.path), ...(current ? [current] : [])])];
    const seen = new Set<string>();
    for (const entry of paths) {
      try {
        const root = await directory(entry); if (seen.has(root)) continue; seen.add(root);
        const file = await this.project(root, global);
        if (!file.exists) continue;
        fail(file.config, file.error || '配置不可读。');
        const states = new ProjectDocument(file.raw).states;
        const active = [...new Set([...file.config.skills, ...Object.values(states).filter(s => s.enabled && s.custom).flatMap(s => s.members.filter(m => m.enabled).map(m => m.id))])];
        projects.push({ path: root, name: path.basename(root), active, skills: [...new Set([...file.config.skills, ...Object.values(states).flatMap(s => s.members.map(m => m.id))])] });
      } catch (e) { unavailable.push({ path: entry, error: message(e) }); }
    }
    return { projects, unavailable };
  }
  private async snapshot(workspace?: string): Promise<Snapshot> {
    const global = await this.global(), center = this.center(global.config);
    let centerExists = false, centerError: string | undefined, skills: Snapshot['skills'] = [];
    if (global.config) {
      try { await directory(center); centerExists = true; skills = await listRegistry(center); } catch (e) { centerError = message(e); }
    }
    const known = await this.knownProjects(global.config, workspace);
    for (const skill of skills) {
      skill.references = known.projects.filter(p => p.skills.includes(skill.id)).length;
      skill.groupReferences = Object.values(global.config?.groups || {}).filter(g => g.skills.includes(skill.id)).length;
    }
    const preferences = structuredClone(this.preferences);
    for (const recent of preferences.recent) {
      try { await directory(recent.path); const file = await this.project(recent.path, global.config); recent.initialized = file.exists; recent.error = file.config ? undefined : file.error; }
      catch (e) { recent.error = message(e); }
    }
    let current: Snapshot['workspace'];
    if (workspace) {
      const root = await this.workspace(workspace), file = await this.project(root, global.config);
      const targets = file.config && global.config ? await resolveTargets(root, file.config, global.config, center, this.options.home, file.raw) : [];
      const diagnostics = file.config ? await inspectLinks(file.config.skills, targets, center) : { links: [], leftovers: [] };
      current = { ...file, root, name: path.basename(root) || root, targets, ...diagnostics };
    }
    return { global: { ...global, center, centerExists, centerError }, workspace: current, skills, preferences, unavailable: known.unavailable };
  }
  private async validateProject(raw: string, root: string, global: GlobalConfig) {
    const config = projectConfig(yamlDocument(raw), global);
    for (const target of Object.values(config.targets || {})) await safeTarget(target.path, root, this.center(global), this.options.home);
    return config;
  }
  private async previewProject(p: Requests['previewProject']['input']): Promise<ChangePreview> {
    const root = await this.workspace(p.workspace), global = await this.global(), config = this.requireGlobal(global);
    const raw = await assertHash(this.configPath(root), p.hash);
    let after: string, title = '保存工作区配置', directories: PresetDirectory[] | undefined;
    const changes: NonNullable<ChangePreview['changes']> = [];
    if (p.change.type === 'raw') after = p.change.raw;
    else {
      const editor = new ProjectDocument(raw), doc = editor.doc, original = projectConfig(yamlDocument(raw), config);
      fail(formEditable(doc), '此 YAML 包含锚点、别名或复杂键，请在项目 YAML 中编辑原文。');
      if (p.change.type === 'skills') {
        const catalog = await listRegistry(this.center(config));
        const add = p.change.add || [], remove = p.change.remove || []; add.forEach(validId); remove.forEach(validId);
        for (const id of add) fail(catalog.some(s => s.id === id && !s.error), `中心仓库中找不到可用的 ${id}。`);
        setStringSequence(doc, ['skills'], [...new Set([...original.skills, ...add])].filter(id => !remove.includes(id)));
        title = remove.length ? '移除工作区 Skill 引用' : '添加工作区 Skill';
      } else if (p.change.type === 'target-enabled') {
        const change = p.change; validId(change.id); fail(typeof change.enabled === 'boolean', '启停状态无效。');
        const existing = editor.target(change.id), preset = config.defaults.targets[change.id];
        fail(existing || preset, '目标已不存在，请刷新。');
        if (change.enabled) await safeTarget(existing && Object.hasOwn(existing, 'path') ? existing.path : preset?.path, root, this.center(config), this.options.home);
        editor.setTarget(change.id, existing || {}, { enabled: change.enabled });
        title = `${change.enabled ? '启用' : '停用'} Agent 目标（${change.enabled ? '取消注释' : '注释保留'}）`;
        changes.push({ label: '目标启停', value: `${change.id}：${change.enabled ? '移除目标块外层注释' : '整段注释保留'}；内部清单与已有链接保留。` });
      } else if (p.change.type === 'target-skill-enabled') {
        const change = p.change; validId(change.id); validId(change.skill);
        fail(typeof change.enabled === 'boolean', '技能启停状态无效。');
        const existing = editor.target(change.id), state = editor.states[change.id];
        fail(existing || config.defaults.targets[change.id], '目标已不存在，请重新打开配置。');
        const members = (state?.members || []).map(member => ({ ...member }));
        const member = members.find(member => member.id === change.skill);
        if (member) member.enabled = change.enabled;
        else {
          const catalog = await listRegistry(this.center(config));
          fail(catalog.some(skill => skill.id === change.skill && !skill.error), `中心仓库中找不到可用的 ${change.skill}。`);
          members.push({ id: change.skill, enabled: change.enabled });
        }
        editor.setTarget(change.id, { ...existing, skills: members.map(member => member.id) }, { members, custom: state?.custom ?? false });
        title = `${change.enabled ? '启用' : '禁用'}自定义技能 ${change.skill}`;
        changes.push({ label: '技能启停', value: `${change.id} / ${change.skill}：${change.enabled ? '取消成员注释' : '注释保留'}；目标状态与清单模式保持原状。` });
      } else if (p.change.type === 'target') {
        const change = p.change; validId(change.id);
        fail(change.custom === undefined || typeof change.custom === 'boolean', '清单使用模式无效。');
        if (change.remove) { editor.removeTarget(change.id); title = '移除工作区显式目标'; }
        else {
          const existing = editor.target(change.id) || {}, next = { ...existing };
          if (change.path !== undefined && !(change.path === '' && editor.states[change.id]?.enabled === false && existing.path === undefined) && change.path !== (existing.path ?? config.defaults.targets[change.id]?.path)) {
            await safeTarget(change.path, root, this.center(config), this.options.home); next.path = change.path;
          }
          if (!editor.target(change.id) && change.path !== undefined) next.path = change.path;
          const state = editor.states[change.id];
          let members = state?.members || [];
          if (change.members !== undefined) {
            fail(Array.isArray(change.members), '自定义技能必须是列表。');
            const catalog = await listRegistry(this.center(config));
            change.members.forEach(m => { validId(m.id); fail(typeof m.enabled === 'boolean', '技能启停状态无效。'); if (!members.some(old => old.id === m.id)) fail(catalog.some(s => s.id === m.id && !s.error), `中心仓库中找不到可用的 ${m.id}。`); });
            fail(new Set(change.members.map(m => m.id)).size === change.members.length, '自定义清单中有重复技能。');
            members = change.members;
          }
          if (change.members !== undefined || change.custom === true) next.skills = members.map(m => m.id);
          editor.setTarget(change.id, next, { ...(change.custom !== undefined ? { custom: change.custom } : {}), members });
          const before = state?.members || [];
          const groups = [
            ['新增技能', members.filter(m => !before.some(old => old.id === m.id))],
            ['移除技能', before.filter(m => !members.some(next => next.id === m.id))],
            ['启用技能', members.filter(m => m.enabled && before.some(old => old.id === m.id && !old.enabled))],
            ['禁用技能（注释保留）', members.filter(m => !m.enabled && before.some(old => old.id === m.id && old.enabled))]
          ] as const;
          for (const [label, items] of groups) if (items.length) changes.push({ label, value: items.map(m => m.id).join('、') });
          if (change.custom !== undefined) changes.push({ label: 'Skills 清单', value: change.custom ? `使用独立清单，${members.filter(m => m.enabled).length} 个启用；完整替换默认清单。` : '继承工作区默认清单；自定义成员及启停状态以注释保留。' });
          if (state?.enabled === false) changes.push({ label: '目标状态', value: '保持停用；编辑配置不会重新启用此目标。' });
          title = '保存 Agent 目标';
        }
      } else if (p.change.type === 'preset-targets') {
        fail(p.change.globalHash === global.hash, '目标预设已变化，请重新打开预设列表。', 'CONFLICT');
        fail(Array.isArray(p.change.ids) && p.change.ids.length > 0, '请至少选择一个目标预设。');
        const ids = [...new Set(p.change.ids)]; ids.forEach(validId);
        const catalog = await presetTargets(root, original, config, this.center(config), this.options.home, raw);
        directories = [];
        for (const id of ids) {
          const item = catalog.find(t => t.id === id);
          fail(item?.selectable, item?.reason || `目标预设不存在：${id}`);
          if (!editor.target(id)) editor.setTarget(id, config.defaults.targets[id]);
          const { path: targetPath, directory, existed, outside } = item;
          directories.push({ id, path: targetPath, directory, existed, outside });
        }
        title = '从预设添加 Agent 目标';
      } else throw new RegistryError('VALIDATION', '不支持的工作区操作。');
      after = editor.toString();
    }
    await this.validateProject(after, root, config);
    const preview: ChangePreview = { id: randomUUID(), scope: 'workspace', file: this.configPath(root), before: raw, after, afterHash: fingerprint(after), title, changes, impact: '只修改当前工作区的配置。已有软链保留；需要创建新链接时，请单独预览并应用。' };
    if (directories) {
      preview.directories = directories;
      preview.confirmLabel = directories.some(d => !d.existed) ? '创建目录并添加' : '添加到工作区';
      preview.impact = '创建所选的缺失目录，并将目标写入当前工作区配置。已有目录内容保留，全局预设保持原状；Skill 链接需单独预览并应用。';
    }
    this.pending.set(preview.id, { kind: 'config', expires: Date.now() + 600000, preview, hash: p.hash, globalHash: global.hash, workspace: root });
    return preview;
  }
  private async previewGlobal(p: Requests['previewGlobal']['input']): Promise<ChangePreview> {
    const file = await this.global(), raw = await assertHash(this.globalPath, p.hash), change: GlobalChange = p.change;
    let after: string, title = '保存全局配置', impact = '修改本机共享配置，可能影响引用该资源的工作区；已有显式目标路径保持原状。';
    if (change.type === 'raw') after = change.raw;
    else {
      const current = this.requireGlobal(file), doc = yamlDocument(raw);
      fail(formEditable(doc), '此全局 YAML 包含锚点、别名或复杂键，请通过原文编辑。');
      if (change.type === 'group') {
        validId(change.id);
        if (change.remove) doc.deleteIn(['groups', change.id]);
        else {
          fail(Array.isArray(change.skills), '请选择分组成员。'); change.skills.forEach(validId);
          setStringSequence(doc, ['groups', change.id, 'skills'], [...new Set(change.skills)]);
          setValue(doc, ['groups', change.id, 'description'], change.description || '');
        }
        title = change.remove ? '移除共享分组' : '保存共享分组'; impact = '只修改全局分组。已经展开到工作区的 Skill 清单保持原状。';
      } else if (change.type === 'preset') {
        validId(change.id);
        if (change.remove) { fail(current.settings.default_target !== change.id, '请先设置另一个默认目标，再移除此预设。'); doc.deleteIn(['defaults', 'targets', change.id]); }
        else { fail(typeof change.path === 'string' && !!change.path.trim(), '请填写预设路径。'); setValue(doc, ['defaults', 'targets', change.id, 'path'], change.path); }
        title = '保存目标预设';
      } else if (change.type === 'default') { validId(change.id); fail(current.defaults.targets[change.id], '预设不存在。'); setValue(doc, ['settings', 'default_target'], change.id); title = '设置默认目标'; }
      else if (change.type === 'restore') { for (const [id, target] of Object.entries(defaults().defaults.targets)) if (!doc.hasIn(['defaults', 'targets', id])) doc.setIn(['defaults', 'targets', id], target); title = '恢复缺失的目标预设'; }
      else if (change.type === 'center') { const center = await directory(expand(change.path, this.options.home, path.dirname(this.globalPath))); setValue(doc, ['registry', 'path'], center); title = '更改中心目录'; impact = `切换到 ${center}，发现 ${(await listRegistry(center)).length} 个 Skill。旧内容和现有软链保持原位置；本次不迁移或重连。`; }
      else throw new RegistryError('VALIDATION', '不支持的全局操作。');
      after = String(doc);
    }
    const normalized = globalConfig(yamlDocument(after));
    if (this.center(normalized) !== this.center(file.config)) await directory(this.center(normalized));
    for (const target of Object.values(normalized.defaults.targets)) await safeTarget(target.path, this.options.home, this.center(normalized), this.options.home);
    const preview: ChangePreview = { id: randomUUID(), scope: 'global', file: this.globalPath, before: raw, after, afterHash: fingerprint(after), title, impact };
    this.pending.set(preview.id, { kind: 'config', expires: Date.now() + 600000, preview, hash: p.hash, globalHash: p.hash }); return preview;
  }
  private async links(root: string) {
    const snapshot = await this.snapshot(root), workspace = snapshot.workspace;
    this.requireGlobal(snapshot.global); fail(workspace?.config, workspace?.error || '工作区尚未初始化。');
    fail(workspace.targets.length, '当前没有 Agent 目标。');
    const signature = fingerprint(JSON.stringify([snapshot.global.hash, workspace.hash, snapshot.global.center, workspace.targets, workspace.links, workspace.leftovers]));
    return { snapshot, workspace, signature };
  }
  private async applyLinks(p: Requests['applyLinks']['input']): Promise<TaskResult> {
    const item = this.pending.get(p.id); fail(item?.kind === 'links', '应用预览已过期，请重新生成。', 'STALE');
    const { workspace, snapshot, signature } = await this.links(item.plan.workspace);
    fail(signature === item.signature, '配置或路径状态已变化，请重新预览链接。', 'STALE');
    const result: TaskResult = { created: [], skipped: [], failed: [], cancelled: false }, entries = item.plan.entries;
    for (let index = 0; index < entries.length; index++) {
      if (this.cancelled.has(p.taskId)) { result.cancelled = true; break; }
      const entry = entries[index]; this.options.progress?.({ taskId: p.taskId, current: index, total: entries.length, message: entry.destination });
      if (entry.status !== 'missing') { result.skipped.push(entry.destination); continue; }
      try {
        await assertHash(this.globalPath, snapshot.global.hash); await assertHash(workspace.path, workspace.hash);
        const target = workspace.targets.find(t => t.id === entry.target)!;
        await safeTarget(target.path, workspace.root, snapshot.global.center, this.options.home);
        const fresh = await inspectLink(entry.skill, target, snapshot.global.center);
        if (fresh.status === 'linked') { result.skipped.push(entry.destination); continue; }
        fail(fresh.status === 'missing', `路径状态已变化：${fresh.reason}`, 'STALE');
        await fs.mkdir(target.directory, { recursive: true });
        await safeTarget(target.path, workspace.root, snapshot.global.center, this.options.home);
        // symlink is exclusive: a newly appeared file is never overwritten.
        await fs.symlink(entry.source, entry.destination, process.platform === 'win32' ? 'junction' : 'dir');
        result.created.push(entry.destination);
      } catch (e) { result.failed.push({ path: entry.destination, error: message(e) }); }
    }
    this.options.progress?.({ taskId: p.taskId, current: entries.length, total: entries.length, message: '执行结束' });
    this.cancelled.delete(p.taskId); this.pending.delete(p.id); return result;
  }
  private async references(id: string, workspace?: string): Promise<ReferenceInfo> {
    validId(id); const file = await this.global(), config = this.requireGlobal(file), known = await this.knownProjects(config, workspace);
    return { projects: known.projects.filter(p => p.skills.includes(id)).map(({ path, name, active }) => ({ path, name, retained: !active.includes(id) })), groups: Object.entries(config.groups).filter(([, group]) => group.skills.includes(id)).map(([name]) => name), unavailable: known.unavailable, globalHash: file.hash, directory: path.join(this.center(config), id) };
  }
  private async prepareImport(p: Requests['prepareImport']['input']): Promise<ImportPreview> {
    validId(p.id); const file = await this.global(), config = this.requireGlobal(file), center = await directory(this.center(config));
    fail(!(await lstat(path.join(center, p.id))), '此注册名已存在，请使用其他名称。');
    await fs.mkdir(this.options.temp, { recursive: true }); const container = await fs.mkdtemp(path.join(this.options.temp, 'import-')), stage = path.join(container, 'skill');
    try {
      if (p.sourceType === 'git') await cloneGit(p.source.replace(/^git\+/, ''), container, stage);
      else {
        fail(p.sourceType === 'local', '不支持的导入方式。');
        const source = await directory(expand(p.source, this.options.home, this.options.home));
        fail(!inside(source, await canonical(this.options.temp)), '来源目录不能包含插件临时目录。');
        await readSkill(source);
        await fs.cp(source, stage, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true, filter: sourcePath => path.basename(sourcePath) !== '.git' });
      }
      const skill = await readSkill(stage), preview: ImportPreview = { id: randomUUID(), skillId: p.id, name: skill.name, description: skill.description, source: p.source, destination: path.join(center, p.id), sourceType: p.sourceType };
      this.pending.set(preview.id, { kind: 'import', expires: Date.now() + 600000, preview, stage, globalHash: file.hash }); return preview;
    } catch (e) { await fs.rm(container, { recursive: true, force: true }); throw e; }
  }
  private async selectDirectory(p: Requests['selectDirectory']['input']) {
    fail(['workspace', 'target', 'center', 'import'].includes(p.purpose), '不支持的目录用途。');
    const root = p.workspace ? await this.workspace(p.workspace) : this.options.home;
    let starting = p.current ? expand(p.current, this.options.home, p.purpose === 'target' ? root : this.options.home) : root;
    while (true) { try { starting = await directory(starting); break; } catch { const parent = path.dirname(starting); if (parent === starting) { starting = root; break; } starting = parent; } }
    const titles = { workspace: '选择工作区文件夹', target: '选择 Agent 目标目录', center: '选择中心目录', import: '选择本地 Skill 目录' };
    const selected = await this.options.selectDirectory({ title: titles[p.purpose], defaultPath: starting, showHidden: p.purpose === 'target' });
    if (!selected) return null;
    const chosen = await directory(selected), configPath = p.purpose === 'target' && inside(root, chosen) ? path.relative(root, chosen) || '.' : chosen;
    return { path: chosen, configPath };
  }
  private async dispatch(method: Method, input: unknown): Promise<unknown> {
    fail(input && typeof input === 'object', '无效请求。');
    const p = input as any;
    await this.cleanPending();
    switch (method) {
      case 'snapshot': return this.snapshot(p.workspace);
      case 'selectWorkspace': {
        const root = await this.workspace(p.path), recent = { path: root, name: path.basename(root) || root };
        this.preferences.recent = [recent, ...this.preferences.recent.filter(w => w.path !== root)].slice(0, 40); this.preferences.lastWorkspace = root; this.savePreferences(); return this.snapshot(root);
      }
      case 'forgetWorkspace': this.preferences.recent = this.preferences.recent.filter(w => w.path !== p.path); if (this.preferences.lastWorkspace === p.path) delete this.preferences.lastWorkspace; this.savePreferences(); return;
      case 'preferences': {
        if (['workspace', 'global'].includes(p.scope)) this.preferences.scope = p.scope;
        if (['skills', 'targets', 'yaml', 'settings'].includes(p.workspacePage)) this.preferences.workspacePage = p.workspacePage;
        if (['registry', 'groups', 'presets', 'settings'].includes(p.globalPage)) this.preferences.globalPage = p.globalPage;
        this.savePreferences(); return;
      }
      case 'initializeGlobal': {
        const config = defaults(), center = p.center ? expand(p.center, this.options.home, this.options.home) : this.center();
        fail(center !== this.options.home && center !== path.parse(center).root, '请选择专用中心目录。');
        config.registry = { path: center }; fail(!(await lstat(this.globalPath)), '全局配置已存在，请重新载入。', 'CONFLICT');
        await fs.mkdir(center, { recursive: true }); await createConfig(this.globalPath, stringify(config)); return;
      }
      case 'initializeWorkspace': { const root = await this.workspace(p.workspace); this.requireGlobal(await this.global()); await createConfig(this.configPath(root), 'skills: []\n'); return; }
      case 'workspacePresets': {
        const root = await this.workspace(p.workspace), file = await this.global(), global = this.requireGlobal(file), project = await this.project(root, global);
        fail(project.config && project.formEditable, project.error || '请先初始化工作区；复杂 YAML 请使用原文编辑。');
        return { workspaceHash: project.hash, globalHash: file.hash, targets: await presetTargets(root, project.config, global, this.center(global), this.options.home, project.raw) } satisfies WorkspacePresets;
      }
      case 'previewProject': return this.previewProject(p);
      case 'previewGlobal': return this.previewGlobal(p);
      case 'commit': {
        const item = this.pending.get(p.id); fail(item?.kind === 'config', '变更预览已过期，请重新预览。', 'STALE');
        await assertHash(this.globalPath, item.globalHash);
        const current = await this.global();
        if (item.workspace) await this.validateProject(item.preview.after, item.workspace, this.requireGlobal(current));
        else { const next = globalConfig(yamlDocument(item.preview.after)); if (this.center(next) !== this.center(current.config)) await directory(this.center(next)); }
        const save = async () => { await assertHash(this.globalPath, item.globalHash); await atomicWrite(item.preview.file, item.preview.after, item.hash); };
        if (item.workspace && item.preview.directories) {
          await assertHash(item.preview.file, item.hash);
          await withTargetDirectories(item.preview.directories, item.workspace, this.center(this.requireGlobal(current)), this.options.home, save);
        } else await save();
        this.pending.delete(p.id); return;
      }
      case 'discardPreview': { const item = this.pending.get(p.id); if (item?.kind === 'import') await fs.rm(path.dirname(item.stage), { recursive: true, force: true }); this.pending.delete(p.id); return; }
      case 'previewLinks': { const root = await this.workspace(p.workspace), current = await this.links(root), plan: LinkPlan = { id: randomUUID(), workspace: root, entries: [...current.workspace.links, ...current.workspace.leftovers], createdAt: Date.now(), targets: current.workspace.targets }; this.pending.set(plan.id, { kind: 'links', expires: Date.now() + 600000, plan, signature: current.signature }); return plan; }
      case 'applyLinks': return this.applyLinks(p);
      case 'skillDetail': { validId(p.id); const config = this.requireGlobal(await this.global()), location = path.join(this.center(config), p.id), skill = await readSkill(location); return { markdown: skill.markdown, git: (await lstat(path.join(location, '.git'))) ? await gitStatus(location, p.id, false) : undefined }; }
      case 'prepareImport': return this.prepareImport(p);
      case 'commitImport': {
        const item = this.pending.get(p.id); fail(item?.kind === 'import', '导入预览已过期，请重新准备导入。', 'STALE'); await assertHash(this.globalPath, item.globalHash);
        const destination = item.preview.destination; await fs.mkdir(destination); // exclusive reservation; never overwrite an existing entry
        try { for (const entry of (await fs.readdir(item.stage)).sort((a, b) => Number(a === 'SKILL.md') - Number(b === 'SKILL.md'))) await fs.cp(path.join(item.stage, entry), path.join(destination, entry), { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true }); }
        catch (e) { await fs.rm(destination, { recursive: true, force: true }); throw e; }
        await fs.rm(path.dirname(item.stage), { recursive: true, force: true }); this.pending.delete(p.id); return;
      }
      case 'references': return this.references(p.id, p.workspace);
      case 'trashSkill': {
        validId(p.id); fail(p.confirm === p.id, '输入的注册名不匹配。'); const references = await this.references(p.id, p.workspace); await assertHash(this.globalPath, p.globalHash);
        fail(p.force === true || (!references.projects.length && !references.groups.length && !references.unavailable.length), '仍有已知引用或引用扫描不完整，请确认断链影响后再移除。');
        fail(await lstat(references.directory), '中心目录已不存在，请刷新。'); await this.options.trash(references.directory); return;
      }
      case 'trashWorkspaceConfig': { const root = await this.workspace(p.workspace), file = this.configPath(root); await assertHash(file, p.hash); await this.options.trash(file); return; }
      case 'gitStatus': { validId(p.id); const config = this.requireGlobal(await this.global()); return gitStatus(path.join(this.center(config), p.id), p.id, !!p.fetch); }
      case 'updateSkill': { validId(p.id); const config = this.requireGlobal(await this.global()); this.options.progress?.({ taskId: p.taskId, current: 0, total: 1, message: '正在检查远端并安全快进…' }); if (this.cancelled.delete(p.taskId)) throw new RegistryError('CANCELLED', '已取消。'); return updateGit(path.join(this.center(config), p.id), p.id, p.revision); }
      case 'selectDirectory': return this.selectDirectory(p);
      case 'openLocation': {
        let file: string;
        if (p.kind === 'workspace' || p.kind === 'workspace-config') { const root = await this.workspace(p.workspace); file = p.kind === 'workspace' ? root : this.configPath(root); }
        else if (p.kind === 'global-config') file = this.globalPath;
        else { const config = this.requireGlobal(await this.global()); file = this.center(config); if (p.kind === 'skill' || p.kind === 'skill-file') { validId(p.id); file = path.join(file, p.id, ...(p.kind === 'skill-file' ? ['SKILL.md'] : [])); } else fail(p.kind === 'center', '不支持的打开位置。'); }
        await this.options.open(file); return;
      }
      default: throw new RegistryError('METHOD', '不支持的操作。');
    }
  }
}
