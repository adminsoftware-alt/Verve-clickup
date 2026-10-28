import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Flag, Search, X } from 'lucide-react';
import { API_V2, type Status, type UserRef } from './api';

// --- people ------------------------------------------------------------------

const AVATAR_COLORS = ['#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#2563eb', '#9333ea', '#b45309'];

export function initials(user: UserRef): string {
  const source = user.display_name || user.email.split('@')[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  // First name and last name, as in ClickUp: "Harish Kandi" -> HK. One name gives its first two letters.
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return ((parts[0]?.[0] ?? '') + (last[0] ?? parts[0]?.[1] ?? '')).toUpperCase() || '?';
}

function colorFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** A person's photo, or their initials on their colour. `color` overrides that colour -- your own
 *  avatar is drawn in the navy wherever it stands for you. */
export const Avatar: React.FC<{ user: UserRef; size?: number; color?: string }> = ({ user, size = 24, color }) => (user.avatar ? (
  <img src={`${API_V2}/${user.avatar}`} alt="" title={user.display_name || user.email}
    className="inline-block shrink-0 rounded-full object-cover ring-2 ring-white" style={{ width: size, height: size }} />
) : (
  <span
    title={user.display_name || user.email}
    className="inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-white shrink-0"
    style={{ width: size, height: size, fontSize: size * 0.4, backgroundColor: color ?? colorFor(user.id) }}
  >
    {initials(user)}
  </span>
));

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
      data-status-dot
      data-closed={closed ? '' : undefined}
      className="inline-block rounded-full shrink-0"
      style={{
        '--dot': status.color,
        width: size,
        height: size,
        border: `2px ${status.group === 'not_started' ? 'dashed' : 'solid'} ${status.color}`,
        backgroundColor: closed ? status.color : 'transparent',
      } as React.CSSProperties}
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

/**
 * Reads a length of time the way people write one:
 *   "1h 30m", "90m", "45 min", "2h"  -> exactly that
 *   "1:30" and "1.30"                -> 1 hour 30 minutes
 *   "4.6"                            -> 4 hours 6 minutes (the part after the dot is minutes)
 *   "1"                              -> 1 hour
 */
export function parseDuration(text: string): number | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  const clock = value.match(/^(\d+)[:.](\d{1,2})$/);
  if (clock) {
    const minutes = Number(clock[2]);
    if (minutes > 59) return null;
    return Number(clock[1]) * 3600 + minutes * 60;
  }
  if (/^\d+$/.test(value)) return Number(value) * 3600;  // a bare number is hours
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

export interface MenuItem {
  label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean;
  /** Small grey text at the right of the row, e.g. the file type. */
  hint?: string;
  /** Rows sharing a section sit under its small heading; a new section starts with a rule.
   *  In the compact tile look only the rule is drawn. */
  section?: string;
  /** The tile look: this row's own colour for its icon tile. */
  tone?: string;
}

const MENU_WIDTH = 184;
const MENU_ITEM_HEIGHT = 36;

export const Menu: React.FC<{
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  /** How the trigger sits in its parent. A cell wants the whole width; a toolbar button does not. */
  triggerClassName?: string;
  /** Wider than the default where the labels are longer, e.g. a List's own status names.
   *  'trigger' matches the control it hangs off, which is what a form field wants. */
  width?: number | 'trigger';
  label?: string;
  onOpenChange?: (open: boolean) => void;
  /** The tool look: compact rows, each icon in a small tile of its own colour that fills in
   *  under the pointer. */
  tiles?: boolean;
}> = ({ trigger, items, align = 'left', label, onOpenChange, triggerClassName = 'inline-flex', width = MENU_WIDTH, tiles = false }) => {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  const setOpen = (next: { top: number; left: number; width: number } | null) => {
    setPos(next);
    onOpenChange?.(next !== null);
  };

  const toggle = () => {
    if (open || !triggerRef.current) { setOpen(null); return; }
    const rect = triggerRef.current.getBoundingClientRect();
    // A list that belongs to a form field lines up with the field; anything else keeps its own
    // width, because a toolbar button is not as wide as its longest menu entry.
    const w = width === 'trigger' ? Math.max(rect.width, 170) : width;
    const breaks = items.filter((it, i) => i > 0 && it.section !== items[i - 1].section).length;
    const heads = items.filter((it, i) => it.section && it.section !== items[i - 1]?.section).length;
    const height = items.length * (tiles ? 32 : MENU_ITEM_HEIGHT) + breaks * 9 + (tiles ? 0 : heads * 24) + 8;
    let left = align === 'right' ? rect.right - w : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    const below = rect.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 4) : below;
    setOpen({ top, left, width: w });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    const onMove = (e: Event) => { if (!popoverRef.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
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
        className={triggerClassName}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
      >
        {trigger}
      </span>
      {pos && (
        <Portal>
          <div
            ref={popoverRef}
            role="menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
            className="z-[200] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-xl ring-1 ring-black/[0.03]"
          >
            {items.map((item, i) => {
              const newSection = i > 0 && item.section !== items[i - 1].section;
              const head = item.section && item.section !== items[i - 1]?.section;
              return (
                <React.Fragment key={item.label}>
                  {newSection && <div className="mx-1 my-1 h-px bg-gray-100" role="separator" />}
                  {head && !tiles && <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-400">{item.section}</div>}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(null); item.onClick(); }}
                    // The row is the hit area, inset from the edge so the highlight reads as a
                    // rounded row rather than a band across the whole popover.
                    className={`group/mi flex w-full items-center rounded-lg text-left transition-colors ${tiles ? 'gap-2 px-1.5 py-1 text-[13px]' : 'gap-2.5 px-2.5 py-1.5 text-sm'} ${
                      item.danger ? 'text-red-600 hover:bg-red-50' : tiles ? 'text-gray-800 hover:bg-gray-100' : 'text-gray-700 hover:bg-gray-100'}`}
                  >
                    {tiles ? (
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--mi)_13%,white)] text-[var(--mi)] transition-colors group-hover/mi:bg-[var(--mi)] group-hover/mi:text-white"
                        style={{ '--mi': item.danger ? '#dc2626' : item.tone ?? '#234788' } as React.CSSProperties}
                      >
                        {item.icon}
                      </span>
                    ) : (
                      // A minimum rather than a fixed width: a plain icon lines up with every other row,
                      // and a composite one -- a tick beside a status dot -- is not squeezed into 16px.
                      <span className="flex min-w-4 shrink-0 items-center text-gray-400">{item.icon}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint && (
                      <span className="shrink-0 rounded border border-b-2 border-gray-200 bg-white px-1 text-[9.5px] font-semibold leading-4 tracking-wide text-gray-400">{item.hint}</span>
                    )}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </Portal>
      )}
    </>
  );
};

// --- search in pickers -------------------------------------------------------

/** Every word typed appears in one of the texts, so "har kan" finds "Harish Kandi". */
export const matchesSearch = (query: string, ...texts: (string | null | undefined)[]): boolean => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
};

/**
 * The search box at the top of a dropdown. It sticks while the list under it scrolls, and Enter
 * picks the first match, so a name can be chosen without touching the mouse.
 */
export const SearchBox: React.FC<{
  value: string;
  onChange: (q: string) => void;
  placeholder?: string;
  label: string;
  onEnter?: () => void;
  /** The padding of the panel it sits in, so the box runs edge to edge: p-1 pickers, p-3 popovers. */
  inset?: 'sm' | 'lg';
}> = ({ value, onChange, placeholder = 'Search…', label, onEnter, inset = 'sm' }) => (
  <label className={`sticky z-10 mb-1 flex items-center gap-1.5 border-b border-gray-100 bg-white px-2.5 py-1.5 ${
    inset === 'lg' ? '-top-3 -mx-3 -mt-3' : '-top-1 -mx-1 -mt-1'}`}>
    <Search size={13} className="shrink-0 text-gray-400" />
    <input
      autoFocus value={value} onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }}
      placeholder={placeholder} aria-label={label}
      className="w-full border-0 bg-transparent p-0 text-[13px] text-gray-800 outline-none placeholder:text-gray-400 focus:ring-0"
    />
  </label>
);

/** What a picker says when the search leaves nothing. */
export const NoMatch: React.FC<{ query: string }> = ({ query }) => (
  <p className="px-2 py-3 text-center text-xs text-gray-400">Nothing matches “{query.trim()}”.</p>
);

export interface SelectOption {
  value: string;
  label: string;
  /** A heading the option sits under, like an <optgroup>: "Teams", "People". */
  group?: string;
  /** Matched by the search but not shown, e.g. an email behind a name. */
  hint?: string;
}

/**
 * A <select> you can type into. A plain select of sixty names means scrolling to find one; this
 * opens the same choices under a search box, and the arrow keys and Enter work as they do there.
 * Options without a group come first, then each group under its heading in the order given.
 */
export const SearchSelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Ties the control to its purpose for screen readers: "Assign comment", "Person". */
  label: string;
  /** Shown on the button while nothing listed is chosen. */
  placeholder?: string;
  className?: string;
  width?: number;
  /** 'sm' for a control tucked into a toolbar line. */
  size?: 'sm' | 'md';
}> = ({ value, onChange, options, label, placeholder = 'Choose…', className = '', width = 260, size = 'md' }) => {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const shown = options.filter((o) => matchesSearch(q, o.label, o.hint, o.group));
  const current = options.find((o) => o.value === value);

  const close = () => { setPos(null); setQ(''); };
  const choose = (o: SelectOption) => { onChange(o.value); close(); button.current?.focus(); };
  const open = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    // Upwards when the bottom of the window is closer than the list would be tall.
    setPos(r.bottom + 320 > window.innerHeight ? { bottom: window.innerHeight - r.top + 4, left } : { top: r.bottom + 4, left });
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
  };

  useEffect(() => {
    if (!pos) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !panel.current?.contains(t)) close();
    };
    // Capture, and marked handled, so Escape shuts this list and not the dialog it is in.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', esc, true); };
  }, [pos]);

  useEffect(() => { list.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi]);

  // Ungrouped first, then the groups in the order they first appear.
  const groups = [...new Set(shown.map((o) => o.group ?? ''))].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0));
  const ordered = groups.flatMap((g) => shown.filter((o) => (o.group ?? '') === g));

  return (
    <>
      <button ref={button} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={!!pos}
        onClick={() => (pos ? close() : open())}
        className={`flex min-w-0 items-center justify-between gap-1 border bg-white text-left ${
          size === 'sm' ? 'rounded border-gray-200 px-1.5 py-0.5 text-xs' : 'rounded-md border-gray-300 px-2 py-1.5 text-sm'} ${className}`}>
        <span className={`truncate ${current ? 'text-gray-800' : 'text-gray-500'}`}>{current?.label ?? placeholder}</span>
        <ChevronDown size={13} className="shrink-0 text-gray-400" />
      </button>
      {pos && (
        <Portal>
          <div ref={panel} style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width }}
            className="z-[170] overflow-hidden rounded-lg border border-gray-200 bg-white text-sm shadow-lg">
            <label className="flex items-center gap-1.5 border-b border-gray-100 px-2.5 py-1.5">
              <Search size={13} className="shrink-0 text-gray-400" />
              <input autoFocus value={q} aria-label={`Search ${label.toLowerCase()}`} placeholder="Search…"
                onChange={(e) => { setQ(e.target.value); setHi(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(i + 1, ordered.length - 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
                  if (e.key === 'Enter') { e.preventDefault(); if (ordered[hi]) choose(ordered[hi]); }
                }}
                className="w-full border-0 bg-transparent p-0 text-[13px] text-gray-800 outline-none placeholder:text-gray-400 focus:ring-0" />
            </label>
            <ul ref={list} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto p-1">
              {ordered.map((o, i) => (
                <React.Fragment key={`${o.group ?? ''}:${o.value}`}>
                  {o.group && o.group !== ordered[i - 1]?.group && (
                    <li role="presentation" className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{o.group}</li>
                  )}
                  <li data-i={i} role="option" aria-selected={o.value === value} onMouseEnter={() => setHi(i)} onClick={() => choose(o)}
                    className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 ${i === hi ? 'bg-gray-100' : ''}`}>
                    <span className="min-w-0 flex-1 truncate text-gray-800">{o.label}</span>
                    {o.value === value && <Check size={13} className="shrink-0 text-brand-600" />}
                  </li>
                </React.Fragment>
              ))}
              {ordered.length === 0 && <li><NoMatch query={q} /></li>}
            </ul>
          </div>
        </Portal>
      )}
    </>
  );
};

// --- name dialog -------------------------------------------------------------

const PICKER_COLORS = ['#7c3aed', '#0ea5e9', '#16a34a', '#ea580c', '#db2777', '#4f46e5', '#0d9488', '#b45309', '#dc2626', '#64748b'];
const initialsOf = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const colorOf = (id: string) => PICKER_COLORS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PICKER_COLORS.length];

/** Initials in a coloured circle, for people known only by id and name. */
export const InitialsAvatar: React.FC<{ id: string; name: string; size?: number }> = ({ id, name, size = 26 }) => (
  <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
    style={{ width: size, height: size, fontSize: Math.round(size * 0.4), backgroundColor: colorOf(id) }}>
    {initialsOf(name) || '?'}
  </span>
);

/**
 * Pick several people: who is chosen as chips you can take back, a search box, and the list with
 * a tick on each one chosen. What a multiple <select> did, without Ctrl-clicking.
 */
export const PeoplePicker: React.FC<{
  label: string;
  people: { id: string; name: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
}> = ({ label, people, value, onChange }) => {
  const [q, setQ] = useState('');
  const chosen = new Set(value);
  const byId = new Map(people.map((p) => [p.id, p]));
  const shown = people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => onChange(chosen.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {value.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-xs text-gray-500 hover:text-red-600">Clear ({value.length})</button>
        )}
      </div>
      <div className="rounded-lg border border-gray-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        {value.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-gray-100 p-2" aria-label="Chosen">
            {value.map((id) => {
              const p = byId.get(id);
              if (!p) return null;
              return (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-0.5 pr-1.5 text-xs text-brand-800 ring-1 ring-brand-100">
                  <InitialsAvatar id={id} name={p.name} size={20} />
                  {p.name}
                  <button type="button" aria-label={`Remove ${p.name}`} onClick={() => toggle(id)} className="rounded-full p-0.5 text-brand-600 hover:bg-brand-100">
                    <X size={11} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <Search size={14} className="shrink-0 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" aria-label={`Search ${label.toLowerCase()}`}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (shown[0]) { toggle(shown[0].id); setQ(''); } } }}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:ring-0" />
        </div>
        <ul role="listbox" aria-multiselectable aria-label={label} className="max-h-44 overflow-y-auto border-t border-gray-100 py-1">
          {shown.map((p) => {
            const on = chosen.has(p.id);
            return (
              <li key={p.id}>
                <button type="button" role="option" aria-selected={on} onClick={() => toggle(p.id)}
                  className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-sm ${on ? 'bg-brand-50/60' : 'hover:bg-gray-50'}`}>
                  <InitialsAvatar id={p.id} name={p.name} />
                  <span className="min-w-0 flex-1 truncate text-gray-800">{p.name}</span>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-300'}`}>
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-3 py-3 text-center text-xs text-gray-400">Nobody matches “{q}”</li>}
        </ul>
      </div>
    </div>
  );
};

export const NameDialog: React.FC<{
  title: string;
  initial?: string;
  confirmLabel?: string;
  withPrivate?: boolean;
  /** People who can be handed the thing being created, with a note about what that means. */
  assignTo?: { people: { id: string; name: string }[]; note: string };
  onSubmit: (name: string, isPrivate: boolean, assignees: string[]) => Promise<void> | void;
  onClose: () => void;
}> = ({ title, initial = '', confirmLabel = 'Create', withPrivate = false, assignTo, onSubmit, onClose }) => {
  const [name, setName] = useState(initial);
  const [isPrivate, setIsPrivate] = useState(false);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSubmit(name.trim(), isPrivate, assignees);
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
        className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl bg-white p-5 shadow-xl"
      >
        <h3 className="mb-3 text-base font-semibold text-gray-900">{title}</h3>
        <input
          autoFocus
          aria-label={title}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          placeholder="Name"
        />
        {assignTo && assignTo.people.length > 0 && (
          <div className="mt-4">
            <PeoplePicker label="Assign to" people={assignTo.people} value={assignees} onChange={setAssignees} />
            <p className="mt-1.5 text-xs text-gray-500">
              {assignees.length ? assignTo.note : 'Optional \u2014 leave empty to keep it for everyone here.'}
            </p>
          </div>
        )}
        {withPrivate && (
          <label className="mt-3 flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            Private — only people you share it with can see it
          </label>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
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
/**
 * Close when the click lands anywhere else.
 *
 * Anything that opens over the page should go away when you turn your attention elsewhere --
 * hunting for the × is work the interface should not ask for. Dialogs get this from their
 * backdrop and menus from the Menu component; this is for the panels that have neither, and
 * `also` covers the trigger, so clicking it again toggles rather than closing and reopening.
 */
export function useClickAway(
  ref: React.RefObject<HTMLElement | null>,
  onAway: () => void,
  active = true,
  also?: React.RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || also?.current?.contains(target)) return;
      onAway();
    };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [ref, also, onAway, active]);
}

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

/** The download mark drawn in two parts, so on hover the arrow can drop into the tray. */
export const DownloadIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <g className="dl-arrow">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
    </g>
  </svg>
);
