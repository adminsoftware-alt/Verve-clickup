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

type Tone = 'blue' | 'orange' | 'red' | 'violet' | 'pink';

// The meaning is carried by the icon tile and, for overdue, by the figure itself; the card stays
// white like every other card, so a row of them reads as one calm band rather than five colours.
const TONES: Record<Tone, { tile: string; value: string }> = {
  blue: { tile: '#3B82F6', value: 'text-gray-900' },
  orange: { tile: '#F97316', value: 'text-gray-900' },
  red: { tile: '#EF4444', value: 'text-rose-600' },
  violet: { tile: '#8B5CF6', value: 'text-gray-900' },
  pink: { tile: '#EC4899', value: 'text-gray-900' },
};

/** What a stat card means, read from the filters it was built with rather than from its name. */
export function statLook(card: Card): { tone: Tone; Icon: React.ElementType } {
  const f = card.config.filters ?? {};
  if (f.due === 'overdue') return { tone: 'red', Icon: AlertCircle };
  if (f.done) return { tone: 'violet', Icon: CheckCircle2 };
  if (f.due) return { tone: 'orange', Icon: CalendarDays };
  if (f.assignees?.includes('none')) return { tone: 'pink', Icon: Users };
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
    <div className="ui-card ui-card-hover group relative flex w-full items-center gap-3 px-4 py-3.5">
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
      <span className="tile-3d h-11 w-11 rounded-xl" style={{ '--tile': skin.tile } as React.CSSProperties}>
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs font-medium text-gray-500 ${filter ? 'pr-7' : ''}`}>{card.title}</span>
        <span className={`tabular block text-[1.625rem] font-semibold leading-tight tracking-tight ${value ? skin.value : 'text-gray-900'}`}>
          {value === null || value === undefined ? <span className="text-gray-300">—</span> : value}
        </span>
        <span className="block truncate text-[11px] text-gray-400">{statScope(card)}</span>
      </span>
        <ChevronRight size={16} className="shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-500" />
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
    // A heading for the row on the left and its one control on the right, so the control has a
    // line to belong to instead of standing alone above the tiles.
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <h2 className="ui-eyebrow mr-auto">At a glance</h2>
      {preset === 'custom' && value?.start && value?.end && (
        <span className="no-print text-xs text-gray-500">{value.start} to {value.end}</span>
      )}
      {/* "Each tile covers the window in its own name..." used to explain this control. The
          tiles' names say it; the board keeps headings only. */}
      <span className="no-print">
      <PeriodMenu
        // "Filter" at rest, like every other filter control in the app, and the period's own name
        // once one is chosen. It used to say "Period" here, which was the only control in the app
        // that named its field rather than its job -- so a row of filters read as a row of
        // different things. What it narrows is still obvious from the calendar on it, and the
        // moment a period is picked the button says which.
        label={value ? (choices.find(([v]) => v === preset)?.[1] ?? periodLabel(value)) : 'Filter'}
        preset={preset}
        choices={choices}
        disabled={!canEdit}
        onPick={onPick}
        onCustom={onCustom}
      />
      </span>
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
