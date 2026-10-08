import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Lock, PartyPopper, Send, Trash2, TrendingUp } from 'lucide-react';
import { useMe } from '../WorkContext';
import { workApi, type Task, type UserRef } from '../api';
import { Avatar, AvatarStack, StatusDot, formatDue, formatDuration } from '../ui';
import { BatteryCard, CapacityCard, GoalCard, SprintCard, VarianceCard, WorkedOnCard } from './moreCards';
import { PlanCard } from './PlanCard';
import { CardSkeleton } from '../Skeleton';
import { dashApi, type BehindRow, type Card, type CardData, type CardType, type CompletedRow, type DiscussionMessage, type PortfolioRow, type Segment, type TimeRow } from './api';

export const CARD_TYPES: { type: CardType; label: string; hint: string; width: number; height: number }[] = [
  { type: 'calculation', label: 'Calculation', hint: 'One number: a count of tasks, or a sum or average of time', width: 3, height: 1 },
  { type: 'plan', label: 'Plan my day', hint: "Tick today's work; it adds up the estimates and warns before you overcommit", width: 6, height: 3 },
  { type: 'pie', label: 'Pie chart', hint: 'How tasks or time split by status, person, priority, tag or List', width: 6, height: 3 },
  { type: 'bar', label: 'Bar chart', hint: 'Compare categories, or show tasks done or created over time', width: 6, height: 3 },
  { type: 'line', label: 'Line chart', hint: 'A trend over time: tasks created, done or due per day, week or month', width: 6, height: 3 },
  { type: 'task_list', label: 'Task list', hint: 'A filtered list of tasks you can open and work on', width: 6, height: 3 },
  { type: 'time_report', label: 'Time reporting', hint: 'Tracked time by person, List or task for a period', width: 6, height: 3 },
  { type: 'timesheet', label: 'Timesheet', hint: 'Tracked time per person per day, against an 8h working day', width: 12, height: 3 },
  { type: 'portfolio', label: 'Portfolio', hint: 'One row per List: progress, overdue, estimated vs tracked time', width: 12, height: 3 },
  { type: 'behind', label: "Who's behind", hint: 'People with overdue tasks, and how late they are', width: 6, height: 3 },
  { type: 'completed', label: 'Completed tasks', hint: 'Tasks finished in a period, by person, on time or late', width: 6, height: 3 },
  { type: 'notes', label: 'Notes', hint: 'Text for context, instructions or links', width: 4, height: 2 },
  { type: 'discussion', label: 'Discussion', hint: 'A chat thread about this Dashboard for everyone who can open it', width: 4, height: 3 },
  { type: 'embed', label: 'Embed', hint: 'A web page, Google Sheet, doc or video shown inside the card', width: 6, height: 3 },
  { type: 'worked_on', label: 'Worked on', hint: 'Per person, the tasks they tracked time on, changed, commented on or finished', width: 6, height: 3 },
  { type: 'battery', label: 'Battery', hint: 'How much of the work is done, at a glance', width: 4, height: 2 },
  { type: 'capacity', label: 'Workload metrics', hint: 'For a period: working hours available, hours planned into them, hours logged and what is left', width: 12, height: 2 },
  { type: 'variance', label: 'Estimate against actual', hint: 'For work finished in the period, per person: what it was estimated at against what it took', width: 12, height: 3 },
  { type: 'goal', label: 'Goals', hint: 'Progress on the goals you pick, including Team goals', width: 4, height: 2 },
  { type: 'sprint', label: 'Sprint', hint: "A Sprint Folder's current sprint: points done and burndown", width: 6, height: 3 },
];

const fmt = (value: number | null | undefined, format: string) =>
  value == null ? '–' : format === 'duration' ? formatDuration(value) || '0m' : value.toLocaleString();

export interface CardHandlers {
  /** Show the tasks behind the card, or behind one segment of it. */
  onDrill: (segment: string | undefined, label: string) => void;
  onOpenTask: (id: string) => void;
  /** Re-read this one card, for the cards you can act on without leaving the Dashboard. */
  onRefresh?: () => void;
  /** Move the card's own window, for the arrows that step a week at a time. */
  onShift?: (start: string, end: string) => void;
}

export const CardBody: React.FC<{ card: Card; data: CardData | undefined; dashboardId: string } & CardHandlers> = ({ card, data, dashboardId, onDrill, onOpenTask, onRefresh, onShift }) => {
  if (!data) return <CardSkeleton />;
  if (data.no_access) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-xs text-gray-400">
        <Lock size={18} />
        You don't have access to the locations this card uses.
      </div>
    );
  }
  if (data.error) return <div className="flex h-full items-center justify-center px-4 text-center text-xs text-red-600">{data.error}</div>;
  const d = data.data;
  switch (card.type) {
    case 'calculation':
      return (
        <button type="button" onClick={() => onDrill(undefined, card.title)} className="flex h-full w-full flex-col items-center justify-center rounded-lg hover:bg-gray-50" title="Show these tasks">
          <span className="text-4xl font-semibold tracking-tight text-gray-900">
            {fmt(d.value, d.format)}
            {d.unit && <span className="ml-1 text-lg font-normal text-gray-500">{d.unit}</span>}
          </span>
          {d.format === 'duration' && <span className="mt-1 text-xs text-gray-400">across {d.count} task{d.count === 1 ? '' : 's'}</span>}
        </button>
      );
    case 'pie':
      return <PieCard segments={d.segments} format={d.format} total={d.total} donut={card.config.donut} onDrill={onDrill} />;
    case 'bar':
      return <BarCard segments={d.segments} format={d.format} onDrill={onDrill} />;
    case 'line':
      return <LineCard segments={d.segments} format={d.format} onDrill={onDrill} />;
    case 'task_list':
      return <TaskListCard tasks={d.tasks} total={d.total} onOpenTask={onOpenTask} onMore={() => onDrill(undefined, card.title)} />;
    case 'time_report':
      return <TimeReportCard rows={d.rows} total={d.total_seconds} showEstimates={card.config.show_estimates} seesEveryone={d.sees_everyone} />;
    case 'timesheet':
      return <TimesheetCard days={d.days} capacity={d.capacity_per_day} rows={d.rows} seesEveryone={d.sees_everyone} onOpenTask={onOpenTask} onShift={onShift} onRefresh={onRefresh} />;
    case 'portfolio':
      return <PortfolioCard rows={d.rows} onDrill={onDrill} />;
    case 'behind':
      return <BehindCard rows={d.rows} total={d.total} onDrill={onDrill} onOpenTask={onOpenTask} />;
    case 'completed':
      return <CompletedCard rows={d.rows} total={d.total} late={d.late} perDay={d.per_day} tasks={d.tasks} onDrill={onDrill} onOpenTask={onOpenTask} />;
    case 'notes':
      return <div className="h-full overflow-auto whitespace-pre-wrap px-1 text-sm leading-relaxed text-gray-700">{d.text || <span className="text-gray-400">Empty note. Edit the card to write something.</span>}</div>;
    case 'embed':
      return <EmbedCard url={d.url} title={card.title} />;
    case 'discussion':
      return <DiscussionCard dashboardId={dashboardId} cardId={card.id} />;
    case 'capacity':
      return <CapacityCard {...(d as React.ComponentProps<typeof CapacityCard>)} onDrill={onDrill} />;
    case 'variance':
      return <VarianceCard {...(d as React.ComponentProps<typeof VarianceCard>)} onDrill={onDrill} onOpenTask={onOpenTask} />;
    case 'plan':
      return <PlanCard {...(d as React.ComponentProps<typeof PlanCard>)} onOpenTask={onOpenTask} onChanged={() => onRefresh?.()} />;
    case 'battery':
      return <BatteryCard total={d.total} done={d.done} percent={d.percent} segments={d.segments} onDrill={onDrill} />;
    case 'worked_on':
      return <WorkedOnCard rows={d.rows} onOpenTask={onOpenTask} />;
    case 'goal':
      return <GoalCard goals={d.goals} />;
    case 'sprint':
      return <SprintCard folder={d.folder} report={d.report} />;
  }
};

const personName = (u: UserRef | null) => (u ? u.display_name || u.email : 'Unassigned');

/** ClickUp's "Who's behind": each person with overdue work, worst first. */
const BehindCard: React.FC<{ rows: BehindRow[]; total: number } & CardHandlers> = ({ rows, total, onDrill, onOpenTask }) => {
  if (!rows.length) {
    return <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-emerald-700"><PartyPopper size={20} /> Nobody is behind.</div>;
  }
  return (
    <div className="h-full overflow-auto">
      <p className="mb-2 text-xs text-gray-500">{total} overdue task{total === 1 ? '' : 's'}</p>
      <ul className="space-y-2" aria-label="People behind">
        {rows.map((r) => (
          <li key={r.key} className="rounded-lg border border-gray-100 p-2">
            <button type="button" onClick={() => onDrill(r.key, personName(r.user))} className="flex w-full items-center gap-2 text-left">
              {r.user ? <Avatar user={r.user} size={22} /> : <span className="h-[22px] w-[22px] rounded-full bg-gray-200" />}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{personName(r.user)}</span>
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">{r.overdue} overdue</span>
              <span className="w-24 text-right text-xs text-gray-500">up to {r.oldest_days} day{r.oldest_days === 1 ? '' : 's'}</span>
            </button>
            <ul className="mt-1 pl-8">
              {r.tasks.slice(0, 3).map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => onOpenTask(t.id)} className="flex w-full items-center gap-2 truncate text-left text-xs text-gray-600 hover:text-brand-700">
                    <span className="min-w-0 flex-1 truncate">{t.name}</span><span className="shrink-0 text-red-600">{t.days}d late</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Tasks finished in the period, per person, with a small daily chart. */
interface DoneTask { id: string; name: string; done_at: string; due_date: string | null; days_late: number }

/** The local calendar day an instant falls on, as the per-day keys are written. */
const localDay = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const dayName = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/** A month of squares, one per day, shaded by how much was finished. Six tasks across thirty days
 *  reads as rhythm on a calendar and as noise on a bar chart. */
const DoneCalendar: React.FC<{
  perDay: { day: string; count: number; late?: number }[];
  active: string | null;
  onHover: (day: string | null) => void;
  onPick: (day: string) => void;
}> = ({ perDay, active, onHover, onPick }) => {
  const max = Math.max(1, ...perDay.map((p) => p.count));
  // One column per day, left to right. A calendar block leaves most of the card empty when only a
  // handful of days have anything on them; a strip stays one row tall whatever the period.
  const shade = (count: number) => {
    if (!count) return 'bg-gray-100';
    const step = count / max;
    return step > 0.66 ? 'bg-emerald-600' : step > 0.33 ? 'bg-emerald-500' : 'bg-emerald-300';
  };
  const dayOf = (day: string) => new Date(`${day}T00:00:00`);
  const when = (day: string) => dayOf(day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  // Enough room for every weekday initial up to a month; past that only the dates stay legible.
  const dense = perDay.length > 31;

  return (
    <div className="min-w-0">
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {perDay.map((p) => {
          const d = dayOf(p.day);
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          const on = active === p.day;
          return (
            <div key={p.day} className="flex min-w-0 flex-1 flex-col items-center gap-1" style={{ minWidth: 14 }}>
              {!dense && (
                <span className={`text-[9px] leading-none ${weekend ? 'text-gray-300' : 'text-gray-400'}`}>
                  {d.toLocaleDateString(undefined, { weekday: 'narrow' })}
                </span>
              )}
              <button
                type="button"
                disabled={!p.count}
                onMouseEnter={() => p.count && onHover(p.day)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => p.count && onHover(p.day)}
                onBlur={() => onHover(null)}
                onClick={() => p.count && onPick(p.day)}
                aria-pressed={on}
                aria-label={`${when(p.day)}: ${p.count === 0 ? 'nothing finished' : `${p.count} finished`}`}
                title={`${when(p.day)}: ${p.count === 0 ? 'nothing finished' : `${p.count} finished${p.late ? `, ${p.late} late` : ''}`}`}
                className={`h-6 w-full rounded-[4px] transition-all ${shade(p.count)} ${
                  p.late ? 'ring-1 ring-amber-400' : ''} ${
                  on ? 'ring-2 ring-emerald-700' : ''} ${
                  p.count ? 'cursor-pointer hover:brightness-110' : 'cursor-default'} ${
                  !p.count && weekend ? 'bg-gray-50' : ''}`}
              />
              {!dense && (
                <span className={`text-[9px] leading-none ${on ? 'font-semibold text-gray-700' : 'text-gray-400'}`}>{d.getDate()}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-400">
        <span className="flex items-center gap-1">
          Less
          <span className="h-2.5 w-2.5 rounded-[2px] bg-gray-100" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-emerald-300" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-emerald-500" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-emerald-600" />
          More
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-gray-100 ring-1 ring-amber-400" /> had a late one
        </span>
        <span>Hover a day, click to keep it</span>
      </div>
    </div>
  );
};

const CompletedCard: React.FC<{
  rows: CompletedRow[]; total: number; late: number;
  perDay: { day: string; count: number; late?: number }[]; tasks?: DoneTask[];
} & CardHandlers> = ({ rows, total, late, perDay, tasks, onDrill, onOpenTask }) => {
  // Hovering a day previews it; clicking pins it, so the list can be reached with the mouse
  // without the preview vanishing on the way there.
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const active = pinned ?? hovered;
  const span = perDay.length ? `${perDay[0].day}:${perDay[perDay.length - 1].day}` : '';
  useEffect(() => { setPinned(null); setHovered(null); }, [span]);
  const shown = useMemo(
    () => (active ? (tasks ?? []).filter((t) => localDay(t.done_at) === active) : tasks ?? []),
    [tasks, active],
  );
  const onTime = total - late;
  const share = total ? Math.round((100 * onTime) / total) : 0;
  // One task swings the percentage by a sixth when only six are finished, so red is held back
  // until there are enough of them for the number to mean anything.
  const tone = total === 0 ? 'text-gray-300'
    : share >= 80 ? 'text-emerald-600'
    : total >= 10 && share < 50 ? 'text-red-600'
    : 'text-amber-600';

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <button type="button" onClick={() => onDrill(undefined, 'Completed tasks')} className="flex shrink-0 items-baseline gap-2 self-start text-left hover:opacity-80">
        <span className={`text-4xl font-semibold leading-none ${tone}`}>{total ? `${share}%` : '—'}</span>
        {/* The denominator stays: 33% of six is a very different claim from 33% of sixty. */}
        <span className="text-xs text-gray-500">of {total} finished on time</span>
      </button>
      {perDay.length > 0 && (
        <DoneCalendar perDay={perDay} active={active} onHover={setHovered} onPick={(day) => setPinned(pinned === day ? null : day)} />
      )}

      {total === 0 ? <Empty text="Nothing completed in this period" /> : tasks && tasks.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-auto border-t border-gray-100 pt-2">
          <p className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
            {active ? dayName(active) : 'What you shipped'}
            {active && <span className="normal-case text-gray-400">· {shown.length} finished</span>}
            {pinned && (
              <button type="button" onClick={() => setPinned(null)} className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium normal-case text-gray-500 hover:bg-gray-100">
                Show all
              </button>
            )}
          </p>
          {shown.length === 0 ? (
            <p className="px-1 py-2 text-xs text-gray-400">Those aren't in the most recent {tasks.length}.</p>
          ) : (
          <ul className="space-y-0.5">
            {shown.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onOpenTask(t.id)}
                  className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-gray-50">
                  <Check size={13} className="shrink-0 text-emerald-500" />
                  <span className="min-w-0 flex-1 truncate text-gray-700">{t.name}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    t.days_late > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {t.days_late > 0 ? `${t.days_late}d late` : 'on time'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          )}
        </div>
      ) : rows.length > 1 ? (
        <ul className="min-h-0 flex-1 space-y-1 overflow-auto border-t border-gray-100 pt-2" aria-label="Completed by person">
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" onClick={() => onDrill(r.key, personName(r.user))} className="flex w-full items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-gray-50">
                {r.user ? <Avatar user={r.user} size={22} /> : <span className="h-[22px] w-[22px] rounded-full bg-gray-200" />}
                <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{personName(r.user)}</span>
                {r.late > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{r.late} late</span>}
                <span className="w-8 text-right text-sm font-semibold text-gray-900">{r.done}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

const Empty: React.FC<{ text?: string }> = ({ text = 'No matching tasks' }) => (
  <div className="flex h-full items-center justify-center text-xs text-gray-400">{text}</div>
);

const PieCard: React.FC<{ segments: Segment[]; format: string; total: number; donut: boolean } & Pick<CardHandlers, 'onDrill'>> = ({ segments, format, total, donut, onDrill }) => {
  if (!segments.length || !total) return <Empty />;
  const share = (value: number) => (total ? (100 * value) / total : 0);
  const biggest = [...segments].sort((a, b) => b.value - a.value)[0];

  // Each slice is named where it sits, with a leader line back to it, so nothing has to be
  // matched up against a legend on the far side of the card.
  const Label = (props: {
    cx?: number; cy?: number; midAngle?: number; outerRadius?: number; index?: number;
  }) => {
    const { cx = 0, cy = 0, midAngle = 0, outerRadius = 0, index = 0 } = props;
    const sg = segments[index];
    if (!sg || !sg.value) return null;
    const rad = -midAngle * (Math.PI / 180);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const from = { x: cx + outerRadius * cos, y: cy + outerRadius * sin };
    const bend = { x: cx + (outerRadius + 14) * cos, y: cy + (outerRadius + 14) * sin };
    const right = cos >= 0;
    const end = { x: bend.x + (right ? 14 : -14), y: bend.y };
    const text = `${fmt(sg.value, format)} (${share(sg.value).toFixed(1)}%)`;
    return (
      <g style={{ pointerEvents: 'none' }}>
        <polyline points={`${from.x},${from.y} ${bend.x},${bend.y} ${end.x},${end.y}`} stroke={sg.color} strokeWidth={1} fill="none" opacity={0.6} />
        <circle cx={end.x + (right ? 5 : -5)} cy={end.y - 6} r={3} fill={sg.color} />
        <text x={end.x + (right ? 12 : -12)} y={end.y - 2.5} textAnchor={right ? 'start' : 'end'} fontSize={11} fontWeight={600} fill="#374151">{sg.label}</text>
        <text x={end.x + (right ? 5 : -5)} y={end.y + 11} textAnchor={right ? 'start' : 'end'} fontSize={10.5} fill="#6b7280">{text}</text>
      </g>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="relative min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="label"
              innerRadius={donut ? '52%' : 0}
              outerRadius="68%"
              paddingAngle={segments.length > 1 ? 2 : 0}
              labelLine={false}
              label={Label}
              onClick={(entry: { key?: string; label?: string }) => entry.key && onDrill(entry.key, entry.label ?? '')}
              isAnimationActive={false}
            >
              {segments.map((sg) => <Cell key={sg.key} fill={sg.color} stroke={segments.length > 1 ? '#fff' : 'none'} strokeWidth={2} className="cursor-pointer outline-none" />)}
            </Pie>
            <Tooltip formatter={(v: number) => fmt(v, format)} />
          </PieChart>
        </ResponsiveContainer>
        {donut && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold leading-none text-gray-900">{fmt(total, format)}</span>
            <span className="mt-1 text-[10px] uppercase tracking-wide text-gray-400">{format === 'duration' ? 'total' : 'total tasks'}</span>
          </div>
        )}
      </div>

      {/* What the split means, rather than leaving the reader to work out which slice is biggest. */}
      {biggest && (
        <button
          type="button"
          onClick={() => onDrill(biggest.key, biggest.label)}
          className="flex items-center gap-2.5 rounded-lg bg-gray-50 px-3 py-2 text-left hover:bg-gray-100"
          title={`Show the ${biggest.label} tasks`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${biggest.color}1f`, color: biggest.color }}>
            <TrendingUp size={14} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-gray-800">Most of your work is {biggest.label}</span>
            <span className="block truncate text-[11px] text-gray-500">
              {share(biggest.value).toFixed(1)}% of the total sits there.
            </span>
          </span>
        </button>
      )}
    </div>
  );
};

/** Past this many, upright bars become a row of slivers under slanted names. */
const UPRIGHT_MAX = 10;
/** How much room one person needs when the chart turns on its side. */
const ROW_PX = 30;

/**
 * Tasks or hours per person.
 *
 * A firm of twenty does not fit across a card as upright bars, and rolling the tail into
 * "8 others" hides exactly the people a manager is looking for. So past ten the chart turns on
 * its side: one row each, names written properly along the left, and the card scrolls. Nobody is
 * summarised away.
 */
const BarCard: React.FC<{ segments: Segment[]; format: string } & Pick<CardHandlers, 'onDrill'>> = ({ segments, format, onDrill }) => {
  const shown = useMemo(() => [...segments].sort((a, b) => b.value - a.value), [segments]);
  const sideways = shown.length > UPRIGHT_MAX;
  const crowded = !sideways && shown.length > 6;
  const total = useMemo(() => shown.reduce((n, sg) => n + sg.value, 0), [shown]);
  if (!segments.length || segments.every((sg) => !sg.value)) return <Empty />;

  // The count and its share sit on top of each bar: a bar you have to measure against the axis
  // makes you do arithmetic to learn what the chart already knows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts types label
  // content as its own Props, which is not indexable; we read only the numbers we need.
  const Cap = (props: any) => {
    const x = Number(props.x ?? 0);
    const y = Number(props.y ?? 0);
    const width = Number(props.width ?? 0);
    const value = Number(props.value ?? 0);
    const index = Number(props.index ?? 0);
    const sg = shown[index];
    if (!sg || !value) return null;
    const mid = x + width / 2;
    const share = total ? (100 * value) / total : 0;
    const text = share >= 10 ? `${share.toFixed(1)}%` : `${share.toFixed(1)}%`;
    const pill = Math.max(38, text.length * 7 + 14);
    return (
      <g style={{ pointerEvents: 'none' }}>
        <text x={mid} y={y - 24} textAnchor="middle" fontSize={13} fontWeight={700} fill="#111827">{fmt(value, format)}</text>
        <rect x={mid - pill / 2} y={y - 19} width={pill} height={17} rx={8.5} fill={sg.color} fillOpacity={0.14} />
        <text x={mid} y={y - 6.5} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={sg.color}>{text}</text>
      </g>
    );
  };

  if (sideways) {
    const top = Math.max(...shown.map((sg) => sg.value), 1);
    return (
      <div className="h-full overflow-y-auto pr-1">
        <ul className="space-y-1" aria-label="Per person">
          {shown.map((sg) => {
            const share = total ? (100 * sg.value) / total : 0;
            return (
              <li key={sg.key}>
                <button
                  type="button"
                  onClick={() => onDrill(sg.key, sg.label)}
                  className="flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-left hover:bg-gray-50"
                  style={{ minHeight: ROW_PX }}
                >
                  <span className="w-36 shrink-0 truncate text-[13px] text-gray-700">{sg.label}</span>
                  <span className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${(100 * sg.value) / top}%`, backgroundColor: sg.color }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right text-[13px] font-semibold tabular-nums text-gray-900">
                    {fmt(sg.value, format)}
                  </span>
                  <span
                    className="w-12 shrink-0 rounded px-1.5 py-px text-right text-[10px] font-semibold tabular-nums"
                    style={{ backgroundColor: `${sg.color}22`, color: sg.color }}
                  >
                    {share.toFixed(1)}%
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={shown} margin={{ top: 30, right: 8, bottom: crowded ? 34 : 0, left: 6 }}>
            <defs>
              {shown.map((sg) => (
                <linearGradient key={sg.key} id={`bar-${sg.key.replace(/[^\w-]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sg.color} stopOpacity={1} />
                  <stop offset="100%" stopColor={sg.color} stopOpacity={0.72} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="#e9ecef" strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11.5, fill: '#4b5563' }}
              interval={0}
              angle={crowded ? -35 : 0}
              textAnchor={crowded ? 'end' : 'middle'}
              height={crowded ? 56 : 30}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={46}
              label={{
                value: format === 'duration' ? 'Hours' : 'Number of tasks',
                angle: -90, position: 'insideLeft', style: { fontSize: 10.5, fill: '#9ca3af', textAnchor: 'middle' },
              }}
              tickFormatter={(v: number) => (format === 'duration' ? `${Math.round(v / 3600)}h` : String(v))}
            />
            <Tooltip formatter={(v: number) => fmt(v, format)} cursor={{ fill: '#f5f5ff' }} />
            <Bar
              dataKey="value"
              radius={[8, 8, 0, 0]}
              isAnimationActive={false}
              onClick={(entry: { key?: string; label?: string }) => entry.key && onDrill(entry.key, entry.label ?? '')}
            >
              {shown.map((sg) => <Cell key={sg.key} fill={`url(#bar-${sg.key.replace(/[^\w-]/g, '')})`} className="cursor-pointer" />)}
              <LabelList dataKey="value" content={Cap} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

    </div>
  );
};

const LineCard: React.FC<{ segments: Segment[]; format: string } & Pick<CardHandlers, 'onDrill'>> = ({ segments, format, onDrill }) => {
  if (!segments.length || segments.every((sg) => !sg.value)) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={segments} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
        onClick={(e: { activePayload?: { payload: Segment }[] } | null) => { const sg = e?.activePayload?.[0]?.payload; if (sg) onDrill(sg.key, sg.label); }}>
        <CartesianGrid vertical={false} stroke="#f0f1f3" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} allowDecimals={false} tickLine={false} axisLine={false}
          tickFormatter={(v: number) => (format === 'duration' ? `${Math.round(v / 3600)}h` : String(v))} />
        <Tooltip formatter={(v: number) => fmt(v, format)} />
        <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5, className: 'cursor-pointer' }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
};

/** ClickUp's Embed card. Sandboxed, and only https pages (the server checks too). */
const EmbedCard: React.FC<{ url: string; title: string }> = ({ url, title }) => {
  if (!url) return <Empty text="No page yet. Edit the card and paste a link." />;
  return (
    <div className="relative h-full">
      <iframe src={url} title={title} className="h-full w-full rounded-md border border-gray-100" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation" referrerPolicy="no-referrer" loading="lazy" allowFullScreen />
      <a href={url} target="_blank" rel="noreferrer" title="Open in a new tab" className="no-print absolute right-1 top-1 rounded bg-white/90 p-1 text-gray-500 shadow-sm hover:text-gray-800"><ExternalLink size={12} /></a>
    </div>
  );
};

/** ClickUp's Discussion card: a thread about the Dashboard for everyone who can open it. */
const DiscussionCard: React.FC<{ dashboardId: string; cardId: string }> = ({ dashboardId, cardId }) => {
  const me = useMe();
  const [messages, setMessages] = useState<DiscussionMessage[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const load = useCallback(() => dashApi.messages(dashboardId, cardId).then(setMessages).catch((e) => setError(e.message)), [dashboardId, cardId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    try { setMessages(await dashApi.postMessage(dashboardId, cardId, body)); setError(null); } catch (err) { setText(body); setError((err as Error).message); }
  };
  const remove = async (m: DiscussionMessage) => {
    setMessages((cur) => cur?.filter((x) => x.id !== m.id) ?? null);
    try { await dashApi.deleteMessage(m.id); } catch (err) { setError((err as Error).message); load(); }
  };
  return (
    <div className="flex h-full flex-col">
      <ul ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" aria-label="Messages">
        {messages === null ? <li className="text-xs text-gray-400">Loading…</li> : messages.length === 0 ? <li className="py-4 text-center text-xs text-gray-400">No messages yet. Start the conversation.</li> : messages.map((m) => (
          <li key={m.id} className="group flex items-start gap-2">
            {m.user ? <Avatar user={m.user} size={22} /> : <span className="h-[22px] w-[22px] rounded-full bg-gray-200" />}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500"><b className="font-medium text-gray-800">{m.user ? m.user.display_name || m.user.email : 'Someone'}</b> · {new Date(m.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{m.body}</p>
            </div>
            {m.user?.id === me && <button type="button" title="Delete message" onClick={() => remove(m)} className="no-print rounded p-0.5 text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"><Trash2 size={12} /></button>}
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <form onSubmit={send} className="no-print mt-2 flex items-center gap-1.5 border-t border-gray-100 pt-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} placeholder="Write a message…" aria-label="Message" className="min-w-0 flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-brand-400 focus:outline-none" />
        <button type="submit" title="Send" disabled={!text.trim()} className="rounded-md bg-brand-600 p-1.5 text-white hover:bg-brand-700 disabled:opacity-40"><Send size={13} /></button>
      </form>
    </div>
  );
};

const TaskListCard: React.FC<{ tasks: Task[]; total: number; onOpenTask: (id: string) => void; onMore: () => void }> = ({ tasks, total, onOpenTask, onMore }) => {
  if (!tasks.length) return <Empty />;
  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white text-left text-[11px] font-medium text-gray-400">
          <tr><th className="py-1 pl-1 font-medium">Name</th><th className="w-28 font-medium">Assignee</th><th className="w-24 font-medium">Due</th></tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} onClick={() => onOpenTask(t.id)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
              <td className="py-1.5 pl-1">
                <span className="flex min-w-0 items-center gap-2">
                  <StatusDot status={t.status} size={11} />
                  <span className={`truncate ${t.status.group === 'closed' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{t.name}</span>
                </span>
              </td>
              <td><AvatarStack users={t.assignees} max={3} /></td>
              <td className={`text-xs ${t.is_overdue ? 'text-red-600' : 'text-gray-500'}`}>{formatDue(t.due_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > tasks.length && (
        <button type="button" onClick={onMore} className="mt-1 w-full py-1 text-center text-xs text-brand-600 hover:underline">
          Show all {total}
        </button>
      )}
    </div>
  );
};

const OnlyYours: React.FC<{ seesEveryone: boolean }> = ({ seesEveryone }) =>
  seesEveryone ? null : <p className="mt-1 text-[11px] text-gray-400">Showing your time, and your Team's if you lead one.</p>;

/**
 * Hours per person for a period, against the hours each of them had.
 *
 * The hard part is that both ends of the scale have to read. Early in a month everyone is at 7%
 * of their hours and a bar scaled to capacity is a sliver you cannot compare; late in a month
 * the question is entirely "who is near their limit". So the bar is scaled to capacity -- which
 * is the honest picture -- and the *number* beside it carries the comparison: a percentage, and
 * a colour that changes as it fills. The capacity marker only appears once it is close enough
 * to mean something.
 *
 * Grouped by task or by List there is no capacity, so the bars go back to being relative to the
 * largest, because there is nothing honest to measure them against.
 */
const TimeReportCard: React.FC<{ rows: TimeRow[]; total: number; showEstimates: boolean; seesEveryone: boolean }> = ({ rows, total, showEstimates, seesEveryone }) => {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!rows.length) return <div className="flex h-full flex-col"><Empty text="No time tracked in this period" /><OnlyYours seesEveryone={seesEveryone} /></div>;

  const byCapacity = rows.some((r) => (r.capacity_seconds ?? 0) > 0);
  const top = Math.max(...rows.map((r) => r.seconds), 1);
  const capacityTotal = rows.reduce((n, r) => n + (r.capacity_seconds ?? 0), 0);
  const over = rows.filter((r) => (r.capacity_seconds ?? 0) > 0 && r.seconds > (r.capacity_seconds ?? 0));

  /** How full someone's hours are, and what that should look like. */
  const band = (share: number) => {
    if (share > 1) return { fill: 'bg-red-500', text: 'text-red-600', chip: 'bg-red-50 text-red-700' };
    if (share >= 0.85) return { fill: 'bg-amber-400', text: 'text-amber-700', chip: 'bg-amber-50 text-amber-700' };
    if (share >= 0.5) return { fill: 'bg-brand-500', text: 'text-gray-800', chip: 'bg-brand-50 text-brand-700' };
    return { fill: 'bg-brand-400/70', text: 'text-gray-700', chip: 'bg-gray-100 text-gray-500' };
  };

  return (
    <div className="flex h-full flex-col text-sm">
      {byCapacity && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-gray-500">
          <span>
            <span className="font-semibold text-gray-800">{formatDuration(total)}</span> of{' '}
            {formatDuration(capacityTotal)} available
          </span>
          <span className="text-gray-300">·</span>
          <span>{capacityTotal ? Math.round((100 * total) / capacityTotal) : 0}% of the team&rsquo;s hours</span>
          {over.length > 0 && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
              {over.length} over their hours
            </span>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {rows.map((r) => {
          const capacity = r.capacity_seconds ?? 0;
          const share = capacity > 0 ? r.seconds / capacity : 0;
          const skin = band(share);
          const shown = capacity > 0 ? Math.min(share, 1) * 100 : (100 * r.seconds) / top;
          const spill = share > 1 ? Math.min((share - 1) * 100, 100) : 0;
          const isOpen = open.has(r.key);
          return (
            <div key={r.key} className={`rounded-lg ${isOpen ? 'bg-gray-50/70' : ''}`}>
              <button
                type="button"
                onClick={() => setOpen((prev) => { const n = new Set(prev); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })}
                className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-2 text-left hover:bg-gray-50"
              >
                <span className="flex w-4 shrink-0 justify-center text-gray-300">
                  {r.children.length > 0 && (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
                </span>
                <span className="w-32 shrink-0 truncate font-medium text-gray-800">{r.label}</span>

                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <span className={`absolute inset-y-0 left-0 rounded-full ${skin.fill}`} style={{ width: `${shown}%` }} />
                  {spill > 0 && (
                    // Past their hours, drawn back over the full bar so the excess is visible.
                    <span className="absolute inset-y-0 right-0 rounded-full bg-red-600" style={{ width: `${spill}%` }} />
                  )}
                  {/* The line they are measured against, only once it is near enough to read. */}
                  {capacity > 0 && share >= 0.6 && (
                    <span aria-hidden className="absolute inset-y-[-3px] right-0 w-[2px] rounded bg-red-500" />
                  )}
                </span>

                <span className="w-32 shrink-0 text-right">
                  <span className={`text-[13px] font-semibold tabular-nums ${skin.text}`}>{formatDuration(r.seconds)}</span>
                  {capacity > 0 && (
                    <span className={`ml-1.5 inline-block rounded px-1.5 py-px text-[10px] font-semibold tabular-nums ${skin.chip}`}>
                      {Math.round(share * 100)}%
                    </span>
                  )}
                </span>
                {showEstimates && <span className="w-16 shrink-0 text-right text-xs text-gray-400">{formatDuration(r.estimate_seconds) || '\u2013'} est.</span>}
              </button>

              {isOpen && r.children.length > 0 && (
                <ul className="mb-1 ml-[3.25rem] border-l border-gray-200 pl-3">
                  {r.children.map((c) => (
                    <li key={c.key} className="flex items-center gap-2 py-1 text-xs">
                      <span className="min-w-0 flex-1 truncate text-gray-600">{c.label}</span>
                      <span className="shrink-0 tabular-nums text-gray-500">{formatDuration(c.seconds)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex shrink-0 items-center gap-2.5 border-t border-gray-200 px-1.5 pt-2">
        <span className="w-4" />
        <span className="w-32 shrink-0 text-[13px] font-semibold text-gray-800">Total</span>
        <span className="flex-1" />
        <span className="w-32 shrink-0 text-right text-[13px] font-semibold tabular-nums text-gray-900">
          {formatDuration(total)}
          {byCapacity && capacityTotal > 0 && (
            <span className="ml-1.5 inline-block rounded bg-gray-100 px-1.5 py-px text-[10px] font-semibold tabular-nums text-gray-500">
              {Math.round((100 * total) / capacityTotal)}%
            </span>
          )}
        </span>
      </div>
      <OnlyYours seesEveryone={seesEveryone} />
    </div>
  );
};

interface SheetTask { id: string; name: string; list_id: string; status: string; color: string; seconds_per_day: number[]; total: number }
interface SheetEntry {
  id: string; task_id: string; task_name: string; color: string; day: string;
  started_at: string; ended_at: string | null; seconds: number; billable: boolean;
}
interface SheetRow {
  user: UserRef; seconds_per_day: number[]; total: number; capacity_per_day?: number[];
  billable_per_day?: number[]; tasks?: SheetTask[]; entries?: SheetEntry[];
}

const clock = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

/** One day for one person: how much of the working day is filled, as a bar. */
const DayBar: React.FC<{
  seconds: number; capacity: number; billable?: number; day: string; active?: boolean; onPick?: () => void;
}> = ({ seconds, capacity, billable = 0, day, active, onPick }) => {
  const hours = capacity / 3600 || 8;
  const full = capacity ? seconds / capacity : seconds ? 1 : 0;
  const when = new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  // One accent for time logged, amber only when a day went over its hours. Four shades for
  // "how full" made people decode a legend to read their own week; the bar already shows it.
  const skin = !seconds ? { tile: 'bg-gray-50', bar: 'bg-gray-200', text: 'text-gray-300' }
    : full > 1.02 ? { tile: 'bg-amber-50', bar: 'bg-amber-500', text: 'text-amber-700' }
    : { tile: 'bg-teal-50', bar: 'bg-teal-600', text: 'text-teal-700' };
  const paid = seconds ? Math.min(1, billable / seconds) : 0;
  return (
    <button
      type="button"
      disabled={!seconds || !onPick}
      onClick={onPick}
      aria-pressed={!!active}
      title={seconds
        ? `${formatDuration(seconds)} of ${hours}h · ${when}${billable ? ` · ${formatDuration(billable)} billable` : ''} — show this day`
        : `Nothing logged · ${when}`}
      className={`block w-full rounded-lg px-1.5 py-1 text-center transition-all ${skin.tile} ${
        active ? 'ring-2 ring-gray-700 ring-offset-1' : ''} ${
        seconds && onPick ? 'cursor-pointer hover:brightness-95' : 'cursor-default'}`}
    >
      <span className={`block truncate text-[11px] font-semibold leading-tight ${skin.text}`}>
        {seconds ? formatDuration(seconds) : '—'}
      </span>
      {/* The solid part is billable time; the rest of the fill is not. */}
      <span className="relative mt-1 block h-1.5 overflow-hidden rounded-full bg-white/70">
        <span className={`absolute inset-y-0 left-0 rounded-full ${skin.bar} opacity-45`} style={{ width: `${Math.min(100, full * 100)}%` }} />
        <span className={`absolute inset-y-0 left-0 rounded-full ${skin.bar}`} style={{ width: `${Math.min(100, full * 100) * paid}%` }} />
      </span>
    </button>
  );
};

/** The team's week, as in ClickUp: a bar per day, opened up into the tasks behind the hours. */
/** One day, in the order it happened. A list of totals says what was worked on; this says how
 *  the day actually went -- where the long stretches were and where the gaps are. */
const DayAgenda: React.FC<{
  day: string; entries: SheetEntry[]; tasks: SheetTask[]; at: number;
  onClear: () => void; onOpenTask: (id: string) => void; onLogged?: () => void;
}> = ({ day, entries, tasks, at, onClear, onOpenTask, onLogged }) => {
  const when = new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const total = entries.reduce((n, e) => n + e.seconds, 0);
  const clockAt = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const [filling, setFilling] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The holes between one entry and the next. Time is far easier to remember on the day than at
  // month end, and the gaps are exactly where it goes missing.
  const gaps = useMemo(() => {
    const spans = entries
      .filter((e) => e.started_at && e.ended_at)
      .map((e) => ({ from: new Date(e.started_at).getTime(), to: new Date(e.ended_at!).getTime() }))
      .sort((a, b) => a.from - b.from);
    const out: { from: number; to: number }[] = [];
    let edge = spans.length ? spans[0].to : 0;
    for (const span of spans.slice(1)) {
      // Ignore anything under ten minutes: that is a coffee, not unlogged work.
      if (span.from - edge > 10 * 60_000) out.push({ from: edge, to: span.from });
      edge = Math.max(edge, span.to);
    }
    return out;
  }, [entries]);

  const fill = async (taskId: string, from: number, to: number) => {
    setSaving(true);
    try {
      await workApi.logTime(taskId, 0, undefined, {
        started_at: new Date(from).toISOString(), ended_at: new Date(to).toISOString(),
      });
      setFilling(null);
      onLogged?.();
    } finally {
      setSaving(false);
    }
  };
  // Without start times (a long period drops them from the payload) fall back to that day's totals.
  const fallback = tasks.filter((t) => (t.seconds_per_day[at] ?? 0) > 0);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-semibold text-gray-700">{when}</span>
        <span className="text-xs text-gray-500">
          {formatDuration(total || fallback.reduce((n, t) => n + (t.seconds_per_day[at] ?? 0), 0)) || '0h'}
          {' · '}
          {(entries.length || fallback.length)} {entries.length ? 'entr' : 'task'}{(entries.length || fallback.length) === 1 ? (entries.length ? 'y' : '') : (entries.length ? 'ies' : 's')}
        </span>
        <button type="button" onClick={onClear} className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-500 hover:bg-gray-200/70">
          Back to the week
        </button>
      </div>
      {gaps.length > 0 && (
        <ul className="mb-1.5 space-y-1">
          {gaps.map((gap) => {
            const key = `${gap.from}`;
            const minutes = Math.round((gap.to - gap.from) / 60_000);
            return (
              <li key={key} className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-2.5 py-1.5">
                <div className="flex items-center gap-2.5 text-sm">
                  <span className="w-32 shrink-0 whitespace-nowrap font-mono text-[11px] text-amber-700">
                    {clockAt(new Date(gap.from).toISOString())}–{clockAt(new Date(gap.to).toISOString())}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-amber-800">
                    {formatDuration(minutes * 60)} not logged
                  </span>
                  <button
                    type="button"
                    onClick={() => setFilling(filling === key ? null : key)}
                    className="shrink-0 rounded-md border border-amber-300 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                  >
                    {filling === key ? 'Cancel' : 'Fill it in'}
                  </button>
                </div>
                {filling === key && (
                  <div className="mt-1.5 border-t border-amber-200 pt-1.5">
                    <p className="mb-1 text-[11px] text-amber-800">Which task did this go on?</p>
                    <ul className="max-h-32 space-y-0.5 overflow-auto">
                      {tasks.map((t) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => fill(t.id, gap.from, gap.to)}
                            className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs text-gray-700 hover:bg-amber-100 disabled:opacity-50"
                          >
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                            <span className="min-w-0 flex-1 truncate">{t.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ul className="space-y-1">
        {(entries.length ? entries : fallback.map((t) => ({
          id: t.id, task_id: t.id, task_name: t.name, color: t.color, day,
          started_at: '', ended_at: null, seconds: t.seconds_per_day[at] ?? 0, billable: false,
        }))).map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onOpenTask(e.task_id)}
              title={`${e.task_name} — open it`}
              className="flex w-full items-center gap-2.5 rounded-lg bg-white px-2.5 py-1.5 text-left text-sm ring-1 ring-gray-100 hover:ring-teal-300"
            >
              {e.started_at && (
                <span className="w-32 shrink-0 whitespace-nowrap font-mono text-[11px] text-gray-400">
                  {clockAt(e.started_at)}{e.ended_at ? `–${clockAt(e.ended_at)}` : ''}
                </span>
              )}
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
              <span className="min-w-0 flex-1 truncate text-gray-700">{e.task_name}</span>
              {e.billable && <span className="shrink-0 rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">billable</span>}
              <span className="shrink-0 text-xs font-medium text-gray-700">{formatDuration(e.seconds)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const TimesheetCard: React.FC<{
  days: string[]; capacity: number[]; rows: SheetRow[]; seesEveryone: boolean;
} & Pick<CardHandlers, 'onOpenTask' | 'onShift' | 'onRefresh'>> = ({ days, capacity, rows, seesEveryone, onOpenTask, onShift, onRefresh }) => {
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Clicking a day opens that person's work for it; clicking it again goes back to the week.
  const [pickedDay, setPickedDay] = useState<{ user: string; day: string } | null>(null);
  const pickDay = (user: string, day: string) =>
    setPickedDay((prev) => (prev && prev.user === user && prev.day === day ? null : { user, day }));
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const dayHead = (day: string) => {
    const d = new Date(`${day}T00:00:00`);
    return `${d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}, ${d.getDate()}`;
  };
  const span = days.length;
  const shift = (by: number) => {
    if (!onShift || !span) return;
    const move = (iso: string) => {
      const d = new Date(`${iso}T00:00:00`);
      d.setDate(d.getDate() + by * span);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    onShift(move(days[0]), move(days[span - 1]));
  };
  const logged = rows.reduce((n, r) => n + r.total, 0);
  // Everyone the card covers now gets a row, so the empty ones are countable here.
  const nobodyLogged = rows.filter((r) => !r.total).length;
  const able = rows.reduce((n, r) => n + (r.capacity_per_day ?? capacity).reduce((m, v) => m + v, 0), 0);
  const range = span
    ? `${new Date(`${days[0]}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(`${days[span - 1]}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
    : '';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold leading-none text-gray-900">{formatDuration(logged) || '0h'}</span>
        <span className="text-xs text-gray-500">logged of {formatDuration(able) || '0h'}</span>
        {able > logged + 60 && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{formatDuration(able - logged)} to go</span>
        )}
        {/* The rows with nothing on them are the point of this card for a manager, so they are
            counted out loud rather than left to be noticed. */}
        {!!nobodyLogged && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            {nobodyLogged} logged nothing
          </span>
        )}
        {onShift && (
          <span className="no-print ml-auto flex items-center gap-1">
            <button type="button" onClick={() => shift(-1)} aria-label="Previous period"
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><ChevronLeft size={15} /></button>
            <span className="min-w-28 text-center text-xs font-medium text-gray-600">{range}</span>
            <button type="button" onClick={() => shift(1)} aria-label="Next period"
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><ChevronRight size={15} /></button>
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
      {rows.length === 0 ? (
        <Empty text="No time tracked in this week" />
      ) : (
      <table className="w-full table-fixed text-xs">
        <thead className="sticky top-0 z-[1] bg-white text-[11px] uppercase tracking-wide text-gray-400">
          <tr>
            <th className="w-64 py-1.5 pl-1 text-left font-medium">Person</th>
            <th className="w-20 text-left font-medium">Total</th>
            {days.map((day) => <th key={day} className="px-1 text-left font-medium">{dayHead(day)}</th>)}
            <th className="w-6" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const mine = pickedDay?.user === r.user.id ? pickedDay.day : null;
            const showing = open.has(r.user.id) || !!mine;
            const tasks = r.tasks ?? [];
            const caps = r.capacity_per_day ?? capacity;
            return (
              <React.Fragment key={r.user.id}>
                <tr className="border-t border-gray-100">
                  <td className="py-2 pl-1">
                    <span className="flex items-center gap-2">
                      <Avatar user={r.user} size={22} />
                      <span className="truncate text-sm text-gray-800">{r.user.display_name || r.user.email}</span>
                    </span>
                  </td>
                  <td className="text-sm font-medium text-gray-700">{clock(r.total)}</td>
                  {r.seconds_per_day.map((v, i) => (
                    <td key={i} className="px-1">
                      <DayBar
                        seconds={v} capacity={caps[i]} billable={r.billable_per_day?.[i] ?? 0} day={days[i]}
                        active={mine === days[i]} onPick={() => pickDay(r.user.id, days[i])}
                      />
                    </td>
                  ))}
                  <td className="pr-1 text-right">
                    <button
                      type="button"
                      onClick={() => tasks.length && toggle(r.user.id)}
                      aria-expanded={showing}
                      aria-label={`${showing ? 'Hide' : 'Show'} what ${r.user.display_name || r.user.email} worked on`}
                      className={`rounded p-0.5 ${tasks.length ? 'text-gray-400 hover:bg-gray-100 hover:text-gray-700' : 'text-gray-200'}`}
                      disabled={!tasks.length}
                    >
                      {showing ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </td>
                </tr>
                {showing && !mine && (
                  <>
                    <tr className="bg-gray-50/70 text-[11px] uppercase tracking-wide text-gray-400">
                      <td className="py-1.5 pl-9">Task</td>
                      <td>Total</td>
                      {days.map((day) => <td key={day} className="px-1">{dayHead(day)}</td>)}
                      <td />
                    </tr>
                    {tasks.map((t) => {
                      // The busiest day of this task, so the row has a shape rather than being
                      // seven numbers of equal weight.
                      const peak = Math.max(...t.seconds_per_day, 1);
                      return (
                        <tr key={t.id} className="group/task border-t border-gray-100 bg-white hover:bg-teal-50/40">
                          <td className="py-2 pl-9 pr-2">
                            <button
                              type="button"
                              onClick={() => onOpenTask(t.id)}
                              className="flex w-full items-center gap-2 text-left"
                              title={`${t.name} — ${t.status}`}
                            >
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white" style={{ backgroundColor: t.color }} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium text-gray-800 group-hover/task:text-teal-800">{t.name}</span>
                                <span className="block truncate text-[11px] text-gray-400">{t.status}</span>
                              </span>
                            </button>
                          </td>
                          <td>
                            <span className="inline-block rounded-md bg-gray-100 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-gray-700">
                              {clock(t.total)}
                            </span>
                          </td>
                          {t.seconds_per_day.map((v, i) => (
                            <td key={i} className="px-1">
                              {v ? (
                                <span className="block rounded-md px-1.5 py-1 text-center"
                                  style={{ backgroundColor: `rgba(13,148,136,${0.06 + 0.14 * (v / peak)})` }}>
                                  <span className="block text-[12px] font-medium tabular-nums text-teal-800">{formatDuration(v)}</span>
                                </span>
                              ) : (
                                <span className="block py-1 text-center text-gray-300">–</span>
                              )}
                            </td>
                          ))}
                          <td />
                        </tr>
                      );
                    })}
                  </>
                )}
                {mine && (
                  <tr>
                    <td colSpan={days.length + 3} className="bg-gray-50/60 px-2 py-2">
                      <DayAgenda
                        day={mine}
                        entries={(r.entries ?? []).filter((e) => e.day === mine)}
                        tasks={tasks}
                        at={days.indexOf(mine)}
                        onClear={() => pickDay(r.user.id, mine)}
                        onOpenTask={onOpenTask}
                        onLogged={onRefresh}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      )}
      </div>
      <OnlyYours seesEveryone={seesEveryone} />
    </div>
  );
};

const PortfolioCard: React.FC<{ rows: PortfolioRow[] } & Pick<CardHandlers, 'onDrill'>> = ({ rows, onDrill }) => {
  if (!rows.length) return <Empty text="No Lists here" />;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white text-left text-[11px] text-gray-400">
          <tr>
            <th className="py-1 pl-1 font-medium">List</th><th className="w-40 font-medium">Progress</th>
            <th className="w-14 text-right font-medium">Open</th><th className="w-16 text-right font-medium">Overdue</th>
            <th className="w-20 text-right font-medium">Estimated</th><th className="w-20 pr-1 text-right font-medium">Tracked</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const over = r.estimate_seconds > 0 && r.tracked_seconds > r.estimate_seconds;
            return (
              <tr key={r.list_id} onClick={() => onDrill(r.list_id, r.path)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
                <td className="max-w-0 truncate py-1.5 pl-1 text-gray-800" title={r.path}>{r.path}</td>
                <td>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-24 overflow-hidden rounded bg-gray-100"><span className="block h-full bg-emerald-500" style={{ width: `${r.progress}%` }} /></span>
                    <span className="text-xs text-gray-500">{r.progress}%</span>
                  </span>
                </td>
                <td className="text-right text-gray-600">{r.open}</td>
                <td className={`text-right ${r.overdue ? 'text-red-600' : 'text-gray-400'}`}>{r.overdue}</td>
                <td className="text-right text-gray-600">{formatDuration(r.estimate_seconds) || '–'}</td>
                <td className={`pr-1 text-right ${over ? 'font-medium text-red-600' : 'text-gray-600'}`}>{formatDuration(r.tracked_seconds) || '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
