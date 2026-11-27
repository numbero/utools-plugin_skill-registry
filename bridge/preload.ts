import os from 'node:os';
import path from 'node:path';
import { RegistryService } from '../core/service';
import { message, RegistryError } from '../core/errors';
import type { Preferences, Progress, RegistryBridge } from '../shared/types';
interface Host {
  dbStorage: { getItem(key: string): unknown; setItem(key: string, value: unknown): void };
  getPluginTempPath?(): string;
  getPath(name: string): string;
  showOpenDialog(options: { title: string; defaultPath: string; buttonLabel: string; properties: string[] }): string[] | undefined;
  onPluginEnter(listener: (action: { type?: string; payload?: unknown }) => void): void;
}
declare const utools: Host;
const { shell } = require('electron') as { shell: { openPath(file: string): Promise<string>; trashItem(file: string): Promise<void> } };
const progressListeners = new Set<(value: Progress) => void>(), entryListeners = new Set<(path?: string) => void>();
let lastEntry: string | undefined, entered = false;
const service = new RegistryService({
  home: os.homedir(), temp: path.join(utools.getPluginTempPath?.() || utools.getPath('temp'), 'skill-registry-imports'),
  loadPreferences: () => (utools.dbStorage.getItem('skill-registry.preferences.v1') as Preferences) || { recent: [] },
  savePreferences: value => utools.dbStorage.setItem('skill-registry.preferences.v1', value),
  trash: file => shell.trashItem(file),
  open: async file => { const error = await shell.openPath(file); if (error) throw new Error(error); },
  selectDirectory: async options => utools.showOpenDialog({ title: options.title, defaultPath: options.defaultPath, buttonLabel: '选择文件夹', properties: ['openDirectory', ...(options.showHidden ? ['showHiddenFiles'] : [])] })?.[0] || null,
  progress: value => progressListeners.forEach(listener => { try { listener(value); } catch { /* one view cannot interrupt a filesystem task */ } })
});
window.skillRegistry = Object.freeze<RegistryBridge>({
  async call(method, input) {
    try { return { ok: true, data: await service.request(method, input) }; }
    catch (error) { return { ok: false, error: { code: error instanceof RegistryError ? error.code : 'IO', message: message(error), details: error instanceof RegistryError ? error.details : undefined } }; }
  },
  onProgress(listener) { progressListeners.add(listener); return () => { progressListeners.delete(listener); }; },
  onEnter(listener) { entryListeners.add(listener); if (entered) queueMicrotask(() => { if (entryListeners.has(listener)) listener(lastEntry); }); return () => { entryListeners.delete(listener); }; }
});
utools.onPluginEnter(action => {
  entered = true; lastEntry = undefined;
  if (action.type === 'files' && Array.isArray(action.payload)) {
    const folder = action.payload.find(item => item && typeof item.path === 'string' && item.isDirectory === true);
    if (folder) lastEntry = folder.path;
  }
  entryListeners.forEach(listener => listener(lastEntry));
});
