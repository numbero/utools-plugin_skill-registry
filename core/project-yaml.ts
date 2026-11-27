/** Comment-backed workspace state. Keep this module identical in the CLI and plugin. */
import { parseDocument, isMap, isSeq, isScalar, isNode, visit, type Document, type YAMLMap } from 'yaml';

type ObjectValue = Record<string, any>;
export interface SkillMember { id: string; enabled: boolean }
export interface TargetState { enabled: boolean; custom: boolean; members: SkillMember[]; config: ObjectValue }
const object = (v: any): v is ObjectValue => !!v && typeof v === 'object' && !Array.isArray(v);
const equal = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
function document(raw: string): Document {
  const doc = parseDocument(raw, { keepSourceTokens: true, uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors.map(e => e.message).join('\n'));
  return doc;
}
function pair(doc: Document, keys: string[]) {
  const parent = keys.length === 1 ? doc.contents : doc.getIn(keys.slice(0, -1), true);
  return isMap(parent) ? parent.items.find(p => isScalar(p.key) && p.key.value === keys[keys.length - 1]) : undefined;
}
function region(raw: string, keys: string[]) {
  const p = pair(document(raw), keys);
  if (!p || !isNode(p.key) || !p.key.range) return undefined;
  const lines = raw.split('\n'), start = raw.slice(0, p.key.range[0]).split('\n').length - 1;
  const indent = lines[start].search(/\S/);
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() && line.search(/\S/) <= indent) break;
    end++;
  }
  return { lines, start, end, indent };
}
function comment(raw: string, keys: string[]): string {
  const r = region(raw, keys); if (!r) return raw;
  for (let i = r.start; i < r.end; i++) {
    if (r.lines[i].trim()) r.lines[i] = ' '.repeat(r.indent) + '# ' + r.lines[i].slice(r.indent);
  }
  return r.lines.join('\n');
}
/** Only complete, unambiguous mapping/sequence comments are treated as saved config. */
function expand(raw: string, parent: string[], kind: 'targets' | 'skills'): { raw: string; names: string[] } {
  const r = region(raw, parent); if (!r) return { raw, names: [] };
  const names: string[] = [], indent = r.indent + 2, prefix = ' '.repeat(indent) + '# ';
  for (let i = r.start + 1; i < r.end; i++) {
    const line = r.lines[i];
    if (!line.startsWith(prefix) || !/^\S.*:/.test(line.slice(prefix.length))) continue;
    let end = i + 1;
    while (end < r.end && (r.lines[end].startsWith(prefix + ' ') || r.lines[end].startsWith(prefix + '#') || !r.lines[end].trim())) end++;
    const candidate = r.lines.slice(i, end).map(l => l.startsWith(prefix) ? l.slice(prefix.length) : l).join('\n');
    let decoded: Document;
    try { decoded = document(candidate); } catch { continue; }
    if (!isMap(decoded.contents) || decoded.contents.items.length !== 1) continue;
    const entry = decoded.contents.items[0];
    if (!isScalar(entry.key) || typeof entry.key.value !== 'string') continue;
    const name = entry.key.value;
    const pausedOnly = kind === 'targets' && isScalar(entry.value) && entry.value.value === null && /^\s+# skills:/m.test(candidate);
    if (kind === 'targets' ? !isMap(entry.value) && !pausedOnly : name !== 'skills' || !isSeq(entry.value)) continue;
    const active = document(raw).getIn([...parent, name], true);
    if (active !== undefined || names.includes(name)) throw new Error(`Ambiguous commented configuration: ${[...parent, name].join('.')}`);
    names.push(name);
    for (let j = i; j < end; j++) if (r.lines[j].startsWith(prefix)) r.lines[j] = ' '.repeat(indent) + r.lines[j].slice(prefix.length);
    if (pausedOnly) r.lines[i] = r.lines[i].replace(/:(\s*(?:#.*)?)$/, ': {}$1');
    i = end - 1;
  }
  if (names.length) r.lines[r.start] = r.lines[r.start].replace(/:\s*(?:\{\}|null|~)(\s*(?:#.*)?)$/, ':$1');
  return { raw: r.lines.join('\n'), names };
}
function expandMembers(raw: string, keys: string[]) {
  const r = region(raw, keys); if (!r) return { raw, disabled: [] as string[] };
  const prefix = ' '.repeat(r.indent + 2) + '# ', disabled: string[] = [];
  const active = document(raw).getIn(keys) as any;
  const existing = isSeq(active) ? active.toJSON() as unknown[] : [];
  for (let i = r.start + 1; i < r.end; i++) {
    if (!r.lines[i].startsWith(prefix + '- ')) continue;
    let decoded: any;
    try { decoded = document(r.lines[i].slice(prefix.length)).toJS(); } catch { continue; }
    if (!Array.isArray(decoded) || decoded.length !== 1 || typeof decoded[0] !== 'string') continue;
    const id = decoded[0];
    if (existing.includes(id) || disabled.includes(id)) throw new Error(`Ambiguous commented skill: ${id}`);
    disabled.push(id); r.lines[i] = ' '.repeat(r.indent + 2) + r.lines[i].slice(prefix.length);
  }
  if (disabled.length) r.lines[r.start] = r.lines[r.start].replace(/:\s*\[\](\s*(?:#.*)?)$/, ':$1');
  return { raw: r.lines.join('\n'), disabled };
}
function sync(doc: Document, keys: string[], value: any) {
  const prior = doc.getIn(keys, true);
  if (equal(isNode(prior) ? prior.toJSON() : prior, value)) return;
  if (isMap(prior) && object(value)) {
    for (const p of [...prior.items]) if (isScalar(p.key) && !Object.prototype.hasOwnProperty.call(value, String(p.key.value))) prior.delete(p.key.value);
    for (const [key, item] of Object.entries(value)) sync(doc, [...keys, key], item);
  } else if (isSeq(prior) && Array.isArray(value)) {
    const old = new Map(prior.items.filter(isScalar).map(n => [n.value, n]));
    prior.items = value.map(v => old.get(v) || doc.createNode(v));
  } else {
    const node = doc.createNode(value);
    if (isNode(prior)) { node.comment = prior.comment; node.commentBefore = prior.commentBefore; }
    doc.setIn(keys, node);
  }
}
export class ProjectDocument {
  readonly doc: Document;
  readonly states: Record<string, TargetState> = Object.create(null);
  constructor(readonly original: string) {
    let result = expand(original, ['targets'], 'targets'), raw = result.raw;
    const stopped = result.names;
    const all = document(raw).toJS();
    if (!object(all)) throw new Error('Project configuration must be a mapping.');
    for (const [id, config] of Object.entries(all.targets || {})) {
      if (!object(config)) throw new Error(`targets.${id} must be a mapping.`);
      result = expand(raw, ['targets', id], 'skills'); raw = result.raw;
      const list = expandMembers(raw, ['targets', id, 'skills']); raw = list.raw;
      const full = document(raw).toJS().targets[id];
      this.states[id] = { enabled: !stopped.includes(id), custom: result.names.length === 0 && Object.prototype.hasOwnProperty.call(full, 'skills'), members: Array.isArray(full.skills) ? full.skills.map((skill: string) => ({ id: skill, enabled: !list.disabled.includes(skill) })) : [], config: full };
    }
    this.doc = document(raw);
  }
  /** Effective configuration; target and member state comes only from comments. */
  active(): ObjectValue {
    const data = this.doc.toJS();
    for (const [id, state] of Object.entries(this.states)) {
      if (!data.targets?.[id]) continue;
      if (!state.enabled) { delete data.targets[id]; continue; }
      if (!state.custom) delete data.targets[id].skills;
      else if (Array.isArray(data.targets[id].skills)) data.targets[id].skills = state.members.filter(s => s.enabled).map(s => s.id);
    }
    return data;
  }
  target(id: string): ObjectValue | undefined {
    const config = this.doc.getIn(['targets', id]) as YAMLMap | undefined;
    return isMap(config) ? config.toJSON() : undefined;
  }
  setTarget(id: string, config: ObjectValue, state?: Partial<TargetState>) {
    if (!this.doc.has('targets') || !isMap(this.doc.get('targets', true))) this.doc.set('targets', this.doc.createNode({}));
    sync(this.doc, ['targets', id], config);
    const prior = this.states[id];
    this.states[id] = { ...(prior || { enabled: true, custom: Object.prototype.hasOwnProperty.call(config, 'skills'), members: (config.skills || []).map((id: string) => ({ id, enabled: true })) }), ...state, config };
  }
  removeTarget(id: string) { this.doc.deleteIn(['targets', id]); delete this.states[id]; }
  update(data: ObjectValue) {
    const current = this.active();
    for (const key of Object.keys(current)) if (key !== 'targets' && !Object.prototype.hasOwnProperty.call(data, key)) this.doc.delete(key);
    for (const [key, value] of Object.entries(data)) if (key !== 'targets') sync(this.doc, [key], value);
    for (const id of Object.keys(current.targets || {})) if (!data.targets?.[id]) this.removeTarget(id);
    for (const [id, config] of Object.entries(data.targets || {})) {
      const prior = this.states[id], target = config as ObjectValue;
      if (equal(current.targets?.[id], target)) continue;
      const before = this.target(id) || {}, custom = Object.prototype.hasOwnProperty.call(target, 'skills');
      const next = { ...target };
      if (!custom && !prior?.custom && before.skills !== undefined) next.skills = before.skills;
      const members = custom ? [
        ...(prior?.members || []).filter(m => !m.enabled || target.skills.includes(m.id)),
        ...target.skills.filter((id: string) => !prior?.members.some(m => m.id === id)).map((id: string) => ({ id, enabled: true }))
      ].map(m => ({ ...m, enabled: target.skills.includes(m.id) })) : prior?.members || [];
      if (custom) next.skills = members.map(m => m.id);
      this.setTarget(id, next, { custom, members, enabled: prior?.enabled ?? true });
    }
  }
  toString(): string {
    visit(this.doc, (_, n) => { if (isMap(n) || isSeq(n)) n.flow = n.items.length === 0; });
    let raw = String(this.doc);
    for (const [id, state] of Object.entries(this.states)) {
      const r = region(raw, ['targets', id, 'skills']);
      if (r) {
        const disabled = new Set(state.members.filter(m => !m.enabled).map(m => m.id));
        for (let i = r.start + 1; i < r.end; i++) {
          const line = r.lines[i], trimmed = line.trim();
          if (!trimmed.startsWith('- ')) continue;
          const value = document(trimmed).toJS();
          if (disabled.has(value[0])) r.lines[i] = ' '.repeat(r.indent + 2) + '# ' + line.slice(r.indent + 2);
        }
        if (state.members.length && !state.members.some(m => m.enabled)) r.lines[r.start] = r.lines[r.start].replace(/:(\s*(?:#.*)?)$/, ': []$1');
        raw = r.lines.join('\n');
        if (!state.custom) raw = comment(raw, ['targets', id, 'skills']);
      }
      // A target containing only a paused list must remain an actual mapping.
      if (document(raw).getIn(['targets', id]) === null) {
        const t = region(raw, ['targets', id]);
        if (t) { t.lines[t.start] = t.lines[t.start].replace(/:(\s*(?:#.*)?)$/, ': {}$1'); raw = t.lines.join('\n'); }
      }
      if (!state.enabled) raw = comment(raw, ['targets', id]);
    }
    const targetNode = document(raw).get('targets', true);
    if (isScalar(targetNode) && targetNode.value === null) {
      const t = region(raw, ['targets']);
      if (t) { t.lines[t.start] = t.lines[t.start].replace(/:(\s*(?:#.*)?)$/, ': {}$1'); raw = t.lines.join('\n'); }
    }
    document(raw); return raw;
  }
}
