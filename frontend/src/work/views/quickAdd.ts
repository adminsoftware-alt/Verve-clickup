// Smart quick add: "Call Nova Foods tomorrow !high @Aarti 2h" becomes a task named "Call Nova
// Foods", due tomorrow, High priority, assigned to Aarti, estimated at two hours. Whatever is not
// recognised stays in the name, so nothing typed is ever lost.
import type { TaskInput, UserRef } from '../api';
import { PRIORITIES, fromDateInput, parseDuration } from '../ui';

export interface QuickAdd {
  name: string;
  input: TaskInput;
  /** What was understood, for the chips under the box: "Due Tue 30 Oct", "High", "Aarti", "2h". */
  chips: string[];
}

const PRIORITY_WORDS: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4, '1': 1, '2': 2, '3': 3, '4': 4 };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plus = (d: Date, days: number) => { const x = new Date(d); x.setDate(x.getDate() + days); return x; };

/** A date said in words, or null. Matched against the whole text; returns the date and the words. */
function findDate(text: string, now: Date): { day: Date; match: string } | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tries: [RegExp, (m: RegExpMatchArray) => Date | null][] = [
    [/\b(today|tdy)\b/i, () => today],
    [/\b(tomorrow|tmrw|tmr)\b/i, () => plus(today, 1)],
    [/\bnext week\b/i, () => plus(today, ((8 - today.getDay()) % 7) || 7)],
    [/\bin (\d{1,3}) days?\b/i, (m) => plus(today, Number(m[1]))],
    [/\b(?:next |on )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|urday|sday)?\b/i, (m) => {
      const want = DAYS.findIndex((d) => d.startsWith(m[1].toLowerCase().slice(0, 3)));
      return plus(today, ((want - today.getDay() + 7) % 7) || 7);
    }],
    // 30 Oct, 30 October
    [/\b(\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i, (m) => monthDay(today, Number(m[1]), m[2])],
    // Oct 30
    [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})\b/i, (m) => monthDay(today, Number(m[2]), m[1])],
    // 30/10, as written in India
    [/\b(\d{1,2})\/(\d{1,2})\b/, (m) => monthDay(today, Number(m[1]), MONTHS[Number(m[2]) - 1] ?? '')],
  ];
  for (const [re, make] of tries) {
    const m = text.match(re);
    if (!m) continue;
    const day = make(m);
    if (day) return { day, match: m[0] };
  }
  return null;
}

/** That day of that month, this year -- or next year, if it has already gone by. */
function monthDay(today: Date, day: number, month: string): Date | null {
  const mi = MONTHS.indexOf(month.toLowerCase().slice(0, 3));
  if (mi < 0 || day < 1 || day > 31) return null;
  const d = new Date(today.getFullYear(), mi, day);
  if (d.getMonth() !== mi) return null;
  return d < today ? new Date(today.getFullYear() + 1, mi, day) : d;
}

export function parseQuickAdd(text: string, people: UserRef[], now = new Date()): QuickAdd {
  let rest = ` ${text} `;
  const input: TaskInput = {};
  const chips: string[] = [];

  const pr = rest.match(/\s!(urgent|high|normal|low|[1-4])\b/i);
  if (pr) {
    const p = PRIORITY_WORDS[pr[1].toLowerCase()];
    input.priority = p;
    chips.push(PRIORITIES[p].label);
    rest = rest.replace(pr[0], ' ');
  }

  // @aarti, @aarti.yadav -- the first person whose name or email starts with it.
  const ids: string[] = [];
  for (const m of [...rest.matchAll(/\s@([\w.-]+)/g)]) {
    const q = m[1].toLowerCase();
    const who = people.find((p) => (p.display_name || '').toLowerCase().split(/\s+/).some((w) => w.startsWith(q))
      || (p.display_name || '').toLowerCase().replace(/\s+/g, '.').startsWith(q)
      || p.email.toLowerCase().startsWith(q));
    if (who && !ids.includes(who.id)) {
      ids.push(who.id);
      chips.push(who.display_name || who.email);
      rest = rest.replace(m[0], ' ');
    }
  }
  if (ids.length) input.assignees = ids;

  // 2h, 30m, 1h30m, 1.5h
  const est = rest.match(/\s(\d+(?:\.\d+)?(?:h|hr|hrs|m|min|mins)(?:\d+(?:m|min|mins))?)(?=\s)/i);
  if (est) {
    const secs = parseDuration(est[1].replace(/([a-z])(\d)/gi, '$1 $2'));
    if (secs) {
      input.time_estimate_seconds = secs;
      chips.push(est[1]);
      rest = rest.replace(est[0], ' ');
    }
  }

  const date = findDate(rest, now);
  if (date) {
    input.due_date = fromDateInput(ymd(date.day));
    chips.push(`Due ${date.day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`);
    // "due tomorrow", "by Friday": the little word in front goes too.
    rest = rest.replace(new RegExp(`\\s(?:due |by |on )?${date.match.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`, 'i'), ' ');
  }

  const name = rest.replace(/\s+/g, ' ').trim();
  return { name: name || text.trim(), input, chips };
}
