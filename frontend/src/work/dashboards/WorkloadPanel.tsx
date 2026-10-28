// "Workload & Time": the hours panel, as its own band across the Dashboard rather than a card in
// the grid. Four tiles say what the period holds, each as a share of capacity; what they add up
// to is said in the board's Highlights (workloadFinding).
import React, { useEffect, useState } from 'react';
import { CalendarClock, CircleGauge, PlayCircle, Users } from 'lucide-react';

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

type Tone = 'slate' | 'violet' | 'blue' | 'orange';

const TONES: Record<Tone, { color: string; percent: string }> = {
  // Each figure keeps a colour of its own for its icon and dial, from the same cool family as the
  // stat cards above (chosen 2026-10-26): indigo capacity, cyan planned, blue logged, teal left.
  slate: { color: '#4F46E5', percent: 'text-gray-700' },
  violet: { color: '#0891B2', percent: 'text-gray-700' },
  blue: { color: '#2563EB', percent: 'text-gray-700' },
  orange: { color: '#0D9488', percent: 'text-gray-700' },
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

/** A dial for a share of capacity: the arc fills to it once drawn, the figure sits in the middle. */
const Ring: React.FC<{ share: number; color: string }> = ({ share, color }) => {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setDrawn(true)); return () => cancelAnimationFrame(id); }, []);
  const r = 24;
  const round = 2 * Math.PI * r;
  const over = share > 1;
  const fill = drawn ? Math.min(1, share) : 0;
  return (
    <span className="relative flex h-16 w-16 shrink-0 items-center justify-center">
      <svg viewBox="0 0 60 60" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="30" cy="30" r={r} fill="none" strokeWidth="6" style={{ stroke: `color-mix(in srgb, ${color} 14%, white)` }} />
        <circle cx="30" cy="30" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
          stroke={over ? '#EF4444' : color} strokeDasharray={round} strokeDashoffset={round * (1 - fill)}
          className="wl-ring" />
      </svg>
      <span className={`tabular text-[13px] font-bold ${over ? 'text-red-600' : 'text-gray-800'}`}>{Math.round(share * 100)}%</span>
    </span>
  );
};

/** One figure as a share of capacity: the dial, then what it is and how much. */
const Tile: React.FC<{
  tone: Tone; Icon: React.ElementType; label: string; value: string; share: number; of: string;
  onClick?: () => void;
}> = ({ tone, Icon, label, value, share, of, onClick }) => {
  const skin = TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`wl-tile dash-well group/tile flex items-center gap-3.5 rounded-xl px-4 py-3.5 text-left ${onClick ? '' : 'cursor-default'}`}
      style={{ '--tile': skin.color } as React.CSSProperties}
    >
      <Ring share={share} color={skin.color} />
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: skin.color }}>
          <Icon size={13} strokeWidth={2.25} /> {label}
        </span>
        <span className="tabular mt-0.5 block text-2xl font-bold leading-tight tracking-tight text-gray-900">{value}</span>
        <span className="block truncate text-[11px] text-gray-500">of {of} capacity</span>
      </div>
    </button>
  );
};

/** Capacity itself: the total the other three are measured against, in the same shape as them. */
const CapacityTile: React.FC<{ d: WorkloadData }> = ({ d }) => {
  const skin = TONES.slate;
  return (
    <div className="wl-tile dash-well flex items-center gap-3.5 rounded-xl px-4 py-3.5" style={{ '--tile': skin.color } as React.CSSProperties}>
      <span className="tile-3d h-16 w-16 rounded-full"><Users size={24} /></span>
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: skin.color }}>
          <Users size={13} strokeWidth={2.25} /> Total capacity
        </span>
        <span className="tabular mt-0.5 block text-2xl font-bold leading-tight tracking-tight text-gray-900">{hours(d.capacity_seconds)}</span>
        <span className="block truncate text-[11px] text-gray-500">hours available</span>
      </div>
    </div>
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
    <section aria-label={card.title} className="wl-panel ui-card mb-6 px-4 py-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        {/* The title, with the dates the figures cover beside it: the tiles below carry the
            colour, so the heading stays quiet. */}
        <h2 className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight text-gray-900">
          Workload &amp; Time
          {d?.period && <span className="truncate rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">{rangeLabel(d.period)}</span>}
        </h2>
        <div className="no-print ml-auto flex items-center gap-2">
          {onSetFilters && (
            <CardFilterMenu
              value={card.config.filters ?? {}}
                          base={card.config.base_filters}
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
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[92px] rounded-xl" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <CapacityTile d={d} />
            <Tile tone="violet" Icon={CalendarClock} label="Planned" value={hours(d.planned_seconds)} share={share(d.planned_seconds)} of={hours(capacity)} onClick={() => onDrill('Planned')} />
            <Tile tone="blue" Icon={PlayCircle} label="Logged" value={hours(d.logged_seconds)} share={share(d.logged_seconds)} of={hours(capacity)} onClick={() => onDrill('Logged')} />
            <Tile tone="orange" Icon={CircleGauge} label="Remaining" value={hours(d.remaining_seconds)} share={share(d.remaining_seconds)} of={hours(capacity)} onClick={() => onDrill('Remaining')} />
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
