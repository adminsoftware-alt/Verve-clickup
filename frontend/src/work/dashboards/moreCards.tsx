// The Battery, Worked on, Goals and Sprint cards.
import React, { useMemo, useState } from 'react';
import { FEATURES } from '../../config/features';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CheckCircle2, MessageSquare, Pencil, Target, Timer, TrendingDown, TrendingUp } from 'lucide-react';
import type { UserRef } from '../api';
import { Avatar, formatDuration } from '../ui';
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

/** Workload for a period: what these people can do, what is planned for them, what they logged. */
export const CapacityCard: React.FC<{
  capacity_seconds: number; planned_seconds: number; logged_seconds: number; remaining_seconds: number;
  people: number; tasks: number; scheduled_tasks: number; sees_everyone: boolean;
  onDrill?: (segment: string | undefined, label: string) => void;
}> = ({ capacity_seconds, planned_seconds, logged_seconds, remaining_seconds, people, tasks, scheduled_tasks, sees_everyone, onDrill }) => {
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
            {unplanned} of {tasks} task{tasks === 1 ? '' : 's'} {unplanned === 1 ? 'has' : 'have'} no dates or no estimate,
            so {unplanned === 1 ? 'it is' : 'they are'} missing from Planned above.
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

const SORTS: { value: string; label: string; of: (t: VarianceTask) => number }[] = [
  { value: 'gap', label: 'Biggest difference', of: (t) => -Math.abs(t.difference_seconds ?? -1) },
  { value: 'over', label: 'Most over', of: (t) => -(t.difference_seconds ?? -Infinity) },
  { value: 'under', label: 'Most under', of: (t) => (t.difference_seconds ?? Infinity) },
  { value: 'actual', label: 'Longest actual', of: (t) => -t.logged_seconds },
  { value: 'estimate', label: 'Largest estimate', of: (t) => -(t.expected_seconds ?? -1) },
  { value: 'recent', label: 'Finished most recently', of: (t) => -new Date(t.done_at).getTime() },
];

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
  onDrill: (segment: string | undefined, label: string) => void;
  onOpenTask?: (id: string) => void;
}> = ({ tasks = [], more_tasks = 0, expected_seconds, logged_seconds, sees_everyone, onDrill, onOpenTask }) => {
  const [shape, setShape] = useState<Shape>('all');
  const [who, setWho] = useState<string>('all');
  const [sort, setSort] = useState<string>('gap');

  const hours = (seconds: number) => formatDuration(seconds) || '0h';
  const total = logged_seconds - expected_seconds;
  const used = expected_seconds ? logged_seconds / expected_seconds : 0;

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

  const shown = useMemo(() => {
    const by = SORTS.find((x) => x.value === sort) ?? SORTS[0];
    return tasks
      .filter((t) => who === 'all' || t.assignees.some((u) => u.id === who))
      .filter((t) => shape === 'all' || shapeOf(t) === shape)
      .slice()
      .sort((a, b) => by.of(a) - by.of(b));
  }, [tasks, shape, who, sort]);

  // One hue per tile, kept pale: the colour tells you which figure you are looking at without
  // reading the label, and the value stays the darkest thing in the tile.
  // Not indigo or brand-600: index.css remaps both to the teal brand colour, so a tile asking
  // for indigo comes out the same shade as the teal one beside it.
  const SKINS = {
    sky: { tile: 'border-sky-100 bg-gradient-to-br from-sky-50 to-white', badge: 'bg-sky-100 text-sky-600', value: 'text-sky-900', note: 'text-sky-600/80' },
    purple: { tile: 'border-purple-100 bg-gradient-to-br from-purple-50 to-white', badge: 'bg-purple-100 text-purple-600', value: 'text-purple-900', note: 'text-purple-500/80' },
    teal: { tile: 'border-teal-100 bg-gradient-to-br from-teal-50 to-white', badge: 'bg-teal-100 text-teal-600', value: 'text-teal-900', note: 'text-teal-600/80' },
    amber: { tile: 'border-amber-100 bg-gradient-to-br from-amber-50 to-white', badge: 'bg-amber-100 text-amber-600', value: 'text-amber-800', note: 'text-amber-600/90' },
    slate: { tile: 'border-gray-200 bg-gradient-to-br from-gray-50 to-white', badge: 'bg-gray-100 text-gray-500', value: 'text-gray-900', note: 'text-gray-400' },
  } as const;

  const Tile: React.FC<{
    icon: React.ReactNode; label: string; value: string; skin: keyof typeof SKINS;
    note?: React.ReactNode; bar?: React.ReactNode; onClick?: () => void;
  }> = ({ icon, label, value, skin, note, bar, onClick }) => {
    const look = SKINS[skin];
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        title={onClick ? 'Show the tasks behind this figure' : undefined}
        className={`flex-1 rounded-xl border px-3 py-2 text-left shadow-sm transition-colors ${look.tile} ${
          onClick ? 'cursor-pointer hover:brightness-[0.98]' : 'cursor-default'}`}
      >
        <span className="flex items-center gap-2">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${look.badge}`}>{icon}</span>
          <span className="truncate text-[11px] font-medium text-gray-600">{label}</span>
        </span>
        <span className={`mt-1.5 block text-xl font-semibold leading-none ${look.value}`}>{value}</span>
        {bar}
        {note && <span className={`mt-1 block truncate text-[11px] ${look.note}`}>{note}</span>}
      </button>
    );
  };

  const Chip: React.FC<{ value: Shape; label: string; count: number }> = ({ value, label, count }) => (
    <button
      type="button"
      onClick={() => setShape(value)}
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
        shape === value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
    >
      {label} <span className={shape === value ? 'text-white/70' : 'text-gray-400'}>{count}</span>
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-2 sm:flex-nowrap">
        <Tile
          skin="sky"
          icon={<Target size={15} />}
          label="Estimated"
          value={hours(expected_seconds)}
          note={tasks.length ? `across ${tasks.length} finished task${tasks.length === 1 ? '' : 's'}` : undefined}
          onClick={() => onDrill(undefined, 'the work these estimates cover')}
        />
        <Tile
          skin={used > 1 ? 'amber' : 'purple'}
          icon={<Timer size={15} />}
          label="Actual"
          value={hours(logged_seconds)}
          bar={expected_seconds > 0 ? (
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/80 ring-1 ring-black/[0.04]">
              <span
                className={`block h-full rounded-full ${used > 1 ? 'bg-amber-500' : 'bg-teal-500'}`}
                style={{ width: `${Math.min(100, used * 100)}%` }}
              />
            </span>
          ) : undefined}
          note={expected_seconds > 0 ? `${Math.round(used * 100)}% of the estimate` : undefined}
          onClick={() => onDrill(undefined, 'the work these hours were logged against')}
        />
        <Tile
          skin={total === 0 ? 'slate' : total > 0 ? 'amber' : 'teal'}
          icon={total > 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
          label="Difference"
          value={total === 0 ? 'None' : hours(Math.abs(total))}
          note={total === 0 ? 'exactly as estimated' : total > 0 ? 'longer than estimated' : 'quicker than estimated'}
          onClick={() => onDrill(undefined, 'the work behind this difference')}
        />
      </div>

      {/* Sorting only: which way a task went against its estimate is read off the table, and who
          it belongs to is the card's own Filter. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-b border-gray-100 pb-2">
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
          <select
            aria-label="Person"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-[11px] text-gray-600"
          >
            <option value="all">Everyone</option>
            {people.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.email}</option>)}
          </select>
        )}
        <select
          aria-label="Sort"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-[11px] text-gray-600"
        >
          {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Task by task. The header stays put while the rows scroll. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">
            {tasks.length === 0 ? 'Nothing was finished in this period.' : 'Nothing here matches these filters.'}
          </p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="text-[10px] uppercase tracking-wide text-gray-400">
                <th className="py-1.5 pr-2 text-left font-semibold">Task</th>
                <th className="w-20 px-2 py-1.5 text-right font-semibold">Estimated</th>
                <th className="w-20 px-2 py-1.5 text-right font-semibold">Actual</th>
                <th className="w-28 py-1.5 pl-2 text-right font-semibold">Difference</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const kind = shapeOf(t);
                const look = kind === 'over' ? 'bg-amber-50 text-amber-800'
                  : kind === 'under' ? 'bg-teal-50 text-teal-800'
                  : kind === 'exact' ? 'bg-gray-100 text-gray-600'
                  : 'bg-gray-50 text-gray-400';
                const priority = t.priority ? PRIORITY_LOOK[t.priority] : undefined;
                return (
                  <tr
                    key={t.id}
                    onClick={() => onOpenTask?.(t.id)}
                    className="cursor-pointer border-t border-gray-100 align-middle hover:bg-gray-50"
                  >
                    <td className="min-w-0 py-1.5 pr-2">
                      <div className="flex items-center gap-1.5">
                        {priority && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${priority.dot}`} title={priority.label} />}
                        <span className="min-w-0 truncate font-medium text-gray-800" title={t.name}>{t.name}</span>
                        {t.late && <span className="shrink-0 rounded bg-red-50 px-1 text-[10px] font-medium text-red-600">late</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400">
                        {t.assignees.slice(0, 3).map((u) => <Avatar key={u.id} user={u} size={14} />)}
                        <span className="truncate">{t.list}</span>
                      </div>
                    </td>
                    <td className="px-2 text-right tabular-nums text-gray-600">
                      {t.expected_seconds === null ? <span className="text-gray-300">—</span> : hours(t.expected_seconds)}
                    </td>
                    <td className="px-2 text-right font-medium tabular-nums text-gray-800">{hours(t.logged_seconds)}</td>
                    <td className="pl-2 text-right">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${look}`}>
                        {t.difference_seconds === null ? 'no estimate'
                          : kind === 'exact' ? 'on target'
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

      {(more_tasks > 0 || !sees_everyone) && (
        <p className="mt-1 shrink-0 text-[11px] text-gray-400">
          {more_tasks > 0 && `${more_tasks} more not shown. `}
          {!sees_everyone && 'Only the people whose time you may see.'}
        </p>
      )}
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
