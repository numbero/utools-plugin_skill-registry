import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Bot, Boxes, Check, ChevronsUpDown, FileCode2, FileText, Folder, FolderOpen, GitBranch, Globe, Layers, ListChecks, Loader2, Plus, RefreshCw, ScanLine, Search, Settings2, Trash2 } from 'lucide-react';
import pluginManifest from '../public/plugin.json';
import ReactMarkdown from 'react-markdown';
import type { ChangePreview, GlobalPage, LinkEntry, LinkStatus, Progress, Scope, Skill, SkillDetail, Snapshot, WorkspacePage } from '../shared/types';
import { call, errorMessage } from './api';
import { Button, Empty, Notice, Status, Switch } from './components';
import { DialogHost, type Dialog, type DialogContext } from './dialogs';

const localPages = [{ id: 'skills', label: 'Skills', icon: ListChecks }, { id: 'targets', label: 'Agent 目标', icon: Bot }, { id: 'yaml', label: '项目 YAML', icon: FileCode2 }, { id: 'settings', label: '设置', icon: Settings2 }] as const;
const globalPages = [{ id: 'registry', label: '中心仓库', icon: Boxes }, { id: 'groups', label: '共享分组', icon: Layers }, { id: 'presets', label: '目标预设', icon: ScanLine }, { id: 'settings', label: '设置', icon: Settings2 }] as const;
interface Draft { workspace: string; raw: string; base: string; hash: string }
export function App() {
  const [data, setData] = useState<Snapshot>(), [scope, setScope] = useState<Scope>('workspace'), [localPage, setLocalPage] = useState<WorkspacePage>('skills'), [globalPage, setGlobalPage] = useState<GlobalPage>('registry');
  const [targetToggle, setTargetToggle] = useState<{ workspace: string; id: string; enabled: boolean }>();
  const [skillView, setSkillView] = useState<'defaults' | 'overview'>('defaults');
  const [selectedId, setSelected] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [selectedIds, setSelectedIds] = useState<string[]>([]), [detailOnly, setDetailOnly] = useState(false), [detail, setDetail] = useState<SkillDetail>();
  const [dialog, setDialog] = useState<Dialog | null>(null), [error, setError] = useState(''), [toast, setToast] = useState(''), [busy, setBusy] = useState(false), [progress, setProgress] = useState<Progress>(), [draft, setDraft] = useState<Draft>();
  const [narrowDetail, setNarrowDetail] = useState(() => window.matchMedia?.('(max-width:930px)').matches || false);
  const workspaceRef = useRef<string>(), booted = useRef(false), requestSequence = useRef(0), searchRef = useRef<HTMLInputElement>(null), mounted = useRef(true);
  const current = data?.workspace, dirty = !!draft && draft.raw !== draft.base;
  const dirtyRef = useRef(dirty), dialogRef = useRef(dialog), detailKey = useRef(''); dirtyRef.current = dirty; dialogRef.current = dialog;
  const refresh = useCallback(async (initial = false) => {
    const sequence = ++requestSequence.current;
    let snapshot = await call('snapshot', { workspace: workspaceRef.current });
    if (initial && !booted.current) {
      booted.current = true;
      if (!workspaceRef.current && snapshot.preferences.lastWorkspace) {
        try { snapshot = await call('snapshot', { workspace: snapshot.preferences.lastWorkspace }); workspaceRef.current = snapshot.workspace?.root; } catch (e) { setError(errorMessage(e)); }
      }
      if (sequence === requestSequence.current) { setScope(snapshot.preferences.scope || 'workspace'); setLocalPage(snapshot.preferences.workspacePage || 'skills'); setGlobalPage(snapshot.preferences.globalPage || 'registry'); }
    }
    if (mounted.current && sequence === requestSequence.current) setData(snapshot);
    return snapshot;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh(true).catch(e => setError(errorMessage(e)));
    const enter = window.skillRegistry?.onEnter(path => {
      if (path && dialogRef.current) { setError('请先完成或关闭当前弹层，再通过工作区选择器切换文件夹。'); return; }
      if (path && dirtyRef.current) { setDialog({ type: 'unsaved', proceed: () => { void selectWorkspace(path).catch(e => setError(errorMessage(e))); } }); return; }
      if (path) void selectWorkspace(path).catch(e => setError(errorMessage(e))); else void refresh(true).catch(e => setError(errorMessage(e)));
    });
    const progress = window.skillRegistry?.onProgress(setProgress);
    const focus = () => { if (booted.current) void refresh().catch(e => setError(errorMessage(e))); };
    window.addEventListener('focus', focus);
    return () => { mounted.current = false; enter?.(); progress?.(); window.removeEventListener('focus', focus); };
  }, [refresh]);
  useEffect(() => { const media = window.matchMedia?.('(max-width:930px)'); if (!media) return; const change = () => setNarrowDetail(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => {
    if (!current) { setDraft(undefined); return; }
    setDraft(previous => previous?.workspace === current.root && previous.raw !== previous.base ? previous : { workspace: current.root, raw: current.raw, base: current.raw, hash: current.hash });
  }, [current?.root, current?.raw, current?.hash]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !dialog) { event.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [dialog]);
  const pageKey = [scope, scope === 'workspace' ? localPage : globalPage, scope === 'workspace' ? current?.root : '', detailOnly && narrowDetail ? 'detail' : 'list'].join('|');
  useEffect(() => { setQuery(''); setFilter('all'); setSelectedIds([]); }, [scope, localPage, globalPage, current?.root, skillView]);
  const effectiveIds = [...new Set((current?.targets || []).filter(t => t.enabled !== false).flatMap(t => t.skills ?? current?.config?.skills ?? []))];
  const projectSkills: Skill[] = (skillView === 'overview' ? effectiveIds : current?.config?.skills || []).map(id => data?.skills.find(s => s.id === id) || { id, name: id, directory: `${data?.global.center}/${id}`, description: '中心源缺失', isGit: false, references: 0, groupReferences: 0, error: '中心源缺失' });
  const list = scope === 'global' ? data?.skills || [] : projectSkills;
  const selected = list.find(s => s.id === selectedId) || list[0];
  useEffect(() => {
    if (!(scope === 'workspace' && localPage === 'skills') && !(scope === 'global' && globalPage === 'registry')) return;
    let active = true; const key = `${selected?.id}|${selected?.directory}`; if (key !== detailKey.current) { setDetail(undefined); detailKey.current = key; }
    if (selected && !selected.error) void call('skillDetail', { id: selected.id }).then(result => { if (active) setDetail(result); }).catch(e => { if (active) setDetail({ markdown: `无法读取内容：${errorMessage(e)}` }); });
    return () => { active = false; };
  }, [selected?.id, selected?.directory, data, scope, localPage, globalPage]);
  async function perform(operation: () => Promise<unknown>) { if (busy) return; setBusy(true); setError(''); try { await operation(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  function toggleTarget(id: string, enabled: boolean) {
    if (!current) return;
    const workspace = current.root, hash = current.hash;
    return perform(async () => {
      let preview: ChangePreview | undefined;
      setTargetToggle({ workspace, id, enabled });
      try {
        preview = await call('previewProject', { workspace, hash, change: { type: 'target-enabled', id, enabled } });
        await call('commit', { id: preview.id });
        await refresh();
        setToast(enabled ? '目标已启用' : '目标已停用，已有链接保留');
      } catch (e) {
        await refresh().catch(() => {});
        throw e;
      } finally {
        setTargetToggle(undefined);
        if (preview) await call('discardPreview', { id: preview.id }).catch(() => {});
      }
    });
  }
  async function selectWorkspace(path: string) {
    ++requestSequence.current; const snapshot = await call('selectWorkspace', { path }); ++requestSequence.current; workspaceRef.current = snapshot.workspace?.root; setData(snapshot); setDraft(undefined); setLocalPage('skills'); setScope('workspace'); setDetailOnly(false); setDialog(null); setError('');
    await call('preferences', { scope: 'workspace', workspacePage: 'skills' });
  }
  const discardDraft = () => { if (current) setDraft({ workspace: current.root, raw: current.raw, base: current.raw, hash: current.hash }); };
  function guard(proceed: () => void) { if (dirty) setDialog({ type: 'unsaved', proceed }); else proceed(); }
  function navigate(nextScope: Scope, page?: WorkspacePage | GlobalPage) {
    guard(() => {
      setScope(nextScope); setDetailOnly(false);
      if (page) { if (nextScope === 'workspace') setLocalPage(page as WorkspacePage); else setGlobalPage(page as GlobalPage); }
      void call('preferences', { scope: nextScope, ...(nextScope === 'workspace' ? { workspacePage: (page || localPage) as WorkspacePage } : { globalPage: (page || globalPage) as GlobalPage }) }).catch(e => setError(errorMessage(e)));
    });
  }
  async function previewYaml(afterSave?: () => void) {
    if (!current || !draft) return;
    const preview = await call('previewProject', { workspace: current.root, hash: draft.hash, change: { type: 'raw', raw: draft.raw } }); setDialog({ type: 'review', preview, afterSave });
  }
  async function committed(preview: ChangePreview) {
    if (preview.scope === 'workspace' && current) setDraft({ workspace: current.root, raw: preview.after, base: preview.after, hash: '' });
    await refresh(); setSelectedIds([]); setDialog(null); setToast(preview.directories ? '目标目录已就绪，已添加到当前工作区；可继续预览并应用链接' : '配置已保存，已有链接保持原状');
  }
  async function merge(scope: Scope, local?: string, base?: string) {
    const latest = await refresh(), file = scope === 'workspace' ? latest.workspace : latest.global;
    if (!file) return;
    setDialog({ type: 'merge', scope, base: base ?? draft?.base ?? file.raw, local: local ?? draft?.raw ?? file.raw, disk: file.raw, hash: file.hash });
  }
  const open = (kind: Parameters<typeof call<'openLocation'>>[1]['kind'], id?: string) => perform(() => call('openLocation', { kind, id, workspace: current?.root }));
  const showAdd = (group?: string) => { if (!current) { setDialog({ type: 'switch' }); return; } if (!current.exists) { navigate('workspace', 'skills'); return; } setDialog({ type: 'add', group }); };
  const previewGlobal = (change: Parameters<typeof call<'previewGlobal'>>[1]['change']) => perform(async () => { if (!data) return; const preview = await call('previewGlobal', { hash: data.global.hash, change }); setDialog({ type: 'review', preview }); });
  const canFormProject = !!current?.config && !!current.formEditable, canFormGlobal = !!data?.global.config && data.global.formEditable;
  const linked = current?.links.filter(e => e.status === 'linked').length || 0, missing = current?.links.filter(e => e.status === 'missing').length || 0, issues = current?.links.filter(e => !['linked', 'missing'].includes(e.status)).length || 0;
  const counts = (links: LinkEntry[]) => ['source-missing', 'conflict', 'broken', 'missing', 'linked'].find(s => links.some(e => e.status === s)) as LinkStatus | undefined;
  function scopeSwitch() { return <div className="scope-switch" role="group" aria-label="配置作用域"><button aria-pressed={scope === 'workspace'} onClick={() => navigate('workspace')}><Folder size={15} />工作区</button><button aria-pressed={scope === 'global'} onClick={() => navigate('global')}><Globe size={15} />全局管理</button></div>; }
  function workspacePicker() { return <button className="project-switch" onClick={() => setDialog({ type: 'switch' })}><Folder size={19} /><span><strong>{current?.name || '选择工作区'}</strong><small>{current ? current.exists ? '当前工作区' : '未初始化' : '接入文件夹'}</small></span><ChevronsUpDown size={16} /></button>; }
  function heading(title: string, subtitle: string, actions?: React.ReactNode) { return <><div className="eyebrow">{scope === 'workspace' ? `当前工作区 / ${current?.name || '尚未选择'}` : '全局管理 / 本机共享'}</div><div className="page-heading"><div><h1>{title}</h1><p className="muted">{subtitle}</p></div><div className="actions">{actions}</div></div></>; }
  function renderSettings() {
    const local = scope === 'workspace';
    if (local && !current) return <Empty title="先选择工作区" action={<Button variant="primary" onClick={() => setDialog({ type: 'switch' })}>选择文件夹…</Button>} />;
    const row = (title: string, value: string, actions: React.ReactNode, note?: string) => <div className="setting-row"><div className="grow"><h3>{title}</h3><p className="path">{value}</p>{note && <p className="note">{note}</p>}</div><div className="actions">{actions}</div></div>;
    return <>{heading('设置', local ? '管理当前工作区的位置与配置。' : '管理本机共享的位置与配置。')}<section className="settings-group"><h2>位置与配置</h2>{local ? <>{row('工作区目录', current!.root, <Button onClick={() => open('workspace')}>打开目录</Button>)}{row('配置文件', current!.path, current!.exists ? <Button onClick={() => open('workspace-config')}>打开文件</Button> : <Button onClick={() => navigate('workspace', 'skills')}>前往初始化</Button>, current!.exists ? undefined : '尚未创建配置。')}</> : <>{row('中心目录', data!.global.center, <><Button onClick={() => open('center')}>打开目录</Button><Button disabled={!canFormGlobal} onClick={() => setDialog({ type: 'center' })}>更改…</Button></>)}{row('配置文件', data!.global.path, <><Button onClick={() => open('global-config')}>打开文件</Button><Button onClick={() => setDialog({ type: 'raw-global' })}>编辑 YAML</Button></>)}</>}</section>{local && <section className="settings-group"><h2>维护操作</h2>{row('最近列表入口', data!.preferences.recent.some(w => w.path === current!.root) ? '已记录' : '已移出', <Button disabled={!data!.preferences.recent.some(w => w.path === current!.root)} onClick={() => setDialog({ type: 'maintenance', action: 'forget' })}>移出列表</Button>, '只移除快捷入口，当前工作区与文件保持可用。')}{current!.exists && row('工作区配置', '.skill-registry/config.yaml', <Button variant="danger" onClick={() => setDialog({ type: 'maintenance', action: 'trash' })}>移除配置</Button>, '移入回收站后可重新初始化，已有链接保留。')}</section>}</>;
  }
  function renderSkills(registry: boolean) {
    const filtered = list.filter(s => `${s.id} ${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()) && (!registry || filter === 'all' || (filter === 'git' ? s.isGit : !s.isGit)));
    return <>{heading(registry ? '中心仓库' : 'Skills', registry ? '一份内容，供各个工作区与 Agent 使用。' : '默认清单供继承它的目标使用；独立清单在目标卡片内配置。', registry ? <Button variant="primary" disabled={busy || !data?.global.centerExists} onClick={() => setDialog({ type: 'import' })}><Plus size={15} />注册 Skill</Button> : <><Button disabled={!canFormProject || busy} onClick={() => showAdd()}><Plus size={15} />从全局中心添加</Button><Button variant="primary" disabled={busy || !current?.targets.length} onClick={() => perform(async () => setDialog({ type: 'links', plan: await call('previewLinks', { workspace: current!.root }) }))}>预览并应用</Button></>)}
      {!registry && <div className="segmented skills-tabs"><Button aria-pressed={skillView === 'defaults'} onClick={() => setSkillView('defaults')}>默认清单 {current?.config?.skills.length || 0}</Button><Button aria-pressed={skillView === 'overview'} onClick={() => setSkillView('overview')}>目标使用总览 {effectiveIds.length}</Button></div>}
      {!registry && projectSkills.length > 0 && <Notice>期望 {current?.links.length || 0} 条链接：{missing} 条待创建，{issues} 项需处理。{current?.leftovers.length ? `另有 ${current.leftovers.length} 条遗留链接保留。` : ''}</Notice>}
      <div className="toolbar"><label className="search"><Search size={16} /><input ref={searchRef} aria-label="搜索 Skill" placeholder="搜索 Skill 名称、描述…" value={query} onChange={e => setQuery(e.target.value)} /></label>{registry ? <select aria-label="筛选来源" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部来源</option><option value="git">Git 仓库</option><option value="local">本地 / 来源未知</option></select> : <span className="muted small">{projectSkills.length} 个{skillView === 'defaults' ? '默认技能' : '有效技能'}</span>}</div>
      {!registry && skillView === 'defaults' && selectedIds.length > 0 && <div className="selection-bar"><span>已选 {selectedIds.length} 个</span><Button variant="danger" disabled={busy || !canFormProject} onClick={() => perform(async () => { const preview = await call('previewProject', { workspace: current!.root, hash: current!.hash, change: { type: 'skills', remove: selectedIds } }); setDialog({ type: 'review', preview }); })}>从配置移除</Button><Button variant="quiet" onClick={() => setSelectedIds([])}>取消选择</Button></div>}
      <Button variant="quiet detail-back" onClick={() => setDetailOnly(false)}><ArrowLeft size={15} />返回清单</Button>
      <div className={`skill-split ${detailOnly ? 'show-detail' : ''} ${!selected ? 'no-detail' : ''}`}><section className="skill-list"><div className="list-head"><span>{!registry && skillView === 'defaults' && <input type="checkbox" aria-label="全选当前清单" checked={!!filtered.length && filtered.every(s => selectedIds.includes(s.id))} onChange={e => setSelectedIds(e.target.checked ? filtered.map(s => s.id) : [])} />} SKILL / 描述</span><span>{registry ? '来源' : '部署状态'}</span></div>
      {filtered.map(s => { const links = current?.links.filter(e => e.skill === s.id) || [], status = counts(links); return <div className={`skill-row ${selected?.id === s.id ? 'selected' : ''}`} key={s.id}>{!registry && skillView === 'defaults' && <input type="checkbox" aria-label={`选择 ${s.id}`} checked={selectedIds.includes(s.id)} onChange={e => setSelectedIds(e.target.checked ? [...selectedIds, s.id] : selectedIds.filter(id => id !== s.id))} />}<button className="skill-main" onClick={() => { setSelected(s.id); setDetailOnly(true); }}><span className="skill-mark"><FileText size={18} /></span><span className="grow"><strong>{s.id}</strong>{s.name !== s.id && <span className="display-name">{s.name}</span>}<span className="description">{s.description || '暂无描述'}</span></span></button>{registry ? <span className="badge">{s.isGit ? 'Git' : '本地 / 未知'}</span> : status ? <Status status={status}>{status === 'linked' ? `${links.length}/${links.length} 正常` : undefined}</Status> : <span className="muted small">暂无目标</span>}</div>; })}
      {!filtered.length && <Empty title={query ? '没有匹配的 Skill' : registry ? '中心仓库还没有 Skill' : '工作区还没有 Skill'} action={query ? <Button onClick={() => { setQuery(''); setFilter('all'); }}>清除筛选</Button> : registry ? <Button onClick={() => setDialog({ type: 'import' })}>注册 Skill</Button> : <Button disabled={!canFormProject} onClick={() => showAdd()}>添加第一个 Skill</Button>} />}
      {!registry && <div className="summary"><Status status="linked">{linked} 条正常</Status><Status status="missing">{missing} 条待创建</Status><Status status="conflict">{issues} 项需处理</Status></div>}</section>
      {selected && <aside className="skill-detail" aria-label="Skill 详情"><div className="detail-top"><span className="skill-mark"><FileText size={18} /></span><span className="badge accent">{registry ? selected.isGit ? 'Git 仓库' : '本地 / 来源未知' : '全局内容 · 只读'}</span></div><h2>{selected.id}</h2>{selected.name !== selected.id && <p>{selected.name}</p>}<p className="muted small">{selected.description}</p><h3 className="detail-label">中心位置 · 全局共享</h3><p className="path">{selected.directory}</p>
      {registry ? <><h3 className="detail-label">来源与版本</h3><p className="path">{detail?.git ? <>{detail.git.remote || '未配置远端'}<br />{detail.git.branch} · {detail.git.revision.slice(0, 10)}<br />尚未检查远端更新</> : selected.isGit ? '正在读取 Git 信息…' : '无 Git 元数据，不支持远端更新'}</p><p className="note">已接入工作区引用：{selected.references} 个</p>{data?.unavailable.length ? <p className="note">引用扫描不完整：{data.unavailable.length} 个工作区不可访问</p> : null}<h3 className="detail-label">SKILL.md</h3><div className="markdown"><ReactMarkdown skipHtml disallowedElements={['img', 'a']} unwrapDisallowed>{detail?.markdown || '正在读取内容…'}</ReactMarkdown></div><div className="actions spaced"><Button disabled={!selected.isGit} onClick={() => setDialog({ type: 'update', skill: selected })}><RefreshCw size={14} />检查 / 更新</Button><Button variant="quiet" onClick={() => open('skill-file', selected.id)}>打开文件</Button><Button variant="danger" onClick={() => setDialog({ type: 'remove-skill', skill: selected })}>移除</Button></div><div className="actions spaced"><Button disabled={!current?.config || !canFormProject || current.config.skills.includes(selected.id)} onClick={() => setDialog({ type: 'add', ids: [selected.id] })}>添加到工作区…</Button></div></> : <><h3 className="detail-label">此 Skill 的 Agent 目标</h3>{(current?.targets || []).map(target => {
        const link = current?.links.find(e => e.skill === selected.id && e.target === target.id), retained = current?.leftovers.some(e => e.skill === selected.id && e.target === target.id);
        const member = target.members?.find(m => m.id === selected.id);
        const reason = target.enabled === false ? '目标已停用' : member?.enabled === false && target.custom ? '技能已禁用 · 注释保留' : !target.skills?.includes(selected.id) ? '未选用' : undefined;
        return <div className="target-link" key={target.id}><span>{target.name}</span>{link ? <Status status={link.status} /> : <span className="muted">{reason || '未选用'}</span>}<span className="path">{target.directory}</span><span className="note">{link?.reason || `${reason || '未选用'}${retained ? '；已有链接保留' : ''}`}</span><Button variant="quiet" onClick={() => setDialog({ type: 'target', target })}>配置目标</Button></div>;
      })}<p className="note">当前工作区保存引用。中心内容修改会影响其他工作区的有效链接。</p><Button onClick={() => { setSelected(selected.id); navigate('global', 'registry'); }}><ArrowUpRight size={15} />进入全局中心</Button></>}
      <div className="actions spaced"><Button variant="quiet" onClick={() => open('skill', selected.id)}><FolderOpen size={15} />打开目录</Button></div></aside>}
      </div></>;
  }
  function renderContent() {
    if (!data) return <Empty title={error ? '无法连接插件运行环境' : '正在读取配置…'}>{error}</Empty>;
    if (!data.global.config && (scope === 'global' || !!current)) return <>{heading(scope === 'global' && globalPage === 'settings' ? '设置' : 'SkillRegistory', '管理本机共享的中心仓库。')}<Empty title={data.global.exists ? '全局配置需要修复' : '先初始化全局中心'} action={data.global.exists ? <><Button onClick={() => setDialog({ type: 'raw-global' })}>编辑全局 YAML</Button><Button onClick={() => open('global-config')}>打开配置文件</Button></> : <Button variant="primary" onClick={() => setDialog({ type: 'initialize-global' })}>初始化全局中心</Button>}>{data.global.error || '创建全局配置后，即可接入工作区与管理 Skills。'}</Empty></>;
    if (scope === 'workspace') {
      if (!current) return <Empty title="选择一个工作区" action={<><Button variant="primary" onClick={() => setDialog({ type: 'switch' })}><FolderOpen size={15} />选择文件夹…</Button><Button variant="quiet" onClick={() => navigate('global')}>进入全局管理</Button></>}>接入项目文件夹，管理它的 Skills 与 Agent 目标。</Empty>;
      if (localPage === 'settings') return renderSettings();
      if (!current.exists) return <>{heading('Skills', '选择此工作区需要的 Skills。')}<Empty title="此工作区尚未初始化" action={<><Button variant="primary" disabled={busy} onClick={() => setDialog({ type: 'initialize-workspace' })}><Plus size={15} />初始化 SkillRegistory</Button><Button variant="quiet" onClick={() => setDialog({ type: 'switch' })}>选择其他工作区</Button></>}><p>创建配置后，即可选择 Skills 并管理 Agent 目标。</p><p className="path spaced">{current.path}</p></Empty></>;
      if (localPage === 'yaml' || !current.config) return <>{heading('项目 YAML', '只编辑当前工作区的 config.yaml。')}{current.error && <Notice error>{current.error}</Notice>}{draft?.hash !== current.hash && dirty && <Notice>配置已被外部修改，本地草稿已保留。<Button variant="quiet" onClick={() => perform(() => merge('workspace'))}>比较版本</Button></Notice>}<textarea className="code editor" aria-label="项目 YAML 配置" spellCheck={false} value={draft?.raw ?? current.raw} onChange={e => setDraft(previous => ({ workspace: current.root, base: previous?.base ?? current.raw, hash: previous?.hash ?? current.hash, raw: e.target.value }))} /><div className="actions spaced"><span className="muted grow">{dirty ? '有未保存修改' : '配置已加载'}</span><Button onClick={discardDraft}>放弃修改 / 载入磁盘</Button><Button variant="primary" disabled={busy || !dirty} onClick={() => perform(() => previewYaml())}>校验并预览保存</Button></div></>;
      if (localPage === 'targets') return <>{heading('Agent 目标', '点击目标卡片配置路径与 Skills；右侧开关控制启停。', <><Button disabled={!canFormProject || busy} onClick={() => setDialog({ type: 'target' })}><Plus size={15} />添加目标</Button><Button variant="primary" disabled={!canFormProject || busy} onClick={() => setDialog({ type: 'add-preset-targets' })}><Plus size={15} />从预设添加</Button><Button disabled={busy || !current.targets.length} onClick={() => perform(async () => setDialog({ type: 'links', plan: await call('previewLinks', { workspace: current.root }) }))}>预览并应用</Button></>)}
      <p className="muted small">{current.targets.filter(t => t.enabled !== false).length} 个已启用 · {current.targets.filter(t => t.enabled === false).length} 个已停用</p>
      <div className="panel spaced">{current.targets.map(t => {
        const links = current.links.filter(e => e.target === t.id), kept = current.leftovers.filter(e => e.target === t.id).length;
        const enabled = targetToggle?.workspace === current.root && targetToggle.id === t.id ? targetToggle.enabled : t.enabled !== false;
        return <article className={`target-card workspace-target ${enabled ? '' : 'is-disabled'}`} key={t.id}>
          <button className="target-open" aria-label={`配置 ${t.name}`} disabled={!canFormProject || busy} onClick={() => setDialog({ type: 'target', target: t })} />
          <span className="skill-mark"><Bot size={19} /></span><div className="grow"><div className="target-title"><strong>{t.name}</strong><ArrowUpRight size={13} /></div><p className="path">{t.directory || '尚未配置部署路径'}</p>
          <p className="note">{t.source === 'explicit' ? '工作区配置' : t.source === 'detected' ? '自动发现' : '默认回退'} · {t.custom ? '独立清单' : '继承默认'} · {t.skills?.length || 0} 个有效 Skill{t.custom && t.members?.some(m => !m.enabled) ? ` · ${t.members.filter(m => !m.enabled).length} 个已禁用` : ''}{t.outside ? ' · 工作区外' : ''}</p>
          <div className="members">{(t.skills || []).map(id => <span className="badge" key={id}>{id}</span>)}</div>
          <div className="summary">{links.length ? [...new Set(links.map(e => e.status))].map(status => <Status key={status} status={status}>{links.filter(e => e.status === status).length} {status === 'linked' ? '已链接' : status === 'missing' ? '待创建' : status === 'source-missing' ? '源缺失' : status === 'broken' ? '断链' : '处冲突'}</Status>) : <span className="muted small">{!enabled ? `后续应用跳过此目标；${kept} 条已有链接保留。` : '有效清单为空，无需创建链接。'}</span>}</div>{t.error && <p className="field-error">{t.error}</p>}</div>
          <Switch label={`启用 ${t.name}`} checked={enabled} off="已停用" disabled={!canFormProject || busy} onChange={enabled => toggleTarget(t.id, enabled)} />
        </article>;
      })}</div></>;
      return renderSkills(false);
    }
    if (globalPage === 'settings') return renderSettings();
    if (globalPage === 'registry') return <>{data.global.centerError && <Notice error>中心目录无法读取：{data.global.centerError}<Button onClick={() => navigate('global', 'settings')}>前往设置</Button></Notice>}{renderSkills(true)}</>;
    if (globalPage === 'groups') return <>{heading('共享分组', '将常用 Skills 整理为可重复添加的集合。', <Button variant="primary" disabled={!canFormGlobal} onClick={() => setDialog({ type: 'group' })}><Plus size={15} />新建分组</Button>)}<div className="group-grid">{Object.entries(data.global.config?.groups || {}).map(([id, group]) => <section className="group-card" key={id}><Layers size={22} /><h2>{id}</h2><p className="muted">{group.description || '暂无描述'}</p><div className="members">{group.skills.map(id => <span className="badge" key={id}>{id}</span>)}</div><div className="actions"><Button disabled={!canFormGlobal} onClick={() => setDialog({ type: 'group', originalId: id })}>编辑分组</Button><Button disabled={!canFormProject} onClick={() => showAdd(id)}>添加到工作区…</Button></div></section>)}</div>{!Object.keys(data.global.config?.groups || {}).length && <Empty title="还没有共享分组" action={<Button disabled={!canFormGlobal} onClick={() => setDialog({ type: 'group' })}>新建分组</Button>} />}</>;
    return <>{heading('目标预设', '定义 Agent 使用的目录模板，供工作区引用。', <><Button disabled={!canFormGlobal || busy} onClick={() => previewGlobal({ type: 'restore' })}>恢复缺失项</Button><Button variant="primary" disabled={!canFormGlobal} onClick={() => setDialog({ type: 'preset' })}><Plus size={15} />新建预设</Button></>)}<div className="panel">{Object.entries(data.global.config?.defaults.targets || {}).map(([id, preset]) => <div className="target-card" key={id}><span className="skill-mark"><ScanLine size={18} /></span><div className="grow"><strong>{id} {data.global.config?.settings.default_target === id && <span className="badge accent">默认回退</span>}</strong><p className="path">{preset.path}</p>{preset.description && <p className="note">{preset.description}</p>}</div><div className="actions">{data.global.config?.settings.default_target !== id && <Button variant="quiet" disabled={!canFormGlobal || busy} onClick={() => previewGlobal({ type: 'default', id })}>设为默认</Button>}<Button disabled={!canFormGlobal} onClick={() => setDialog({ type: 'preset', originalId: id })}>编辑</Button></div></div>)}</div><p className="note">修改预设不会自动重写工作区的显式路径，也不会移动已有软链。</p></>;
  }
  const ctx: DialogContext | undefined = data && dialog ? { data, dialog, setDialog, refresh: async () => { await refresh(); }, switchWorkspace: async path => { if (dirty) setDialog({ type: 'unsaved', proceed: () => { void perform(() => selectWorkspace(path)); } }); else await selectWorkspace(path); }, notify: setToast, committed, previewYaml, discardDraft, merge, progress } : undefined;
  return <div className="app"><aside className="sidebar"><div className="brand"><span className="brand-icon"><img src={`./${pluginManifest.logo}`} width={32} height={32} alt="" /></span><div>SkillRegistory<small>本机 Skill 管理</small></div></div>{scopeSwitch()}{scope === 'workspace' && workspacePicker()}<nav aria-label={scope === 'workspace' ? '工作区导航' : '全局导航'}>{(scope === 'workspace' ? localPages : globalPages).map(item => { const Icon = item.icon; const active = item.id === (scope === 'workspace' ? localPage : globalPage), disabled = scope === 'workspace' && ['targets', 'yaml'].includes(item.id) && !current?.exists; return <button key={item.id} className={`nav-item ${active ? 'active' : ''}`} disabled={disabled} aria-current={active ? 'page' : undefined} onClick={() => navigate(scope, item.id)}><Icon size={17} />{item.label}{item.id === 'targets' ? <span className="count">{current?.targets.length || 0}</span> : item.id === 'registry' ? <span className="count">{data?.skills.length || 0}</span> : null}</button>; })}</nav></aside>
    <div className="main-column"><div className="mobile-navigation">{scopeSwitch()}{scope === 'workspace' && workspacePicker()}<select aria-label="当前页面" value={scope === 'workspace' ? localPage : globalPage} onChange={e => navigate(scope, e.target.value as WorkspacePage | GlobalPage)}>{(scope === 'workspace' ? localPages : globalPages).map(item => <option key={item.id} value={item.id} disabled={scope === 'workspace' && ['targets', 'yaml'].includes(item.id) && !current?.exists}>{item.label}</option>)}</select></div>
    <main className={`main ${detailOnly ? 'detail-mode' : ''}`} key={pageKey}>
      {data && <div className="scope-banner"><span className="scope-icon">{scope === 'workspace' ? <Folder size={20} /> : <Globe size={20} />}</span><div className="grow"><strong>{scope === 'workspace' ? `当前工作区 · ${current?.name || '尚未选择'}` : '全局管理 · 本机共享'}</strong><p className="path">{scope === 'workspace' ? current ? `${current.exists ? '' : '待创建：'}${current.path}` : '选择文件夹后读取配置' : globalPage === 'registry' ? data.global.center : data.global.path}</p><p className="note">{scope === 'workspace' ? '本页维护工作区配置；Skill 内容来自全局中心。' : globalPage === 'registry' ? '修改 Skill 内容会影响所有指向它的有效链接。' : '本页配置由本机工作区共享。'}</p></div><span className="badge">{scope === 'workspace' ? '仅此工作区' : '所有工作区共享'}</span><Button variant="icon quiet" aria-label="刷新配置" disabled={busy} onClick={() => perform(() => refresh())}>{busy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}</Button></div>}
      {error && data && <Notice error>{error}<Button variant="quiet" onClick={() => setError('')}>关闭提示</Button></Notice>}
      {scope === 'workspace' && current?.config && !current.formEditable && localPage !== 'yaml' && <Notice>{current.error || '此配置包含复杂 YAML，请通过原文编辑。'}<Button variant="quiet" onClick={() => navigate('workspace', 'yaml')}>项目 YAML</Button><Button variant="quiet" onClick={() => open('workspace-config')}>打开原文件</Button></Notice>}
      {scope === 'global' && data?.global.config && !data.global.formEditable && <Notice>{data.global.error || '此配置包含复杂 YAML，请通过原文编辑。'}<Button variant="quiet" onClick={() => setDialog({ type: 'raw-global' })}>全局 YAML</Button><Button variant="quiet" onClick={() => open('global-config')}>打开原文件</Button></Notice>}{renderContent()}
    </main><footer className="footer"><span>{scope === 'workspace' ? <Folder size={13} /> : <Globe size={13} />}{scope === 'workspace' ? `工作区：${current?.name || '尚未选择'}` : `全局共享 · ${data?.skills.length || 0} 个 Skill`}</span><span aria-live="polite">{busy ? '正在处理…' : scope === 'workspace' ? dirty ? '工作区配置有未保存修改' : !current?.exists ? '尚未初始化' : `${linked} 条正常 · ${issues} 项需处理` : '修改共享资源前请核对影响范围'}</span></footer></div>
    {ctx && <DialogHost key={dialog!.type} ctx={ctx} />}{toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
  </div>;
}
