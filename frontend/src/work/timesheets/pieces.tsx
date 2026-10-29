import React, { startTransition, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ListFilter, RotateCcw, Search } from 'lucide-react';
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
  /** No padding of its own: the contents bring their own header and edges. */
  bare?: boolean;
}> = ({ trigger, children, width = 260, align = 'left', bare }) => {
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
          <div ref={panel} role="dialog" className={`fixed z-[130] border bg-white ${bare
            ? 'overflow-hidden rounded-xl border-[#D9E1EF] shadow-[0_18px_40px_-12px_rgba(16,24,40,0.28),0_2px_6px_rgba(16,24,40,0.06)]'
            : 'rounded-lg border-gray-200 p-2 shadow-lg'}`} style={{ top: pos.top, left: pos.left, width }}>
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

  const prev = (cls: string) => <button aria-label="Previous week" type="button" onClick={() => shift(-7)} className={cls}><ChevronLeft size={17} /></button>;
  const next = (cls: string) => <button aria-label="Next week" type="button" onClick={() => shift(7)} className={cls}><ChevronRight size={17} /></button>;
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
      <button type="button" onClick={() => jump(today)} disabled={away === 0} className="wk-today" aria-label={away === 0 ? 'You are on this week' : 'Go to this week'}>
        {away === 0 ? <><span className="wk-dot" /> This week</> : <><RotateCcw size={13} /> Today</>}
      </button>
      {pickerFor}
    </div>
  );
};

// --- add tasks to the week ------------------------------------------------------------------------

/** "Oct 22 at 11:16 pm" -- when a task last changed. */
const changedAt = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
};

/**
 * Add task, as in ClickUp: one search over every task you can track time on, or just the ones on
 * last week's timesheet; tick as many as you like and add them together.
 */
export const AddTaskPicker: React.FC<{
  exclude: Set<string>;
  /** The week on screen, so "Previous Timesheet" can read the week before it. */
  weekStart: string;
  /** Whose timesheet, when an admin is filling in someone else's. */
  forUserId?: string;
  onAdd: (taskIds: string[]) => Promise<void> | void;
  onClose: () => void;
}> = ({ exclude, weekStart, forUserId, onAdd, onClose }) => {
  const { workspace } = useWork();
  const [tab, setTab] = useState<'all' | 'previous'>('all');
  const [q, setQ] = useState('');
  const [all, setAll] = useState<PickTask[] | null>(null);
  const [previous, setPrevious] = useState<PickTask[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!workspace) return undefined;
    const timer = setTimeout(() => { sheetApi.pickTasks(workspace.id, q).then(setAll).catch(() => setAll([])); }, 200);
    return () => clearTimeout(timer);
  }, [workspace, q]);
  useEffect(() => {
    if (!workspace || tab !== 'previous' || previous) return;
    const before = parseDay(weekStart);
    before.setDate(before.getDate() - 7);
    sheetApi.get(workspace.id, isoDay(before), { userId: forUserId })
      .then((sheet) => setPrevious(sheet.rows.filter((r) => r.task.status)
        .map((r) => ({ id: r.task.id, name: r.task.name, status: r.task.status!, location: r.task.location ?? '' }))))
      .catch(() => setPrevious([]));
  }, [workspace, tab, previous, weekStart, forUserId]);
  const source = tab === 'all' ? all : previous;
  const words = q.trim().toLowerCase();
  const shown = (source ?? []).filter((x) => !exclude.has(x.id)
    && (tab === 'all' || !words || x.name.toLowerCase().includes(words))
    && (!onlyMine || tab === 'previous' || x.mine)
    && (!hideDone || (x.status.group !== 'done' && x.status.group !== 'closed')));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const add = async () => {
    if (!picked.length) return;
    setBusy(true);
    try { await onAdd(picked); onClose(); } finally { setBusy(false); }
  };
  const filters = Number(onlyMine) + Number(hideDone);
  const options: [string, boolean, (on: boolean) => void][] = [['Assigned to me', onlyMine, setOnlyMine], ['Hide completed', hideDone, setHideDone]];
  return (
    <div className="flex max-h-[min(34rem,80vh)] flex-col">
      <label className="flex items-center gap-3 border-b border-[#EEF0F3] px-4 py-3.5">
        <Search size={18} className="shrink-0 text-gray-400" />
        <input autoFocus aria-label="Search for a task" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && picked.length) { e.preventDefault(); void add(); } }}
          placeholder="Search for task name" className="w-full bg-transparent text-[15px] text-gray-900 placeholder:text-gray-400 focus:outline-none" />
      </label>
      <div className="relative flex items-center gap-5 border-b border-[#EEF0F3] px-4">
        {([['all', 'All Tasks'], ['previous', 'Previous Timesheet']] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`-mb-px border-b-2 py-2.5 text-[13px] ${tab === key ? 'border-[#1B2A4A] font-semibold text-[#1B2A4A]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {label}
          </button>
        ))}
        <button type="button" aria-expanded={filterOpen} onClick={() => setFilterOpen(!filterOpen)}
          className={`ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] ${filters ? 'font-medium text-[#234788]' : 'text-gray-500 hover:text-gray-800'}`}>
          <ListFilter size={14} /> Filter{filters ? ` · ${filters}` : ''}
        </button>
        {filterOpen && (
          <div className="vf-menu absolute right-3 top-full z-10 mt-1 w-52 rounded-xl border p-1.5">
            {options.map(([label, on, set]) => (
              <label key={label} className="vf-menu-row flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-gray-700">
                <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> {label}
              </label>
            ))}
          </div>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5" role="listbox" aria-label="Tasks" aria-multiselectable>
        {source === null ? <li className="px-3 py-3"><LinesSkeleton /></li>
          : shown.length === 0 ? (
            <li className="px-3 py-8 text-center text-[13px] text-gray-400">
              {tab === 'previous' ? 'Nothing from last week that is not here already.' : 'No tasks found.'}
            </li>
          ) : shown.map((task) => {
            const on = picked.includes(task.id);
            const done = task.status.group === 'done' || task.status.group === 'closed';
            const where = task.location.split(' / ').pop();
            return (
              <li key={task.id}>
                <button type="button" role="option" aria-selected={on} onClick={() => toggle(task.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${on ? 'bg-[#EEF2F8]' : 'hover:bg-[#F7F8FA]'}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-gray-900">{task.name}</span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-gray-500">
                      {done
                        ? <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-[#16A34A] text-white"><Check size={9} strokeWidth={3.5} /></span>
                        : <StatusDot status={task.status} size={12} />}
                      <span className="shrink-0">{task.status.name}</span>
                      {where && <span className="truncate">• {where}</span>}
                      {task.updated_at && <span className="shrink-0">• {changedAt(task.updated_at)}</span>}
                    </span>
                  </span>
                  <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border ${on ? 'border-[#234788] bg-[#234788] text-white' : 'border-gray-300 bg-white'}`}>
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                </button>
              </li>
            );
          })}
      </ul>
      <div className="flex items-center gap-2 border-t border-[#EEF0F3] bg-[#F8FAFD] px-4 py-2.5">
        <span className="text-[12.5px] text-gray-500">{picked.length ? `${picked.length} selected` : 'Tick the tasks to add'}</span>
        {picked.length > 0 && <button type="button" onClick={() => setPicked([])} className="text-[12.5px] text-gray-500 underline-offset-2 hover:underline">Clear</button>}
        <button type="button" onClick={onClose} className="ml-auto rounded-lg px-3 py-1.5 text-[13px] text-gray-600 hover:bg-gray-100">Cancel</button>
        <button type="button" disabled={!picked.length || busy} onClick={() => { void add(); }}
          className="rounded-lg bg-[#234788] px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-[#1C3A70] disabled:opacity-40">
          {busy ? 'Adding…' : `Add${picked.length > 1 ? ` ${picked.length} tasks` : ' task'}`}
        </button>
      </div>
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
