// The Battery, Worked on, Goals and Sprint cards.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FEATURES } from '../../config/features';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CheckCircle2, MessageSquare, Pencil, Target, Timer, TrendingDown, TrendingUp } from 'lucide-react';
import type { UserRef } from '../api';
import { Avatar, SearchSelect, formatDuration } from '../ui';
import type { Segment } from './api';
import type { SprintReport } from '../spacesApi';

/** How much of the work is done, as a battery that fills up. */
export const BatteryCard: React.FC<{ total: number; done: number; percent: number; segments: Segment[]; onDrill: (segment: string | undefined, label: string) => void }> = ({ total, done, percent, segments, onDrill }) => (
  <div className="flex h-full flex-col justify-center gap-3 px-2">
    <div className="flex items-center gap-2">
      <div className="relative h-12 flex-1 overflow-hidden rounded-lg border-2 border-gray-300 bg-gray-50" role="meter" aria-label="Done" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="flex h-full">
          {segments.map((sg) => (
            <button key={sg.key} type="button" title={`${sg.label}: ${sg.value}`} onClick={() => onDrill(sg.key, sg.label)}
              style={{ width: `${total ? (100 * sg.value) / total : 0}%`, backgroundColor: sg.color }} className="h-full hover:opacity-80" />
          ))}
        </div>
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-lg font-semibold text-gray-900 drop-shadow-[0_1px_0_rgba(255,255,255,.8)]">{percent}%</span>
      </div>
      <span className="h-5 w-1.5 rounded-r bg-gray-300" aria-hidden="true" />
    </div>
    <p className="text-center text-xs text-gray-500">{done} of {total} task{total === 1 ? '' : 's'} done</p>
    <ul className="flex flex-wrap justify-center gap-3 text-xs text-gray-600">
      {segments.map((sg) => <li key={sg.key} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: sg.color }} />{sg.label} {sg.value}</li>)}
    </ul>
  </div>
);

/** "3 of 10 tasks are left out: 2 have no due date, 1 has no time estimate." */
function missingNote(unplanned: number, tasks: number, noDue?: number, noEstimate?: number): string {
  const lead = `${unplanned} of ${tasks} task${tasks === 1 ? '' : 's'} ${unplanned === 1 ? 'is' : 'are'} left out`;
  if (noDue === undefined || noEstimate === undefined) return `${lead}: ${unplanned === 1 ? 'it has' : 'each has'} no due date, no time estimate, or neither.`;
  const parts = [
    noDue > 0 ? `${noDue} ${noDue === 1 ? 'has' : 'have'} no due date` : null,
    noEstimate > 0 ? `${noEstimate} ${noEstimate === 1 ? 'has' : 'have'} no time estimate` : null,
  ].filter(Boolean);
  return parts.length ? `${lead}: ${parts.join(', ')}.` : `${lead}: their dates fall outside this period.`;
}

/** Workload for a period: what these people can do, what is planned for them, what they logged. */
export const CapacityCard: React.FC<{
  capacity_seconds: number; planned_seconds: number; logged_seconds: number; remaining_seconds: number;
  people: number; tasks: number; scheduled_tasks: number; sees_everyone: boolean;
  /** Of the tasks left out of Planned, how many lack a due date and how many lack an estimate
   *  (a task can lack both). Sent by newer servers; without them the note names both reasons. */
  no_due_date_tasks?: number; no_estimate_tasks?: number;
  onDrill?: (segment: string | undefined, label: string) => void;
}> = ({ capacity_seconds, planned_seconds, logged_seconds, remaining_seconds, people, tasks, scheduled_tasks, sees_everyone, no_due_date_tasks, no_estimate_tasks, onDrill }) => {
  const width = (seconds: number) => `${capacity_seconds ? Math.min(100, (100 * seconds) / capacity_seconds) : 0}%`;
  const over = planned_seconds > capacity_seconds && capacity_seconds > 0;
  const unplanned = Math.max(0, tasks - scheduled_tasks);
  const hours = (seconds: number) => formatDuration(Math.abs(seconds)) || '0h';
  const who = people === 1 ? { you: 'You', have: 'have', re: 'are' } : { you: 'They', have: 'have', re: 'are' };

  /** What the four numbers add up to, said once, in a sentence. */
  const finding = ((): { text: string; tone: string } => {
    if (over) {
      return {
        text: `${hours(planned_seconds - capacity_seconds)} more work is planned than there are hours to do it in. Something has to move.`,
        tone: 'bg-red-50 text-red-700',
      };
    }
    // Logging well over what was planned usually means unplanned work, not slow work.
    if (logged_seconds > planned_seconds * 1.2 && planned_seconds > 0) {
      return {
        text: `${who.you} logged ${hours(logged_seconds - planned_seconds)} more than was planned for — most of that time went on work that was never sized.`,
        tone: 'bg-amber-50 text-amber-800',
      };
    }
    if (planned_seconds > 0 && logged_seconds < planned_seconds * 0.5) {
      return {
        text: `Only ${hours(logged_seconds)} logged against ${hours(planned_seconds)} planned. Either the work has not started, or the time has not been recorded.`,
        tone: 'bg-amber-50 text-amber-800',
      };
    }
    return {
      text: `${hours(remaining_seconds)} of the ${hours(capacity_seconds)} in this period ${who.re} still free.`,
      tone: 'bg-emerald-50 text-emerald-800',
    };
  })();
  const tiles: [string, number, string][] = [
    ['Capacity', capacity_seconds, 'text-gray-900'],
    ['Planned', planned_seconds, over ? 'text-red-600' : 'text-gray-900'],
    ['Logged', logged_seconds, 'text-gray-900'],
    ['Left to fill', remaining_seconds, 'text-emerald-700'],
  ];
  return (
    <div className="flex h-full flex-col justify-center gap-3 px-1">
      <dl className="grid grid-cols-4 gap-2">
        {tiles.map(([label, seconds, tone]) => (
          <button
            key={label}
            type="button"
            onClick={() => onDrill?.(undefined, `${label} — the work behind it`)}
            title={onDrill ? 'Show the tasks these hours cover' : undefined}
            className="rounded-lg bg-gray-50 px-3 py-2 text-left hover:bg-gray-100 disabled:cursor-default"
            disabled={!onDrill}
          >
            <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className={`text-xl font-semibold ${tone}`}>{formatDuration(seconds) || '0h'}</dd>
          </button>
        ))}
      </dl>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100" role="meter" aria-label="Planned against capacity">
        <div className={`h-full ${over ? 'bg-red-500' : 'bg-teal-500'}`} style={{ width: width(planned_seconds) }} />
      </div>

      {/* The four numbers are the evidence; this is the finding. Without it everyone reads the
          tiles, nods, and takes nothing away. */}
      <p className={`rounded-lg px-3 py-2 text-xs ${finding.tone}`}>{finding.text}</p>

      {/* Fewer than half the tasks sized is not a footnote: it is the reason the numbers above
          are smaller than the real workload. */}
      {unplanned > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>
            {missingNote(unplanned, tasks, no_due_date_tasks, no_estimate_tasks)}
            {' '}A task needs both a due date and a time estimate to count in Planned above.
          </span>
        </p>
      )}

      <p className="text-xs text-gray-400">
        {people} {people === 1 ? 'person' : 'people'} · {scheduled_tasks} of {tasks} sized and scheduled
        {sees_everyone ? '' : ' · only the people whose time you may see'}
      </p>
    </div>
  );
};

interface VarianceRow {
  key: string; user: UserRef | null; expected_seconds: number; logged_seconds: number;
  difference_seconds: number; tasks: number;
}

interface VarianceTask {
  id: string; name: string; list: string; status: string; status_group: string;
  priority: number | null; assignees: UserRef[]; due_date: string | null; done_at: string;
  late: boolean;
  /** Null when nobody said what the task should take: there is no overrun to report, only a gap. */
  expected_seconds: number | null;
  logged_seconds: number;
  difference_seconds: number | null;
}

/** Which way a task went against its estimate -- the thing this card is actually about. */
type Shape = 'all' | 'over' | 'under' | 'exact' | 'none';

/** Within a twentieth of the estimate is as close as anyone estimates; call that on target. */
const CLOSE = 0.05;

function shapeOf(t: VarianceTask): Exclude<Shape, 'all'> {
  if (t.expected_seconds === null || t.difference_seconds === null) return 'none';
  if (Math.abs(t.difference_seconds) <= t.expected_seconds * CLOSE) return 'exact';
  return t.difference_seconds > 0 ? 'over' : 'under';
}

const PRIORITY_LOOK: Record<number, { label: string; dot: string }> = {
  1: { label: 'Urgent', dot: 'bg-red-500' },
  2: { label: 'High', dot: 'bg-amber-500' },
  3: { label: 'Normal', dot: 'bg-sky-500' },
  4: { label: 'Low', dot: 'bg-gray-300' },
};

/**
 * Estimate against actual, task by task.
 *
 * The summary across the top says whether the period ran over at all; the table underneath says
 * which work made it do so, which is the only version of this number anyone can act on. The
 * filters above the table narrow it in a way the card's own task filters cannot: by which way a
 * task went against its estimate.
 */
export const VarianceCard: React.FC<{
  rows: VarianceRow[]; tasks?: VarianceTask[]; more_tasks?: number;
  expected_seconds: number; logged_seconds: number;
  sees_everyone: boolean;
  period?: { start: string; end: string };
  onDrill: (segment: string | undefined, label: string) => void;
  onOpenTask?: (id: string) => void;
}> = ({ tasks = [], more_tasks = 0, expected_seconds, logged_seconds, period, onDrill, onOpenTask }) => {
  const [shape, setShape] = useState<Shape>('all');
  const [who, setWho] = useState<string>('all');

  const hours = (seconds: number) => formatDuration(seconds) || '0h';
  const total = logged_seconds - expected_seconds;
  const used = expected_seconds ? logged_seconds / expected_seconds : 0;
  const empty = tasks.length === 0;
  const span = period ? periodText(period.start, period.end) : 'this period';

  // Everyone who appears on the finished work, for the person filter on the card itself.
  const people = useMemo(() => {
    const seen = new Map<string, UserRef>();
    for (const t of tasks) for (const u of t.assignees) if (!seen.has(u.id)) seen.set(u.id, u);
    return [...seen.values()].sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email));
  }, [tasks]);

  const counts = useMemo(() => {
    const n: Record<Exclude<Shape, 'all'>, number> = { over: 0, under: 0, exact: 0, none: 0 };
    for (const t of tasks) if (who === 'all' || t.assignees.some((u) => u.id === who)) n[shapeOf(t)] += 1;
    return n;
  }, [tasks, who]);

  // In the server's order: biggest difference first, tasks with no estimate last.
  const shown = useMemo(() => tasks
    .filter((t) => who === 'all' || t.assignees.some((u) => u.id === who))
    .filter((t) => shape === 'all' || shapeOf(t) === shape), [tasks, shape, who]);

  const drillAll = () => onDrill(undefined, 'the work these figures cover');
  const summary = { tasks, empty, expected_seconds, logged_seconds, total, used, counts, hours, onOpen: drillAll };

  const Chip: React.FC<{ value: Shape; label: string; count: number }> = ({ value, label, count }) => (
    <button
      type="button"
      onClick={() => setShape(value)}
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
        shape === value ? 'bg-[#234788] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
    >
      {label} <span className={shape === value ? 'text-white/70' : 'text-gray-400'}>{count}</span>
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <VarianceWater {...summary} />

      {!empty && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-gray-400">{tasks.length} finished task{tasks.length === 1 ? '' : 's'} · {span}</span>
          {FEATURES.dashboardVarianceChips && (
            <>
              <Chip value="all" label="All" count={counts.over + counts.under + counts.exact + counts.none} />
              <Chip value="over" label="Over" count={counts.over} />
              <Chip value="under" label="Under" count={counts.under} />
              <Chip value="exact" label="On target" count={counts.exact} />
              <Chip value="none" label="No estimate" count={counts.none} />
            </>
          )}
          <span className="flex-1" />
          {FEATURES.dashboardVarianceChips && people.length > 1 && (
            <SearchSelect label="Person" value={who} onChange={setWho} size="sm" className="max-w-40"
              options={[
                { value: 'all', label: 'Everyone' },
                ...people.map((u) => ({ value: u.id, label: u.display_name || u.email, hint: u.email })),
              ]} />
          )}
        </div>
      )}

      {/* Task by task. The header stays put while the rows scroll. */}
      <div className="mt-1.5 min-h-0 flex-1 overflow-auto">
        {empty ? (
          <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF2F8] text-[#234788]"><CheckCircle2 size={18} /></span>
            <p className="text-[13px] font-medium text-gray-600">Nothing finished yet</p>
            <p className="text-[11.5px] text-gray-400">{span} · finished tasks show here, with their estimate and what they took.</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-gray-400">Nothing here matches these filters.</p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-gray-200 text-[11px] text-gray-500">
                <th className="py-1.5 pr-2 text-left font-medium">Task</th>
                <th className="w-20 px-2 py-1.5 text-right font-medium">Estimated</th>
                <th className="w-20 px-2 py-1.5 text-right font-medium">Actual</th>
                <th className="w-28 py-1.5 pl-2 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const kind = shapeOf(t);
                const pill = kind === 'over' ? 'bg-red-50 text-red-700'
                  : kind === 'under' ? 'bg-green-50 text-green-700'
                  : kind === 'exact' ? 'bg-[#EEF2F8] text-[#234788]'
                  : 'text-gray-400 ring-1 ring-inset ring-dashed ring-gray-200';
                const priority = t.priority ? PRIORITY_LOOK[t.priority] : undefined;
                return (
                  <tr key={t.id} onClick={() => onOpenTask?.(t.id)} className="cursor-pointer border-b border-gray-100 align-middle hover:bg-[#F7F9FC]">
                    <td className="min-w-0 py-2 pr-2">
                      <div className="flex items-center gap-1.5">
                        {priority && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${priority.dot}`} aria-label={priority.label} />}
                        <span className="min-w-0 truncate font-medium text-gray-800">{t.name}</span>
                        {t.late && <span className="shrink-0 rounded bg-red-50 px-1 text-[10px] font-medium text-red-600">late</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400">
                        {t.assignees.slice(0, 3).map((u) => <Avatar key={u.id} user={u} size={14} />)}
                        <span className="truncate">{t.list}</span>
                      </div>
                    </td>
                    <td className="px-2 text-right tabular-nums text-gray-500">
                      {t.expected_seconds === null ? <span className="text-gray-300">–</span> : hours(t.expected_seconds)}
                    </td>
                    <td className="px-2 text-right font-medium tabular-nums text-gray-900">{hours(t.logged_seconds)}</td>
                    <td className="pl-2 text-right">
                      {/* Always the figure: within 5% it is "on target" and drawn navy, but still says by how much. */}
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${pill}`}>
                        {t.difference_seconds === null ? 'no estimate'
                          : t.difference_seconds === 0 ? 'on target'
                          : `${t.difference_seconds > 0 ? '+' : '−'}${hours(Math.abs(t.difference_seconds))}`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {more_tasks > 0 && <p className="mt-1 shrink-0 text-[11px] text-gray-400">{more_tasks} more not shown.</p>}
    </div>
  );
};

/* ---- The figures at the top: Estimated as it is; Actual and Difference as boxes of water. ---- */

type VarianceSummary = {
  tasks: VarianceTask[]; empty: boolean; expected_seconds: number; logged_seconds: number;
  total: number; used: number; counts: Record<Exclude<Shape, 'all'>, number>;
  hours: (seconds: number) => string; onOpen: () => void;
};

const periodText = (start: string, end: string) => {
  const f = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return start === end ? f(start) : `${f(start)} – ${f(end)}`;
};

/** "+2h over" / "1h under" / "on estimate", with its colour: red over, green under. */
const gapWords = (s: VarianceSummary) => {
  if (s.empty) return { text: 'Nothing finished yet', tone: 'text-gray-400', short: '–' };
  if (s.total === 0) return { text: 'on estimate', tone: 'text-[#234788]', short: 'On estimate' };
  const pct = s.expected_seconds ? ` · ${Math.round(Math.abs(s.used - 1) * 100)}%` : '';
  return s.total > 0
    ? { text: `longer than estimated${pct}`, tone: 'text-red-600', short: `+${s.hours(s.total)}` }
    : { text: `quicker than estimated${pct}`, tone: 'text-green-700', short: `−${s.hours(-s.total)}` };
};

/** How long the waves move each time the box comes into view before the water settles. */
const WAVE_MS = 6000;

/**
 * Water filling a box to `level` percent, with a slow wave on its surface. It rises from empty
 * when the card first draws, so the eye reads "how full" before it reads the number.
 *
 * The waves move only for a few seconds after the box comes into view, then settle; off screen
 * they stay still. Nothing keeps running while someone simply has the Dashboard open.
 */
const Water: React.FC<{ level: number; color: string }> = ({ level, color }) => {
  const [shown, setShown] = useState(0);
  const [moving, setMoving] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { const t = window.setTimeout(() => setShown(level), 60); return () => window.clearTimeout(t); }, [level]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let timer = 0;
    const seen = new IntersectionObserver(([entry]) => {
      window.clearTimeout(timer);
      if (entry.isIntersecting) {
        setMoving(true);
        timer = window.setTimeout(() => setMoving(false), WAVE_MS);
      } else {
        setMoving(false);
      }
    });
    seen.observe(el);
    return () => { seen.disconnect(); window.clearTimeout(timer); };
  }, []);
  // Two waves the same shape, one behind the other, drifting at different speeds.
  const wave = 'M0 6 Q 25 0 50 6 T 100 6 T 150 6 T 200 6 V 20 H 0 Z';
  return (
    <span ref={ref} aria-hidden className={`water pointer-events-none absolute inset-x-0 bottom-0 ${moving ? '' : 'is-still'}`} style={{ height: `${Math.min(100, Math.max(0, shown))}%`, '--water': color } as React.CSSProperties}>
      <svg className="water-wave water-wave-back" viewBox="0 0 200 20" preserveAspectRatio="none"><path d={wave} /></svg>
      <svg className="water-wave water-wave-front" viewBox="0 0 200 20" preserveAspectRatio="none"><path d={wave} /></svg>
      <span className="water-body" />
    </span>
  );
};

/** The Estimated figure as a plain box; Actual and Difference as boxes of water. */
const VarianceWater: React.FC<VarianceSummary> = (s) => {
  const gap = gapWords(s);
  const over = s.used > 1;
  const pct = Math.round(s.used * 100);
  const diffLevel = s.expected_seconds ? Math.min(100, Math.abs(s.used - 1) * 100) : 0;
  const Box: React.FC<{ label: string; Icon: React.ElementType; children: React.ReactNode; note?: React.ReactNode; water?: React.ReactNode }> = ({ label, Icon, children, note, water }) => (
    <button type="button" onClick={s.empty ? undefined : s.onOpen} disabled={s.empty}
      className="relative flex min-h-[92px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#E6E9F0] bg-white px-4 py-3 text-left transition-colors enabled:hover:border-[#C9D3E6] disabled:cursor-default">
      {water}
      <span className="relative flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-gray-500">
        <Icon size={13} className="text-[#234788]" /> {label}
      </span>
      <span className="relative">{children}</span>
      {note && <span className="relative mt-1 truncate text-[11.5px] text-gray-600">{note}</span>}
    </button>
  );
  return (
    <div className="flex flex-wrap gap-2.5 sm:flex-nowrap">
      <Box label="Estimated" Icon={Target} note={s.empty ? undefined : `across ${s.tasks.length} task${s.tasks.length === 1 ? '' : 's'}`}>
        <span className="mt-1.5 block text-[22px] font-semibold leading-none tabular-nums text-[#1B2A4A]">{s.empty ? '–' : s.hours(s.expected_seconds)}</span>
      </Box>
      <Box
        label="Actual" Icon={Timer}
        water={!s.empty && s.expected_seconds > 0 ? <Water level={Math.min(100, s.used * 100)} color={over ? '#ef4444' : '#234788'} /> : undefined}
        note={!s.empty && s.expected_seconds ? <span className={over ? 'font-medium text-red-700' : ''}>{pct}% of the estimate{over ? ' · overflowing' : ' used'}</span> : undefined}
      >
        <span className="mt-1.5 block text-[22px] font-semibold leading-none tabular-nums text-[#1B2A4A]">{s.empty ? '–' : s.hours(s.logged_seconds)}</span>
      </Box>
      <Box
        label="Difference" Icon={s.total > 0 ? TrendingUp : TrendingDown}
        water={!s.empty && s.total !== 0 && s.expected_seconds > 0 ? <Water level={Math.max(8, diffLevel)} color={s.total > 0 ? '#ef4444' : '#16a34a'} /> : undefined}
        note={<span className={gap.tone}>{gap.text}</span>}
      >
        <span className={`mt-1.5 block text-[22px] font-semibold leading-none tabular-nums ${s.empty ? 'text-gray-300' : gap.tone}`}>{gap.short}</span>
      </Box>
    </div>
  );
};


interface WorkedTask { id: string; name: string; tracked_seconds: number; changes: number; comments: number; completed: boolean }
interface WorkedRow { key: string; user: UserRef | null; tracked_seconds: number; task_count: number; tasks: WorkedTask[] }

/** ClickUp's "Worked on": what each person touched in the period. */
export const WorkedOnCard: React.FC<{ rows: WorkedRow[]; onOpenTask: (id: string) => void }> = ({ rows, onOpenTask }) => {
  if (!rows.length) return <div className="flex h-full items-center justify-center text-sm text-gray-400">Nothing worked on in this period.</div>;
  return (
    <ul className="h-full space-y-2 overflow-auto" aria-label="Worked on">
      {rows.map((r) => (
        <li key={r.key} className="rounded-lg border border-gray-100 p-2">
          <div className="flex items-center gap-2">
            {r.user && <Avatar user={r.user} size={22} />}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{r.user?.display_name || r.user?.email}</span>
            <span className="text-xs text-gray-500">{r.task_count} task{r.task_count === 1 ? '' : 's'}{r.tracked_seconds ? ` · ${formatDuration(r.tracked_seconds)}` : ''}</span>
          </div>
          <ul className="mt-1 space-y-0.5 pl-8">
            {r.tasks.slice(0, 6).map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onOpenTask(t.id)} className="flex w-full items-center gap-2 text-left text-xs text-gray-600 hover:text-brand-700">
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {t.completed && <CheckCircle2 size={12} className="shrink-0 text-emerald-600" aria-label="Completed" />}
                  {t.comments > 0 && <span className="flex shrink-0 items-center gap-0.5"><MessageSquare size={11} />{t.comments}</span>}
                  {t.changes > 0 && <span className="flex shrink-0 items-center gap-0.5"><Pencil size={11} />{t.changes}</span>}
                  {t.tracked_seconds > 0 && <span className="shrink-0">{formatDuration(t.tracked_seconds)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
};

interface GoalLite { id: string; name: string; color: string; progress: number; on_track: boolean | null; due_date: string | null; team: { name: string } | null; targets: { id: string; name: string; progress: number }[] }

export const GoalCard: React.FC<{ goals: GoalLite[] }> = ({ goals }) => {
  if (!goals.length) return <div className="flex h-full items-center justify-center text-sm text-gray-400">The chosen goals aren't available to you.</div>;
  return (
    <ul className="h-full space-y-3 overflow-auto" aria-label="Goals">
      {goals.map((g) => (
        <li key={g.id}>
          <Link to={`/goals/${g.id}`} className="flex items-center gap-2 text-sm font-medium text-gray-800 no-underline hover:text-brand-700">
            <Target size={14} style={{ color: g.color }} /> <span className="min-w-0 flex-1 truncate">{g.name}</span>
            {g.on_track !== null && <span className={`rounded-full px-1.5 text-[10px] ${g.on_track ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{g.on_track ? 'On track' : 'Behind'}</span>}
            <span className="w-10 text-right text-xs text-gray-600">{Math.round(g.progress)}%</span>
          </Link>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full" style={{ width: `${g.progress}%`, backgroundColor: g.color }} /></div>
          {g.team && <p className="mt-0.5 text-[11px] text-gray-400">{g.team.name}</p>}
        </li>
      ))}
    </ul>
  );
};

export const SprintCard: React.FC<{ folder: string; report: SprintReport | null }> = ({ folder, report }) => {
  if (!report) return <div className="flex h-full items-center justify-center text-sm text-gray-400">{folder} has no sprints yet.</div>;
  const s = report.sprint;
  const unit = report.unit === 'points' ? 'pts' : 'tasks';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link to={`/l/${s.id}`} className="font-medium text-gray-800 no-underline hover:text-brand-700">{s.name}</Link>
        <span className="text-xs text-gray-500">{report.unit === 'points' ? `${s.done_points} of ${s.total_points}` : `${s.done_count} of ${s.task_count}`} {unit} done</span>
        {report.average_velocity > 0 && <span className="ml-auto text-xs text-gray-500">Velocity {report.average_velocity} pts</span>}
      </div>
      <div className="min-h-0 flex-1" aria-label="Sprint burndown">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={report.burndown.map((d) => ({ ...d, label: new Date(d.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip />
            <Line dataKey="ideal" name="Ideal" stroke="#a5b4fc" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="remaining" name={`Remaining (${unit})`} stroke="#4f46e5" strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
