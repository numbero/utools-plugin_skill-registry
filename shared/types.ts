export interface TargetConfig { path: string; description?: string; [key: string]: unknown }
export interface GroupConfig { skills: string[]; description?: string; [key: string]: unknown }
export interface GlobalConfig {
  registry?: { path?: string; [key: string]: unknown };
  defaults: { targets: Record<string, TargetConfig>; [key: string]: unknown };
  groups: Record<string, GroupConfig>;
  settings: { default_target: string; [key: string]: unknown };
  [key: string]: unknown;
}
export interface SkillMember { id: string; enabled: boolean }
export interface ProjectConfig { skills: string[]; targets?: Record<string, TargetConfig>; [key: string]: unknown }
export interface ConfigFile<T> { path: string; exists: boolean; raw: string; hash: string; config?: T; error?: string; formEditable: boolean }
export interface RecentWorkspace { path: string; name: string; initialized?: boolean; error?: string }
export type Scope = 'workspace' | 'global';
export type WorkspacePage = 'skills' | 'targets' | 'yaml' | 'settings';
export type GlobalPage = 'registry' | 'groups' | 'presets' | 'settings';
export interface Preferences { recent: RecentWorkspace[]; lastWorkspace?: string; scope?: Scope; workspacePage?: WorkspacePage; globalPage?: GlobalPage }
export interface EffectiveTarget { id: string; name: string; path: string; directory: string; source: 'explicit' | 'detected' | 'default'; outside: boolean; error?: string; enabled?: boolean; custom?: boolean; savedCustom?: boolean; members?: SkillMember[]; skills?: string[] }
export interface PresetDirectory { id: string; path: string; directory: string; existed: boolean; outside: boolean }
export interface WorkspacePreset extends PresetDirectory { name: string; state: 'missing' | 'existing' | 'configured' | 'override' | 'blocked'; selectable: boolean; reason: string; isDefault: boolean }
export interface WorkspacePresets { workspaceHash: string; globalHash: string; targets: WorkspacePreset[] }
export type LinkStatus = 'linked' | 'missing' | 'broken' | 'conflict' | 'source-missing' | 'leftover';
export interface LinkEntry { skill: string; target: string; source: string; destination: string; status: LinkStatus; reason: string; actual?: string; outside: boolean }
export interface Skill { id: string; name: string; description: string; directory: string; isGit: boolean; references: number; groupReferences: number; error?: string }
export interface ReferenceInfo { projects: { path: string; name: string; retained?: boolean }[]; groups: string[]; unavailable: { path: string; error: string }[]; globalHash: string; directory: string }
export interface WorkspaceState extends ConfigFile<ProjectConfig> { root: string; name: string; targets: EffectiveTarget[]; links: LinkEntry[]; leftovers: LinkEntry[] }
export interface Snapshot {
  global: ConfigFile<GlobalConfig> & { center: string; centerExists: boolean; centerError?: string };
  workspace?: WorkspaceState;
  skills: Skill[];
  preferences: Preferences;
  unavailable: { path: string; error: string }[];
}
export type ProjectChange = { type: 'skills'; add?: string[]; remove?: string[] } | { type: 'target'; id: string; path?: string; remove?: boolean; custom?: boolean; members?: SkillMember[] } | { type: 'target-enabled'; id: string; enabled: boolean } | { type: 'target-skill-enabled'; id: string; skill: string; enabled: boolean } | { type: 'preset-targets'; ids: string[]; globalHash: string } | { type: 'raw'; raw: string };
export type GlobalChange = { type: 'group'; id: string; skills?: string[]; description?: string; remove?: boolean } | { type: 'preset'; id: string; path?: string; remove?: boolean } | { type: 'default'; id: string } | { type: 'restore' } | { type: 'center'; path: string } | { type: 'raw'; raw: string };
export interface ChangePreview { id: string; scope: Scope; file: string; before: string; after: string; afterHash: string; impact: string; title: string; changes?: { label: string; value: string }[]; directories?: PresetDirectory[]; confirmLabel?: string }
export interface LinkPlan { id: string; workspace: string; entries: LinkEntry[]; createdAt: number; targets?: EffectiveTarget[] }
export interface TaskResult { created: string[]; skipped: string[]; failed: { path: string; error: string }[]; cancelled: boolean }
export interface Progress { taskId: string; current: number; total: number; message: string }
export interface GitStatus { id: string; revision: string; branch: string; remote: string; dirty: boolean; ahead: number; behind: number; checked: boolean; error?: string }
export interface SkillDetail { markdown: string; git?: GitStatus }
export interface ImportPreview { id: string; skillId: string; name: string; description: string; source: string; destination: string; sourceType: 'local' | 'git' }
export interface ApiErrorData { code: string; message: string; details?: unknown }
export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiErrorData };
export interface Requests {
  snapshot: { input: { workspace?: string }; output: Snapshot };
  selectWorkspace: { input: { path: string }; output: Snapshot };
  forgetWorkspace: { input: { path: string }; output: void };
  preferences: { input: Partial<Pick<Preferences, 'scope' | 'workspacePage' | 'globalPage'>>; output: void };
  initializeGlobal: { input: { center?: string }; output: void };
  initializeWorkspace: { input: { workspace: string }; output: void };
  workspacePresets: { input: { workspace: string }; output: WorkspacePresets };
  previewProject: { input: { workspace: string; hash: string; change: ProjectChange }; output: ChangePreview };
  previewGlobal: { input: { hash: string; change: GlobalChange }; output: ChangePreview };
  commit: { input: { id: string }; output: void };
  discardPreview: { input: { id: string }; output: void };
  previewLinks: { input: { workspace: string }; output: LinkPlan };
  applyLinks: { input: { id: string; taskId: string }; output: TaskResult };
  cancelTask: { input: { taskId: string }; output: void };
  skillDetail: { input: { id: string }; output: SkillDetail };
  prepareImport: { input: { id: string; source: string; sourceType: 'local' | 'git' }; output: ImportPreview };
  commitImport: { input: { id: string }; output: void };
  references: { input: { id: string; workspace?: string }; output: ReferenceInfo };
  trashSkill: { input: { id: string; globalHash: string; confirm: string; force: boolean; workspace?: string }; output: void };
  trashWorkspaceConfig: { input: { workspace: string; hash: string }; output: void };
  gitStatus: { input: { id: string; fetch: boolean }; output: GitStatus };
  updateSkill: { input: { id: string; revision: string; taskId: string }; output: GitStatus };
  selectDirectory: { input: { purpose: 'workspace' | 'target' | 'center' | 'import'; workspace?: string; current?: string }; output: { path: string; configPath: string } | null };
  openLocation: { input: { kind: 'workspace' | 'workspace-config' | 'global-config' | 'center' | 'skill' | 'skill-file'; workspace?: string; id?: string }; output: void };
}
export type Method = keyof Requests;
export interface RegistryBridge {
  call<K extends Method>(method: K, input: Requests[K]['input']): Promise<Result<Requests[K]['output']>>;
  onProgress(listener: (progress: Progress) => void): () => void;
  onEnter(listener: (path?: string) => void): () => void;
}
declare global { interface Window { skillRegistry?: RegistryBridge } }
