import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import type { RegistryBridge } from '../shared/types';
test('bundled CommonJS preload wires native dialogs, folder entry, errors and trash without exposing fs', async t => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'skill-registry-bridge-'))); t.after(() => fs.rm(base, { recursive: true, force: true }));
  const home = path.join(base, 'home'), workspace = path.join(base, 'workspace'); await fs.mkdir(home); await fs.mkdir(workspace);
  const output = await build({ entryPoints: ['bridge/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['electron'], write: false });
  const stored = new Map<string, unknown>(), dialogs: any[] = [], trashed: string[] = []; let enter: (action: unknown) => void = () => {};
  const window = {} as { skillRegistry: RegistryBridge }, require = createRequire(import.meta.url);
  vm.runInNewContext(output.outputFiles[0].text, { window, Buffer, process, console, structuredClone, queueMicrotask, setTimeout, clearTimeout,
    require(name: string) {
      if (name === 'node:os') return { ...os, homedir: () => home };
      if (name === 'electron') return { shell: { openPath: async () => 'open unavailable', trashItem: async (file: string) => { trashed.push(file); throw new Error('trash unavailable'); } } };
      return require(name);
    },
    utools: { dbStorage: { getItem: (key: string) => stored.get(key), setItem: (key: string, value: unknown) => stored.set(key, value) }, getPath: () => base, getPluginTempPath: () => base, showOpenDialog: (options: unknown) => { dialogs.push(options); return [workspace]; }, onPluginEnter: (fn: typeof enter) => { enter = fn; } }
  });
  assert.deepEqual(Object.keys(window.skillRegistry).sort(), ['call', 'onEnter', 'onProgress']); assert.equal(stored.size, 0);
  const chosen = await window.skillRegistry.call('selectDirectory', { purpose: 'target', workspace }); assert.equal(chosen.ok, true); assert.deepEqual([...dialogs[0].properties], ['openDirectory', 'showHiddenFiles']);
  let entry: string | undefined; const unsubscribe = window.skillRegistry.onEnter(value => { entry = value; }); enter({ type: 'files', payload: [{ path: workspace, isDirectory: true }] }); assert.equal(entry, workspace); unsubscribe();
  assert.equal((await window.skillRegistry.call('initializeGlobal', {})).ok, true); assert.equal((await window.skillRegistry.call('initializeWorkspace', { workspace })).ok, true);
  const snapshot = await window.skillRegistry.call('snapshot', { workspace }); assert.equal(snapshot.ok, true); if (!snapshot.ok) return;
  const deleted = await window.skillRegistry.call('trashWorkspaceConfig', { workspace, hash: snapshot.data.workspace!.hash }); assert.equal(deleted.ok, false); if (!deleted.ok) assert.match(deleted.error.message, /trash unavailable/); assert.equal(trashed.length, 1); assert.equal((await fs.stat(snapshot.data.workspace!.path)).isFile(), true);
  const open = await window.skillRegistry.call('openLocation', { kind: 'workspace', workspace }); assert.equal(open.ok, false); if (!open.ok) assert.match(open.error.message, /open unavailable/);
});
