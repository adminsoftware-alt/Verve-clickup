// The month, by date.
//
// A calendar is read at two distances: from across the desk, where the only questions are "which
// days are busy" and "is anything late", and up close, where you want to know what a particular
// day actually holds. So a day cell carries a load bar and a count for the first, and proper task
// cards -- priority, name, who, how long -- for the second.
//
// Rows are a fixed height and the page scrolls. They used to stretch to fill their container,
// which made one week fill the screen and pushed the rest of the month out of sight.
import React, { useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Plus } from 'lucide-react';

import type { Task, TaskInput } from '../api';
import { Avatar, formatDuration, startOfDay } from '../ui';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MS = 86_400_000;
/** How tall a week is, and how many cards fit before the rest are counted. */
const ROW_PX = 132;
const SHOWN_PER_DAY = 3;

const PRIORITY_DOT: Record<number, string> = {
  1: 'bg-red-500', 2: 'bg-orange-500', 3: 'bg-sky-500', 4: 'bg-gray-300',
};

/** A card's own colour, by priority: a month then reads as a spread of urgency before any of
 *  it is read as names. Overdue and finished work override it. */
const PRIORITY_CARD: Record<number, string> = {
  1: 'border-red-200 bg-red-50/80',
  2: 'border-orange-200 bg-orange-50/80',
  3: 'border-sky-200 bg-sky-50/70',
  4: 'border-gray-200 bg-gray-50',
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** The six-week grid shown for a month, starting on Monday. */
function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

const shift = (iso: string | null, days: number) => (iso ? new Date(new Date(iso).getTime() + days * DAY_MS).toISOString() : null);

const isDone = (t: Task) => t.status.group === 'done' || t.status.group === 'closed';

export const CalendarView: React.FC<{
  tasks: Task[];
  canCreate: boolean;
  onCreate: (name: string, dueIso: string) => Promise<void>;
  onUpdate: (id: string, input: TaskInput) => Promise<void>;
  onOpenTask: (id: string) => void;
}> = ({ tasks, canCreate, onCreate, onUpdate, onOpenTask }) => {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [addingOn, setAddingOn] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const days = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks.forEach((t) => {
      const anchor = t.due_date ?? t.start_date;
      if (!anchor) return;
      const key = dayKey(new Date(anchor));
      map.set(key, [...(map.get(key) ?? []), t]);
    });
    // Urgent first, then the rest by name: a day with six things on it should put the one that
    // matters at the top, because that is the one that stays visible.
    map.forEach((list) => list.sort((a, b) =>
      Number(isDone(a)) - Number(isDone(b))
      || (a.priority ?? 9) - (b.priority ?? 9)
      || a.name.localeCompare(b.name)));
    return map;
  }, [tasks]);

  const unscheduled = tasks.filter((t) => !t.due_date && !t.start_date).length;
  const todayKey = dayKey(new Date());

  // What this month holds, said once at the top rather than left to be counted off the grid.
  const summary = useMemo(() => {
    const inView = days.filter((d) => d.getMonth() === month.getMonth()).flatMap((d) => byDay.get(dayKey(d)) ?? []);
    return {
      total: inView.length,
      overdue: inView.filter((t) => t.is_overdue).length,
      done: inView.filter(isDone).length,
    };
  }, [days, byDay, month]);

  /** The busiest day in view, so the load bars have something to be a share of. */
  const busiest = useMemo(
    () => Math.max(1, ...days.map((d) => (byDay.get(dayKey(d)) ?? []).length)),
    [days, byDay],
  );

  const drop = async (e: React.DragEvent, day: Date) => {
    e.preventDefault();
    setDragOver(null);
    const task = tasks.find((t) => t.id === e.dataTransfer.getData('text/task-id'));
    if (!task) return;
    const anchor = new Date(task.due_date ?? task.start_date!);
    const moved = Math.round((startOfDay(day).getTime() - startOfDay(anchor).getTime()) / DAY_MS);
    if (moved === 0) return;
    // Move the whole span, so a task keeps its duration.
    await onUpdate(task.id, { start_date: shift(task.start_date, moved), due_date: shift(task.due_date, moved) });
  };

  const create = async (e: React.FormEvent, day: Date) => {
    e.preventDefault();
    if (!draft.trim()) return;
    await onCreate(draft.trim(), new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString());
    setDraft('');
    setAddingOn(null);
  };

  return (
    <div className="px-6 pb-8">
      <div className="flex flex-wrap items-center gap-2 py-3">
        <button
          type="button"
          onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
          className="rounded-md border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
        >
          Today
        </button>
        <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronLeft size={18} /></button>
        <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronRight size={18} /></button>
        <h3 className="ml-1 text-lg font-semibold text-gray-900">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>

        <span className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600">{summary.total} scheduled</span>
          {summary.overdue > 0 && <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-700">{summary.overdue} overdue</span>}
          {summary.done > 0 && <span className="rounded-full bg-teal-50 px-2.5 py-1 font-medium text-teal-700">{summary.done} done</span>}
          {unscheduled > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700" title="Tasks with no start or due date cannot be placed on a calendar">
              <CalendarClock size={12} /> {unscheduled} undated
            </span>
          )}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50/80">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={`px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide ${i > 4 ? 'text-gray-400' : 'text-gray-500'}`}>
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day, index) => {
            const key = dayKey(day);
            const inMonth = day.getMonth() === month.getMonth();
            const weekend = day.getDay() === 0 || day.getDay() === 6;
            const items = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            const open = expanded === key;
            const shown = open ? items : items.slice(0, SHOWN_PER_DAY);
            const late = items.filter((t) => t.is_overdue).length;

            return (
              <div
                key={key}
                onDragOver={(e) => { e.preventDefault(); setDragOver(key); }}
                onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
                onDrop={(e) => drop(e, day)}
                style={{ minHeight: open ? undefined : ROW_PX }}
                className={`group/day relative flex flex-col border-b border-r border-gray-100 p-1.5 ${
                  index % 7 === 6 ? 'border-r-0' : ''} ${
                  !inMonth ? 'bg-gray-50/70' : weekend ? 'bg-gray-50/40' : 'bg-white'} ${
                  dragOver === key ? 'ring-2 ring-inset ring-teal-400' : ''}`}
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <span className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs ${
                    isToday ? 'bg-sky-600 font-semibold text-white'
                      : inMonth ? 'font-medium text-gray-700' : 'text-gray-400'}`}>
                    {day.getDate()}
                  </span>
                  {/* How busy the day is, before any of it is read. */}
                  {items.length > 0 && (
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-gray-100" title={`${items.length} task${items.length === 1 ? '' : 's'}`}>
                      <span
                        className={`block h-full rounded-full ${
                          late ? 'bg-red-500' : items.length >= busiest * 0.7 ? 'bg-orange-400' : 'bg-teal-400'}`}
                        style={{ width: `${(items.length / busiest) * 100}%` }}
                      />
                    </span>
                  )}
                  {canCreate && (
                    <button
                      type="button"
                      aria-label={`Add a task due ${day.toDateString()}`}
                      onClick={() => setAddingOn(key)}
                      className="ml-auto rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-600 group-hover/day:opacity-100"
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-1">
                  {shown.map((t) => {
                    const done = isDone(t);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        draggable={t.permission_level === 'edit' || t.permission_level === 'full'}
                        onDragStart={(e) => e.dataTransfer.setData('text/task-id', t.id)}
                        onClick={() => onOpenTask(t.id)}
                        title={`${t.name}${t.status ? ` — ${t.status.name}` : ''}`}
                        className={`relative w-full overflow-hidden rounded-md border py-1 pl-2 pr-1.5 text-left shadow-[0_1px_1px_rgba(0,0,0,0.03)] transition-shadow hover:shadow-md ${
                          t.is_overdue ? 'border-red-300 bg-red-100/80'
                            : done ? 'border-gray-200 bg-gray-50'
                            : t.priority ? PRIORITY_CARD[t.priority]
                            : 'border-gray-200 bg-white'}`}
                      >
                        {/* The status colour as a spine, rather than a wash that makes the name
                            hard to read. */}
                        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: t.status.color }} />
                        <span className="flex items-center gap-1">
                          {t.priority ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[t.priority]}`} /> : null}
                          <span className={`min-w-0 flex-1 truncate text-[11px] font-medium ${
                            done ? 'text-gray-400 line-through' : t.is_overdue ? 'text-red-900' : 'text-gray-800'}`}>
                            {t.name}
                          </span>
                          {t.assignees.slice(0, 1).map((u) => <Avatar key={u.id} user={u} size={13} />)}
                        </span>
                        {(t.time_estimate_seconds || t.is_overdue) && (
                          <span className="mt-0.5 flex items-center gap-1 text-[10px]">
                            {t.is_overdue && <span className="font-medium text-red-600">overdue</span>}
                            {!!t.time_estimate_seconds && <span className="text-gray-400">{formatDuration(t.time_estimate_seconds)}</span>}
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {items.length > SHOWN_PER_DAY && (
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : key)}
                      className="rounded px-1 py-0.5 text-left text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                    >
                      {open ? 'Show less' : `+${items.length - SHOWN_PER_DAY} more`}
                    </button>
                  )}

                  {addingOn === key && (
                    <form onSubmit={(e) => create(e, day)}>
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => !draft && setAddingOn(null)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(''); setAddingOn(null); } }}
                        placeholder="Task name"
                        className="w-full rounded-md border border-teal-400 px-1.5 py-1 text-[11px] focus:outline-none"
                      />
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-gray-400">
        Tasks sit on their due date, or their start date when they have no due date. Drag one to move it — its length is kept.
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />urgent</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-500" />high</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" />normal</span>
      </p>
    </div>
  );
};
