// "Every Monday", "monthly", "every 2 weeks" -- a repeat, said in passing.
//
// Recurring work is most of what an accounts firm does: rent on the first, TDS by the seventh,
// a payroll run every month. Said to the assistant, the repeat is just another clause of the
// sentence, so it is read the way the dates are: found, taken out of the name, and turned into the
// same rule the Repeat field in a task would have saved.
//
// It produces only what the Repeat field can show back -- daily, weekly on given days, monthly on
// a given day, yearly, every N of any of them -- and the defaults that field starts from: the next
// one is made when this one is done, as a new task. Anything it does not recognise stays in the
// sentence, where the parser reports it rather than guessing.

import type { Recurrence } from '../api';

/** A repeat as read: the rule, the words it came from, and the first day it falls on, if fixed. */
export interface RepeatRead {
  rule: Recurrence;
  /** The words, so they can be taken out of the name and shown. */
  from: string;
  /** The first occurrence, for a task that said when it repeats but not when it is first due. */
  first: Date | null;
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?s?';
const ORDINAL = '(\\d{1,2})(?:st|nd|rd|th)?';

const tz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};
/** 0 = Monday, as the API counts. */
const weekday = (word: string) => DAYS.findIndex((d) => d.startsWith(word.toLowerCase().replace(/s$/, '').slice(0, 3)));
const at = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** The next date on one of these weekdays, counting from tomorrow -- "every Monday" said on a Monday is next week's. */
function nextWeekday(days: number[], now: Date): Date | null {
  if (!days.length) return null;
  const today = at(now);
  for (let i = 1; i <= 7; i += 1) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    if (days.includes((d.getDay() + 6) % 7)) return d;
  }
  return null;
}

/** The next date that is this day of the month, today included. */
function nextMonthDay(day: number, now: Date): Date {
  const today = at(now);
  const clamp = (y: number, m: number) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  const thisMonth = clamp(today.getFullYear(), today.getMonth());
  return thisMonth >= today ? thisMonth : clamp(today.getFullYear(), today.getMonth() + 1);
}

const rule = (frequency: Recurrence['frequency'], extra: Partial<Recurrence> = {}): Recurrence => ({
  frequency, interval: 1, weekdays: null, month_day: null,
  trigger: 'on_done', action: 'new_task', sync_to_due: true, tz: tz(), ...extra,
});

/** Read a repeat out of a sentence, or null when it does not say one. */
export function readRepeat(text: string, now = new Date()): RepeatRead | null {
  const t = text;
  let m: RegExpMatchArray | null;

  // "every weekday", "on weekdays", "every working day".
  if ((m = t.match(/\b(?:every|each|on)\s+(?:week\s?days?|working\s+days?|business\s+days?)\b/i))) {
    const days = [0, 1, 2, 3, 4];
    return { rule: rule('weekly', { weekdays: days }), from: m[0], first: nextWeekday(days, now) };
  }
  // "every monday", "every mon and thu", "on mondays", "every other friday".
  m = t.match(new RegExp(`\\b(?:(?:every|each)\\s+(other\\s+|alternate\\s+|second\\s+)?|on\\s+(?=${DAY}s\\b))(${DAY}(?:\\s*(?:,|and|&)\\s*${DAY})*)\\b`, 'i'));
  if (m) {
    const days = [...new Set(m[2].split(/\s*(?:,|and|&)\s*/i).map(weekday).filter((d) => d >= 0))].sort();
    if (days.length) {
      return { rule: rule('weekly', { weekdays: days, interval: m[1] ? 2 : 1 }), from: m[0], first: nextWeekday(days, now) };
    }
  }
  // "on the 5th of every month", "every month on the 5th", "every 5th", "monthly on the 1st".
  m = t.match(new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?${ORDINAL}\\s+of\\s+(?:every|each)\\s+month\\b`, 'i'))
    ?? t.match(new RegExp(`\\b(?:every|each)\\s+month\\s+on\\s+(?:the\\s+)?${ORDINAL}\\b`, 'i'))
    ?? t.match(new RegExp(`\\bmonthly\\s+on\\s+(?:the\\s+)?${ORDINAL}\\b`, 'i'))
    ?? t.match(new RegExp(`\\b(?:every|each)\\s+${ORDINAL}(?=\\s|$)(?!\\s*(?:days?|weeks?|months?|years?))`, 'i'));
  if (m) {
    const day = Number(m[1]);
    if (day >= 1 && day <= 31) return { rule: rule('monthly', { month_day: day }), from: m[0], first: nextMonthDay(day, now) };
  }
  // "every 2 weeks", "every 3 days", "every 6 months", "every other week".
  m = t.match(/\b(?:every|each)\s+(\d{1,3}|other|alternate)\s+(days?|weeks?|months?|years?)\b/i);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 2;
    const unit = m[2].toLowerCase().replace(/s$/, '');
    const frequency = unit === 'day' ? 'daily' : unit === 'week' ? 'weekly' : unit === 'month' ? 'monthly' : 'yearly';
    return { rule: rule(frequency, { interval: Math.max(1, n) }), from: m[0], first: null };
  }
  // "every quarter" anywhere; "fortnightly" and "quarterly" alone only where a clause ends, since
  // "quarterly compliance report" is the work, not how often it comes round.
  const END = '(?=\\s*(?:$|[,.;]|\\b(?:and|due|by|from|starting|start|assign|priority|estimate|until|till)\\b))';
  if ((m = t.match(new RegExp(`\\b(?:fortnightly|bi-?weekly)${END}`, 'i')))) return { rule: rule('weekly', { interval: 2 }), from: m[0], first: null };
  if ((m = t.match(/\b(?:every|each)\s+quarter\b/i)) || (m = t.match(new RegExp(`\\bquarterly${END}`, 'i')))) {
    return { rule: rule('monthly', { interval: 3 }), from: m[0], first: null };
  }
  // "every day", "every week", "every month", "every year" -- anywhere, because "every" says it.
  if ((m = t.match(/\b(?:every\s?day|each\s+day)\b/i))) return { rule: rule('daily'), from: m[0], first: null };
  if ((m = t.match(/\b(?:every|each)\s+week\b/i))) return { rule: rule('weekly'), from: m[0], first: null };
  if ((m = t.match(/\b(?:every|each)\s+month\b/i))) return { rule: rule('monthly'), from: m[0], first: null };
  if ((m = t.match(/\b(?:every|each)\s+year\b/i))) return { rule: rule('yearly'), from: m[0], first: null };
  // "daily", "weekly", "monthly", "yearly" on their own only where a clause ends. In the middle
  // of words they are the work itself: "weekly review", "monthly MIS", "Daily standup notes".
  const bare: [RegExp, Recurrence['frequency']][] = [
    [new RegExp(`\\bdaily${END}`, 'i'), 'daily'],
    [new RegExp(`\\bweekly${END}`, 'i'), 'weekly'],
    [new RegExp(`\\bmonthly${END}`, 'i'), 'monthly'],
    [new RegExp(`\\b(?:yearly|annually)${END}`, 'i'), 'yearly'],
  ];
  for (const [pattern, frequency] of bare) {
    if ((m = t.match(pattern))) return { rule: rule(frequency), from: m[0], first: null };
  }
  return null;
}

/**
 * Fill in the parts a repeat takes from the task's own dates, the way the Repeat field does:
 * weekly falls on the due date's weekday, monthly on its day of the month.
 */
export function settle(r: Recurrence, due: string | null, now = new Date()): Recurrence {
  const anchor = due ? new Date(due) : now;
  if (r.frequency === 'weekly' && !r.weekdays?.length) return { ...r, weekdays: [(anchor.getDay() + 6) % 7] };
  if (r.frequency === 'monthly' && !r.month_day) return { ...r, month_day: anchor.getDate() };
  return r;
}

const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const UNIT = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year', days_after: 'day' } as const;

/** "Every Monday", "Every 2 weeks", "Monthly on the 5th" -- short, for a chip. */
export function sayRepeat(r: Recurrence | null): string {
  if (!r) return 'Does not repeat';
  const unit = UNIT[r.frequency];
  const every = r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`;
  if (r.frequency === 'weekly' && r.weekdays?.length) {
    if (r.interval === 1 && r.weekdays.join() === '0,1,2,3,4') return 'Every weekday';
    return `${r.interval > 1 ? `Every ${r.interval} weeks on` : 'Every'} ${r.weekdays.map((d) => SHORT[d]).join(', ')}`;
  }
  if (r.frequency === 'monthly' && r.month_day) return `${every} on day ${r.month_day}`;
  return every;
}
