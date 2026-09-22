import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Flag } from 'lucide-react';
import type { Status, UserRef } from './api';

// --- people ------------------------------------------------------------------

const AVATAR_COLORS = ['#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#2563eb', '#9333ea', '#b45309'];

export function initials(user: UserRef): string {
  const source = user.display_name || user.email.split('@')[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function colorFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export const Avatar: React.FC<{ user: UserRef; size?: number }> = ({ user, size = 24 }) => (
  <span
    title={user.display_name || user.email}
    className="inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-white shrink-0"
    style={{ width: size, height: size, fontSize: size * 0.4, backgroundColor: colorFor(user.id) }}
  >
    {initials(user)}
  </span>
);

export const AvatarStack: React.FC<{ users: UserRef[]; max?: number }> = ({ users, max = 3 }) => {
  if (users.length === 0) return <span className="text-gray-300 text-xs">—</span>;
  const shown = users.slice(0, max);
  return (
    <span className="inline-flex -space-x-1.5 items-center">
      {shown.map((u) => <Avatar key={u.id} user={u} />)}
      {users.length > max && <span className="ml-2 text-xs text-gray-500">+{users.length - max}</span>}
    </span>
  );
};

// --- priority & status -------------------------------------------------------

export const PRIORITIES: Record<number, { label: string; color: string }> = {
  1: { label: 'Urgent', color: '#dc2626' },
  2: { label: 'High', color: '#f59e0b' },
  3: { label: 'Normal', color: '#3b82f6' },
  4: { label: 'Low', color: '#9ca3af' },
};

export const PriorityFlag: React.FC<{ priority: number | null; withLabel?: boolean }> = ({ priority, withLabel = true }) => {
  if (!priority) return <Flag size={14} className="text-gray-300" />;
  const p = PRIORITIES[priority];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
      <Flag size={14} fill={p.color} color={p.color} />
      {withLabel && p.label}
    </span>
  );
};

export const StatusDot: React.FC<{ status: Status; size?: number }> = ({ status, size = 14 }) => {
  const closed = status.group === 'closed' || status.group === 'done';
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        border: `2px ${status.group === 'not_started' ? 'dashed' : 'solid'} ${status.color}`,
        backgroundColor: closed ? status.color : 'transparent',
      }}
    />
  );
};

export const StatusPill: React.FC<{ status: Pick<Status, 'name' | 'color'> }> = ({ status }) => (
  <span
    className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white"
    style={{ backgroundColor: status.color }}
  >
    {status.name}
  </span>
);

// --- durations ---------------------------------------------------------------

/** "8h 23m", "15m", "45s" — how ClickUp shows tracked time and estimates. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return `${seconds}s`;
}

/** Reads "1h 30m", "1.5h", "90m", "45 min", "1:30" or a bare number of hours. */
export function parseDuration(text: string): number | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  const clock = value.match(/^(\d+):(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 3600);
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of value.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b/g)) {
    matched = true;
    const n = Number(amount);
    total += unit.startsWith('h') ? n * 3600 : unit.startsWith('m') ? n * 60 : n;
  }
  return matched && total > 0 ? Math.round(total) : null;
}

// --- dates -------------------------------------------------------------------

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function formatDue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const days = Math.round((startOfDay(date).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === -1) return 'Yesterday';
  if (days === 1) return 'Tomorrow';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: '2-digit' }) });
}

/** yyyy-mm-dd for <input type="date">, in local time. */
export function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight of a yyyy-mm-dd value, as an ISO string. */
export function fromDateInput(value: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}

// --- overlays ----------------------------------------------------------------

/**
 * Render overlays at the document root. The sidebar uses backdrop-filter, which makes
 * it the containing block for position:fixed children, so an in-place modal would be
 * trapped and clipped inside the sidebar.
 */
export const Portal: React.FC<{ children: React.ReactNode }> = ({ children }) => createPortal(children, document.body);

// --- popover menu ------------------------------------------------------------

export interface MenuItem { label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean }

const MENU_WIDTH = 184;
const MENU_ITEM_HEIGHT = 34;

export const Menu: React.FC<{
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  label?: string;
  onOpenChange?: (open: boolean) => void;
}> = ({ trigger, items, align = 'left', label, onOpenChange }) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  const setOpen = (next: { top: number; left: number } | null) => {
    setPos(next);
    onOpenChange?.(next !== null);
  };

  const toggle = () => {
    if (open || !triggerRef.current) { setOpen(null); return; }
    const rect = triggerRef.current.getBoundingClientRect();
    const height = items.length * MENU_ITEM_HEIGHT + 8;
    let left = align === 'right' ? rect.right - MENU_WIDTH : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8));
    const below = rect.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 4) : below;
    setOpen({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    const onMove = (e: Event) => { if (!popoverRef.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
      >
        {trigger}
      </span>
      {pos && (
        <Portal>
          <div
            ref={popoverRef}
            role="menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="z-[200] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(null); item.onClick(); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100 ${item.danger ? 'text-red-600' : 'text-gray-700'}`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </Portal>
      )}
    </>
  );
};

// --- name dialog -------------------------------------------------------------

export const NameDialog: React.FC<{
  title: string;
  initial?: string;
  confirmLabel?: string;
  withPrivate?: boolean;
  onSubmit: (name: string, isPrivate: boolean) => Promise<void> | void;
  onClose: () => void;
}> = ({ title, initial = '', confirmLabel = 'Create', withPrivate = false, onSubmit, onClose }) => {
  const [name, setName] = useState(initial);
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSubmit(name.trim(), isPrivate);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Portal>
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-label={title}
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="w-96 max-w-[calc(100vw-2rem)] rounded-xl bg-white p-5 shadow-xl"
      >
        <h3 className="mb-3 text-base font-semibold text-gray-900">{title}</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          placeholder="Name"
        />
        {withPrivate && (
          <label className="mt-3 flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            Private — only people you share it with can see it
          </label>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
    </Portal>
  );
};

/**
 * Esc closes a window, as in ClickUp — but only the topmost one (windows opened later sit
 * later in the page), and not while you're typing (Esc then just leaves the field) or a
 * menu is open.
 */
export function useEscapeToClose(ref: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (!ref.current || dialogs[dialogs.length - 1] !== ref.current) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) { el.blur(); return; }
      if (document.querySelector('[role="menu"]')) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref, onClose]);
}
