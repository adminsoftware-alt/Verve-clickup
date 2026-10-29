// Your own month, opened from the date on the Dashboard: the work assigned to you that is due or
// starts each day, your calendar events (when Google Calendar is connected), and leave and holidays.
// Pick a day to see what is on it. It reads what the Planner reads, for whoever is signed in.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Portal, StatusDot } from '../ui';
import { useWork } from '../WorkContext';
import { useMyTasks, isOpen } from '../MyTasksContext';
import { planningApi, type Planner } from '../planningApi';
import type { Task } from '../api';

const WIDTH = 344;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOf = (value: string) => iso(new Date(value));
const time = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export const MonthCalendar: React.FC<{ anchor: DOMRect; onClose: () => void }> = ({ anchor, onClose }) => {
  const { workspace } = useWork();
  const { tasks } = useMyTasks();
  const panel = useRef<HTMLDivElement>(null);
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [picked, setPicked] = useState(iso(today));
  const [planner, setPlanner] = useState<Planner | null>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 8 });

  // Monday-first weeks covering the month, so the grid is always whole weeks.
  const grid = useMemo(() => {
    const first = new Date(month);
    first.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(first); d.setDate(first.getDate() + i); return d; });
  }, [month]);

  // Events, leave and holidays for the six weeks on screen.
  useEffect(() => {
    if (!workspace) return;
    const end = new Date(grid[41]); end.setDate(end.getDate() + 1);
    setPlanner(null);
    planningApi.planner(workspace.id, grid[0], end).then(setPlanner).catch(() => setPlanner({ blocks: [], events: [], feed_errors: {} }));
  }, [workspace, grid]);

  // Open at the date, under it; above it when there is no room below.
  useLayoutEffect(() => {
    const h = panel.current?.offsetHeight ?? 0;
    const below = anchor.bottom + 8;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, anchor.top - h - 8) : below;
    setPos({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8)), top });
  }, [anchor, planner, picked]);

  useEffect(() => {
    // A press on the date itself is left to the date, which opens and closes the calendar.
    const away = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!panel.current?.contains(target) && !target.closest('[data-calendar-trigger]')) onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', esc); };
  }, [onClose]);

  // What falls on each day: your open tasks by due date (or start, when there is no due date).
  const byDay = useMemo(() => {
    const out = new Map<string, { tasks: Task[]; events: Planner['events']; off: NonNullable<Planner['days_off']> }>();
    const at = (k: string) => { if (!out.has(k)) out.set(k, { tasks: [], events: [], off: [] }); return out.get(k)!; };
    tasks.filter(isOpen).forEach((t) => { const when = t.due_date ?? t.start_date; if (when) at(dayOf(when)).tasks.push(t); });
    planner?.events.forEach((e) => at(e.all_day ? e.start.slice(0, 10) : dayOf(e.start)).events.push(e));
    planner?.days_off?.forEach((d) => at(d.day).off.push(d));
    return out;
  }, [tasks, planner]);

  const todayIso = iso(today);
  const day = byDay.get(picked);
  const step = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const pickedLabel = new Date(`${picked}T00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Portal>
      <div ref={panel} role="dialog" aria-label="My calendar" style={{ position: 'fixed', left: pos.left, top: pos.top, width: WIDTH }}
        className="z-[150] overflow-hidden rounded-2xl border border-[#D9E1EF] bg-white text-gray-800 shadow-[0_18px_40px_-12px_rgba(16,24,40,0.35)]">
        <header className="flex items-center gap-1 border-b border-[#EEF1F5] px-3 py-2.5">
          <p className="flex-1 pl-1 font-display text-[15px] font-bold tracking-tight text-[#142B57]">
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </p>
          <button type="button" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setPicked(todayIso); }}
            className="rounded-md px-2 py-1 text-xs font-semibold text-[#234788] hover:bg-[#EEF2F8]">Today</button>
          <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="rounded-md p-1 text-gray-500 hover:bg-gray-100"><ChevronLeft size={16} /></button>
          <button type="button" aria-label="Next month" onClick={() => step(1)} className="rounded-md p-1 text-gray-500 hover:bg-gray-100"><ChevronRight size={16} /></button>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100"><X size={15} /></button>
        </header>

        <div className="px-3 pb-2 pt-2">
          <div className="grid grid-cols-7 pb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5" role="grid">
            {grid.map((d) => {
              const k = iso(d);
              const inMonth = d.getMonth() === month.getMonth();
              const on = byDay.get(k);
              const isToday = k === todayIso;
              const isPicked = k === picked;
              const off = !!on?.off.length;
              return (
                <button key={k} type="button" role="gridcell" aria-selected={isPicked} aria-label={d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
                  onClick={() => setPicked(k)}
                  className={`relative mx-auto flex h-9 w-9 flex-col items-center justify-center rounded-lg text-[13px] tabular-nums transition-colors ${
                    isToday ? 'bg-[#234788] font-bold text-white'
                      : isPicked ? 'bg-[#EEF2F8] font-semibold text-[#142B57] ring-1 ring-[#B9C7E2]'
                        : off ? 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                          : inMonth ? 'text-gray-800 hover:bg-gray-100' : 'text-gray-300 hover:bg-gray-50'}`}>
                  {d.getDate()}
                  {(on?.tasks.length || on?.events.length) ? (
                    <span className="absolute bottom-1 flex gap-0.5" aria-hidden>
                      {!!on.tasks.length && <span className={`h-1 w-1 rounded-full ${isToday ? 'bg-white' : 'bg-[#234788]'}`} />}
                      {!!on.events.length && <span className={`h-1 w-1 rounded-full ${isToday ? 'bg-sky-200' : 'bg-sky-500'}`} />}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="mt-2 flex items-center gap-3 px-1 text-[10.5px] text-gray-400">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#234788]" /> Tasks</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Events</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-100 ring-1 ring-amber-200" /> Leave / holiday</span>
          </p>
        </div>

        <section className="max-h-56 overflow-y-auto border-t border-[#EEF1F5] bg-[#F9FAFC] px-3 py-2.5" aria-label={pickedLabel}>
          <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">{pickedLabel}</p>
          {!planner && !day ? <p className="px-1 py-2 text-xs text-gray-400">Loading…</p> : (
            <ul className="space-y-1">
              {day?.off.map((o) => (
                <li key={`off-${o.label}`} className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12.5px] font-medium text-amber-800">{o.label}{o.pending ? ' (waiting for approval)' : ''}</li>
              ))}
              {day?.events.map((e, i) => (
                <li key={`ev-${i}`} className="flex items-start gap-2 rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-[#EEF1F5]">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: e.color || '#0EA5E9' }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-gray-800">{e.title}</span>
                    <span className="block text-[11px] text-gray-400">{e.all_day ? 'All day' : `${time(e.start)} – ${time(e.end)}`}{e.location ? ` · ${e.location}` : ''}</span>
                  </span>
                </li>
              ))}
              {day?.tasks.map((t) => (
                <li key={t.id}>
                  <Link to={`/l/${t.list_id}?task=${t.id}`} onClick={onClose}
                    className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 no-underline ring-1 ring-[#EEF1F5] hover:ring-[#B9C7E2]">
                    <StatusDot status={t.status} size={10} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-gray-800">{t.name}</span>
                    <span className="shrink-0 text-[11px] text-gray-400">{t.due_date && dayOf(t.due_date) === picked ? 'Due' : 'Starts'}</span>
                  </Link>
                </li>
              ))}
              {!day?.off.length && !day?.events.length && !day?.tasks.length && <li className="px-1 py-2 text-xs text-gray-400">Nothing on this day.</li>}
            </ul>
          )}
        </section>
      </div>
    </Portal>
  );
};
