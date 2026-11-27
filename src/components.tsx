import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FolderOpen, Loader2, X } from 'lucide-react';
import type { LinkStatus, Scope } from '../shared/types';
import { call, errorMessage } from './api';
export function Button({ children, variant = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) { return <button type="button" className={`button ${variant}`} {...props}>{children}</button>; }
export function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) { return <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : undefined}><AlertCircle size={16} /><div>{children}</div></div>; }
export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) { return <div className="empty"><FolderOpen size={28} /><h2>{title}</h2>{children && <div className="muted">{children}</div>}<div className="actions">{action}</div></div>; }
export const statusNames: Record<LinkStatus, string> = { linked: '已链接', missing: '待创建', broken: '断链', conflict: '冲突', 'source-missing': '源缺失', leftover: '遗留链接' };
export function Status({ status, children }: { status: LinkStatus; children?: React.ReactNode }) { return <span className={`status ${status}`}><span className="dot" />{children || statusNames[status]}</span>; }
export function Modal({ title, subtitle, scope, workspace, children, footer, onClose, busy = false }: { title: string; subtitle?: string; scope: Scope; workspace?: string; children: React.ReactNode; footer?: React.ReactNode; onClose(): void; busy?: boolean }) {
  const modal = useRef<HTMLDivElement>(null), closing = useRef(onClose); closing.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = modal.current!;
    const controls = () => [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')];
    (panel.querySelector<HTMLElement>('[data-autofocus]') || controls()[0])?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closing.current(); }
      if (event.key === 'Tab') {
        const items = controls(), first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="modal-layer"><div className="modal" ref={modal} role="dialog" aria-modal="true" aria-label={title} aria-busy={busy}>
    <div className="modal-scope">{scope === 'global' ? '全局范围 · 本机所有工作区共享' : `工作区范围 · ${workspace || '尚未选择'}`}</div>
    <header className="modal-head"><div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div><Button variant="icon quiet" aria-label="关闭弹层" disabled={busy} onClick={onClose}><X size={18} /></Button></header>
    <div className="modal-body">{children}</div>{footer && <footer className="modal-footer">{footer}</footer>}
  </div></div>;
}
export function useOperation() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function run<T>(operation: () => Promise<T>): Promise<T | undefined> { if (busy) return; setBusy(true); setError(''); try { return await operation(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  return { busy, error, run, setError };
}
export function ErrorText({ children }: { children?: string }) { return children ? <p className="field-error" role="alert">{children}</p> : null; }
export function BusyLabel({ busy, children }: { busy: boolean; children: React.ReactNode }) { return <>{busy && <Loader2 className="spin" size={15} />}{children}</>; }
export function DirectoryInput({ value, onChange, purpose, workspace, id = 'directory-path', label = '目录路径' }: { value: string; onChange(value: string): void; purpose: 'target' | 'center' | 'import'; workspace?: string; id?: string; label?: string }) {
  const op = useOperation();
  return <div className="field"><label htmlFor={id}>{label}</label><div className="path-input"><input id={id} value={value} onChange={e => onChange(e.target.value)} spellCheck={false} /><Button disabled={op.busy} onClick={() => op.run(async () => { const selected = await call('selectDirectory', { purpose, workspace, current: value || undefined }); if (selected) onChange(purpose === 'target' ? selected.configPath : selected.path); })}><FolderOpen size={15} />选择文件夹…</Button></div><ErrorText>{op.error}</ErrorText></div>;
}
export function Success({ children }: { children: React.ReactNode }) { return <span className="success-line"><CheckCircle2 size={16} />{children}</span>; }
export function Switch({ checked, onChange, label, disabled = false, off = '已禁用' }: { checked: boolean; onChange(value: boolean): void; label: string; disabled?: boolean; off?: string }) {
  return <label className={`toggle ${checked ? 'on' : ''}`}><input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /><span>{checked ? '已启用' : off}</span></label>;
}
