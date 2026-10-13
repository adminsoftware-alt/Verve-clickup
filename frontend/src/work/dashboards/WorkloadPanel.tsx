// "Workload & Time": the hours panel, as its own band across the Dashboard rather than a card in
// the grid. Four tiles say what the period holds, each as a share of capacity; what they add up
// to is said in the board's Highlights (workloadFinding).
import React from 'react';
import { BarChart3, CalendarClock, CircleGauge, PlayCircle, Users } from 'lucide-react';

import { FEATURES } from '../../config/features';
import { formatDuration } from '../ui';
import { PeriodMenu } from './StatRow';
import { CardFilterMenu } from './CardFilters';
import type { Card, CardData, Filters, Period } from './api';

export interface WorkloadData {
  capacity_seconds: number;
  planned_seconds: number;
  logged_seconds: number;
  remaining_seconds: number;
  working_days: number;
  seconds_per_day: number;
  people: number;
  tasks: number;
  scheduled_tasks: number;
  sees_everyone: boolean;
  period: { start: string; end: string };
}

type Tone = 'blue' | 'violet' | 'green' | 'orange';

const TONES: Record<Tone, { tile: string; badge: string; bar: string; percent: string }> = {
  blue: { tile: 'bg-gray-50/80', badge: 'bg-blue-100 text-blue-600', bar: 'bg-blue-500', percent: 'text-blue-600' },
  violet: { tile: 'bg-gray-50/80', badge: 'bg-violet-100 text-violet-600', bar: 'bg-violet-500', percent: 'text-violet-600' },
  green: { tile: 'bg-gray-50/80', badge: 'bg-emerald-100 text-emerald-600', bar: 'bg-emerald-500', percent: 'text-emerald-600' },
  orange: { tile: 'bg-gray-50/80', badge: 'bg-orange-100 text-orange-600', bar: 'bg-orange-500', percent: 'text-orange-600' },
};

const CHOICES: [Period['preset'], string][] = [
  ['today', 'Today'], ['yesterday', 'Yesterday'],
  ['this_week', 'This week'], ['last_week', 'Last week'],
  ['this_month', 'This month'], ['last_month', 'Last month'],
  ['this_quarter', 'This quarter'], ['last_quarter', 'Last quarter'],
];

const hours = (seconds: number) => formatDuration(Math.abs(seconds)) || '0h';

/** "21 Sep – 27 Sep 2026", or a single day when the period is one. */
function rangeLabel(period: { start: string; end: string } | undefined): string {
  if (!period) return '';
  const from = new Date(`${period.start}T00:00:00`);
  const to = new Date(`${period.end}T00:00:00`);
  const day = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (period.start === period.end) return `${day(from)} ${to.getFullYear()}`;
  return `${day(from)} – ${day(to)} ${to.getFullYear()}`;
}

const Tile: React.FC<{
  tone: Tone; Icon: React.ElementType; label: string; value: string;
  /** Share of capacity, shown as a percentage and a bar. Omitted for capacity itself. */
  share?: number;
  note?: string;
  onClick?: () => void;
}> = ({ tone, Icon, label, value, share, note, onClick }) => {
  const skin = TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={onClick ? 'Show the tasks these hours cover' : undefined}
      className={`rounded-xl px-4 py-3 text-left ring-1 ring-inset ring-gray-100 transition-all ${skin.tile} ${onClick ? 'hover:bg-white hover:shadow-[var(--ui-shadow-sm)] hover:ring-gray-200' : 'cursor-default'}`}
    >
      <div className="flex items-start gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${skin.badge}`}>
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-medium text-gray-600">{label}</span>
            {share !== undefined && <span className={`shrink-0 text-xs font-semibold ${skin.percent}`}>{Math.round(share * 100)}%</span>}
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="tabular text-xl font-semibold leading-tight tracking-tight text-gray-900">{value}</span>
            {share !== undefined && <span className="shrink-0 text-[10px] text-gray-400">of capacity</span>}
          </div>
        </div>
      </div>
      {share !== undefined ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200/70">
          <div className={`h-full rounded-full ${skin.bar}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
        </div>
      ) : (
        <p className="mt-2 truncate text-[11px] text-gray-500">{note}</p>
      )}
    </button>
  );
};

export const WorkloadPanel: React.FC<{
  card: Card;
  data: CardData | undefined;
  canEdit: boolean;
  onSetPeriod: (period: Period) => void;
  onCustom: () => void;
  onDrill: (label: string) => void;
  /** Narrow the band to some of the people it covers. */
  onSetFilters?: (filters: Filters) => void;
}> = ({ card, data, canEdit, onSetPeriod, onCustom, onDrill, onSetFilters }) => {
  const d = data?.data as WorkloadData | undefined;
  const preset = card.config.period?.preset;
  const capacity = d?.capacity_seconds ?? 0;
  const share = (seconds: number) => (capacity ? seconds / capacity : 0);

  // What the four tiles add up to used to be said here, in coloured notes under them. It is now
  // a line in the Highlights at the foot of the board (workloadFinding below), with everything
  // else that needs attention, so this band is the figures and nothing else.
  return (
    <section aria-label={card.title} className="ui-card mb-6 px-4 py-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <BarChart3 size={15} />
        </span>
        <h2 className="min-w-0 text-sm font-semibold text-gray-900">Workload &amp; Time</h2>
        <div className="no-print ml-auto flex items-center gap-2">
          {onSetFilters && (
            <CardFilterMenu
              value={card.config.filters ?? {}}
              disabled={!canEdit}
              time={{
                value: preset ?? 'this_week',
                options: CHOICES.map(([value, label]) => ({ value, label })),
                onPick: (value) => onSetPeriod({ preset: value as Period['preset'] }),
                onCustom,
              }}
              onApply={onSetFilters}
            />
          )}
          {/* The window is the Time entry inside Filter; a dropdown beside it saying the same
              thing was a second control over one setting. */}
          {FEATURES.dashboardCardScopeMenu && (
            <PeriodMenu
              label={`${CHOICES.find(([v]) => v === preset)?.[1] ?? 'Custom'}${d?.period ? ` (${rangeLabel(d.period)})` : ''}`}
              preset={preset}
              choices={CHOICES}
              disabled={!canEdit}
              onPick={onSetPeriod}
              onCustom={onCustom}
            />
          )}
        </div>
      </header>

      {!d ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[88px] rounded-xl" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile
              tone="blue" Icon={Users} label="Total capacity" value={hours(capacity)}
            />
            <Tile tone="violet" Icon={CalendarClock} label="Planned" value={hours(d.planned_seconds)} share={share(d.planned_seconds)} onClick={() => onDrill('Planned')} />
            <Tile tone="green" Icon={PlayCircle} label="Logged" value={hours(d.logged_seconds)} share={share(d.logged_seconds)} onClick={() => onDrill('Logged')} />
            <Tile tone="orange" Icon={CircleGauge} label="Remaining" value={hours(d.remaining_seconds)} share={share(d.remaining_seconds)} onClick={() => onDrill('Remaining')} />
          </div>
        </>
      )}
    </section>
  );
};

/**
 * The one thing the Workload band's figures add up to, for the Highlights: over capacity (the
 * bottleneck), time logged far from what was planned, or planned figures too thin to trust.
 * Null when the figures need no comment.
 */
export function workloadFinding(data: CardData | undefined): { tone: 'danger' | 'warning'; text: string } | null {
  const d = data?.data as WorkloadData | undefined;
  if (!d) return null;
  const capacity = d.capacity_seconds;
  if (capacity > 0 && d.planned_seconds > capacity) {
    return { tone: 'danger', text: `Over capacity: ${hours(d.planned_seconds - capacity)} more work is planned than there are hours for in ${rangeLabel(d.period)}. Something has to move.` };
  }
  if (d.planned_seconds > 0 && d.logged_seconds > d.planned_seconds * 1.2) {
    return { tone: 'warning', text: `${hours(d.logged_seconds - d.planned_seconds)} more was logged than planned — time is going on work nobody sized.` };
  }
  // Work with no dates or estimate is left out of Planned; the Highlights already count it
  // ("Open tasks missing details"), so it is not said twice.
  return null;
}
