import React, { startTransition, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Search } from 'lucide-react';
import { useWork } from '../WorkContext';
import { Portal, StatusDot, formatDuration } from '../ui';
import { isoDay, parseDay, sheetApi, type PickTask } from './api';
import { LinesSkeleton } from '../Skeleton';
import { WeekPicker } from './WeekPicker';

/** "0h", "54m", "2h 5m": ClickUp's timesheet style (zero shows as 0h). */
export const hours = (seconds: number) => formatDuration(seconds) || '0h';

export function rangeLabel(start: string, end: string): string {
  const a = parseDay(start), b = parseDay(end);
  // A week the server never sent (a refused request, a mangled ?week=) is not "Invalid Date NaN".
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '…';
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
  return a.getMonth() === b.getMonth()
    ? `${month(a)} ${a.getDate()} - ${b.getDate()}`
    : `${month(a)} ${a.getDate()} - ${month(b)} ${b.getDate()}`;
}

/**
 * Ask for the weeks either side of the one on screen, so stepping to them draws at once from what
 * is kept (see `peek`) instead of waiting on the server. Quietly: a failure here is nobody's news.
 */
export function prefetchWeeks(periodStart: string, fetchWeek: (start: string) => Promise<unknown>) {
  const timer = setTimeout(() => {
    for (const by of [7, -7]) {
      const d = parseDay(periodStart); d.setDate(d.getDate() + by);
      fetchWeek(isoDay(d)).catch(() => undefined);
    }
  }, 300);
  return () => clearTimeout(timer);
}

/** Saturday or Sunday, read from the date itself so a weekend looks like one whoever's sheet it is. */
export const isWeekend = (iso: string) => { const d = new Date(`${iso}T00:00:00`).getDay(); return d === 0 || d === 6; };
/** The weekend shade, used on the header, the cells and the entry rows alike. */
export const WEEKEND = 'bg-gray-100/80';

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
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [pos]);
  useLayoutEffect(() => {
    // Keep it on screen vertically -- and keep doing so while it grows, because the contents
    // (search results, for one) arrive after it is first placed.
    const node = panel.current;
    if (!pos || !node) return;
    const fit = () => {
      const height = node.offsetHeight;
      const room = window.innerHeight - 8;
      const top = pos.top + height > room ? Math.max(8, room - height) : pos.top;
      if (top !== pos.top) setPos({ ...pos, top });
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(node);
    window.addEventListener('resize', fit);
    return () => { watch.disconnect(); window.removeEventListener('resize', fit); };
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

/** How far a week is from this one, in weeks: 0 this week, -1 last week. */
const weeksAway = (start: string) => {
  const first = parseDay(start);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - ((now.getDay() - first.getDay() + 7) % 7));
  return Math.round((first.getTime() - now.getTime()) / (7 * 864e5));
};

export const WeekNav: React.FC<{ start: string | null; end: string | null; onGo: (day: string) => void }> = ({ start, end, onGo }) => {
  const title = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);
  // Steps count from the week last asked for, so pressing → twice before the first week has
  // loaded lands two weeks on, not one; and the title moves the moment a week is chosen, not
  // when its hours arrive.
  const aim = useRef(start);
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => { aim.current = start; setTarget(null); }, [start]);
  const jump = (day: string) => {
    // Any day stands for its week: the one starting on the same weekday as the week on screen.
    if (start) {
      const d = parseDay(day);
      d.setDate(d.getDate() - ((d.getDay() - parseDay(start).getDay() + 7) % 7));
      aim.current = isoDay(d);
      setTarget(aim.current === start ? null : aim.current);
    }
    // The title is drawn first; the page under it follows when it can.
    startTransition(() => onGo(day));
  };
  const shift = (days: number) => {
    if (!aim.current) return;
    const d = parseDay(aim.current);
    d.setDate(d.getDate() + days);
    jump(isoDay(d));
  };
  const today = isoDay(new Date());
  const shownStart = target ?? start;
  const shownEnd = target ? (() => { const d = parseDay(target); d.setDate(d.getDate() + 6); return isoDay(d); })() : end;
  const away = shownStart ? weeksAway(shownStart) : 0;
  const range = shownStart && shownEnd ? rangeLabel(shownStart, shownEnd) : '…';

  // ← and → step a week, as in a calendar, unless the keys belong to something being typed in.
  const step = useRef(shift); step.current = shift;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]')) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      step.current(e.key === 'ArrowLeft' ? -7 : 7);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const prev = (cls: string) => <button aria-label="Previous week" type="button" title="Previous week (←)" onClick={() => shift(-7)} className={cls}><ChevronLeft size={17} /></button>;
  const next = (cls: string) => <button aria-label="Next week" type="button" title="Next week (→)" onClick={() => shift(7)} className={cls}><ChevronRight size={17} /></button>;
  const pickerFor = picking && start && <WeekPicker anchor={title} start={shownStart ?? start} onPick={jump} onClose={() => setPicking(false)} />;
  const chevron = <ChevronDown size={15} className={`wk-caret ${picking ? 'rotate-180' : ''}`} />;
  const titleProps = { ref: title, type: 'button' as const, 'aria-label': 'Pick a week', 'aria-expanded': picking, onClick: () => setPicking((x) => !x) };

  return (
    <div className="wk" data-busy={target ? '' : undefined}>
      {/* One joined control: back, the week (opens the picker), forward; Today beside it. */}
      <div className="wk-seg">
        {prev('wk-seg-btn')}
        <button {...titleProps} className="wk-seg-range"><CalendarDays size={15} className="wk-cal" />{range}{chevron}</button>
        {next('wk-seg-btn')}
      </div>
      <button type="button" onClick={() => jump(today)} disabled={away === 0} className="wk-today" title={away === 0 ? 'You are on this week' : 'Go to this week'}>
        {away === 0 ? <><span className="wk-dot" /> This week</> : <><RotateCcw size={13} /> Today</>}
      </button>
      {pickerFor}
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
        <input autoFocus aria-label={placeholder} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="w-full text-sm focus:outline-none" />
      </div>
      <ul className="max-h-64 overflow-y-auto" role="listbox" aria-label="Tasks">
        {items === null ? <li className="px-2 py-2 text-xs text-gray-400"><LinesSkeleton /></li> : shown.length === 0 ? <li className="px-2 py-2 text-xs text-gray-400">No tasks found</li> : shown.map((task) => (
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
