import React, { useEffect, useState } from 'react';
import { Folder, FolderOpen, Plus, Search } from 'lucide-react';
import type { ChangePreview, EffectiveTarget, GitStatus, ImportPreview, LinkPlan, Progress, ReferenceInfo, Scope, Skill, SkillMember, Snapshot, TaskResult, WorkspacePresets } from '../shared/types';
import { call } from './api';
import { Button, BusyLabel, DirectoryInput, Empty, ErrorText, Modal, Notice, Status, Success, Switch, useOperation } from './components';

export type Dialog =
  | { type: 'switch' }
  | { type: 'initialize-workspace' | 'initialize-global' }
  | { type: 'target'; target?: EffectiveTarget; id?: string; path?: string; hash?: string; custom?: boolean; members?: SkillMember[] }
  | { type: 'add-preset-targets'; catalog?: WorkspacePresets; ids?: string[] }
  | { type: 'preset'; originalId?: string; id?: string; path?: string; hash?: string }
  | { type: 'add'; group?: string; ids?: string[]; hash?: string }
  | { type: 'group'; originalId?: string; id?: string; description?: string; ids?: string[]; hash?: string }
  | { type: 'review'; preview: ChangePreview; previous?: Dialog; afterSave?: () => void }
  | { type: 'links'; plan: LinkPlan }
  | { type: 'import'; id?: string; source?: string; sourceType?: 'git' | 'local' }
  | { type: 'import-preview'; preview: ImportPreview; previous: Dialog }
  | { type: 'remove-skill'; skill: Skill }
  | { type: 'update'; skill: Skill }
  | { type: 'center'; path?: string; hash?: string }
  | { type: 'raw-global'; raw?: string; hash?: string }
  | { type: 'maintenance'; action: 'forget' | 'trash' }
  | { type: 'merge'; scope: Scope; base: string; local: string; disk: string; hash: string }
  | { type: 'unsaved'; proceed: () => void };

export interface DialogContext {
  data: Snapshot;
  dialog: Dialog;
  setDialog(dialog: Dialog | null): void;
  refresh(): Promise<void>;
  switchWorkspace(path: string): Promise<void>;
  notify(text: string): void;
  committed(preview: ChangePreview): Promise<void>;
  previewYaml(afterSave?: () => void): Promise<void>;
  discardDraft(): void;
  merge(scope: Scope, local?: string, base?: string): Promise<void>;
  progress?: Progress;
}
const workspaceName = (ctx: DialogContext) => ctx.data.workspace?.name;
const root = (ctx: DialogContext) => { if (!ctx.data.workspace) throw new Error('请先选择工作区。'); return ctx.data.workspace.root; };
function ProjectModal(props: Omit<React.ComponentProps<typeof Modal>, 'scope' | 'workspace'> & { ctx: DialogContext }) { const { ctx, ...rest } = props; return <Modal {...rest} scope="workspace" workspace={workspaceName(ctx)} />; }

export function DialogHost({ ctx }: { ctx: DialogContext }) {
  const d = ctx.dialog;
  switch (d.type) {
    case 'switch': return <SwitchDialog ctx={ctx} />;
    case 'initialize-global': case 'initialize-workspace': return <InitializeDialog ctx={ctx} global={d.type === 'initialize-global'} />;
    case 'target': return <WorkspaceTargetDialog ctx={ctx} d={d} />;
    case 'preset': return <TargetDialog ctx={ctx} d={d} />;
    case 'add-preset-targets': return <PresetTargetsDialog ctx={ctx} d={d} />;
    case 'add': return <AddDialog ctx={ctx} d={d} />;
    case 'group': return <GroupDialog ctx={ctx} d={d} />;
    case 'review': return <ReviewDialog ctx={ctx} d={d} />;
    case 'links': return <LinksDialog ctx={ctx} initial={d.plan} />;
    case 'import': return <ImportDialog ctx={ctx} d={d} />;
    case 'import-preview': return <ImportReview ctx={ctx} d={d} />;
    case 'remove-skill': return <RemoveDialog ctx={ctx} skill={d.skill} />;
    case 'update': return <UpdateDialog ctx={ctx} skill={d.skill} />;
    case 'center': return <CenterDialog ctx={ctx} initial={d.path} initialHash={d.hash} />;
    case 'raw-global': return <RawDialog ctx={ctx} d={d} />;
    case 'maintenance': return <MaintenanceDialog ctx={ctx} action={d.action} />;
    case 'merge': return <MergeDialog ctx={ctx} d={d} />;
    case 'unsaved': return <UnsavedDialog ctx={ctx} proceed={d.proceed} />;
  }
}
function SwitchDialog({ ctx }: { ctx: DialogContext }) {
  const [manual, setManual] = useState(false), [value, setValue] = useState(''), op = useOperation();
  const choose = (path: string) => op.run(() => ctx.switchWorkspace(path));
  return <ProjectModal ctx={ctx} title="切换工作区" subtitle="选择最近工作区，或接入其他文件夹。" busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<><Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>取消</Button>{manual && <Button variant="primary" disabled={op.busy || !value.trim()} onClick={() => choose(value.trim())}>切换到此路径</Button>}</>}>
    <h3>最近工作区</h3>{ctx.data.preferences.recent.map(w => <button className="workspace-option" key={w.path} disabled={op.busy} onClick={() => choose(w.path)}><Folder size={18} /><span className="grow"><strong>{w.name}</strong><span className="path">{w.path}</span>{w.error && <span className="field-error">{w.error}</span>}</span><span className="badge">{ctx.data.workspace?.root === w.path ? '当前 · ' : ''}{w.initialized ? '已初始化' : '未初始化'}</span></button>)}
    {!ctx.data.preferences.recent.length && <p className="muted">暂无最近工作区</p>}
    <div className="actions spaced"><Button variant="primary" disabled={op.busy} onClick={() => op.run(async () => { const selected = await call('selectDirectory', { purpose: 'workspace', current: ctx.data.workspace?.root }); if (selected) await ctx.switchWorkspace(selected.path); })}><FolderOpen size={15} />选择文件夹…</Button><Button variant="quiet" onClick={() => setManual(!manual)} aria-expanded={manual}>{manual ? '收起路径输入' : '手动输入路径'}</Button></div>
    {manual && <label className="field">工作区文件夹路径<input value={value} onChange={e => setValue(e.target.value)} placeholder="~/Projects/my-project" spellCheck={false} /></label>}<ErrorText>{op.error}</ErrorText>
  </ProjectModal>;
}
function InitializeDialog({ ctx, global }: { ctx: DialogContext; global: boolean }) {
  const [center, setCenter] = useState(ctx.data.global.center), op = useOperation();
  const submit = () => op.run(async () => { if (global) await call('initializeGlobal', { center }); else await call('initializeWorkspace', { workspace: root(ctx) }); await ctx.refresh(); ctx.setDialog(null); ctx.notify(global ? '全局中心已初始化' : '工作区初始化完成'); });
  return <Modal scope={global ? 'global' : 'workspace'} workspace={workspaceName(ctx)} title={global ? '初始化全局中心' : '初始化 SkillRegistory'} subtitle={global ? '创建全局配置与中心目录。' : '创建一个空清单，随后再选择 Skills。'} busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<><Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>取消</Button><Button variant="primary" disabled={op.busy} onClick={submit}><BusyLabel busy={op.busy}>创建配置</BusyLabel></Button></>}>
    {global && <DirectoryInput value={center} onChange={setCenter} purpose="center" label="中心目录" />}
    <h3>将创建配置文件</h3><p className="path">{global ? ctx.data.global.path : ctx.data.workspace?.path}</p>
    {!global && <><h3 className="spaced">初始内容</h3><pre className="code small">skills: []</pre><p className="note">初始化只创建配置，不创建部署链接。</p></>}
    {global && <p className="note">使用与 CLI 相同的文件格式。已有配置不会被覆盖。</p>}<ErrorText>{op.error}</ErrorText>
  </Modal>;
}
function WorkspaceTargetDialog({ ctx, d }: { ctx: DialogContext; d: Extract<Dialog, { type: 'target' }> }) {
  const target = d.target, originalId = target?.id;
  const [hash, setHash] = useState(d.hash ?? ctx.data.workspace!.hash);
  const [id, setId] = useState(d.id ?? originalId ?? ''), [value, setValue] = useState(d.path ?? target?.path ?? '');
  const [custom, setCustom] = useState(d.custom ?? target?.custom ?? false), [members, setMembers] = useState<SkillMember[]>(d.members ?? target?.members ?? []);
  const [saved, setSaved] = useState(d.members !== undefined || target?.savedCustom || !!d.custom), [picking, setPicking] = useState(false), [picked, setPicked] = useState<string[]>([]), [query, setQuery] = useState('');
  const op = useOperation();
  const toggleMember = (skill: string, enabled: boolean) => {
    if (op.busy || !originalId) return;
    const before = members.find(member => member.id === skill)?.enabled;
    void op.run(async () => {
      let preview: ChangePreview | undefined, committed = false;
      setMembers(previous => previous.map(member => member.id === skill ? { ...member, enabled } : member));
      try {
        preview = await call('previewProject', { workspace: root(ctx), hash, change: { type: 'target-skill-enabled', id: originalId, skill, enabled } });
        await call('commit', { id: preview.id });
        committed = true;
        setHash(preview.afterHash);
        setSaved(true);
        await ctx.refresh();
        ctx.notify(`${skill} 已${enabled ? '启用' : '禁用'}`);
      } catch (error) {
        if (!committed) setMembers(previous => previous.map(member => member.id === skill ? { ...member, enabled: before ?? !enabled } : member));
        throw error;
      } finally {
        if (preview) await call('discardPreview', { id: preview.id }).catch(() => {});
      }
    });
  };
  const draft = (): Dialog => ({ type: 'target', target, id, path: value, hash, custom, ...(saved || custom ? { members } : {}) });
  const submit = (remove = false) => op.run(async () => {
    const preview = await call('previewProject', { workspace: root(ctx), hash, change: { type: 'target', id: id.trim(), path: value.trim(), remove, custom, ...(saved || custom ? { members } : {}) } });
    ctx.setDialog({ type: 'review', preview, previous: draft() });
  });
  if (picking) return <ProjectModal ctx={ctx} title="添加自定义技能" subtitle={`加入 ${target?.name || id || '当前目标'} 的独立清单。`} busy={op.busy} onClose={() => setPicking(false)} footer={<><Button onClick={() => setPicking(false)}>返回配置</Button><Button variant="primary" disabled={!picked.length} onClick={() => { setMembers([...members, ...picked.map(id => ({ id, enabled: true }))]); setSaved(true); setPicked([]); setPicking(false); }}>加入 {picked.length} 个技能</Button></>}>
    <label className="search"><Search size={16} /><input aria-label="搜索中心技能" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索中心仓库…" /></label>
    {ctx.data.skills.filter(s => `${s.id} ${s.description}`.toLowerCase().includes(query.toLowerCase())).map(skill => { const member = members.find(m => m.id === skill.id); return <label className="choice" key={skill.id}><input type="checkbox" checked={!!member || picked.includes(skill.id)} disabled={!!member || !!skill.error} onChange={e => setPicked(e.target.checked ? [...picked, skill.id] : picked.filter(id => id !== skill.id))} /><span>{skill.id}<small>{member ? `已在自定义清单中${member.enabled ? '' : ' · 已禁用，请回列表开启'}` : skill.error || skill.description}</small></span></label>; })}
    {!ctx.data.skills.length && <Empty title="中心仓库还没有 Skill" />}
  </ProjectModal>;
  return <ProjectModal ctx={ctx} title={target ? `配置目标 · ${target.name}` : '添加 Agent 目标'} subtitle="仅修改当前工作区的此目标。" busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<>{originalId && target?.source === 'explicit' && <Button variant="danger push-left" disabled={op.busy} onClick={() => submit(true)}>移除显式配置</Button>}<Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>取消</Button><Button variant="primary" disabled={op.busy || !id.trim()} onClick={() => submit()}><BusyLabel busy={op.busy}>预览保存</BusyLabel></Button></>}>
    {!originalId && <label className="field">Agent 标识<input data-autofocus value={id} onChange={e => setId(e.target.value)} placeholder="例如 agent-generic" /></label>}
    <DirectoryInput value={value} onChange={setValue} purpose="target" workspace={root(ctx)} label="部署路径" />
    <p className="note">工作区内保存相对路径，外部目录保存绝对路径。路径未改变时继续沿用原有继承关系。</p>
    <h3 className="spaced">Skills 清单</h3>
    <label className="choice"><input type="radio" name="skills-mode" disabled={op.busy} checked={!custom} onChange={() => setCustom(false)} /><span>继承工作区默认清单<small>当前 {ctx.data.workspace?.config?.skills.length || 0} 个 Skill；自定义清单以注释保留。</small></span></label>
    <label className="choice"><input type="radio" name="skills-mode" disabled={op.busy} checked={custom} onChange={() => { setCustom(true); setSaved(true); }} /><span>使用独立清单<small>完整替换默认清单，只选此目标需要的 Skill。</small></span></label>
    <section className="target-members" aria-label="自定义技能管理"><div className="page-heading"><h3>自定义技能 {members.length} 个 · {members.filter(m => m.enabled).length} 个启用</h3><Button disabled={op.busy} onClick={() => { setPicking(true); setPicked([]); setQuery(''); }}><Plus size={14} />添加技能</Button></div>
    {!custom && <p className="note">当前继承默认清单。下方成员及启停状态以注释保留，恢复独立清单后生效。</p>}
    {members.map(member => <div className={`member-row ${member.enabled ? '' : 'disabled'}`} key={member.id}><div className="grow"><strong>{member.id}</strong><p className="note">{ctx.data.skills.find(s => s.id === member.id)?.description || '中心源缺失'}{!member.enabled ? ' · 注释保留' : ''}</p></div><div className="member-actions"><Switch label={`启用 ${target?.name || id} 的 ${member.id}`} checked={member.enabled} disabled={op.busy || !originalId} onChange={enabled => toggleMember(member.id, enabled)} /><Button variant="quiet danger" aria-label={`从 ${target?.name || id} 移除 ${member.id}`} disabled={op.busy} onClick={() => { setMembers(members.filter(m => m.id !== member.id)); setSaved(true); }}>移除</Button></div></div>)}
    {!members.length && <p className="note">自定义清单为空。使用独立清单时，不创建新链接。</p>}
    <div className="actions spaced"><Button variant="quiet" disabled={op.busy} onClick={() => { setMembers((ctx.data.workspace?.config?.skills || []).map(id => ({ id, enabled: true }))); setSaved(true); }}>复制默认清单</Button><Button variant="quiet danger" disabled={op.busy || !members.length} onClick={() => { setMembers([]); setSaved(true); }}>清空清单</Button></div>
    <p className="note">{originalId ? '技能开关切换后直接保存；取消编辑不会撤销已保存的开关。其他草稿仍需预览保存。' : '请先保存新目标，再使用技能的即时开关。'}禁用以注释保留条目；中心内容与已有链接保留。</p></section>
    {target?.enabled === false && <Notice>此目标已停用。编辑配置不会重新启用它；已有链接保留。</Notice>}<p className="path spaced">{ctx.data.workspace?.path}</p><ErrorText>{op.error}</ErrorText>
  </ProjectModal>;
}
function TargetDialog({ ctx, d }: { ctx: DialogContext; d: Extract<Dialog, { type: 'target' | 'preset' }> }) {
  const preset = d.type === 'preset', item = preset ? ctx.data.global.config?.defaults.targets[d.originalId || ''] : d.target;
  const originalId = preset ? d.originalId : d.target?.id;
  const [hash] = useState(d.hash ?? (preset ? ctx.data.global.hash : ctx.data.workspace!.hash));
  const [id, setId] = useState(d.id ?? originalId ?? ''), [value, setValue] = useState(d.path ?? item?.path ?? ''), op = useOperation();
  const previous = (): Dialog => preset ? { type: 'preset', originalId, id, path: value, hash } : { type: 'target', target: d.target, id, path: value, hash };
  const submit = (remove = false) => op.run(async () => {
    const preview = preset ? await call('previewGlobal', { hash, change: { type: 'preset', id: id.trim(), path: value.trim(), remove } }) : await call('previewProject', { workspace: root(ctx), hash, change: { type: 'target', id: id.trim(), path: value.trim(), remove } });
    ctx.setDialog({ type: 'review', preview, previous: previous() });
  });
  return <Modal scope={preset ? 'global' : 'workspace'} workspace={workspaceName(ctx)} title={`${originalId ? '编辑' : '添加'}${preset ? '目标预设' : ' Agent 目标'}`} subtitle={preset ? '维护本机共享路径模板。' : '仅保存当前工作区的显式配置。'} busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<>{originalId && (preset || (!preset && d.target?.source === 'explicit')) && <Button variant="danger push-left" disabled={op.busy} onClick={() => submit(true)}>移除{preset ? '预设' : '显式配置'}</Button>}<Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>取消</Button><Button variant="primary" disabled={op.busy} onClick={() => submit()}><BusyLabel busy={op.busy}>预览保存</BusyLabel></Button></>}>
    <label className="field">Agent 标识<input data-autofocus readOnly={!!originalId} value={id} onChange={e => setId(e.target.value)} placeholder="例如 agent-generic" /></label>
    {preset ? <label className="field">部署路径<input value={value} onChange={e => setValue(e.target.value)} placeholder="例如 .agents/skills" spellCheck={false} /></label> : <DirectoryInput value={value} onChange={setValue} purpose="target" workspace={root(ctx)} label="部署路径" />}
    <p className="note">{preset ? '相对路径基于使用它的工作区解析。已有显式路径保持原状。' : '选择 Agent 存放 Skills 的目录。工作区内保存相对路径，外部目录保存绝对路径。保存后需单独应用链接。'}</p>
    {!preset && d.target?.source !== 'explicit' && originalId && <Notice>保存后生成当前工作区的覆盖配置，全局预设保持原状。</Notice>}
    <p className="path spaced">{preset ? ctx.data.global.path : ctx.data.workspace?.path}</p><ErrorText>{op.error}</ErrorText>
  </Modal>;
}
function PresetTargetsDialog({ ctx, d }: { ctx: DialogContext; d: Extract<Dialog, { type: 'add-preset-targets' }> }) {
  const [catalog, setCatalog] = useState(d.catalog), [ids, setIds] = useState(d.ids || []), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0), op = useOperation();
  const workspace = root(ctx);
  useEffect(() => {
    if (d.catalog && !reload) return;
    let active = true;
    setCatalog(undefined); setLoadError('');
    void call('workspacePresets', { workspace }).then(value => { if (active) { setCatalog(value); setIds(previous => previous.filter(id => value.targets.some(t => t.id === id && t.selectable))); } }, error => { if (active) setLoadError((error as Error).message); });
    return () => { active = false; };
  }, [workspace, d.catalog, reload]);
  const selected = catalog?.targets.filter(t => ids.includes(t.id) && t.selectable) || [];
  const submit = () => op.run(async () => {
    if (!catalog) return;
    const preview = await call('previewProject', { workspace, hash: catalog.workspaceHash, change: { type: 'preset-targets', ids: selected.map(t => t.id), globalHash: catalog.globalHash } });
    ctx.setDialog({ type: 'review', preview, previous: { type: 'add-preset-targets', catalog, ids } });
  });
  return <ProjectModal ctx={ctx} title="从预设添加目标" subtitle="选择需要的 Agent；确认后创建缺失目录并添加到此工作区。" busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<><span className="muted push-left">已选 {selected.length} 个 · 待创建 {selected.filter(t => !t.existed).length} 个目录</span><Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>取消</Button><Button variant="primary" disabled={op.busy || !selected.length} onClick={submit}><BusyLabel busy={op.busy}>预览添加</BusyLabel></Button></>}>
    {!catalog && !loadError && <p className="muted" role="status">正在检查预设目录…</p>}
    {catalog?.targets.map(target => <label className={`choice preset-choice ${target.selectable ? '' : 'unavailable'}`} key={target.id}>
      <input type="checkbox" aria-label={`${target.name}（${target.id}）`} disabled={op.busy || !target.selectable} checked={ids.includes(target.id) && target.selectable} onChange={e => setIds(e.target.checked ? [...ids, target.id] : ids.filter(id => id !== target.id))} />
      <span className="grow"><strong>{target.name}</strong> <span className="muted small">{target.id}</span>{target.isDefault && <span className="badge">默认</span>}{target.outside && <span className="badge accent">工作区外</span>}
        <small className="path">{target.path}</small><small className="path">{target.directory}</small><small className={target.state === 'blocked' ? 'field-error' : undefined}>{target.reason}</small>
      </span>
    </label>)}
    {catalog && !catalog.targets.length && <Empty title="没有可用的目标预设">先在全局管理的“目标预设”中添加。</Empty>}
    <p className="note">只处理勾选的目录，已有内容保留。添加后可单独预览并应用 Skill 链接。</p><ErrorText>{loadError || op.error}</ErrorText>
    {(loadError || op.error) && <Button variant="quiet" disabled={op.busy} onClick={() => { op.setError(''); setReload(value => value + 1); }}>重新载入预设</Button>}
  </ProjectModal>;
}
function AddDialog({ ctx, d }: { ctx: DialogContext; d: Extract<Dialog, { type: 'add' }> }) {
  const existing = ctx.data.workspace?.config?.skills || [], [ids, setIds] = useState(d.ids || ctx.data.global.config?.groups[d.group || '']?.skills.filter(id => !existing.includes(id)) || []), [query, setQuery] = useState(''), op = useOperation();
  const [hash] = useState(d.hash ?? ctx.data.workspace!.hash);
  const chooseGroup = (name: string) => setIds(ctx.data.global.config?.groups[name]?.skills.filter(id => !existing.includes(id)) || []);
  return <ProjectModal ctx={ctx} title="引用全局中心的 Skill" subtitle={`只写入 ${workspaceName(ctx)} 的配置，全局内容保持原状。`} busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<><span className="muted push-left">新增 {ids.length} 个引用</span><Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>取消</Button><Button variant="primary" disabled={op.busy || !ids.length} onClick={() => op.run(async () => { const preview = await call('previewProject', { workspace: root(ctx), hash, change: { type: 'skills', add: ids } }); ctx.setDialog({ type: 'review', preview, previous: { ...d, ids, hash } }); })}>预览添加</Button></>}>
    <div className="toolbar"><label className="search"><Search size={15} /><input aria-label="搜索中心 Skill" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索 Skill…" /></label><select aria-label="从共享分组选择" defaultValue={d.group || ''} onChange={e => chooseGroup(e.target.value)}><option value="">从共享分组选择</option>{Object.keys(ctx.data.global.config?.groups || {}).map(id => <option key={id}>{id}</option>)}</select></div>
    {ctx.data.skills.filter(s => `${s.id} ${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase())).map(s => <label className="choice" key={s.id}><input type="checkbox" disabled={existing.includes(s.id) || !!s.error} checked={existing.includes(s.id) || ids.includes(s.id)} onChange={e => setIds(e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} /><span><strong>{s.id}</strong><small>{existing.includes(s.id) ? '已在当前工作区' : s.error || s.description}</small></span></label>)}
    {!ctx.data.skills.length && <Empty title="中心仓库还没有 Skill">先在全局管理中注册 Skill。</Empty>}<p className="note">分组成员会展开为本次引用，之后修改分组不会自动改变工作区。</p><ErrorText>{op.error}</ErrorText>
  </ProjectModal>;
}
function GroupDialog({ ctx, d }: { ctx: DialogContext; d: Extract<Dialog, { type: 'group' }> }) {
  const original = ctx.data.global.config?.groups[d.originalId || ''];
  const [id, setId] = useState(d.id ?? d.originalId ?? ''), [description, setDescription] = useState(d.description ?? original?.description ?? ''), [ids, setIds] = useState(d.ids ?? original?.skills ?? []), op = useOperation();
  const [hash] = useState(d.hash ?? ctx.data.global.hash);
  const submit = (remove = false) => op.run(async () => { const preview = await call('previewGlobal', { hash, change: { type: 'group', id: id.trim(), skills: ids, description, remove } }); ctx.setDialog({ type: 'review', preview, previous: { ...d, id, description, ids, hash } }); });
  const all = [...new Set([...ctx.data.skills.map(s => s.id), ...ids])];
  return <Modal scope="global" title={d.originalId ? '编辑共享分组' : '新建共享分组'} subtitle="修改分组不会自动改写工作区清单。" busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<>{d.originalId && <Button variant="danger push-left" disabled={op.busy} onClick={() => submit(true)}>移除分组</Button>}<Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>取消</Button><Button variant="primary" disabled={op.busy} onClick={() => submit()}>预览保存</Button></>}>
    <label className="field">分组名称<input data-autofocus readOnly={!!d.originalId} value={id} onChange={e => setId(e.target.value)} placeholder="例如 daily" /></label><label className="field">描述<input value={description} onChange={e => setDescription(e.target.value)} /></label>
    {all.map(id => <label className="choice" key={id}><input type="checkbox" checked={ids.includes(id)} onChange={e => setIds(e.target.checked ? [...ids, id] : ids.filter(value => value !== id))} /><span>{id}{!ctx.data.skills.some(s => s.id === id) && <small>中心源缺失</small>}</span></label>)}<ErrorText>{op.error}</ErrorText>
  </Modal>;
}
function ReviewDialog({ ctx, d }: { ctx: DialogContext; d: Extract<Dialog, { type: 'review' }> }) {
  const op = useOperation();
  const back = () => op.run(async () => { await call('discardPreview', { id: d.preview.id }); ctx.setDialog(d.previous || null); });
  return <Modal scope={d.preview.scope} workspace={workspaceName(ctx)} title="预览变更" subtitle={d.preview.title} busy={op.busy} onClose={back} footer={<><Button disabled={op.busy} onClick={back}>返回编辑</Button><Button variant="primary" disabled={op.busy} onClick={() => op.run(async () => { await call('commit', { id: d.preview.id }); await ctx.committed(d.preview); d.afterSave?.(); })}><BusyLabel busy={op.busy}>{d.preview.confirmLabel || '确认保存'}</BusyLabel></Button></>}>
    {d.preview.directories && <section aria-label="目标目录变更"><h3>目标目录</h3>{d.preview.directories.map(target => <div className="plan-row" key={target.id}><div><strong>{target.id}</strong>{target.outside && <span className="badge accent">工作区外</span>}<p className="path">{target.directory}</p></div><span className="badge">{target.existed ? '已存在 · 保留内容' : '将创建'}</span></div>)}</section>}
    <p className="path spaced">{d.preview.file}</p>{d.preview.changes?.map((change, index) => <div className="change-row" key={index}><span>{change.label}</span><span>{change.value}</span></div>)}<div className="diff-grid"><section><h3>变更前</h3><pre className="code small">{d.preview.before}</pre></section><section><h3>变更后</h3><pre className="code small">{d.preview.after}</pre></section></div><Notice>{d.preview.impact}</Notice><ErrorText>{op.error}</ErrorText>
    {op.error && (d.preview.directories ? <Button variant="quiet" disabled={op.busy} onClick={() => op.run(async () => { await call('discardPreview', { id: d.preview.id }); ctx.setDialog({ type: 'add-preset-targets', ids: d.preview.directories!.map(t => t.id) }); })}>重新载入预设</Button> : <Button variant="quiet" disabled={op.busy} onClick={() => op.run(() => ctx.merge(d.preview.scope, d.preview.after, d.preview.before))}>比较外部版本</Button>)}
  </Modal>;
}
function LinksDialog({ ctx, initial }: { ctx: DialogContext; initial: LinkPlan }) {
  const [plan, setPlan] = useState(initial), [result, setResult] = useState<TaskResult>(), [taskId, setTaskId] = useState(''), op = useOperation();
  const count = plan.entries.filter(e => e.status === 'missing').length, issues = plan.entries.filter(e => !['missing', 'linked'].includes(e.status));
  const progress = ctx.progress?.taskId === taskId ? ctx.progress : undefined;
  const close = () => { if (!op.busy) { void call('discardPreview', { id: plan.id }); ctx.setDialog(null); } };
  return <ProjectModal ctx={ctx} title={`应用到 ${workspaceName(ctx)}`} subtitle="仅创建缺失链接，保留已有文件与其他链接。" busy={op.busy} onClose={close} footer={<>{op.busy ? <Button onClick={() => call('cancelTask', { taskId })}>停止后续条目</Button> : <Button onClick={close}>关闭</Button>}{result ? <Button disabled={op.busy} onClick={() => op.run(async () => { setPlan(await call('previewLinks', { workspace: root(ctx) })); setResult(undefined); })}>重新预览 / 重试</Button> : <Button variant="primary" disabled={op.busy || !count} onClick={() => op.run(async () => { const id = crypto.randomUUID(); setTaskId(id); const output = await call('applyLinks', { id: plan.id, taskId: id }); setResult(output); await ctx.refresh(); })}><BusyLabel busy={op.busy}>创建 {count} 条链接</BusyLabel></Button>}</>}>
    <div className="link-summary"><span>{count} 条待创建</span><span>{plan.entries.filter(e => e.status === 'linked').length} 条正常</span><span>{issues.length} 项保留 / 跳过</span></div>
    {op.busy && <p className="path" role="status">{progress ? `${progress.current}/${progress.total} · ${progress.message}` : '正在检查并创建链接…'}</p>}
    {result && <div aria-live="polite"><Success>创建 {result.created.length} 条，跳过 {result.skipped.length} 项，失败 {result.failed.length} 项{result.cancelled ? ' · 已停止后续条目' : ''}</Success>{result.failed.map(item => <Notice error key={item.path}><span className="path">{item.path}</span>{item.error}</Notice>)}</div>}
    {(plan.targets || []).map(target => <section key={target.id} className="plan-target"><h3>{target.name} · {target.enabled === false ? '已停用，跳过' : target.custom ? '独立清单' : '继承默认'}</h3>{target.enabled !== false && !target.skills?.length && <p className="note">有效清单为空，无需创建链接。</p>}{plan.entries.filter(e => e.target === target.id).map((e, i) => <div className="plan-row" key={i}><div><strong>{e.skill}</strong><p className="path">{e.destination}</p>{e.actual && <p className="path">当前指向：{e.actual}</p>}<p className="note">{e.reason}{e.outside ? ' · 工作区外路径' : ''}</p></div><Status status={result?.created.includes(e.destination) ? 'linked' : e.status} /></div>)}</section>)}
    {plan.targets?.length && plan.targets.every(t => t.enabled === false) ? <Notice>所有目标已停用，不会启用默认兜底目标。已有链接保留。</Notice> : null}
    {!plan.entries.length && <Empty title="没有待应用的 Skill" />}<ErrorText>{op.error}</ErrorText>
  </ProjectModal>;
}
function ImportDialog({ ctx, d }: { ctx: DialogContext; d: Extract<Dialog, { type: 'import' }> }) {
  const [sourceType, setType] = useState<'git' | 'local'>(d.sourceType || 'git'), [source, setSource] = useState(d.source || ''), [id, setId] = useState(d.id || ''), op = useOperation();
  return <Modal scope="global" title="注册到中心仓库" subtitle="预览来源和中心位置后再确认导入。" busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<><Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>取消</Button><Button variant="primary" disabled={op.busy || !id.trim() || !source.trim()} onClick={() => op.run(async () => { const preview = await call('prepareImport', { id: id.trim(), source: source.trim(), sourceType }); ctx.setDialog({ type: 'import-preview', preview, previous: { type: 'import', id, source, sourceType } }); })}><BusyLabel busy={op.busy}>{op.busy ? '正在准备…' : '预览注册'}</BusyLabel></Button></>}>
    <div className="segmented"><Button aria-pressed={sourceType === 'git'} disabled={op.busy} onClick={() => setType('git')}>Git 仓库</Button><Button aria-pressed={sourceType === 'local'} disabled={op.busy} onClick={() => setType('local')}>本地复制</Button></div>
    {sourceType === 'local' ? <DirectoryInput value={source} onChange={setSource} purpose="import" label="本地 Skill 目录" /> : <label className="field">Git 仓库 URL<input data-autofocus value={source} onChange={e => setSource(e.target.value)} placeholder="https://github.com/owner/my-skill.git" spellCheck={false} /></label>}
    <label className="field">注册名<input value={id} onChange={e => setId(e.target.value)} placeholder="例如 my-skill" /></label><p className="path">{ctx.data.global.center}/{id || '注册名'}</p><p className="note">{sourceType === 'local' ? '复制导入；原目录后续修改不会同步。复制时不保留 .git。' : '使用系统 Git 与已有凭据。首期仅支持根目录包含 SKILL.md 的完整仓库；准备预览时会克隆到临时目录。'}</p><ErrorText>{op.error}</ErrorText>
  </Modal>;
}
function ImportReview({ ctx, d }: { ctx: DialogContext; d: Extract<Dialog, { type: 'import-preview' }> }) {
  const op = useOperation(), cancel = () => op.run(async () => { await call('discardPreview', { id: d.preview.id }); ctx.setDialog(d.previous); });
  return <Modal scope="global" title="确认注册 Skill" subtitle={d.preview.skillId} busy={op.busy} onClose={cancel} footer={<><Button disabled={op.busy} onClick={cancel}>返回编辑</Button><Button variant="primary" disabled={op.busy} onClick={() => op.run(async () => { await call('commitImport', { id: d.preview.id }); await ctx.refresh(); ctx.setDialog(null); ctx.notify('Skill 已注册到中心仓库'); })}>确认导入</Button></>}>
    <h3>{d.preview.name}</h3><p className="muted">{d.preview.description}</p><div className="change-row"><span>来源</span><span className="path">{d.preview.source}</span></div><div className="change-row"><span>中心位置</span><span className="path">{d.preview.destination}</span></div><p className="note">{d.preview.sourceType === 'local' ? '导入本地副本，原目录的修改不会自动同步。' : '保留完整 Git 仓库，可在中心仓库检查与更新。'}</p><ErrorText>{op.error}</ErrorText>
  </Modal>;
}
function RemoveDialog({ ctx, skill }: { ctx: DialogContext; skill: Skill }) {
  const [refs, setRefs] = useState<ReferenceInfo>(), [confirm, setConfirm] = useState(''), [force, setForce] = useState(false), op = useOperation();
  useEffect(() => { void op.run(async () => setRefs(await call('references', { id: skill.id, workspace: ctx.data.workspace?.root }))); }, []);
  const referenced = !!(refs && (refs.projects.length || refs.groups.length || refs.unavailable.length));
  return <Modal scope="global" title="从中心仓库移除" subtitle={skill.id} busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<><Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>取消</Button><Button variant="danger" disabled={op.busy || !refs || confirm !== skill.id || (referenced && !force)} onClick={() => op.run(async () => { await call('trashSkill', { id: skill.id, confirm, force, globalHash: refs!.globalHash, workspace: ctx.data.workspace?.root }); await ctx.refresh(); ctx.setDialog(null); ctx.notify('中心内容已移入回收站'); })}>移入回收站</Button></>}>
    {refs ? <><Notice>{refs.projects.length} 个已接入工作区、{refs.groups.length} 个分组引用此 Skill。移除后相关链接可能断开。</Notice><p className="note">引用检查只覆盖已接入且可访问的工作区。</p>{refs.projects.map(w => <p className="path" key={w.path}>{w.name}{w.retained ? ' · 注释保留、未生效' : ''} · {w.path}</p>)}{refs.groups.length > 0 && <p className="note">分组：{refs.groups.join('、')}</p>}{refs.unavailable.length > 0 && <Notice error>有 {refs.unavailable.length} 个工作区无法检查，扫描不完整。{refs.unavailable.map(w => <p className="path" key={w.path}>{w.path}：{w.error}</p>)}</Notice>}<p className="path spaced">{refs.directory}</p>{referenced && <label className="choice"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} /><span>我了解引用会保留，并接受断链影响</span></label>}</> : <p className="muted">正在扫描已接入工作区…</p>}
    <label className="field">输入注册名 {skill.id} 确认<input value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off" /></label><ErrorText>{op.error}</ErrorText>
  </Modal>;
}
function UpdateDialog({ ctx, skill }: { ctx: DialogContext; skill: Skill }) {
  const [status, setStatus] = useState<GitStatus>(), [taskId] = useState(() => crypto.randomUUID()), op = useOperation();
  return <Modal scope="global" title="更新全局 Skill 内容" subtitle={skill.id} busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<><Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>关闭</Button><Button disabled={op.busy} onClick={() => op.run(async () => setStatus(await call('gitStatus', { id: skill.id, fetch: true })))}>检查远端</Button><Button variant="primary" disabled={op.busy || !status?.checked || status.dirty || !status.behind || !!status.error || !!(status.ahead && status.behind)} onClick={() => op.run(async () => { await call('updateSkill', { id: skill.id, revision: status!.revision, taskId }); await ctx.refresh(); ctx.setDialog(null); ctx.notify('中心内容已更新，有效软链直接读取新内容'); })}><BusyLabel busy={op.busy}>安全快进更新</BusyLabel></Button></>}>
    <Notice>{skill.references} 个已接入工作区引用此内容；更新中心后，相关有效软链会直接读取新版本。</Notice>
    {status ? <><div className="change-row"><span>当前版本</span><span className="path">{status.branch} · {status.revision.slice(0, 12)}</span></div><div className="change-row"><span>远端</span><span className="path">{status.remote || '未配置'}</span></div><p className="note">{status.checked ? `远端已检查：落后 ${status.behind} 个提交，本地领先 ${status.ahead} 个提交。` : '远端未成功检查。'}</p>{status.dirty && <Notice error>工作区有未提交或未跟踪文件，请先打开目录处理。</Notice>}{!!(status.ahead && status.behind) && <Notice error>本地与远端已分叉，请先在 Git 中处理。</Notice>}<ErrorText>{status.error}</ErrorText></> : <p className="note">尚未检查远端。检查后才能确认是否有更新。</p>}
    <Button variant="quiet" onClick={() => op.run(() => call('openLocation', { kind: 'skill', id: skill.id }))}><FolderOpen size={15} />打开目录</Button><ErrorText>{op.error}</ErrorText>
  </Modal>;
}
function CenterDialog({ ctx, initial, initialHash }: { ctx: DialogContext; initial?: string; initialHash?: string }) {
  const [hash] = useState(initialHash ?? ctx.data.global.hash);
  const [value, setValue] = useState(initial ?? ctx.data.global.center), op = useOperation();
  return <Modal scope="global" title="更改中心目录" subtitle="选择现有目录，预览后保存。" busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<><Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>取消</Button><Button variant="primary" disabled={op.busy} onClick={() => op.run(async () => { const preview = await call('previewGlobal', { hash, change: { type: 'center', path: value } }); ctx.setDialog({ type: 'review', preview, previous: { type: 'center', path: value, hash } }); })}>预览变更</Button></>}><DirectoryInput purpose="center" value={value} onChange={setValue} label="中心目录路径" /><p className="note">只更改共享中心路径。旧内容与已有链接保留，不自动迁移或重连。</p><ErrorText>{op.error}</ErrorText></Modal>;
}
function RawDialog({ ctx, d }: { ctx: DialogContext; d: Extract<Dialog, { type: 'raw-global' }> }) {
  const [raw, setRaw] = useState(d.raw ?? ctx.data.global.raw), [hash] = useState(d.hash ?? ctx.data.global.hash), op = useOperation();
  return <Modal scope="global" title="全局 YAML" subtitle={ctx.data.global.path} busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<><Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>取消</Button><Button variant="primary" disabled={op.busy} onClick={() => op.run(async () => { const preview = await call('previewGlobal', { hash, change: { type: 'raw', raw } }); ctx.setDialog({ type: 'review', preview, previous: { type: 'raw-global', raw, hash } }); })}>校验并预览</Button></>}><textarea className="code editor" aria-label="全局 YAML 配置" value={raw} onChange={e => setRaw(e.target.value)} spellCheck={false} /><ErrorText>{op.error}</ErrorText>{op.error && <Button variant="quiet" onClick={() => op.run(() => ctx.merge('global', raw, ctx.data.global.raw))}>比较外部版本</Button>}</Modal>;
}
function MaintenanceDialog({ ctx, action }: { ctx: DialogContext; action: 'forget' | 'trash' }) {
  const op = useOperation(), trash = action === 'trash';
  const [hash] = useState(ctx.data.workspace!.hash);
  return <ProjectModal ctx={ctx} title="预览变更" subtitle={trash ? '移除工作区配置' : '移出最近工作区列表'} busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<><Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>取消</Button><Button variant={trash ? 'danger' : 'primary'} disabled={op.busy} onClick={() => op.run(async () => { if (trash) await call('trashWorkspaceConfig', { workspace: root(ctx), hash }); else await call('forgetWorkspace', { path: root(ctx) }); await ctx.refresh(); ctx.setDialog(null); ctx.notify(trash ? '工作区配置已移入回收站，现有链接保留' : '已移出最近列表，当前工作区保持打开'); })}>{trash ? '移入回收站' : '确认移出'}</Button></>}><div className="change-row"><span>作用位置</span><span className="path">{trash ? ctx.data.workspace?.path : root(ctx)}</span></div><div className="change-row"><span>变更前</span><span>{trash ? '已初始化' : '已记录在最近列表'}</span></div><div className="change-row"><span>变更后</span><span>{trash ? '恢复为未初始化状态' : '移出快捷入口'}</span></div><Notice>{trash ? '只移除配置文件，工作区内容与已部署链接保持原状。' : '当前工作区继续使用，配置和所有文件保持原状；再次选择后可加入最近列表。'}</Notice><ErrorText>{op.error}</ErrorText></ProjectModal>;
}
function MergeDialog({ ctx, d }: { ctx: DialogContext; d: Extract<Dialog, { type: 'merge' }> }) {
  const [raw, setRaw] = useState(d.local), op = useOperation();
  return <Modal scope={d.scope} workspace={workspaceName(ctx)} title="比较外部配置变更" subtitle="保留本地草稿，对照磁盘版本编辑合并结果。" busy={op.busy} onClose={() => ctx.setDialog(null)} footer={<><Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>保留草稿并返回</Button><Button variant="primary" disabled={op.busy} onClick={() => op.run(async () => { const preview = d.scope === 'workspace' ? await call('previewProject', { workspace: root(ctx), hash: d.hash, change: { type: 'raw', raw } }) : await call('previewGlobal', { hash: d.hash, change: { type: 'raw', raw } }); ctx.setDialog({ type: 'review', preview, previous: { ...d, local: raw } }); })}>预览合并保存</Button></>}><div className="diff-grid"><section><h3>加载时内容</h3><pre className="code small">{d.base}</pre></section><section><h3>磁盘最新版本</h3><pre className="code small">{d.disk}</pre></section></div><label className="field">合并结果<textarea className="code editor" value={raw} onChange={e => setRaw(e.target.value)} spellCheck={false} /></label><ErrorText>{op.error}</ErrorText></Modal>;
}
function UnsavedDialog({ ctx, proceed }: { ctx: DialogContext; proceed: () => void }) {
  const op = useOperation();
  return <ProjectModal ctx={ctx} title="工作区配置尚未保存" onClose={() => ctx.setDialog(null)} busy={op.busy} footer={<><Button disabled={op.busy} onClick={() => ctx.setDialog(null)}>返回编辑</Button><Button disabled={op.busy} onClick={() => { ctx.discardDraft(); ctx.setDialog(null); proceed(); }}>放弃并继续</Button><Button variant="primary" disabled={op.busy} onClick={() => op.run(() => ctx.previewYaml(proceed))}>预览保存后继续</Button></>}><p className="muted">保存或放弃项目 YAML 草稿后，再切换工作区或页面。</p><ErrorText>{op.error}</ErrorText></ProjectModal>;
}
