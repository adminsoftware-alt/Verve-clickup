// "What does my week look like" — the Workload view for My Tasks.
//
// A day is a container of a fixed size, and work is what you pour into it. So that is what a day
// looks like here: a glass that fills from the bottom, one per day, and you can see at a glance
// which ones are empty, which are comfortable and which have spilled over. A number alone
// ("8.6h") does not say whether that is a full day or half of one; a level does, without being
// read.
//
// Above the glasses, four figures say what the whole window holds. Below them, your tasks, each
// with its share of each day.
//
// Same rules as ClickUp — an estimate is divided over the working days between its start and due
// dates, only open work is scheduled, and the day is measured against your real capacity (working
// hours less holidays and approved leave).
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarOff, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Circle, Droplets, Flag,
  FolderTree, Gauge, Layers, ListOrdered, Timer, TrendingUp, TriangleAlert,
} from 'lucide-react';

import { useWork } from '../WorkContext';
import { workApi, type Workload } from '../api';
import { Avatar, StatusDot, formatDuration } from '../ui';
import { TaskRowsSkeleton } from '../Skeleton';
import { TwoStepFilter, type FilterField } from './TwoStepFilter';

/** The spans the Range field offers, plus a custom one you type. */
const RANGES: { value: string; label: string; days: number }[] = [
  { value: '7', label: 'This week', days: 7 },
  { value: '14', label: 'Two weeks', days: 14 },
  { value: '28', label: 'Four weeks', days: 28 },
];

const PRIORITY_NAMES: Record<number, { label: string; color: string }> = {
  1: { label: 'Urgent', color: '#ef4444' },
  2: { label: 'High', color: '#f59e0b' },
  3: { label: 'Normal', color: '#0ea5e9' },
  4: { label: 'Low', color: '#9ca3af' },
};

const DAY_MS = 86_400_000;
/** How tall a day's glass is. Tall enough that a quarter of it is still visible as a level. */
const GLASS_PX = 64;

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The Monday on or before a date: a week that starts mid-week is hard to read. */
function mondayOf(d: Date): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Hours, short: "" for nothing, "45m", "1h", "1.5h". */
function hoursShort(seconds: number): string {
  if (seconds <= 0) return '';
  const h = seconds / 3600;
  if (h < 1) return `${Math.round(seconds / 60)}m`;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

const hours = (seconds: number) => formatDuration(seconds) || '0h';

type Level = 'empty' | 'light' | 'full' | 'over' | 'closed';

/** How full a day is. The same bands ClickUp uses for a WIP limit. */
function levelOf(scheduled: number, capacity: number): Level {
  if (capacity <= 0) return 'closed';
  if (scheduled <= 0) return 'empty';
  if (scheduled > capacity) return 'over';
  return scheduled >= capacity * 0.8 ? 'full' : 'light';
}

const WATER: Record<Level, { glass: string; fill: string; text: string }> = {
  closed: { glass: 'border-gray-100 bg-[repeating-linear-gradient(135deg,#f9fafb_0_6px,#f3f4f6_6px_12px)]', fill: '', text: 'text-gray-300' },
  empty: { glass: 'border-gray-200 bg-gray-50/60', fill: '', text: 'text-gray-400' },
  light: { glass: 'border-teal-200 bg-teal-50/40', fill: 'bg-gradient-to-t from-teal-500 to-teal-300', text: 'text-teal-900' },
  full: { glass: 'border-amber-200 bg-amber-50/40', fill: 'bg-gradient-to-t from-amber-500 to-amber-300', text: 'text-amber-900' },
  over: { glass: 'border-red-300 bg-red-50/60', fill: 'bg-gradient-to-t from-red-600 to-red-400', text: 'text-red-800' },
};

export const MyWorkloadView: React.FC<{
  onOpenTask: (id: string) => void;
  listName: (listId: string) => string | null;
}> = ({ onOpenTask, listName }) => {
  const { workspace } = useWork();
  const [start, setStart] = useState(() => mondayOf(new Date()));
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Workload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  // Narrowed here rather than on the server: the window is one person's fortnight, so the rows
  // are already in hand and a round trip per tick would buy nothing.
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  // A span the presets do not cover, typed in the Range field.
  const [customDays, setCustomDays] = useState('');

  useEffect(() => {
    if (!workspace) return;
    setError(null);
    setData(null);
    workApi.myWorkload(workspace.id, isoDate(start), days)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [workspace, start, days]);

  const row = data?.rows?.[0];
  const dates = useMemo(() => (data?.days ?? []).map((d) => new Date(`${d}T00:00:00`)), [data]);
  const today = isoDate(new Date());

  const sums = useMemo(() => {
    const add = (xs: number[]) => xs.reduce((n, v) => n + v, 0);
    const planned = row ? add(row.scheduled_seconds) : 0;
    const capacity = row ? add(row.capacity_seconds) : 0;
    const overDays = row
      ? row.capacity_seconds.filter((cap, i) => cap > 0 && row.scheduled_seconds[i] > cap).length
      : 0;
    const workingDays = row ? row.capacity_seconds.filter((c) => c > 0).length : 0;
    return { planned, capacity, free: Math.max(0, capacity - planned), overDays, workingDays };
  }, [row]);

  const step = (by: number) => setStart(new Date(start.getTime() + by * days * DAY_MS));

  // Only the tasks that actually land in these days, heaviest first: a row of nothing but
  // dashes is what made the grid unreadable.
  const all = useMemo(() => {
    const rows = (row?.tasks ?? []).map((t) => ({ t, total: t.seconds_per_day.reduce((n, v) => n + v, 0) }));
    return rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  }, [row]);

  const fields: FilterField[] = useMemo(() => {
    const statuses = new Map<string, { value: string; label: string; color: string }>();
    const lists = new Map<string, { value: string; label: string }>();
    const priorities = new Set<number>();
    for (const { t } of all) {
      statuses.set(t.status.name.toLowerCase(), { value: t.status.name.toLowerCase(), label: t.status.name, color: t.status.color });
      const where = (listName(t.list_id) ?? '').split(' / ').slice(-1)[0];
      if (where) lists.set(t.list_id, { value: t.list_id, label: where });
      if (t.priority) priorities.add(t.priority);
    }
    return [
      {
        key: 'range',
        label: 'Range',
        Icon: CalendarRange,
        single: true,
        options: RANGES.map((r) => ({ value: r.value, label: `${r.label} (${r.days} days)` })),
        selected: [String(days)],
      },
      { key: 'status', label: 'Status', Icon: Circle, options: [...statuses.values()], selected: picked.status ?? [] },
      {
        key: 'priority',
        label: 'Priority',
        Icon: Flag,
        options: [...priorities].sort().map((p) => ({ value: String(p), ...PRIORITY_NAMES[p] })),
        selected: picked.priority ?? [],
      },
      { key: 'list', label: 'List', Icon: FolderTree, options: [...lists.values()], selected: picked.list ?? [] },
    ];
  }, [all, picked, listName, days]);

  const tasks = useMemo(() => all.filter(({ t }) => {
    const byStatus = picked.status?.length ? picked.status.includes(t.status.name.toLowerCase()) : true;
    const byPriority = picked.priority?.length ? picked.priority.includes(String(t.priority ?? '')) : true;
    const byList = picked.list?.length ? picked.list.includes(t.list_id) : true;
    return byStatus && byPriority && byList;
  }), [all, picked]);

  const toggle = (field: FilterField, value: string) => {
    // The Range is the window the view is read over, not a property of the work in it, so it is
    // saved on the view rather than in the set of picked values.
    if (field.key === 'range') { setDays(Number(value)); setCustomDays(''); return; }
    setPicked((prev) => {
      const on = prev[field.key] ?? [];
      const next = on.includes(value) ? on.filter((x) => x !== value) : [...on, value];
      return { ...prev, [field.key]: next };
    });
  };

  /**
   * The three things a person actually asks of their own week: what is taking the most of it,
   * which days have tipped over, and where there is still room.
   *
   * All three come off the same numbers as the grid; they are here because a grid answers
   * "how much on each day" and none of these are that question.
   */
  const insights = useMemo(() => {
    const heaviest = tasks.slice(0, 4);
    const bottlenecks = dates.map((d, i) => ({
      date: d,
      planned: row?.scheduled_seconds[i] ?? 0,
      capacity: row?.capacity_seconds[i] ?? 0,
    })).filter((x) => x.capacity > 0 && x.planned > x.capacity);
    // Only days still to come: room in a day that has already gone is not room.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const open = dates.map((d, i) => ({
      date: d,
      planned: row?.scheduled_seconds[i] ?? 0,
      capacity: row?.capacity_seconds[i] ?? 0,
    })).filter((x) => x.capacity > 0 && x.date >= startOfToday && x.planned < x.capacity / 2);
    return { heaviest, bottlenecks, open: open.slice(0, 5) };
  }, [tasks, dates, row]);

  const months = useMemo(() => {
    const out: { label: string; span: number }[] = [];
    for (const d of dates) {
      const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      if (out.length && out[out.length - 1].label === label) out[out.length - 1].span += 1;
      else out.push({ label, span: 1 });
    }
    return out;
  }, [dates]);

  // The task column is wide and fixed: a name that wraps under the glasses is what pushed the
  // hours out of their columns.
  const grid = { gridTemplateColumns: `320px repeat(${dates.length || days}, minmax(56px, 1fr))` };
  const over = sums.planned > sums.capacity && sums.capacity > 0;

  if (error) return <p className="m-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;

  return (
    <div className="px-6 pb-8">
      {/* --- what the window holds, before any of the detail ---------------------------------- */}
      <div className="grid gap-3 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          tone="slate" Icon={Gauge} label="Capacity"
          value={hours(sums.capacity)}
          note={`${sums.workingDays} working day${sums.workingDays === 1 ? '' : 's'} in view`}
        />
        <Stat
          tone={over ? 'red' : 'teal'} Icon={Droplets} label="Planned"
          value={hours(sums.planned)}
          note={sums.capacity ? `${Math.round((sums.planned / sums.capacity) * 100)}% of capacity` : 'no capacity in view'}
          share={sums.capacity ? sums.planned / sums.capacity : 0}
        />
        <Stat
          tone={over ? 'red' : 'sky'} Icon={Layers} label={over ? 'Over by' : 'Still free'}
          value={over ? hours(sums.planned - sums.capacity) : hours(sums.free)}
          note={over ? 'more planned than you have' : 'room left in these days'}
        />
        <Stat
          tone={sums.overDays ? 'orange' : 'slate'} Icon={TriangleAlert} label="Days over"
          value={String(sums.overDays)}
          note={sums.overDays ? 'these days have spilled over' : 'no day is overloaded'}
        />
      </div>

      {/* --- the window itself ---------------------------------------------------------------- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setStart(mondayOf(new Date()))}
          className="rounded-md border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
        >
          Today
        </button>
        <button type="button" title="Earlier" onClick={() => step(-1)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronLeft size={18} /></button>
        <button type="button" title="Later" onClick={() => step(1)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronRight size={18} /></button>
        <span className="text-sm font-medium text-gray-700">
          {start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – {
            new Date(start.getTime() + (days - 1) * DAY_MS).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <TwoStepFilter
            fields={fields}
            onToggle={toggle}
            onClear={(f) => (f.key === 'range' ? setDays(7) : setPicked((prev) => ({ ...prev, [f.key]: [] })))}
            onClearAll={() => { setPicked({}); setDays(7); }}
            align="right"
            footer={(field) => (field.key === 'range' ? (
              <form
                className="flex items-center gap-1.5 border-t border-gray-100 px-3 py-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = Number(customDays);
                  if (Number.isFinite(n) && n >= 1 && n <= 92) setDays(Math.round(n));
                }}
              >
                <input
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  placeholder="Custom"
                  aria-label="Custom number of days"
                  inputMode="numeric"
                  className="w-16 rounded-md border border-gray-300 px-2 py-1 text-[13px]"
                />
                <span className="flex-1 text-[11px] text-gray-400">days, up to 92</span>
                <button type="submit" className="rounded-md bg-teal-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-700">
                  Apply
                </button>
              </form>
            ) : null)}
          />
        </span>

      </div>

      {!data ? <TaskRowsSkeleton rows={5} /> : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm" role="table" aria-label="My workload">
            {/* Which months these days belong to. */}
            <div className="grid border-b border-gray-100" style={grid} role="row">
              <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Work</div>
              {months.map((m) => (
                <div key={m.label} className="px-2 py-1.5 text-sm font-semibold text-gray-800" style={{ gridColumn: `span ${m.span} / span ${m.span}` }}>
                  {m.label}
                </div>
              ))}
            </div>

            {/* The days. Today is circled; weekends are greyed. */}
            <div className="grid border-b border-gray-200 bg-gray-50/70" style={grid} role="row">
              <div className="px-3 py-2 text-xs font-medium text-gray-500">Person</div>
              {dates.map((d) => {
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                const isToday = isoDate(d) === today;
                return (
                  <div
                    key={d.toISOString()}
                    className={`flex flex-col items-center gap-0.5 py-1.5 text-[11px] ${weekend ? 'bg-gray-100/70' : ''}`}
                  >
                    <span className={weekend ? 'text-gray-400' : 'text-gray-500'}>
                      {d.toLocaleDateString(undefined, { weekday: 'short' })}
                    </span>
                    <span className={isToday
                      ? 'flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 font-semibold text-white'
                      : `font-medium ${weekend ? 'text-gray-400' : 'text-gray-700'}`}>
                      {d.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Your row: one glass per day. */}
            <div className="grid items-stretch border-b border-gray-100 bg-white" style={grid} role="row">
              <button
                type="button"
                onClick={() => setOpen(!open)}
                className="flex min-w-0 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                {tasks.length ? (open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />) : <span className="w-3.5" />}
                {row?.user ? <Avatar user={row.user} size={26} /> : <span className="h-[26px] w-[26px] rounded-full bg-gray-200" />}
                <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">
                  {row?.user ? row.user.display_name || row.user.email : 'Me'}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  over ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                  {hoursShort(sums.planned) || '0h'}/{hoursShort(sums.capacity) || '0h'}
                </span>
              </button>
              {dates.map((d, i) => (
                <Glass
                  key={d.toISOString()}
                  planned={row?.scheduled_seconds[i] ?? 0}
                  capacity={row?.capacity_seconds[i] ?? 0}
                />
              ))}
            </div>

            {/* The tasks behind those levels. */}
            {open && (tasks.length ? tasks.map(({ t, total }) => {
              // The full path can be "Space / Folder / List"; the last two segments are what
              // actually tell one task's home from another's.
              const where = (listName(t.list_id) ?? '').split(' / ').slice(-2).join(' / ');
              const priority = t.priority ? PRIORITY_NAMES[t.priority] : undefined;
              return (
                <div key={t.id} className="group grid items-stretch border-b border-gray-50 text-xs last:border-b-0 hover:bg-gray-50/60" style={grid} role="row">
                  <button
                    type="button"
                    onClick={() => onOpenTask(t.id)}
                    className="flex min-w-0 items-center gap-2.5 py-2 pl-9 pr-3 text-left"
                    title={where ? `${t.name} — ${where}` : t.name}
                  >
                    <StatusDot status={t.status} size={11} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-gray-800 group-hover:text-gray-950">{t.name}</span>
                      {/* Where it lives and how urgent it is share the second line, so the name
                          never has to compete with them for the first. */}
                      <span className="mt-0.5 flex items-center gap-1.5">
                        {priority && (
                          <span className="flex shrink-0 items-center gap-1 text-[10px] text-gray-400">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: priority.color }} />
                            {priority.label}
                          </span>
                        )}
                        {where && <span className="min-w-0 truncate text-[11px] text-gray-400">{where}</span>}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600 group-hover:bg-gray-200">
                      {hoursShort(total)}
                    </span>
                  </button>
                  {/* A day's share as a soft pill rather than a bare number: the row then reads
                      as a shape across the week before any of it is read as figures. */}
                  {t.seconds_per_day.map((v, i) => (
                    <div key={i} className="flex items-center justify-center px-1 py-1.5">
                      {v ? (
                        <span className="w-full rounded-md bg-teal-50 py-1 text-center text-[11px] font-semibold tabular-nums text-teal-800 ring-1 ring-teal-100">
                          {hoursShort(v)}
                        </span>
                      ) : (
                        <span className="text-gray-200">·</span>
                      )}
                    </div>
                  ))}
                </div>
              );
            }) : (
              <div className="px-3 py-8 text-center text-sm text-gray-400">
                {all.length ? 'Nothing matches these filters.' : 'Nothing of yours falls in these days.'}
              </div>
            ))}
          </div>

          <p className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-400">
            Each task's estimate is spread evenly over the working days between its start and due dates.
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-teal-400" />under 80%</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-amber-400" />80–100%</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-red-500" />over capacity</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-gray-200" />not a working day</span>
          </p>

          {/* Work that cannot be placed in a day is the reason the glasses look emptier than the
              week feels, so it is named rather than silently dropped. */}
          {(data.unscheduled.length > 0 || data.no_estimate.length > 0) && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {data.unscheduled.length > 0 && (
                <Aside icon={<CalendarOff size={13} />} title={`${data.unscheduled.length} with no dates`}
                  note="Give these a start and due date and they will take their place in the week."
                  items={data.unscheduled} onOpenTask={onOpenTask} />
              )}
              {data.no_estimate.length > 0 && (
                <Aside icon={<Timer size={13} />} title={`${data.no_estimate.length} with no estimate`}
                  note="Scheduled, but with no size there is nothing to spread across the days."
                  items={data.no_estimate} onOpenTask={onOpenTask} />
              )}
            </div>
          )}
        </div>

        <aside className="min-w-0" aria-label="Personal insights">
          <h3 className="mb-2 text-base font-semibold text-gray-900">Personal insights</h3>
          <div className="space-y-3">
            <Insight Icon={ListOrdered} tint="text-brand-600" title="Heaviest work"
              note="What is taking the most of these days.">
              {insights.heaviest.length === 0 ? (
                <Quiet>Nothing of yours falls in this period.</Quiet>
              ) : (
                <ul className="space-y-1">
                  {insights.heaviest.map(({ t, total }) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => onOpenTask(t.id)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-50">
                        <StatusDot status={t.status} size={10} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-gray-700">{t.name}</span>
                        <span className="shrink-0 text-[12px] font-medium text-gray-900">{hoursShort(total)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Insight>

            <Insight Icon={TriangleAlert} tint="text-red-600" title="Daily bottlenecks"
              note="Days with more planned than you have.">
              {insights.bottlenecks.length === 0 ? (
                <p className="px-2 py-1 text-[13px] font-medium text-teal-700">No day has tipped over.</p>
              ) : (
                <ul className="space-y-1">
                  {insights.bottlenecks.map((b) => (
                    <li key={b.date.toISOString()} className="flex items-center gap-2 rounded-md bg-red-50 px-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-red-900">
                        {b.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
                      </span>
                      <span className="shrink-0 text-[12px] font-semibold text-red-700">
                        +{hoursShort(b.planned - b.capacity)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Insight>

            <Insight Icon={TrendingUp} tint="text-teal-600" title="Open slots"
              note="Days still to come that are under half booked.">
              {insights.open.length === 0 ? (
                <Quiet>Nothing spare in the days ahead.</Quiet>
              ) : (
                <ul className="space-y-1">
                  {insights.open.map((o) => (
                    <li key={o.date.toISOString()} className="flex items-center gap-2 rounded-md bg-teal-50 px-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-teal-900">
                        {o.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
                      </span>
                      <span className="shrink-0 text-[12px] font-semibold text-teal-700">
                        {hoursShort(o.capacity - o.planned)} free
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Insight>
          </div>
        </aside>
        </div>
      )}
    </div>
  );
};

const Insight: React.FC<{
  Icon: React.ElementType; tint: string; title: string; note: string; children: React.ReactNode;
}> = ({ Icon, tint, title, note, children }) => (
  <section className="rounded-xl border border-gray-200 bg-white px-3 py-3 shadow-sm">
    <h4 className="flex items-center gap-2 text-[15px] font-semibold text-gray-900">
      <Icon size={16} className={tint} /> {title}
    </h4>
    <p className="mb-2 mt-0.5 text-[12px] text-gray-500">{note}</p>
    {children}
  </section>
);

const Quiet: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-2 py-1 text-[13px] text-gray-400">{children}</p>
);

/** One day, as a container filling up. Over capacity it is full and red, with the spill named. */
const Glass: React.FC<{ planned: number; capacity: number }> = ({ planned, capacity }) => {
  const level = levelOf(planned, capacity);
  const skin = WATER[level];
  const share = capacity > 0 ? Math.min(1, planned / capacity) : 0;
  const title = capacity <= 0
    ? 'Not a working day'
    : `${hours(planned)} planned of ${hours(capacity)}${planned > capacity ? ` — ${hours(planned - capacity)} over` : ''}`;

  return (
    <div className={'p-1.5'}>
      <div
        title={title}
        role="meter"
        aria-label={title}
        aria-valuenow={Math.round(share * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className={`relative flex items-end justify-center overflow-hidden rounded-lg border ${skin.glass}`}
        style={{ height: GLASS_PX }}
      >
        {/* The water. It rises from the bottom, which is the only direction a level reads in. */}
        {share > 0 && (
          <span
            aria-hidden
            className={`absolute inset-x-0 bottom-0 ${skin.fill} transition-[height] duration-300`}
            style={{ height: `${Math.max(8, share * 100)}%` }}
          >
            {/* A lighter band at the surface, so the level has an edge to read against. */}
            <span className="absolute inset-x-0 top-0 h-[3px] bg-white/45" />
          </span>
        )}
        <span className={`relative w-full pb-1 text-center text-[11px] font-semibold ${
          share > 0.55 ? 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]' : skin.text}`}>
          {capacity <= 0 ? '' : hoursShort(planned) || '0h'}
        </span>
      </div>
    </div>
  );
};

const STAT_TONES = {
  slate: { card: 'border-slate-200 bg-slate-50', badge: 'bg-slate-500 text-white', bar: 'bg-slate-400', value: 'text-slate-900' },
  teal: { card: 'border-teal-200 bg-teal-50', badge: 'bg-teal-600 text-white', bar: 'bg-teal-500', value: 'text-teal-900' },
  sky: { card: 'border-sky-200 bg-sky-50', badge: 'bg-sky-600 text-white', bar: 'bg-sky-500', value: 'text-sky-900' },
  amber: { card: 'border-amber-200 bg-amber-50', badge: 'bg-amber-500 text-white', bar: 'bg-amber-500', value: 'text-amber-900' },
  orange: { card: 'border-orange-200 bg-orange-50', badge: 'bg-orange-500 text-white', bar: 'bg-orange-500', value: 'text-orange-900' },
  red: { card: 'border-red-200 bg-red-50', badge: 'bg-red-600 text-white', bar: 'bg-red-500', value: 'text-red-900' },
} as const;

const Stat: React.FC<{
  tone: keyof typeof STAT_TONES; Icon: React.ElementType; label: string; value: string; note: string;
  /** Drawn as a bar under the number when the figure is a share of something. */
  share?: number;
}> = ({ tone, Icon, label, value, note, share }) => {
  const skin = STAT_TONES[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 shadow-sm ${skin.card}`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-sm ${skin.badge}`}><Icon size={15} /></span>
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      </div>
      <p className={`mt-2 text-2xl font-semibold leading-none ${skin.value}`}>{value}</p>
      {share !== undefined && (
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-black/10">
          <span className={`block h-full rounded-full ${skin.bar}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
        </span>
      )}
      <p className="mt-1.5 truncate text-[11px] text-gray-600/90">{note}</p>
    </div>
  );
};

const Aside: React.FC<{
  icon: React.ReactNode; title: string; note: string;
  items: { id: string; name: string }[]; onOpenTask: (id: string) => void;
}> = ({ icon, title, note, items, onOpenTask }) => (
  <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
    <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">{icon}{title}</p>
    <p className="mt-0.5 text-[11px] text-amber-700/90">{note}</p>
    <ul className="mt-1.5 space-y-0.5">
      {items.slice(0, 6).map((t) => (
        <li key={t.id}>
          <button type="button" onClick={() => onOpenTask(t.id)}
            className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs text-gray-700 hover:bg-amber-100/70">
            <AlertTriangle size={11} className="shrink-0 text-amber-500" />
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
          </button>
        </li>
      ))}
      {items.length > 6 && <li className="px-1 text-[11px] text-amber-700/80">and {items.length - 6} more</li>}
    </ul>
  </div>
);
