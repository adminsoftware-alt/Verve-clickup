import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useWork } from '../WorkContext';
import { Portal, StatusDot, formatDuration } from '../ui';
import { isoDay, parseDay, sheetApi, type PickTask } from './api';

/** "0h", "54m", "2h 5m": ClickUp's timesheet style (zero shows as 0h). */
export const hours = (seconds: number) => formatDuration(seconds) || '0h';

export function rangeLabel(start: string, end: string): string {
  const a = parseDay(start), b = parseDay(end);
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
  return a.getMonth() === b.getMonth()
    ? `${month(a)} ${a.getDate()} - ${b.getDate()}`
    : `${month(a)} ${a.getDate()} - ${month(b)} ${b.getDate()}`;
}

export const dayLabel = (iso: string) => parseDay(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

// --- a popover anchored under its trigger -------------------------------------------------

export const Popover: React.FC<{
  trigger: (open: () => void, active: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  width?: number;
  align?: 'left' | 'right';
}> = ({ trigger, children, width = 260, align = 'left' }) => {
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const left = align === 'right' ? r.right - width : r.left;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
  };
  const close = () => setPos(null);
  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [pos]);
  useLayoutEffect(() => {
    // Keep it on screen vertically.
    if (pos && panel.current) {
      const h = panel.current.offsetHeight;
      if (pos.top + h > window.innerHeight - 8) setPos({ ...pos, top: Math.max(8, window.innerHeight - h - 8) });
    }
  }, [pos]);
  return (
    <>
      <span ref={anchor} className="inline-flex">{trigger(open, !!pos)}</span>
      {pos && (
        <Portal>
          <div ref={panel} role="dialog" className="fixed z-[130] rounded-lg border border-gray-200 bg-white p-2 shadow-lg" style={{ top: pos.top, left: pos.left, width }}>
            {children(close)}
          </div>
        </Portal>
      )}
    </>
  );
};

// --- week navigation ------------------------------------------------------------------------

export const WeekNav: React.FC<{ start: string | null; end: string | null; onGo: (day: string) => void }> = ({ start, end, onGo }) => {
  const picker = useRef<HTMLInputElement>(null);
  const shift = (days: number) => {
    if (!start) return;
    const d = parseDay(start);
    d.setDate(d.getDate() + days);
    onGo(isoDay(d));
  };
  return (
    <div className="flex items-center gap-2">
      <button type="button" title="Previous week" onClick={() => shift(-7)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronLeft size={18} /></button>
      <button type="button" title="Next week" onClick={() => shift(7)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronRight size={18} /></button>
      <button
        type="button"
        onClick={() => picker.current?.showPicker?.()}
        className="relative flex items-center gap-1.5 rounded px-1 text-2xl font-medium text-gray-900 hover:bg-gray-50"
        aria-label="Pick a week"
      >
        {start && end ? rangeLabel(start, end) : '…'}
        <ChevronDown size={16} className="text-gray-500" />
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden
          value={start ?? ''}
          onChange={(e) => e.target.value && onGo(e.target.value)}
          className="pointer-events-none absolute left-0 top-full h-0 w-0 opacity-0"
        />
      </button>
      <button type="button" onClick={() => onGo(isoDay(new Date()))} className="ml-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
        This week
      </button>
    </div>
  );
};

// --- pick a task ------------------------------------------------------------------------------

export const TaskPicker: React.FC<{ onPick: (task: PickTask) => void; exclude?: Set<string>; placeholder?: string }> = ({ onPick, exclude, placeholder = 'Search tasks' }) => {
  const { workspace } = useWork();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PickTask[] | null>(null);
  useEffect(() => {
    if (!workspace) return;
    const timer = setTimeout(() => { sheetApi.pickTasks(workspace.id, q).then(setItems).catch(() => setItems([])); }, 200);
    return () => clearTimeout(timer);
  }, [workspace, q]);
  const shown = (items ?? []).filter((x) => !exclude?.has(x.id));
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1">
        <Search size={13} className="text-gray-400" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="w-full text-sm focus:outline-none" />
      </div>
      <ul className="max-h-64 overflow-y-auto" role="listbox" aria-label="Tasks">
        {items === null ? <li className="px-2 py-2 text-xs text-gray-400">Loading…</li> : shown.length === 0 ? <li className="px-2 py-2 text-xs text-gray-400">No tasks found</li> : shown.map((task) => (
          <li key={task.id}>
            <button type="button" role="option" aria-selected={false} onClick={() => onPick(task)} className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-50">
              <span className="mt-0.5"><StatusDot status={task.status} size={11} /></span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-gray-800">{task.name}</span>
                <span className="block truncate text-[11px] text-gray-400">{task.location}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
