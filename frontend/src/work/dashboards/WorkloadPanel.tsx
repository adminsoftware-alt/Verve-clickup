// "Workload & Time": the hours panel, as its own band across the Dashboard rather than a card in
// the grid. Four tiles say what the period holds, each as a share of capacity, and a sentence
// underneath says what they add up to -- without it people read the numbers, nod, and act on
// nothing.
import React from 'react';
import { AlertTriangle, BarChart3, CalendarClock, CircleGauge, PlayCircle, Users } from 'lucide-react';

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
  blue: { tile: 'bg-blue-50/70', badge: 'bg-blue-100 text-blue-600', bar: 'bg-blue-500', percent: 'text-blue-600' },
  violet: { tile: 'bg-violet-50/70', badge: 'bg-violet-100 text-brand-600', bar: 'bg-violet-500', percent: 'text-brand-600' },
  green: { tile: 'bg-emerald-50/70', badge: 'bg-emerald-100 text-emerald-600', bar: 'bg-emerald-500', percent: 'text-emerald-600' },
  orange: { tile: 'bg-orange-50/70', badge: 'bg-orange-100 text-orange-600', bar: 'bg-orange-500', percent: 'text-orange-600' },
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
      className={`rounded-xl px-4 py-3 text-left transition-colors ${skin.tile} ${onClick ? 'hover:brightness-95' : 'cursor-default'}`}
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
            <span className="text-xl font-semibold leading-tight text-gray-900">{value}</span>
            {share !== undefined && <span className="shrink-0 text-[10px] text-gray-400">of capacity</span>}
          </div>
        </div>
      </div>
      {share !== undefined ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/80">
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
  const unplanned = d ? Math.max(0, d.tasks - d.scheduled_tasks) : 0;
  const over = d ? d.planned_seconds > capacity && capacity > 0 : false;

  /** What the four tiles add up to, said once. */
  const finding = ((): { text: string; tone: string } | null => {
    if (!d) return null;
    if (over) {
      return { text: `${hours(d.planned_seconds - capacity)} more work is planned than there are hours to do it in. Something has to move.`, tone: 'bg-red-50 text-red-700' };
    }
    if (d.planned_seconds > 0 && d.logged_seconds > d.planned_seconds * 1.2) {
      return { text: `${hours(d.logged_seconds - d.planned_seconds)} more was logged than planned — most of that time went on work nobody sized.`, tone: 'bg-amber-50 text-amber-800' };
    }
    if (d.planned_seconds > 0 && d.logged_seconds < d.planned_seconds * 0.5) {
      return { text: `Only ${hours(d.logged_seconds)} logged against ${hours(d.planned_seconds)} planned. Either the work has not started, or the time has not been recorded.`, tone: 'bg-amber-50 text-amber-800' };
    }
    // "Still free" is a claim about work nobody has sized. Planned only knows about tasks that
    // have both an estimate and a due date, so when most of them have neither, the free hours
    // are an artefact of the missing data -- and a manager who believes them hands out more work
    // to a team that may already be full. Say what is actually known instead.
    if (d.tasks > 0 && d.scheduled_tasks < d.tasks * 0.7) {
      return {
        text: `Planned covers ${d.scheduled_tasks} of ${d.tasks} tasks, so the free hours are not reliable yet. Give the other ${unplanned} a date and an estimate to find out where this team really stands.`,
        tone: 'bg-amber-50 text-amber-800',
      };
    }
    return { text: `${hours(d.remaining_seconds)} of ${hours(capacity)} is still free in this period.`, tone: 'bg-emerald-50 text-emerald-800' };
  })();

  return (
    <section aria-label={card.title} className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3.5">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <BarChart3 size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Workload &amp; Time</h2>
          {/* The window in words, since the dropdown that used to say it has gone. */}
          <p className="truncate text-xs text-gray-500">
            {d?.period ? rangeLabel(d.period) : 'Track your capacity, plan your work and stay on top of your time.'}
            {d?.period && <span className="text-gray-400"> · capacity, planned and logged</span>}
          </p>
        </div>
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
              note={`${d.working_days} working day${d.working_days === 1 ? '' : 's'} · ${hours(d.seconds_per_day)}/day${d.people > 1 ? ` · ${d.people} people` : ''}`}
            />
            <Tile tone="violet" Icon={CalendarClock} label="Planned" value={hours(d.planned_seconds)} share={share(d.planned_seconds)} onClick={() => onDrill('Planned')} />
            <Tile tone="green" Icon={PlayCircle} label="Logged" value={hours(d.logged_seconds)} share={share(d.logged_seconds)} onClick={() => onDrill('Logged')} />
            <Tile tone="orange" Icon={CircleGauge} label="Remaining" value={hours(d.remaining_seconds)} share={share(d.remaining_seconds)} onClick={() => onDrill('Remaining')} />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {finding && <p className={`flex-1 rounded-lg px-3 py-2 text-xs ${finding.tone}`}>{finding.text}</p>}
            {unplanned > 0 && (
              <p className="flex flex-1 items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle size={13} className="mt-px shrink-0" />
                <span>
                  {unplanned} of {d.tasks} task{d.tasks === 1 ? '' : 's'} {unplanned === 1 ? 'has' : 'have'} no dates or no estimate,
                  so {unplanned === 1 ? 'it is' : 'they are'} missing from Planned.
                </span>
              </p>
            )}
          </div>
          {!d.sees_everyone && <p className="mt-2 text-[11px] text-gray-400">Only the people whose time you may see.</p>}
        </>
      )}
    </section>
  );
};
