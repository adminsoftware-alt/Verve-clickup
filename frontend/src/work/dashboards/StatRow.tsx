// The row of single-number cards at the top of a Dashboard, and the one period control that
// re-scopes them. Each card is tinted by what it means, so overdue reads as a problem at a glance
// and the row can be taken in without reading the labels.
import React from 'react';
import {
  AlertCircle, CalendarDays, CalendarRange, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, ListChecks, Users,
} from 'lucide-react';
import { Menu, type MenuItem } from '../ui';
import type { Card, CardData, Period } from './api';

/** Which presets the row offers, and what "Previous" means next to each. */
export const ROW_PERIODS: { preset: Period['preset']; label: string; previous: Period['preset'] }[] = [
  { preset: 'today', label: 'Today', previous: 'yesterday' },
  { preset: 'this_week', label: 'This week', previous: 'last_week' },
  { preset: 'this_month', label: 'This month', previous: 'last_month' },
];

const PREVIOUS: Partial<Record<string, string>> = {
  yesterday: 'Yesterday', last_week: 'Last week', last_month: 'Last month',
};

type Tone = 'blue' | 'green' | 'red' | 'violet' | 'amber';

const TONES: Record<Tone, { card: string; badge: string; arrow: string }> = {
  blue: { card: 'border-blue-100 bg-blue-50/60 hover:bg-blue-50', badge: 'bg-blue-100 text-blue-600', arrow: 'text-blue-400' },
  green: { card: 'border-emerald-100 bg-emerald-50/60 hover:bg-emerald-50', badge: 'bg-emerald-100 text-emerald-600', arrow: 'text-emerald-400' },
  red: { card: 'border-red-100 bg-red-50/60 hover:bg-red-50', badge: 'bg-red-100 text-red-600', arrow: 'text-red-400' },
  violet: { card: 'border-violet-100 bg-violet-50/60 hover:bg-violet-50', badge: 'bg-violet-100 text-brand-600', arrow: 'text-violet-400' },
  amber: { card: 'border-amber-100 bg-amber-50/60 hover:bg-amber-50', badge: 'bg-amber-100 text-amber-600', arrow: 'text-amber-400' },
};

/** What a stat card means, read from the filters it was built with rather than from its name. */
export function statLook(card: Card): { tone: Tone; Icon: React.ElementType } {
  const f = card.config.filters ?? {};
  if (f.due === 'overdue') return { tone: 'red', Icon: AlertCircle };
  if (f.done) return { tone: 'violet', Icon: CheckCircle2 };
  if (f.due) return { tone: 'green', Icon: CalendarDays };
  if (f.assignees?.includes('none')) return { tone: 'amber', Icon: Users };
  if (card.config.measure && card.config.measure !== 'tasks') return { tone: 'blue', Icon: Clock };
  return { tone: 'blue', Icon: ListChecks };
}

/** A stat card only moves with the period if it was built around a date. */
export const followsPeriod = (card: Card): boolean => {
  const f = card.config.filters ?? {};
  return (!!f.due && f.due !== 'overdue' && f.due !== 'none' && f.due !== 'set') || !!f.done;
};

/** The window this number actually covers, read from the card rather than from the row control. */
export function statScope(card: Card): string {
  const f = card.config.filters ?? {};
  if (f.done === 'period' || f.due === 'period') return periodLabel(card.config.period);
  if (f.done) return WORDS[f.done] ?? f.done.replace(/_/g, ' ');
  if (f.due && f.due !== 'overdue' && f.due !== 'none' && f.due !== 'set') return WORDS[f.due] ?? f.due.replace(/_/g, ' ');
  return 'right now';
}

const WORDS: Partial<Record<string, string>> = {
  today: 'today', this_week: 'this week', this_month: 'this month',
  next_7_days: 'in the next 7 days', last_7_days: 'in the last 7 days', last_30_days: 'in the last 30 days',
};

export const StatCard: React.FC<{
  card: Card;
  data: CardData | undefined;
  onDrill: () => void;
  /** Narrowing one figure, e.g. "overdue, but only the HR team's". */
  filter?: React.ReactNode;
}> = ({ card, data, onDrill, filter }) => {
  const { tone, Icon } = statLook(card);
  const skin = TONES[tone];
  const d = data?.data;
  const value = data && !data.error && !data.no_access ? d?.value : null;

  return (
    <div className={`group/stat relative flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${skin.card}`}>
      {/* The filter sits above the tile rather than inside it: the tile itself is the button
          that opens the tasks, and a button inside a button is not a thing. It is always on
          show -- hidden until hover, it was a control nobody knew was there, and a card could
          be filtered with nothing on screen saying so. The title keeps clear of it. */}
      {filter && <span className="absolute right-2 top-2 z-10">{filter}</span>}
      <button
        type="button"
        onClick={onDrill}
        title="Show these tasks"
        className="flex w-full items-center gap-3 text-left"
      >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${skin.badge}`}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs font-medium text-gray-600 ${filter ? 'pr-7' : ''}`}>{card.title}</span>
        <span className="block text-2xl font-semibold leading-tight text-gray-900">
          {value === null || value === undefined ? <span className="text-gray-300">—</span> : value}
        </span>
        <span className="block truncate text-[11px] text-gray-500">{statScope(card)}</span>
      </span>
        <ChevronRight size={16} className={`shrink-0 ${skin.arrow}`} />
      </button>
    </div>
  );
};

/** Today / This week / This month / Previous / Custom range, above the stat cards. */
export const PeriodBar: React.FC<{
  /** Null while the cards cover different windows, so nothing is shown as chosen. */
  value: Period | null;
  canEdit: boolean;
  onPick: (period: Period) => void;
  onCustom: () => void;
}> = ({ value, canEdit, onPick, onCustom }) => {
  const preset = value?.preset;
  // Each granularity carries its own "previous", so the list says which period you get instead of
  // leaving "Previous" to be guessed from whatever is selected.
  const choices: [Period['preset'], string][] = [
    ['today', 'Today'], ['yesterday', 'Yesterday'],
    ['this_week', 'This week'], ['last_week', 'Last week'],
    ['this_month', 'This month'], ['last_month', 'Last month'],
  ];

  return (
    <div className="no-print mb-3 flex flex-wrap items-center justify-end gap-2">
      {preset === 'custom' && value?.start && value?.end && (
        <span className="text-xs text-gray-500">{value.start} to {value.end}</span>
      )}
      {!value && <span className="mr-auto text-xs text-gray-400">Each card is on its own window — pick one to line them up.</span>}
      <PeriodMenu
        // With no shared window the button says what it is for rather than naming a state nobody
        // can pick: "Mixed" read like a period you had chosen, and sat where "This week" would.
        label={value ? (choices.find(([v]) => v === preset)?.[1] ?? periodLabel(value)) : 'Period'}
        preset={preset}
        choices={choices}
        disabled={!canEdit}
        onPick={onPick}
        onCustom={onCustom}
      />
    </div>
  );
};

/** The period picker itself: a proper menu rather than the browser's own select box. */
export const PeriodMenu: React.FC<{
  label: string;
  preset: Period['preset'] | undefined;
  choices: [Period['preset'], string][];
  disabled?: boolean;
  onPick: (period: Period) => void;
  onCustom: () => void;
  /** An entry above the periods for "no period at all", e.g. "All open work". */
  anyLabel?: string;
  onAny?: () => void;
}> = ({ label, preset, choices, disabled, onPick, onCustom, anyLabel, onAny }) => {
  const tick = (on: boolean) => (on ? <Check size={14} className="text-teal-600" /> : <span className="w-3.5" />);
  const items: MenuItem[] = [
    ...(anyLabel && onAny ? [{ label: anyLabel, icon: tick(preset === undefined), onClick: onAny }] : []),
    ...choices.map(([value, text]) => ({
      label: text, icon: tick(preset === value), onClick: () => onPick({ preset: value }),
    })),
    { label: 'Custom range…', icon: tick(preset === 'custom'), onClick: onCustom },
  ];
  if (disabled) {
    return (
      <span className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500">
        <CalendarRange size={14} className="text-gray-400" /> {label}
      </span>
    );
  }
  return (
    <Menu
      align="right"
      label="Period for these cards"
      items={items}
      trigger={
        <span className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50">
          <CalendarRange size={14} className="text-gray-400" />
          {label}
          <ChevronDown size={13} className="text-gray-400" />
        </span>
      }
    />
  );
};

/** How the chosen period reads under a number. */
export const periodLabel = (period: Period): string => {
  if (period.preset === 'custom') return period.start && period.end ? `${period.start} to ${period.end}` : 'custom range';
  const found = ROW_PERIODS.find((p) => p.preset === period.preset);
  if (found) return found.label.toLowerCase();
  return (PREVIOUS[period.preset] ?? period.preset.replace(/_/g, ' ')).toLowerCase();
};
