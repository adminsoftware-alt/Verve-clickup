// Typed dates, as in ClickUp: "today", "tomorrow", "next monday", "fri", "in 3 days", "2 weeks",
// "end of month", "25 dec", "25/12", "2026-12-25". Returns local midnight, or null if not understood.

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const at = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const prefix = (list: string[], word: string) => (word.length >= 3 ? list.findIndex((x) => x.startsWith(word)) : -1);

function dayMonth(day: number, month: number, year: number | null, today: Date): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  let y = year ?? today.getFullYear();
  if (y < 100) y += 2000;
  let d = new Date(y, month, day);
  if (d.getMonth() !== month) return null; // 31 Feb
  if (year === null && d < today) d = new Date(y + 1, month, day); // "25 dec" means the next one
  return d;
}

export function parseTypedDate(input: string, now: Date = new Date()): Date | null {
  const today = at(now);
  const text = input.trim().toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ');
  if (!text) return null;
  if (text === 'today' || text === 'tod' || text === 'now') return today;
  if (text === 'tomorrow' || text === 'tom' || text === 'tmrw') return addDays(today, 1);
  if (text === 'yesterday') return addDays(today, -1);

  let m = text.match(/^(?:in )?(\d{1,3}) ?(d|day|days|w|wk|week|weeks|m|mo|month|months)(?: from now)?$/);
  if (m) {
    const n = Number(m[1]);
    if (m[2].startsWith('d')) return addDays(today, n);
    if (m[2].startsWith('w')) return addDays(today, 7 * n);
    const x = new Date(today); x.setMonth(x.getMonth() + n); return x;
  }
  if (text === 'next week') return addDays(today, 7 - ((today.getDay() + 6) % 7)); // next Monday
  if (text === 'end of week' || text === 'eow') return addDays(today, (5 - today.getDay() + 7) % 7); // Friday
  if (text === 'next month') return new Date(today.getFullYear(), today.getMonth() + 1, 1);
  if (text === 'end of month' || text === 'eom') return new Date(today.getFullYear(), today.getMonth() + 1, 0);

  m = text.match(/^(next |this |on )?([a-z]+)$/);
  if (m) {
    const dow = prefix(DAYS, m[2]);
    if (dow >= 0) {
      if (m[1] === 'next ') {
        // "next friday": that day in next week (weeks start on Monday).
        const nextMonday = addDays(today, 7 - ((today.getDay() + 6) % 7));
        return addDays(nextMonday, (dow + 6) % 7);
      }
      const diff = (dow - today.getDay() + 7) % 7;
      return addDays(today, diff === 0 ? 7 : diff); // "monday" on a Monday means the coming one
    }
  }
  m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return dayMonth(Number(m[3]), Number(m[2]) - 1, Number(m[1]), today);
  m = text.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/); // day first, as in India
  if (m) return dayMonth(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : null, today);
  m = text.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{2,4}))?$/);
  if (m && prefix(MONTHS, m[2]) >= 0) return dayMonth(Number(m[1]), prefix(MONTHS, m[2]), m[3] ? Number(m[3]) : null, today);
  m = text.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{2,4}))?$/);
  if (m && prefix(MONTHS, m[1]) >= 0) return dayMonth(Number(m[2]), prefix(MONTHS, m[1]), m[3] ? Number(m[3]) : null, today);
  return null;
}

export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
