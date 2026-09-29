import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, GripVertical, Search, X } from 'lucide-react';
import { useWork } from '../WorkContext';
import { useMyTasks } from '../MyTasksContext';
import { TaskPanel } from '../TaskPanel';
import { NameDialog, PriorityFlag, StatusDot, formatDue, startOfDay } from '../ui';
import { planningApi, type CalendarEvent, type Planner, type TimeBlock } from '../planningApi';
import { CalendarsDialog } from './CalendarsDialog';

const HOUR_PX = 48;
const SNAP_MIN = 15;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const KEY = 'timetriq.planner.mode';

type Mode = 'day' | 'week';

const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => { const x = startOfDay(d); const dow = (x.getDay() + 6) % 7; return addDays(x, -dow); }; // weeks start on Monday
const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
const hhmm = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const snap = (minutes: number) => Math.round(minutes / SNAP_MIN) * SNAP_MIN;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

/** ClickUp's Planner: drag your tasks into time slots, next to the meetings in your calendars. */
export const PlannerPage: React.FC<{ embedded?: boolean }> = ({ embedded }) => {
  const { workspace, listName, refresh: refreshTree } = useWork();
  const { tasks, refresh: refreshMine } = useMyTasks();
  const [mode, setMode] = useState<Mode>(() => { try { return (localStorage.getItem(KEY) as Mode) || 'week'; } catch { return 'week'; } });
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [data, setData] = useState<Planner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [newBlock, setNewBlock] = useState<{ start: Date } | null>(null);
  const [showCalendars, setShowCalendars] = useState(false);
  // Back from signing in to Google or Outlook: say how it went, and show the calendars.
  const [params, setParams] = useSearchParams();
  const [calendarNote, setCalendarNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const done = params.get('calendar'), failed = params.get('calendar_error');
    if (!done && !failed) return;
    setCalendarNote(failed ? { ok: false, text: failed } : { ok: true, text: 'Calendar connected — your tasks and time blocks are syncing both ways.' });
    setShowCalendars(true);
    setParams({}, { replace: true });
  }, [params, setParams]);
  const [drag, setDrag] = useState<{ id: string; start: Date; end: Date } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => { try { localStorage.setItem(KEY, mode); } catch { /* ignore */ } }, [mode]);

  const first = mode === 'week' ? startOfWeek(anchor) : anchor;
  const days = useMemo(() => Array.from({ length: mode === 'week' ? 7 : 1 }, (_, i) => addDays(first, i)), [first.getTime(), mode]); // eslint-disable-line react-hooks/exhaustive-deps
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
  useEffect(() => { scrollRef.current?.scrollTo({ top: HOUR_PX * 8 - 8 }); }, []);

  const act = async (fn: () => Promise<unknown>) => { try { setError(null); await fn(); } catch (e) { setError((e as Error).message); } await load(); };

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
    const task = tasks.find((t) => t.id === taskId);
    const minutes = clamp(snap((task?.time_estimate_seconds ?? 3600) / 60), 15, 240);
    const start = timeAt(e.clientX, e.clientY);
    act(() => planningApi.addBlock(workspace.id, { task_id: taskId, start_at: start.toISOString(), end_at: new Date(start.getTime() + minutes * MIN_MS).toISOString() }));
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
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return s <= key && key < e;
  });
  const planned = (day: Date) => items.filter((it) => it.kind === 'block' && sameDay(it.start, day)).reduce((sum, it) => sum + (it.end.getTime() - it.start.getTime()), 0);

  const blockedTaskIds = new Set((data?.blocks ?? []).map((b) => b.task_id).filter(Boolean));
  const tray = tasks
    .filter((t) => !q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(blockedTaskIds.has(a.id)) - Number(blockedTaskIds.has(b.id)) || (a.due_date ?? '9').localeCompare(b.due_date ?? '9'));

  const title = mode === 'week'
    ? `${days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : anchor.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const feedErrors = Object.values(data?.feed_errors ?? {});

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {calendarNote && (
        <div role="status" className={`flex items-center gap-2 px-6 py-1.5 text-sm ${calendarNote.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          {calendarNote.text}
          <button type="button" onClick={() => setCalendarNote(null)} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-6 py-3">
        {/* Inside My Tasks the page already says where you are, so the Planner keeps only its
            own controls. */}
        {!embedded && <CalendarDays size={18} className="text-brand-600" />}
        {!embedded && <h1 className="mr-3 text-base font-semibold text-gray-900">Planner</h1>}
        <button type="button" onClick={() => setAnchor(startOfDay(new Date()))} className="rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50">Today</button>
        <button type="button" title="Previous" onClick={() => setAnchor(addDays(anchor, mode === 'week' ? -7 : -1))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronLeft size={16} /></button>
        <button type="button" title="Next" onClick={() => setAnchor(addDays(anchor, mode === 'week' ? 7 : 1))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronRight size={16} /></button>
        <span className="text-sm font-medium text-gray-700" aria-live="polite">{title}</span>
        <span className="ml-auto flex rounded-md border border-gray-200 p-0.5" role="radiogroup" aria-label="Planner range">
          {(['day', 'week'] as Mode[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`rounded px-2.5 py-0.5 text-sm capitalize ${mode === m ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-500'}`}>{m}</button>
          ))}
        </span>
        <button type="button" onClick={() => setShowCalendars(true)} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><CalendarPlus size={14} /> Calendars</button>
      </header>
      {(error || feedErrors.length > 0) && (
        <div className="mx-6 mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-800">{error ?? `A calendar couldn't be read: ${feedErrors[0]}`}</div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-gray-50/60" aria-label="Tasks to plan">
          <div className="px-4 pb-2 pt-3">
            <h2 className="text-sm font-semibold text-gray-800">To plan</h2>
            <p className="text-xs text-gray-500">Drag a task onto the calendar to block out time for it.</p>
            <span className="mt-2 flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1">
              <Search size={13} className="text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a task" aria-label="Find a task to plan" className="w-full text-sm focus:outline-none" />
            </span>
          </div>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
            {tray.length === 0 && <li className="px-2 py-6 text-center text-xs text-gray-400">No open tasks assigned to you.</li>}
            {tray.map((t) => (
              <li key={t.id} draggable aria-label={`Plan ${t.name}`}
                onDragStart={(e) => { e.dataTransfer.setData('application/x-timetriq-task', t.id); e.dataTransfer.effectAllowed = 'copy'; }}
                className="group flex cursor-grab items-start gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm hover:border-brand-300">
                <GripVertical size={13} className="mt-0.5 shrink-0 text-gray-300 group-hover:text-gray-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5"><StatusDot status={t.status} size={10} /><span className="truncate text-gray-800">{t.name}</span></div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                    <span className="truncate">{listName(t.list_id)}</span>
                    {t.due_date && <span className={t.is_overdue ? 'text-red-600' : ''}>{formatDue(t.due_date)}</span>}
                    {blockedTaskIds.has(t.id) && <span className="text-brand-600">planned</span>}
                  </div>
                </div>
                <PriorityFlag priority={t.priority} withLabel={false} />
              </li>
            ))}
          </ul>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col" aria-label="Planner calendar">
          <div className="flex border-b border-gray-200 pl-14">
            {days.map((d) => (
              <div key={d.getTime()} className="min-w-0 flex-1 border-l border-gray-100 px-2 py-1.5">
                <div className={`text-xs ${sameDay(d, now) ? 'font-semibold text-brand-700' : 'text-gray-500'}`}>{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</div>
                <div className="text-[11px] text-gray-400">{planned(d) ? `${Math.round(planned(d) / 36e5 * 10) / 10}h planned` : ' '}</div>
                {(data?.days_off ?? []).filter((o) => o.day === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).map((o, i) => (
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
              <div className="w-14 shrink-0">
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
                    <div key={d.getTime()} data-day={d.toDateString()} className="relative min-w-0 flex-1 border-l border-gray-100"
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
                                className="ml-auto rounded p-0.5 opacity-0 hover:bg-white/20 group-hover:opacity-100 focus:opacity-100"><X size={10} /></button>
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
          <p className="border-t border-gray-100 px-4 py-1 text-[11px] text-gray-400">Double-click an empty slot to block out time for something else. Drag a block to move it, or its bottom edge to change its length.</p>
        </section>
      </div>

      {newBlock && (
        <NameDialog title={`Block out ${hhmm(newBlock.start)} on ${newBlock.start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`}
          initial="Focus time" confirmLabel="Add" onClose={() => setNewBlock(null)}
          onSubmit={async (name) => {
            if (!workspace) return;
            await planningApi.addBlock(workspace.id, { title: name, start_at: newBlock.start.toISOString(), end_at: new Date(newBlock.start.getTime() + 60 * MIN_MS).toISOString() });
            await load();
          }} />
      )}
      {showCalendars && <CalendarsDialog onClose={() => { setShowCalendars(false); load(); }} />}
      {openTask && <TaskPanel taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => { load(); refreshMine(); refreshTree(); }} onOpen={setOpenTask} />}
    </div>
  );
};
