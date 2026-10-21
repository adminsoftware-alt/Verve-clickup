import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, GripVertical, ListTodo, Search, X } from 'lucide-react';
import { useMe, useWork } from '../WorkContext';
import { useMyTasks } from '../MyTasksContext';
import { TaskPanel } from '../TaskPanel';
import { NameDialog, Portal, PriorityFlag, StatusDot, formatDue, startOfDay, useClickAway } from '../ui';
import type { Task } from '../api';
import { planningApi, type CalendarEvent, type Planner, type TimeBlock } from '../planningApi';
import { FilterPanel } from '../views/FilterPanel';
import { EMPTY_FILTERS, applyFilters, type ViewFilters } from '../views/viewSettings';
import { useBelow, usePhone } from '../useBreakpoint';

const HOUR_PX = 48;
const SNAP_MIN = 15;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const KEY = 'timetriq.planner.mode';
const FILTER_KEY = 'timetriq.planner.filters';
/** Where a task dropped on a whole day (the Month view) starts, when no time was chosen. */
const DEFAULT_START_HOUR = 9;

type Mode = 'day' | 'week' | 'month';
const MODES: { mode: Mode; label: string; key: string }[] = [
  { mode: 'day', label: 'Day', key: 'D' },
  { mode: 'week', label: 'Week', key: 'W' },
  { mode: 'month', label: 'Month', key: 'M' },
];

const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const startOfWeek = (d: Date) => { const x = startOfDay(d); const dow = (x.getDay() + 6) % 7; return addDays(x, -dow); }; // weeks start on Monday
const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
/** Saturday or Sunday: shaded the same light grey as on the timesheet. */
const weekendDay = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const hhmm = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const snap = (minutes: number) => Math.round(minutes / SNAP_MIN) * SNAP_MIN;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** How long a task is planned for when nothing says otherwise: its estimate, within reason. */
const lengthFor = (task: Task | undefined) => clamp(snap((task?.time_estimate_seconds ?? 3600) / 60), 15, 240);

interface Item { id: string; kind: 'block' | 'event'; start: Date; end: Date; title: string; color: string; block?: TimeBlock; event?: CalendarEvent }
interface Placed extends Item { lane: number; lanes: number }

/** Side-by-side lanes for overlapping items in one day. */
function layout(items: Item[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = 0;
  const flush = () => { const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1)); cluster.forEach((c) => { c.lanes = lanes; }); cluster = []; };
  for (const it of sorted) {
    if (cluster.length && it.start.getTime() >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.end.getTime() > it.start.getTime()).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    const placed = { ...it, lane, lanes: 1 };
    cluster.push(placed);
    out.push(placed);
    clusterEnd = Math.max(clusterEnd, it.end.getTime());
  }
  flush();
  return out;
}

/** "Day ▾": the time period, as a menu that also names its keyboard shortcut. */
const PeriodPicker: React.FC<{ mode: Mode; onPick: (m: Mode) => void }> = ({ mode, onPick }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickAway(ref, close, open);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
        {MODES.find((m) => m.mode === mode)?.label}
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" aria-label="Time period" className="absolute left-0 top-full z-30 mt-1 w-48 rounded-xl border border-gray-200 bg-white p-1.5">
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-gray-400">Time period</p>
          {MODES.map((m) => (
            <button key={m.mode} type="button" role="menuitemradio" aria-checked={mode === m.mode}
              onClick={() => { onPick(m.mode); setOpen(false); }}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm ${mode === m.mode ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-800 hover:bg-gray-50'}`}>
              {m.label}
              <kbd className="rounded-md border border-gray-200 bg-gray-50 px-1.5 font-sans text-[11px] text-gray-500">{m.key}</kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** Plan a task without dragging it: a day, a start and a length. The way in on a phone. */
const PlanDialog: React.FC<{
  task: Task; day: Date; onClose: () => void; onPlan: (start: Date, minutes: number) => Promise<void>;
}> = ({ task, day, onClose, onPlan }) => {
  const [date, setDate] = useState(isoDay(day));
  const [time, setTime] = useState(`${String(DEFAULT_START_HOUR).padStart(2, '0')}:00`);
  const [minutes, setMinutes] = useState(lengthFor(task));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lengths = Array.from(new Set([15, 30, 45, 60, 90, 120, 180, 240, minutes])).sort((a, b) => a - b);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const [h, m] = time.split(':').map(Number);
    const [y, mo, d] = date.split('-').map(Number);
    if (!y || Number.isNaN(h)) return;
    setBusy(true);
    try { await onPlan(new Date(y, mo - 1, d, h, m || 0), minutes); onClose(); } catch (err) { setError((err as Error).message); setBusy(false); }
  };
  const field = 'mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none';
  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/30 sm:items-center sm:p-4" onMouseDown={onClose}>
        <form role="dialog" aria-label={`Plan ${task.name}`} onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}
          className="safe-bottom w-full rounded-t-2xl bg-white p-5 sm:w-[26rem] sm:rounded-2xl">
          <div className="mb-4 flex items-start gap-2">
            <StatusDot status={task.status} />
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-gray-900">Plan this task</h3>
              <p className="truncate text-sm text-gray-500">{task.name}</p>
            </div>
            <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-xs font-medium text-gray-600">Day
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
            </label>
            <label className="text-xs font-medium text-gray-600">Start
              <input type="time" required step={900} value={time} onChange={(e) => setTime(e.target.value)} className={field} />
            </label>
            <label className="text-xs font-medium text-gray-600">Length
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={field}>
                {lengths.map((n) => <option key={n} value={n}>{n < 60 ? `${n} min` : `${n / 60} h`}</option>)}
              </select>
            </label>
          </div>
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? 'Planning…' : 'Plan'}</button>
          </div>
        </form>
      </div>
    </Portal>
  );
};

/** ClickUp's Planner: drag your tasks into time slots, next to the meetings in your calendars. */
export const PlannerPage: React.FC<{ embedded?: boolean }> = ({ embedded }) => {
  const { workspace, members, listName, refresh: refreshTree } = useWork();
  const me = useMe();
  const phone = usePhone();
  // Below a laptop's width the tasks-to-plan panel (18rem) beside the app's own sidebar left the
  // calendar a thin strip, so there it opens as a sheet from a "To plan" button, as on a phone.
  const compact = useBelow('lg');
  const { tasks, refresh: refreshMine } = useMyTasks();
  // A phone shows one day unless someone chose otherwise *on the phone*: seven columns do not fit
  // 390px, and a Week picked on a wide window used to follow the browser down to a narrow one.
  const modeKey = phone ? `${KEY}.phone` : KEY;
  const [mode, setMode] = useState<Mode>(() => {
    try { return (localStorage.getItem(modeKey) as Mode) || (phone ? 'day' : 'week'); } catch { return phone ? 'day' : 'week'; }
  });
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [data, setData] = useState<Planner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [newBlock, setNewBlock] = useState<{ start: Date } | null>(null);
  const [planning, setPlanning] = useState<Task | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  // The same Filter the List tab has, over the tasks waiting to be planned. Kept per browser,
  // like the time period beside it.
  const [filters, setFilters] = useState<ViewFilters>(() => {
    try { return { ...EMPTY_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_KEY) || 'null') }; } catch { return EMPTY_FILTERS; }
  });
  useEffect(() => { try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch { /* ignore */ } }, [filters]);
  const people = useMemo(() => members.map((m) => m.user), [members]);
  const [drag, setDrag] = useState<{ id: string; start: Date; end: Date } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => { try { localStorage.setItem(modeKey, mode); } catch { /* ignore */ } }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // D, W and M switch the period, as the menu says -- unless someone is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const hit = MODES.find((m) => m.key.toLowerCase() === e.key.toLowerCase());
      if (hit) setMode(hit.mode);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The days on screen. A month is shown as whole weeks, six of them, so its grid never jumps.
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const first = mode === 'week' ? startOfWeek(anchor) : mode === 'month' ? startOfWeek(monthStart) : anchor;
  const count = mode === 'day' ? 1 : mode === 'week' ? 7 : 42;
  const days = useMemo(() => Array.from({ length: count }, (_, i) => addDays(first, i)), [first.getTime(), count]); // eslint-disable-line react-hooks/exhaustive-deps
  const rangeEnd = addDays(days[days.length - 1], 1);

  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!workspace) return;
    const mine = ++seq.current;
    try {
      const out = await planningApi.planner(workspace.id, first, rangeEnd);
      if (mine === seq.current) { setData(out); setError(null); }
    } catch (e) { if (mine === seq.current) setError((e as Error).message); }
  }, [workspace, first.getTime(), rangeEnd.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (mode !== 'month') scrollRef.current?.scrollTo({ top: HOUR_PX * 8 - 8 }); }, [mode]);

  const act = async (fn: () => Promise<unknown>) => { try { setError(null); await fn(); } catch (e) { setError((e as Error).message); } await load(); };
  const plan = (taskId: string, start: Date, minutes: number) => workspace && act(() => planningApi.addBlock(workspace.id, {
    task_id: taskId, start_at: start.toISOString(), end_at: new Date(start.getTime() + minutes * MIN_MS).toISOString(),
  }));

  const step = (by: number) => setAnchor(mode === 'month' ? addMonths(anchor, by) : addDays(anchor, by * (mode === 'week' ? 7 : 1)));
  const openDay = (d: Date) => { setAnchor(startOfDay(d)); setMode('day'); };

  // --- turning pointer positions into times ------------------------------------------------------------
  const colWidth = () => (gridRef.current ? gridRef.current.clientWidth / days.length : 1);
  const timeAt = (clientX: number, clientY: number): Date => {
    const rect = gridRef.current!.getBoundingClientRect();
    const col = clamp(Math.floor((clientX - rect.left) / colWidth()), 0, days.length - 1);
    const minutes = clamp(snap(((clientY - rect.top) / HOUR_PX) * 60), 0, 24 * 60 - SNAP_MIN);
    return new Date(days[col].getTime() + minutes * MIN_MS);
  };

  // --- dropping a task from the tray ----------------------------------------------------------------------
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('application/x-timetriq-task');
    if (!taskId || !workspace) return;
    plan(taskId, timeAt(e.clientX, e.clientY), lengthFor(tasks.find((t) => t.id === taskId)));
  };
  /** A task dropped on a whole day in the Month view starts at nine. */
  const onDropDay = (e: React.DragEvent, day: Date) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('application/x-timetriq-task');
    if (!taskId) return;
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), DEFAULT_START_HOUR);
    plan(taskId, start, lengthFor(tasks.find((t) => t.id === taskId)));
  };

  // --- moving and resizing blocks -------------------------------------------------------------------------
  const startDrag = (e: React.PointerEvent, block: TimeBlock, how: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start0 = new Date(block.start_at), end0 = new Date(block.end_at);
    const length = end0.getTime() - start0.getTime();
    const x0 = e.clientX, y0 = e.clientY;
    const grabOffset = timeAt(x0, y0).getTime() - start0.getTime();
    let moved = false;
    let latest = { start: start0, end: end0 };
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return;
      moved = true;
      if (how === 'move') {
        const at = timeAt(ev.clientX, ev.clientY).getTime() - grabOffset;
        const start = new Date(Math.round(at / (SNAP_MIN * MIN_MS)) * SNAP_MIN * MIN_MS);
        latest = { start, end: new Date(start.getTime() + length) };
      } else {
        const rect = gridRef.current!.getBoundingClientRect();
        const dayStart = startOfDay(start0).getTime();
        const minutes = snap(((ev.clientY - rect.top) / HOUR_PX) * 60);
        const end = new Date(clamp(dayStart + minutes * MIN_MS, start0.getTime() + SNAP_MIN * MIN_MS, dayStart + DAY_MS));
        latest = { start: start0, end };
      }
      setDrag({ id: block.id, ...latest });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) {
        setDrag(null);
        if (block.task_id) setOpenTask(block.task_id);
        return;
      }
      if (!workspace) return;
      act(() => planningApi.updateBlock(workspace.id, block.id, { start_at: latest.start.toISOString(), end_at: latest.end.toISOString() })).finally(() => setDrag(null));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // --- what to draw ------------------------------------------------------------------------------------------
  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    (data?.blocks ?? []).forEach((b) => {
      const d = drag?.id === b.id ? drag : null;
      out.push({ id: b.id, kind: 'block', start: d ? d.start : new Date(b.start_at), end: d ? d.end : new Date(b.end_at),
        title: b.task?.name ?? b.title ?? 'Time block', color: b.task ? b.task.status.color : '#6366f1', block: b });
    });
    (data?.events ?? []).filter((ev) => !ev.all_day).forEach((ev, i) => out.push({
      id: `ev-${i}`, kind: 'event', start: new Date(ev.start), end: new Date(ev.end), title: ev.title, color: ev.color, event: ev,
    }));
    return out;
  }, [data, drag]);
  const allDay = (data?.events ?? []).filter((ev) => ev.all_day);
  const allDayFor = (day: Date) => allDay.filter((ev) => {
    // All-day dates are calendar dates; compare them as dates, not instants.
    const s = ev.start.slice(0, 10), e = ev.end.slice(0, 10);
    const key = isoDay(day);
    return s <= key && key < e;
  });
  const planned = (day: Date) => items.filter((it) => it.kind === 'block' && sameDay(it.start, day)).reduce((sum, it) => sum + (it.end.getTime() - it.start.getTime()), 0);

  const blockedTaskIds = new Set((data?.blocks ?? []).map((b) => b.task_id).filter(Boolean));
  const tray = applyFilters(tasks, filters, me, false)
    .filter((t) => !q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(blockedTaskIds.has(a.id)) - Number(blockedTaskIds.has(b.id)) || (a.due_date ?? '9').localeCompare(b.due_date ?? '9'));
  const unplanned = tray.filter((t) => !blockedTaskIds.has(t.id)).length;

  const title = mode === 'month'
    ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : mode === 'week'
      ? `${days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: phone ? undefined : 'numeric' })}`
      : anchor.toLocaleDateString(undefined, { weekday: phone ? 'short' : 'long', day: 'numeric', month: phone ? 'short' : 'long' });

  // --- the tray of tasks to plan: a side panel on a desk, a sheet on a phone ---------------------------------
  const trayList = (
    <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
      {tray.length === 0 && (
        <li className="px-2 py-6 text-center text-xs text-gray-400">
          {tasks.length ? 'No tasks match the filter.' : 'No open tasks assigned to you.'}
        </li>
      )}
      {tray.map((t) => (
        <li key={t.id}>
          <button type="button" draggable aria-label={`Plan ${t.name}`}
            onDragStart={(e) => { e.dataTransfer.setData('application/x-timetriq-task', t.id); e.dataTransfer.effectAllowed = 'copy'; }}
            onClick={() => { setTrayOpen(false); setPlanning(t); }}
            title="Drag onto the calendar, or click to pick a time"
            className="tap-row group flex w-full cursor-grab items-start gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-2 text-left text-sm transition-colors hover:border-brand-300 active:cursor-grabbing">
            <GripVertical size={13} className="mt-0.5 hidden shrink-0 text-gray-300 group-hover:text-gray-500 sm:block" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5"><StatusDot status={t.status} size={10} /><span className="truncate text-gray-800">{t.name}</span></span>
              <span className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                <span className="truncate">{listName(t.list_id)}</span>
                {t.due_date && <span className={t.is_overdue ? 'text-red-600' : ''}>{formatDue(t.due_date)}</span>}
                {blockedTaskIds.has(t.id) && <span className="text-brand-600">planned</span>}
              </span>
            </span>
            <PriorityFlag priority={t.priority} withLabel={false} />
          </button>
        </li>
      ))}
    </ul>
  );
  const trayHead = (
    <div className="px-4 pb-2 pt-3">
      <h2 className="text-sm font-semibold text-gray-800">To plan</h2>
      <span className="mt-2 flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5">
        <Search size={13} className="text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a task" aria-label="Find a task to plan" className="w-full bg-transparent text-sm focus:outline-none" />
      </span>
    </div>
  );

  // The time grid is wider than a phone in Week view; it scrolls sideways, hours pinned on the left.
  const colMin = phone && mode === 'week' ? 92 : 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex flex-wrap items-center gap-x-1.5 gap-y-2 border-b border-gray-200 px-3 py-2.5 sm:gap-x-2 sm:px-6 sm:py-3">
        {/* Inside My Tasks the page already says where you are, so the Planner keeps only its
            own controls. */}
        {!embedded && <CalendarDays size={18} className="text-brand-600" />}
        {!embedded && <h1 className="mr-3 text-base font-semibold text-gray-900">Planner</h1>}
        <button type="button" onClick={() => setAnchor(startOfDay(new Date()))} className="rounded-lg border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50">Today</button>
        <PeriodPicker mode={mode} onPick={setMode} />
        <button type="button" aria-label="Previous" onClick={() => step(-1)} className="tap rounded-lg text-gray-500 hover:bg-gray-100"><ChevronLeft size={16} /></button>
        <button type="button" aria-label="Next" onClick={() => step(1)} className="tap rounded-lg text-gray-500 hover:bg-gray-100"><ChevronRight size={16} /></button>
        <span className="min-w-0 truncate text-sm font-semibold text-gray-800" aria-live="polite">{title}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <FilterPanel filters={filters} onChange={setFilters} tasks={tasks} statuses={null} people={people} />
          {compact && (
            <button type="button" onClick={() => setTrayOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">
              <ListTodo size={15} /> To plan{unplanned ? <span className="rounded-full bg-white/25 px-1.5 text-xs">{unplanned}</span> : null}
            </button>
          )}
        </span>
      </header>
      {error && <div className="mx-3 mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-800 sm:mx-6">{error}</div>}
      <div className="flex min-h-0 flex-1">
        {!compact && (
          <aside className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-gray-50/60" aria-label="Tasks to plan">
            {trayHead}
            {trayList}
          </aside>
        )}

        {mode === 'month' ? (
          <MonthGrid days={days} month={anchor.getMonth()} now={now} items={items} allDayFor={allDayFor} phone={phone}
            onOpenDay={openDay} onDropDay={onDropDay}
            onOpenTask={(id) => setOpenTask(id)} />
        ) : (
          <section className="flex min-w-0 flex-1 flex-col overflow-x-auto" aria-label="Planner calendar">
            <div className="flex min-h-0 flex-1 flex-col" style={{ minWidth: colMin ? 56 + colMin * days.length : undefined }}>
              <div className="flex border-b border-gray-200 pl-14">
                {days.map((d) => (
                  <div key={d.getTime()} className={`min-w-0 flex-1 border-l border-gray-100 px-2 py-1.5 ${sameDay(d, now) ? 'bg-brand-50/50' : weekendDay(d) ? 'bg-gray-100/60' : ''}`}>
                    <div className={`text-xs ${sameDay(d, now) ? 'font-semibold text-brand-700' : 'text-gray-500'}`}>{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</div>
                    <div className="text-[11px] text-gray-400">{planned(d) ? `${Math.round(planned(d) / 36e5 * 10) / 10}h planned` : ' '}</div>
                    {(data?.days_off ?? []).filter((o) => o.day === isoDay(d)).map((o, i) => (
                      <div key={`off-${i}`} aria-label={`${o.kind === 'holiday' ? 'Holiday' : 'On leave'}: ${o.label}`}
                        className={`mt-0.5 truncate rounded px-1.5 text-[11px] ${o.kind === 'holiday' ? 'bg-violet-100 text-violet-800' : 'bg-amber-100 text-amber-800'} ${o.pending ? 'opacity-60' : ''}`}>
                        {o.label}{o.part !== 'full' ? ' (half)' : ''}{o.pending ? ' · requested' : ''}
                      </div>
                    ))}
                    {allDayFor(d).map((ev, i) => (
                      <div key={i} title={ev.title} className="mt-0.5 truncate rounded px-1.5 text-[11px] text-white" style={{ backgroundColor: ev.color }}>{ev.title}</div>
                    ))}
                  </div>
                ))}
              </div>
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
                <div className="relative flex" style={{ height: HOUR_PX * 24 }}>
                  <div className="sticky left-0 z-20 w-14 shrink-0 bg-white">
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="relative text-right text-[10px] text-gray-400" style={{ height: HOUR_PX }}>
                        {h > 0 && <span className="absolute -top-1.5 right-2">{hhmm(new Date(2000, 0, 1, h))}</span>}
                      </div>
                    ))}
                  </div>
                  <div ref={gridRef} className="relative flex flex-1"
                    onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-timetriq-task')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
                    onDrop={onDrop}>
                    {days.map((d) => {
                      const placed = layout(items.filter((it) => sameDay(it.start, d)));
                      return (
                        <div key={d.getTime()} data-day={d.toDateString()} className={`relative min-w-0 flex-1 border-l border-gray-100 ${sameDay(d, now) ? 'bg-brand-50/20' : weekendDay(d) ? 'bg-gray-100/50' : ''}`}
                          onDoubleClick={(e) => { if (e.target === e.currentTarget) setNewBlock({ start: timeAt(e.clientX, e.clientY) }); }}>
                          {Array.from({ length: 24 }, (_, h) => <div key={h} className="pointer-events-none border-t border-gray-100" style={{ height: HOUR_PX }} />)}
                          {sameDay(d, now) && (
                            <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500" style={{ top: ((now.getTime() - startOfDay(d).getTime()) / 36e5) * HOUR_PX }} />
                          )}
                          {placed.map((it) => {
                            const top = ((it.start.getTime() - startOfDay(d).getTime()) / 36e5) * HOUR_PX;
                            const height = Math.max(18, ((Math.min(it.end.getTime(), startOfDay(d).getTime() + DAY_MS) - it.start.getTime()) / 36e5) * HOUR_PX - 2);
                            const style: React.CSSProperties = { top, height, left: `calc(${(it.lane / it.lanes) * 100}% + 2px)`, width: `calc(${100 / it.lanes}% - 4px)` };
                            const time = `${hhmm(it.start)} – ${hhmm(it.end)}`;
                            if (it.kind === 'event') {
                              return (
                                <div key={it.id} title={`${it.title}\n${time}${it.event?.location ? `\n${it.event.location}` : ''}`} aria-label={`Meeting: ${it.title}`}
                                  className="absolute z-0 overflow-hidden rounded-md border-l-4 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600"
                                  style={{ ...style, borderColor: it.color }}>
                                  <div className="truncate font-medium text-gray-700">{it.title}</div>
                                  {height > 30 && <div className="truncate">{time}</div>}
                                </div>
                              );
                            }
                            const b = it.block!;
                            return (
                              <div key={it.id} role="button" tabIndex={0} aria-label={`Time block: ${it.title}`} title={`${it.title}\n${time}`}
                                onPointerDown={(e) => startDrag(e, b, 'move')}
                                onKeyDown={(e) => { if (e.key === 'Enter' && b.task_id) setOpenTask(b.task_id); if (e.key === 'Delete' && workspace) act(() => planningApi.removeBlock(workspace.id, b.id)); }}
                                className={`group absolute z-10 cursor-grab touch-none select-none overflow-hidden rounded-md px-1.5 py-0.5 text-[11px] text-white shadow-sm ${drag?.id === b.id ? 'opacity-80 ring-2 ring-brand-300' : ''}`}
                                style={{ ...style, backgroundColor: b.task ? '#4f46e5' : '#7c3aed' }}>
                                <div className="flex items-center gap-1">
                                  {b.task && <StatusDot status={b.task.status} size={9} />}
                                  <span className="truncate font-medium">{it.title}</span>
                                  <button type="button" title="Remove time block" aria-label={`Remove ${it.title}`} onPointerDown={(e) => e.stopPropagation()}
                                    onClick={() => workspace && act(() => planningApi.removeBlock(workspace.id, b.id))}
                                    className="ml-auto rounded p-0.5 opacity-0 hover:bg-white/20 group-hover:opacity-100 focus:opacity-100 [@media(pointer:coarse)]:opacity-100"><X size={10} /></button>
                                </div>
                                {height > 30 && <div className="truncate opacity-90">{time}</div>}
                                <span onPointerDown={(e) => startDrag(e, b, 'resize')} title="Drag to change the length" className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" />
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* On a phone or a narrow window the tasks to plan come up as a sheet from the bottom. */}
      {compact && trayOpen && (
        <Portal>
          <div className="fixed inset-0 z-[110] flex items-end bg-black/30" onMouseDown={() => setTrayOpen(false)}>
            <div role="dialog" aria-label="Tasks to plan" onMouseDown={(e) => e.stopPropagation()}
              className="safe-bottom mx-auto flex max-h-[80dvh] w-full max-w-xl flex-col rounded-t-2xl bg-gray-50">
              <div className="flex items-center justify-between px-4 pt-3">
                <span className="mx-auto h-1 w-10 rounded-full bg-gray-300" aria-hidden />
              </div>
              <div className="flex items-start">
                <div className="flex-1">{trayHead}</div>
                <button type="button" aria-label="Close" onClick={() => setTrayOpen(false)} className="tap mr-2 mt-1 rounded-lg text-gray-400"><X size={18} /></button>
              </div>
              {trayList}
            </div>
          </div>
        </Portal>
      )}

      {planning && (
        <PlanDialog task={planning} day={mode === 'day' ? anchor : sameDay(now, anchor) || mode !== 'week' ? startOfDay(now) : days[0]}
          onClose={() => setPlanning(null)}
          onPlan={async (start, minutes) => { await plan(planning.id, start, minutes); }} />
      )}
      {newBlock && (
        <NameDialog title={`Block out ${hhmm(newBlock.start)} on ${newBlock.start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`}
          initial="Focus time" confirmLabel="Add" onClose={() => setNewBlock(null)}
          onSubmit={async (name) => {
            if (!workspace) return;
            await planningApi.addBlock(workspace.id, { title: name, start_at: newBlock.start.toISOString(), end_at: new Date(newBlock.start.getTime() + 60 * MIN_MS).toISOString() });
            await load();
          }} />
      )}
      {openTask && <TaskPanel taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => { load(); refreshMine(); refreshTree(); }} onOpen={setOpenTask} />}
    </div>
  );
};

/**
 * The month as six weeks of days. Each day lists what is planned in it -- time blocks in colour,
 * meetings in grey -- and a tap opens that day. On a phone a day shows dots instead of titles.
 */
const MonthGrid: React.FC<{
  days: Date[]; month: number; now: Date; items: Item[]; phone: boolean;
  allDayFor: (d: Date) => CalendarEvent[];
  onOpenDay: (d: Date) => void; onDropDay: (e: React.DragEvent, d: Date) => void; onOpenTask: (id: string) => void;
}> = ({ days, month, now, items, phone, allDayFor, onOpenDay, onDropDay, onOpenTask }) => {
  const [over, setOver] = useState<number | null>(null);
  const SHOWN = 3;
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-y-auto" aria-label="Month">
      <div className="sticky top-0 z-10 grid grid-cols-7 border-b border-gray-200 bg-white">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{phone ? d.slice(0, 1) : d}</div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const today = sameDay(d, now);
          const own = items.filter((it) => sameDay(it.start, d)).sort((a, b) => a.start.getTime() - b.start.getTime());
          const allDay = allDayFor(d);
          const total = own.length + allDay.length;
          return (
            <div key={d.getTime()} role="button" tabIndex={0} aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}: ${total} planned`}
              onClick={() => onOpenDay(d)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpenDay(d); }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-timetriq-task')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(i); } }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => { setOver(null); onDropDay(e, d); }}
              className={`group flex min-h-[64px] cursor-pointer flex-col gap-0.5 border-b border-r border-gray-100 p-1 text-left transition-colors sm:min-h-[110px] sm:p-1.5 ${
                i % 7 === 6 ? 'border-r-0' : ''} ${
                over === i ? 'bg-brand-50 ring-2 ring-inset ring-brand-300' : !inMonth ? 'bg-gray-50/70' : weekendDay(d) ? 'bg-gray-100/50 hover:bg-gray-100' : 'hover:bg-gray-50'}`}>
              <span className={`flex h-6 w-6 items-center justify-center self-start rounded-full text-xs ${
                today ? 'bg-brand-600 font-semibold text-white' : inMonth ? 'font-medium text-gray-700' : 'text-gray-400'}`}>
                {d.getDate()}
              </span>
              {phone ? (
                // A phone has room for dots, not titles: one per item, up to four.
                total > 0 && (
                  <span className="flex flex-wrap gap-0.5 px-0.5">
                    {[...allDay.map((ev) => ev.color), ...own.map((it) => (it.kind === 'block' ? '#4f46e5' : '#9ca3af'))].slice(0, 4).map((c, j) => (
                      <span key={j} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                )
              ) : (
                <>
                  {allDay.slice(0, SHOWN).map((ev, j) => (
                    <span key={`a${j}`} className="truncate rounded px-1.5 py-px text-[11px] text-white" style={{ backgroundColor: ev.color }}>{ev.title}</span>
                  ))}
                  {own.slice(0, Math.max(0, SHOWN - allDay.length)).map((it) => (
                    <span key={it.id}
                      onClick={(e) => { if (it.block?.task_id) { e.stopPropagation(); onOpenTask(it.block.task_id); } }}
                      title={`${it.title} · ${hhmm(it.start)}`}
                      className={`flex items-center gap-1 truncate rounded px-1.5 py-px text-[11px] ${
                        it.kind === 'block' ? 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100' : 'bg-gray-100 text-gray-600'}`}>
                      <span className="tabular shrink-0 opacity-70">{hhmm(it.start).replace(/:00/, '')}</span>
                      <span className="truncate">{it.title}</span>
                    </span>
                  ))}
                  {total > SHOWN && <span className="px-1.5 text-[11px] font-medium text-gray-400 group-hover:text-gray-600">+{total - SHOWN} more</span>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
