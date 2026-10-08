// Turning a spoken or typed sentence into a task, without asking anybody's API.
//
// "add task workup meeting as normal for today to tomorrow and assign to me" is five regexes and
// a name lookup. The app already parses dates the way a person says them (`parseTypedDate`) and
// durations the way a person says them (`parseDuration`), so the only new work is pulling the
// clauses apart and deciding what is left over -- which is the task's name.
//
// Rules first, and a model only for what the rules cannot do, for three reasons: this is free,
// it is instant, and it cannot invent an assignee who does not work here. What it cannot handle
// -- two tasks in one sentence, a name it does not recognise, a clause in the middle of another
// -- it says so, and `confidence` is what the caller shows the person before anything is created.

import { parseTypedDate } from '../dates';
import { parseDuration } from '../ui';

export interface Person {
  id: string;
  display_name?: string | null;
  email: string;
}

export interface ParsedCommand {
  name: string;
  priority: number | null;
  start_date: string | null;
  due_date: string | null;
  time_estimate_seconds: number | null;
  assignees: string[];
  /** The words each field came from, so the preview can show its working. */
  found: { field: string; from: string }[];
  /** Anything that looked like an instruction but matched nobody and nothing. */
  unknown: string[];
  /** 'high' when every clause was understood; 'low' when something was left over. */
  confidence: 'high' | 'low';
}

const PRIORITY_WORDS: [RegExp, number][] = [
  [/\b(urgent|critical|asap|emergency|top priority)\b/i, 1],
  [/\b(high priority|high|important)\b/i, 2],
  [/\b(normal|medium|normal priority)\b/i, 3],
  [/\b(low priority|low|whenever|minor)\b/i, 4],
];

/** Words that introduce a clause rather than belong to the task's name. Each one keeps its
 *  word boundaries: without them the optional "to" matches the first two letters of
 *  "tomorrow", and a date becomes a task called "morrow". */
const LEAD_IN = /^(?:please\s+)?(?:can you\s+)?(?:\b(?:add|create|make|new)\b\s*)?(?:\ba\b\s*)?(?:\b(?:task|todo|to-do|reminder)\b\s*)?(?:\b(?:called|named|for|to)\b\s*)?/i;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Someone's first name, their full name, or their email -- whichever was said. */
function matchPerson(word: string, people: Person[]): Person | 'me' | null {
  const needle = word.trim().toLowerCase();
  if (!needle) return null;
  if (needle === 'me' || needle === 'myself' || needle === 'my') return 'me';
  const named = (p: Person) => (p.display_name || p.email).toLowerCase();
  const exact = people.find((p) => named(p) === needle || p.email.toLowerCase() === needle);
  if (exact) return exact;
  // A first name, which is how people actually speak. Only when it picks out one person: two
  // Priyas and a guess is worse than asking.
  const byFirst = people.filter((p) => named(p).split(/\s+/)[0] === needle);
  if (byFirst.length === 1) return byFirst[0];
  const contains = people.filter((p) => named(p).includes(needle));
  return contains.length === 1 ? contains[0] : null;
}

const iso = (d: Date) => {
  const at = new Date(d);
  at.setHours(12, 0, 0, 0); // midday, so a timezone shift cannot move it to the day before
  return at.toISOString();
};

/**
 * Read a sentence as a task.
 *
 * `me` is the signed-in person's id, so "assign to me" has somebody to mean.
 */
export function parseCommand(input: string, people: Person[], me?: string, now = new Date()): ParsedCommand {
  const found: ParsedCommand['found'] = [];
  const unknown: string[] = [];
  let rest = squash(input);

  // Take each clause out of the sentence as it is understood. Whatever survives is the name,
  // which is why the order matters: the longest and most distinctive patterns go first.
  const take = (pattern: RegExp, onMatch: (m: RegExpMatchArray) => boolean | void) => {
    const m = rest.match(pattern);
    if (!m) return;
    if (onMatch(m) !== false) rest = squash(rest.replace(m[0], ' '));
  };

  // --- who ------------------------------------------------------------------------------------
  //
  // "assign to me and aarti" and "assign to me and file it tomorrow" start identically, so a
  // regex that stops at "and" loses Aarti and one that does not swallows the rest of the
  // sentence. Walk forward from "assign to" instead, taking a word at a time for as long as it
  // names somebody, and stop at the first that does not -- which leaves it in the sentence where
  // it belongs.
  const assignees: string[] = [];
  const to = rest.match(/\b(?:and\s+)?assign(?:ed)?\s+(?:it\s+)?to\s+/i);
  if (to && to.index !== undefined) {
    const after = rest.slice(to.index + to[0].length);
    const words = after.split(/\s+/);
    let taken = 0;
    let lastFailed = '';
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i].replace(/[,.]$/, '');
      if (/^and$/i.test(word)) {
        // Only a joiner if a name follows it; otherwise it belongs to the next clause.
        const next = (words[i + 1] || '').replace(/[,.]$/, '');
        if (next && matchPerson(next, people)) { taken = i + 1; continue; }
        break;
      }
      // A two-word name ("aarti yadav") before falling back to one.
      const pair = `${word} ${(words[i + 1] || '').replace(/[,.]$/, '')}`.trim();
      const both = words[i + 1] ? matchPerson(pair, people) : null;
      const hit = both ?? matchPerson(word, people);
      if (!hit) { lastFailed = word; break; }
      assignees.push(hit === 'me' ? (me ?? '') : hit.id);
      found.push({ field: 'Assignee', from: both ? pair : word });
      i += both ? 1 : 0;
      taken = i + 1;
    }
    if (taken > 0) {
      const consumed = `${to[0]}${words.slice(0, taken).join(' ')}`;
      rest = squash(rest.replace(consumed, ' '));
    } else if (lastFailed) {
      unknown.push(`nobody here is called "${lastFailed}"`);
      rest = squash(rest.replace(to[0] + lastFailed, ' '));
    }
  }

  // --- how long -------------------------------------------------------------------------------
  let estimate: number | null = null;
  take(/\b(?:estimate|should take|takes|about|roughly)\s+(\d+(?:[.:]\d+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)?)\b/i, (m) => {
    const seconds = parseDuration(m[1]);
    if (seconds === null) return false;
    estimate = seconds;
    found.push({ field: 'Estimate', from: m[1] });
  });

  // --- when -----------------------------------------------------------------------------------
  let start: Date | null = null;
  let due: Date | null = null;

  // A span: "today to tomorrow", "from monday to friday", "25 dec until 2 jan".
  //
  // Found by candidate rather than by pattern. A single regex over the whole sentence matches the
  // shortest thing that looks like a span, which in "as normal for today to tomorrow" is not the
  // span -- so each "to" is tried in turn, with up to three words either side, and the first pair
  // where both sides are real dates wins.
  const words = rest.split(/\s+/);
  for (let i = 1; i < words.length - 1 && !due; i += 1) {
    if (!/^(to|until|till|through)$/i.test(words[i])) continue;
    for (let back = 1; back <= 3 && !due; back += 1) {
      const left = words.slice(Math.max(0, i - back), i).join(' ').replace(/^(?:for|from|starting|start)\s+/i, '');
      const a = parseTypedDate(left, now);
      if (!a) continue;
      for (let fwd = 1; fwd <= 3 && !due; fwd += 1) {
        const right = words.slice(i + 1, Math.min(words.length, i + 1 + fwd)).join(' ');
        const b = parseTypedDate(right, now);
        if (!b || b < a) continue;
        start = a;
        due = b;
        const whole = words.slice(Math.max(0, i - back), Math.min(words.length, i + 1 + fwd)).join(' ');
        found.push({ field: 'Dates', from: whole });
        // Take the lead-in word with it, so "for" does not survive into the name.
        rest = squash(rest.replace(new RegExp(`(?:\\b(?:for|from|starting|start)\\s+)?${whole.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), ' '));
      }
    }
  }

  if (!due) {
    take(/\b(?:due|by|before|on|for)\s+([a-z0-9/\- ]+?)(?=\s+(?:and|assign|as|with|priority|estimate)\b|$)/i, (m) => {
      const d = parseTypedDate(m[1], now);
      if (!d) return false;
      due = d;
      found.push({ field: 'Due', from: m[1].trim() });
    });
  }
  if (!start && !due) {
    // A bare day at the end: "call the auditor tomorrow".
    take(/(?:^|\s)(today|tomorrow|tmrw|yesterday|next week|next month|end of month|eom|eow|(?:next\s+)?(?:mon|tues?|wed(?:nes)?|thurs?|fri|sat(?:ur)?|sun)(?:day)?)\s*$/i, (m) => {
      const d = parseTypedDate(m[1], now);
      if (!d) return false;
      due = d;
      found.push({ field: 'Due', from: m[1].trim() });
    });
  }

  // --- how urgent -----------------------------------------------------------------------------
  let priority: number | null = null;
  for (const [pattern, value] of PRIORITY_WORDS) {
    const m = rest.match(new RegExp(`\\b(?:as|at|with|priority)?\\s*${pattern.source}\\b`, 'i'));
    if (!m) continue;
    priority = value;
    found.push({ field: 'Priority', from: squash(m[0]) });
    rest = squash(rest.replace(m[0], ' '));
    break;
  }

  // --- what is left is the name ---------------------------------------------------------------
  // "assign to me and file the TDS return" leaves "and file the TDS return" once the names are
  // taken; the conjunction joined two clauses, and only one of them is still here.
  let name = squash(rest.replace(/^\s*(?:and|then)\s+/i, ''));
  name = squash(name.replace(LEAD_IN, ''));
  // Punctuation stranded where a clause used to be: "the board pack, ," is what is left when the
  // estimate between two commas is lifted out.
  name = squash(name.replace(/\s*,\s*(?=,|$)/g, '').replace(/[,;]+\s*$/, ''));
  // Trailing conjunctions and prepositions left behind by the clauses that were lifted out.
  name = squash(name.replace(/\b(and|with|as|for|to|the|by|on|due)\s*$/i, ''));
  name = name.replace(/^["\u2018\u2019\u201c\u201d']|["\u2018\u2019\u201c\u201d']$/g, '').trim();
  if (name) name = name[0].toUpperCase() + name.slice(1);

  if (!name) unknown.push('no task name was left once everything else was understood');

  return {
    name,
    priority,
    start_date: start ? iso(start) : null,
    due_date: due ? iso(due) : null,
    time_estimate_seconds: estimate,
    assignees: [...new Set(assignees)],
    found,
    unknown,
    confidence: unknown.length === 0 && name.length > 0 ? 'high' : 'low',
  };
}
