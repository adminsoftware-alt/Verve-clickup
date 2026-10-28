// "What does my week look like" — the Workload view for My Tasks.
//
// A day is a container of a fixed size, and work is what you pour into it: one level per day, so
// you see at a glance which days are empty, comfortable or over. Under each level the numbers are
// written out -- planned of capacity, what spilled over, what you actually logged -- so nothing
// waits behind a hover.
//
// Above the days, one line says what the whole window holds. Below them, your tasks, each with
// its share of each day. Click a day for what is on it.
//
// Same rules as ClickUp — an estimate is divided over the working days between its start and due
// dates, only open work is scheduled, and the day is measured against your real capacity (working
// hours less company holidays).
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Circle, Flag, FolderTree, Timer, X } from 'lucide-react';

import { useWork } from '../WorkContext';
import { workApi, type Workload } from '../api';
import { planningApi } from '../planningApi';
import { Avatar, Portal, StatusDot, formatDuration, parseDuration } from '../ui';
import { TaskRowsSkeleton } from '../Skeleton';
import { TwoStepFilter, type FilterField } from './TwoStepFilter';
import { notify } from '../../components/notify';

/** The spans offered beside the dates. */
const RANGES: { days: number; label: string }[] = [
  { days: 7, label: 'Week' },
  { days: 14, label: '2 weeks' },
  { days: 28, label: '4 weeks' },
];

const PRIORITY_NAMES: Record<number, { label: string; color: string }> = {
  1: { label: 'Urgent', color: '#ef4444' },
  2: { label: 'High', color: '#f59e0b' },
  3: { label: 'Normal', color: '#0ea5e9' },
  4: { label: 'Low', color: '#9ca3af' },
};

const DAY_MS = 86_400_000;
/** How tall a day's level is. Tall enough that a quarter of it is still visible. */
const GLASS_PX = 56;

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

/** How full a day is: under 80%, 80–100%, over. */
function levelOf(scheduled: number, capacity: number): Level {
  if (capacity <= 0) return 'closed';
  if (scheduled <= 0) return 'empty';
  if (scheduled > capacity) return 'over';
  return scheduled >= capacity * 0.8 ? 'full' : 'light';
}

/** Flat colours: the navy for a comfortable day, amber nearly full, red over. */
const FILL: Record<Level, string> = { closed: '', empty: '', light: '#234788', full: '#D97706', over: '#DC2626' };
/** The water's lighter surface colour, over the deeper colour at the bottom of the bowl. */
const SURFACE: Record<Level, string> = { closed: '', empty: '', light: '#5A7DB6', full: '#FBBF24', over: '#F87171' };

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
  const [reload, setReload] = useState(0);
  // The day opened in the side panel, by its index in the window.
  const [dayOpen, setDayOpen] = useState<number | null>(null);

  useEffect(() => {
    if (!workspace) return;
    setError(null);
    setData(null);
    workApi.myWorkload(workspace.id, isoDate(start), days)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [workspace, start, days, reload]);
  useEffect(() => setDayOpen(null), [start, days]);

  const row = data?.rows?.[0];
  const dates = useMemo(() => (data?.days ?? []).map((d) => new Date(`${d}T00:00:00`)), [data]);
  const today = isoDate(new Date());
  const todayIndex = dates.findIndex((d) => isoDate(d) === today);
  const tracked = data?.tracked_seconds ?? [];
  const notes = data?.day_notes ?? [];

  const sums = useMemo(() => {
    const add = (xs: number[]) => xs.reduce((n, v) => n + v, 0);
    return { planned: row ? add(row.scheduled_seconds) : 0, capacity: row ? add(row.capacity_seconds) : 0 };
  }, [row]);
  // A weekend is a day like any other here -- people plan work on them too. With no hours of its
  // own, it is measured against an ordinary working day.
  const usualDay = useMemo(() => Math.max(0, ...(row?.capacity_seconds ?? [0])) || 8 * 3600, [row]);

  const step = (by: number) => setStart(new Date(start.getTime() + by * days * DAY_MS));

  // Only the tasks that actually land in these days, heaviest first.
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
  }, [all, picked, listName]);

  const tasks = useMemo(() => all.filter(({ t }) => {
    const byStatus = picked.status?.length ? picked.status.includes(t.status.name.toLowerCase()) : true;
    const byPriority = picked.priority?.length ? picked.priority.includes(String(t.priority ?? '')) : true;
    const byList = picked.list?.length ? picked.list.includes(t.list_id) : true;
    return byStatus && byPriority && byList;
  }), [all, picked]);

  const toggle = (field: FilterField, value: string) => {
    setPicked((prev) => {
      const on = prev[field.key] ?? [];
      const next = on.includes(value) ? on.filter((x) => x !== value) : [...on, value];
      return { ...prev, [field.key]: next };
    });
  };

  const months = useMemo(() => {
    const out: { label: string; span: number }[] = [];
    for (const d of dates) {
      const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      if (out.length && out[out.length - 1].label === label) out[out.length - 1].span += 1;
      else out.push({ label, span: 1 });
    }
    return out;
  }, [dates]);

  // The task column is wide and fixed: a name that wraps under the days is what pushed the
  // hours out of their columns.
  const grid = { gridTemplateColumns: `300px repeat(${dates.length || days}, minmax(60px, 1fr))` };
  const over = sums.planned > sums.capacity && sums.capacity > 0;
  /** Today's column carries a light navy band the whole way down. */
  const band = (i: number) => (i === todayIndex ? 'bg-[#F3F6FB]' : '');

  if (error) return <p className="m-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;

  return (
    <div className="px-6 pb-8">
      {/* --- the window: dates, span, filter, and the key -------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 py-4">
        <button
          type="button"
          onClick={() => setStart(mondayOf(new Date()))}
          className="vf-tool rounded-md px-3 py-1 text-sm"
        >
          Today
        </button>
        {/* ‹ the dates › -- the arrows sit either side of what they move. */}
        <span className="flex items-center gap-0.5">
          <button aria-label="Earlier" type="button" onClick={() => step(-1)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronLeft size={18} /></button>
          <span className="px-1 text-sm font-semibold text-[#1B2A4A]">
            {start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – {
              new Date(start.getTime() + (days - 1) * DAY_MS).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <button aria-label="Later" type="button" onClick={() => step(1)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronRight size={18} /></button>
        </span>
        <span role="group" aria-label="Span" className="ml-2 flex rounded-lg border border-[#D9E1EF] bg-white p-0.5">
          {RANGES.map((r) => (
            <button key={r.days} type="button" aria-pressed={days === r.days} onClick={() => setDays(r.days)}
              className={`rounded-md px-2.5 py-0.5 text-[13px] ${days === r.days ? 'bg-brand-600 font-medium text-white' : 'text-gray-600 hover:bg-[#EEF2F8]'}`}>
              {r.label}
            </button>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-2.5 text-[11px] text-gray-500 lg:flex">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#234788]" />under 80%</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#D97706]" />80–100%</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#DC2626]" />over</span>
            <span className="inline-flex items-center gap-1"><span className="h-0 w-3 border-t-2 border-dashed border-[#1B2A4A]" />logged</span>
          </span>
          <TwoStepFilter
            fields={fields}
            onToggle={toggle}
            onClear={(f) => setPicked((prev) => ({ ...prev, [f.key]: [] }))}
            onClearAll={() => setPicked({})}
            align="right"
          />
        </span>
      </div>

      {!data ? <TaskRowsSkeleton rows={5} /> : (
        <div className="min-w-0">
          <div className="overflow-x-auto rounded-xl border border-[#E6E8EC] bg-white" role="table" aria-label="My workload">
            {/* Which months these days belong to. */}
            <div className="grid border-b border-gray-100" style={grid} role="row">
              <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Work</div>
              {months.map((m) => (
                <div key={m.label} className="px-2 py-1.5 text-sm font-semibold text-gray-800" style={{ gridColumn: `span ${m.span} / span ${m.span}` }}>
                  {m.label}
                </div>
              ))}
            </div>

            {/* The days. Today is circled in navy; days off are greyed. Click one to see it. */}
            <div className="grid border-b border-[#E6E8EC]" style={grid} role="row">
              <div />
              {dates.map((d, i) => {
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => setDayOpen(i)}
                    aria-label={`Open ${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`}
                    className={`flex flex-col items-center gap-0.5 py-1.5 text-[11px] hover:bg-[#EEF2F8] ${band(i)}`}
                  >
                    <span className="text-gray-500">
                      {d.toLocaleDateString(undefined, { weekday: 'short' })}
                    </span>
                    <span className={i === todayIndex
                      ? 'flex h-5 w-5 items-center justify-center rounded-full bg-[#234788] font-semibold text-white'
                      : 'font-medium text-gray-700'}>
                      {d.getDate()}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Your row: one level per day, the numbers written under it. */}
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
                  over ? 'bg-red-100 text-red-700' : 'bg-[#EEF2F8] text-[#1C3A70]'}`}>
                  {hoursShort(sums.planned) || '0h'}/{hoursShort(sums.capacity) || '0h'}
                </span>
              </button>
              {dates.map((d, i) => (
                <button key={d.toISOString()} type="button" onClick={() => setDayOpen(i)} className={`text-left ${band(i)}`}
                  aria-label={`Open ${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`}>
                  <Day
                    planned={row?.scheduled_seconds[i] ?? 0}
                    capacity={row?.capacity_seconds[i] ?? 0}
                    usual={usualDay}
                    logged={tracked[i] ?? 0}
                    note={notes[i] ?? null}
                  />
                </button>
              ))}
            </div>

            {/* The tasks behind those levels. */}
            {open && (tasks.length ? tasks.map(({ t, total }) => {
              // The full path can be "Space / Folder / List"; the List is what tells them apart.
              const where = (listName(t.list_id) ?? '').split(' / ').pop();
              const priority = t.priority && t.priority <= 2 ? PRIORITY_NAMES[t.priority] : undefined;
              return (
                <div key={t.id} className="group grid items-stretch border-b border-gray-50 text-xs last:border-b-0 hover:bg-gray-50/60" style={grid} role="row">
                  <button
                    type="button"
                    onClick={() => onOpenTask(t.id)}
                    className="flex min-w-0 items-center gap-2.5 py-2 pl-9 pr-3 text-left"
                  >
                    <StatusDot status={t.status} size={11} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-gray-800 group-hover:text-gray-950">{t.name}</span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        {priority && (
                          <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium" style={{ color: priority.color }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: priority.color }} />
                            {priority.label}
                          </span>
                        )}
                        {where && <span className="min-w-0 truncate rounded bg-[#F2F4F7] px-1.5 text-[11px] text-[#667085]">{where}</span>}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-md bg-[#EEF2F8] px-1.5 py-0.5 text-[11px] font-semibold text-[#1C3A70]">
                      {hoursShort(total)}
                    </span>
                  </button>
                  {t.seconds_per_day.map((v, i) => (
                    <div key={i} className={`flex items-center justify-center px-1 py-1.5 ${band(i)}`}>
                      {v ? (
                        <span className="w-full rounded-md bg-[#EEF2F8] py-1 text-center text-[11px] font-semibold tabular-nums text-[#1C3A70] ring-1 ring-[#D9E1EF]">
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
                {all.length ? 'Nothing matches these filters.' : 'Nothing with dates and an estimate lands in these days.'}
              </div>
            ))}
          </div>

          {/* Work that has dates but no estimate cannot be poured into a day -- the usual reason
              a week looks emptier than it feels. Each one can be sized right here. */}
          {data.no_estimate.length > 0 && (
            <div className="mt-4 max-w-2xl rounded-xl border border-[#E6E8EC] bg-white px-4 py-3">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#1B2A4A]">
                <Timer size={14} className="text-[#2F5699]" />
                {data.no_estimate.length} with no estimate
                <span className="font-normal text-gray-500">— not counted above until they have one</span>
              </p>
              <ul className="mt-2 divide-y divide-gray-100">
                {data.no_estimate.slice(0, 8).map((t) => (
                  <EstimateRow key={t.id} id={t.id} name={t.name} onOpen={() => onOpenTask(t.id)} onSaved={() => setReload((n) => n + 1)} />
                ))}
              </ul>
              {data.no_estimate.length > 8 && <p className="mt-1 text-[11px] text-gray-400">and {data.no_estimate.length - 8} more</p>}
            </div>
          )}
        </div>
      )}

      {data && row && dayOpen !== null && dates[dayOpen] && (
        <DayPanel
          date={dates[dayOpen]}
          planned={row.scheduled_seconds[dayOpen] ?? 0}
          capacity={row.capacity_seconds[dayOpen] ?? 0}
          logged={tracked[dayOpen] ?? 0}
          note={notes[dayOpen] ?? null}
          items={row.tasks.filter((t) => t.seconds_per_day[dayOpen] > 0)
            .map((t) => ({ id: t.id, name: t.name, status: t.status, seconds: t.seconds_per_day[dayOpen], where: (listName(t.list_id) ?? '').split(' / ').pop() ?? '' }))
            .sort((a, b) => b.seconds - a.seconds)}
          onOpenTask={onOpenTask}
          onClose={() => setDayOpen(null)}
        />
      )}
    </div>
  );
};

/** One day: a flat level filling from the bottom, and under it the numbers written out. */
const Day: React.FC<{ planned: number; capacity: number; usual: number; logged: number; note: string | null }> = ({ planned, capacity, usual, logged, note }) => {
  // A day with no hours of its own (a weekend, a holiday) is still a day you can plan into:
  // it is drawn against an ordinary day and never counts as over.
  const own = capacity > 0;
  const scale = own ? capacity : usual;
  const level: Level = own ? levelOf(planned, capacity) : planned > 0 ? 'light' : 'empty';
  const share = Math.min(1, planned / scale);
  const loggedShare = Math.min(1, logged / scale);
  const label = `${hours(planned)} planned${own ? ` of ${hours(capacity)}` : ''}${own && planned > capacity ? `, ${hours(planned - capacity)} over` : ''}${logged ? `, ${hours(logged)} logged` : ''}${note ? `, ${note}` : ''}`;

  return (
    <div className="px-1.5 pb-1.5 pt-1.5" role="meter" aria-label={label} aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
      {(
        // A box, filled from the bottom to how full the day is. Still: nothing moves.
        <div className={`vf-box relative overflow-hidden border ${level === 'over' ? 'border-red-200' : 'border-[#D9E1EF]'}`} style={{ height: GLASS_PX }}>
          {share > 0 && (
            <span aria-hidden className="vf-fill absolute inset-x-0 bottom-0"
              style={{ height: `${Math.max(8, share * 100)}%`, '--deep': FILL[level], '--top': SURFACE[level] } as React.CSSProperties} />
          )}
          {/* What was actually logged: a dashed line at that height. */}
          {logged > 0 && (
            <span aria-hidden className="absolute inset-x-1 border-t-2 border-dashed border-[#1B2A4A]/70"
              style={{ bottom: `${Math.max(2, loggedShare * 100)}%` }} />
          )}
        </div>
      )}
      {(
        <div className="mt-1 text-center leading-tight">
          <p className={`text-[11px] font-semibold tabular-nums ${level === 'over' ? 'text-red-700' : 'text-gray-700'}`}>
            {hoursShort(planned) || '0h'}{own && <span className="font-normal text-gray-400"> / {hoursShort(capacity)}</span>}
          </p>
          {note && <p className="truncate text-[10px] font-medium text-[#2F5699]">{note}</p>}
          {own && planned > capacity && <p className="text-[10px] font-semibold text-red-600">+{hoursShort(planned - capacity)}</p>}
          {logged > 0 && <p className="text-[10px] text-gray-500">{hoursShort(logged)} logged</p>}
        </div>
      )}
    </div>
  );
};

/** A task with dates but no estimate, sized in place: type "2h" and press Enter. */
const EstimateRow: React.FC<{ id: string; name: string; onOpen: () => void; onSaved: () => void }> = ({ id, name, onOpen, onSaved }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const secs = parseDuration(text);
    if (!secs) { notify.error(new Error('Write estimates like 2h or 1h 30m')); return; }
    setBusy(true);
    try { await workApi.updateTask(id, { time_estimate_seconds: secs }); onSaved(); } catch (e) { notify.error(e); setBusy(false); }
  };
  return (
    <li className="flex items-center gap-2 py-1.5">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-[13px] text-gray-700 hover:text-brand-700">{name}</button>
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="flex items-center gap-1">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 2h" aria-label={`Estimate for ${name}`} disabled={busy}
          className="w-20 rounded-md border border-[#D9E1EF] px-2 py-0.5 text-[13px] outline-none focus:border-brand-500" />
        <button type="submit" disabled={busy || !text.trim()} className="rounded-md bg-brand-600 px-2 py-0.5 text-[12px] font-medium text-white disabled:opacity-40">Set</button>
      </form>
    </li>
  );
};

/** One day opened: what is on it, for how long, and a way to block it out in the Planner. */
const DayPanel: React.FC<{
  date: Date; planned: number; capacity: number; logged: number; note: string | null;
  items: { id: string; name: string; status: Workload['rows'][number]['tasks'][number]['status']; seconds: number; where: string }[];
  onOpenTask: (id: string) => void; onClose: () => void;
}> = ({ date, planned, capacity, logged, note, items, onOpenTask, onClose }) => {
  const { workspace } = useWork();
  const [from, setFrom] = useState('09:00');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  /** Blocks out the given tasks one after another from the chosen time, each for its hours that day. */
  const plan = async (which: typeof items) => {
    if (!workspace) return;
    const [h, m] = from.split(':').map(Number);
    let at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m);
    setBusy(true);
    try {
      for (const t of which) {
        const end = new Date(at.getTime() + t.seconds * 1000);
        await planningApi.addBlock(workspace.id, { task_id: t.id, start_at: at.toISOString(), end_at: end.toISOString() });
        at = end;
      }
      notify.ok(which.length === 1 ? 'Added to your Planner' : `Added ${which.length} to your Planner`);
    } catch (e) { notify.error(e); } finally { setBusy(false); }
  };
  return (
    <Portal>
      <div className="fixed inset-0 z-[120] bg-black/10" onClick={onClose} />
      <aside role="dialog" aria-label={date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        className="fixed inset-y-0 right-0 z-[121] flex w-full max-w-sm flex-col border-l border-[#E6E8EC] bg-white shadow-2xl">
        <header className="flex items-start gap-2 border-b border-[#E6E8EC] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-[#1B2A4A]">{date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <p className="mt-0.5 text-[13px] text-gray-500">
              {hours(planned)} planned{capacity > 0 && <> of {hours(capacity)}</>}
              {capacity > 0 && planned > capacity && <b className="text-red-600"> · {hours(planned - capacity)} over</b>} · {hours(logged)} logged
              {note && <> · {note}</>}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={16} /></button>
        </header>
        <ul className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto px-2">
          {items.length === 0 && <li className="px-2 py-10 text-center text-sm text-gray-400">Nothing planned on this day.</li>}
          {items.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-2 py-2">
              <StatusDot status={t.status} size={11} />
              <button type="button" onClick={() => onOpenTask(t.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] font-medium text-gray-800 hover:text-brand-700">{t.name}</span>
                {t.where && <span className="block truncate text-[11px] text-gray-400">{t.where}</span>}
              </button>
              <span className="shrink-0 rounded-md bg-[#EEF2F8] px-1.5 py-0.5 text-[11px] font-semibold text-[#1C3A70]">{hoursShort(t.seconds)}</span>
              <button type="button" disabled={busy} onClick={() => plan([t])} aria-label={`Add ${t.name} to the Planner`}
                className="shrink-0 rounded-md p-1 text-[#2F5699] hover:bg-[#EEF2F8] disabled:opacity-40"><CalendarClock size={15} /></button>
            </li>
          ))}
        </ul>
        {items.length > 0 && (
          <footer className="flex items-center gap-2 border-t border-[#E6E8EC] px-4 py-3">
            <label className="flex items-center gap-1.5 text-[13px] text-gray-600">
              From
              <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Starting at"
                className="rounded-md border border-[#D9E1EF] px-2 py-1 text-[13px] text-gray-800" />
            </label>
            <button type="button" disabled={busy} onClick={() => plan(items)}
              className="ml-auto flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              <CalendarClock size={14} /> Add all to Planner
            </button>
          </footer>
        )}
      </aside>
    </Portal>
  );
};
