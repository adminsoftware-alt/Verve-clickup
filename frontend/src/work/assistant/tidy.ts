// The sentence as meant, before any rule reads it.
//
// People do not type commands. They type "can you please mark the GST return done!!", "log two
// hours on payroll", "call the auditor tommorow". Every word of the meaning is there, and every rule
// downstream was written for the bare version -- so rather than teach each rule about politeness,
// spelling and number words, they are taken care of once, here.
//
// It only ever removes what carries no meaning or repairs what was plainly meant. It never invents
// a date or a person, and it leaves a task's own words alone: "Monday Motors" stays a client.

import { parseTypedDate } from '../dates';
import { parseDuration } from '../ui';
import { close } from './fuzzy';

/** "Can you please", "could you", "kindly" -- asked nicely, meant as an instruction. */
const POLITE_FRONT = /^\s*(?:(?:hey|hi|ok(?:ay)?|so|um+|uh+)[,\s]+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+|kindly\s+)?|please\s+(?:can|could|would)\s+you\s+|(?:please|kindly|pls|plz)\s+|i\s+(?:want|would like|'d like)\s+you\s+to\s+|go\s+ahead\s+and\s+)+/i;
const POLITE_BACK = /[\s,]+(?:please|pls|plz|thanks|thank you|thx)\s*[.!?]*\s*$/i;

/** Number words, for the places a number is said aloud: "two hours", "in three days". */
const NUMBER: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45, 'forty-five': 45,
  fifty: 50, sixty: 60, ninety: 90, 'a couple of': 2, 'couple of': 2, 'a few': 3,
};
const NUMBER_WORD = Object.keys(NUMBER).sort((x, y) => y.length - x.length).join('|');

/**
 * The day words a slip of the keyboard most often breaks.
 *
 * Compared with a tolerance scaled to the word's length, and only against these: a near miss is
 * repaired only when the word it is near is a date, so "fridge" stays a fridge.
 */
const DAY_WORDS = ['today', 'tomorrow', 'yesterday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
/** Real words a day name is one letter from. Left alone. */
const NOT_A_TYPO = new Set(['sundae', 'sundry', 'mondal', 'toddy', 'tidy', 'body', 'todays']);

/**
 * Fix a mistyped day word: "tommorow", "fridy", "wednsday".
 *
 * Exported so the parser can read a date word the same way here and inside a task's own clause.
 */
export function fixDayTypo(word: string): string {
  const w = word.toLowerCase();
  if (w.length < 4 || DAY_WORDS.includes(w) || NOT_A_TYPO.has(w)) return word;
  // "Mondays" is a plural, not a slip.
  if (w.endsWith('s') && DAY_WORDS.includes(w.slice(0, -1))) return word;
  const hit = DAY_WORDS.filter((d) => close(w, d));
  return hit.length === 1 ? hit[0] : word;
}

export interface Tidied {
  text: string;
  /** True when it ended in a question mark, which is worth knowing after the mark is gone. */
  asked: boolean;
  /** True when a word was repaired, so the panel can say what it read. Politeness does not count. */
  repaired: boolean;
}

export function tidy(input: string): Tidied {
  // A phone types “what’s” with a curly apostrophe; every rule downstream is written with a straight one.
  let text = input.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  const asked = /\?\s*[!.]*\s*$/.test(text);
  // Trailing punctuation is tone, not content: "call the auditor tomorrow!!" is the same task.
  text = text.replace(POLITE_BACK, '').replace(/[\s.!?,;]+$/, '').trim();
  for (let i = 0; i < 2; i += 1) text = text.replace(POLITE_FRONT, '').trim();
  const before = text;

  // "two hours", "thirty minutes", "half an hour", "an hour and a half" -- only in front of a unit,
  // so "call one client" keeps its words.
  text = text
    .replace(/\b(?:an?\s+)?hour\s+and\s+a\s+half\b/gi, '1.5 hours')
    .replace(/\bhalf\s+an?\s+hour\b/gi, '30 minutes')
    .replace(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+and\s+a\s+half\s+(hours?|hrs?)\b/gi,
      (_, n: string, unit: string) => `${(NUMBER[n.toLowerCase()] ?? Number(n)) + 0.5} ${unit}`)
    .replace(new RegExp(`\\b(${NUMBER_WORD})\\s+(hours?|hrs?|minutes?|mins?)\\b`, 'gi'),
      (_, n: string, unit: string) => `${NUMBER[n.toLowerCase().replace(/\s+/g, ' ')]} ${unit}`)
    // Days and weeks only after "in" or "for": "in two days" is a date, "plan a day out" is a task.
    .replace(new RegExp(`\\b(in|for|after)\\s+(${NUMBER_WORD})\\s+(days?|weeks?|months?)\\b`, 'gi'),
      (_, lead: string, n: string, unit: string) => `${lead} ${NUMBER[n.toLowerCase().replace(/\s+/g, ' ')]} ${unit}`);

  // Day words, mistyped. Word by word, keeping whatever punctuation was attached.
  text = text.replace(/[a-z]{4,}/gi, (w) => fixDayTypo(w));
  return { text, asked, repaired: text.toLowerCase() !== before.toLowerCase() };
}

/**
 * A length of time as somebody says it to the assistant.
 *
 * The app's own reader treats "2.5" as 2h05 -- right in a timesheet cell, where people type hours
 * and minutes with a dot between them. Said to the assistant, "2.5 hours" is two and a half, so a
 * single digit after the dot is a fraction here. Two digits are still minutes: "2.30" is 2h30.
 */
export function readDuration(text: string): number | null {
  const value = text.trim().toLowerCase();
  const decimal = value.match(/^(\d+)\.(\d)\s*(h|hr|hrs|hours?)?$/);
  if (decimal) return Math.round((Number(decimal[1]) + Number(decimal[2]) / 10) * 3600);
  const clock = value.match(/^(\d+)[.:](\d{2})\s*(?:h|hr|hrs|hours?)?$/);
  if (clock && Number(clock[2]) > 59) return Math.round(Number(`${clock[1]}.${clock[2]}`) * 3600);
  return parseDuration(value);
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';

/**
 * A day already gone: "yesterday", "on Monday", "last Friday", "12 Oct".
 *
 * The typed-date reader looks forward, because a due date is in the future -- "monday" said on a
 * Wednesday is next Monday. Hours logged and questions about them look back, where the same word
 * means the Monday just gone. A weekday said on that weekday is today.
 *
 * @returns the day at local midnight and the words it was read from, or null if none was said.
 */
export function pastDay(text: string, now = new Date()): { day: Date; from: string } | null {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const back = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
  let m: RegExpMatchArray | null;
  if ((m = text.match(/\b(?:on\s+)?(?:the\s+)?day\s+before\s+yesterday\b/i))) return { day: back(2), from: m[0] };
  if ((m = text.match(/\b(?:on\s+)?yesterday\b/i))) return { day: back(1), from: m[0] };
  if ((m = text.match(/\b(?:on\s+)?today\b/i))) return { day: today, from: m[0] };
  // Saturday and Sunday in full only: "sat with the client" is not a date.
  m = text.match(/\b(?:(last|on|this past|past)\s+)?(sunday|saturday|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?)\b/i);
  if (m) {
    const dow = WEEKDAYS.findIndex((d) => d.startsWith(m![2].toLowerCase().slice(0, 3)));
    let diff = (today.getDay() - dow + 7) % 7;
    if (diff === 0 && m[1] && /last|past/i.test(m[1])) diff = 7;
    return { day: back(diff), from: m[0] };
  }
  m = text.match(new RegExp(`\\b(?:on\\s+)?(\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}|${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?)\\b`, 'i'));
  if (m) {
    const d = parseTypedDate(m[1], now);
    if (d) {
      // "25 dec" said in October means last December here, not the coming one.
      if (d > today) d.setFullYear(d.getFullYear() - 1);
      return { day: d, from: m[0] };
    }
  }
  return null;
}
