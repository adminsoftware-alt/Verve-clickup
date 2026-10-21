// One sentence in, one reading out.
//
// Everything the assistant understands goes through `interpret`: the tidy-up, the Hindi, which kind
// of request it is, and the details of that kind. What comes back is plain data -- which task it
// named, what to change, how long, which day -- and nothing in here talks to the server. The panel
// takes the reading and does the looking up and the acting.
//
// That split is deliberate, and it is the seam for what may come later. Understanding is done by
// rules today because rules are free, instant and cannot invent a colleague. If the firm decides to
// put a language model behind the assistant, it replaces this one function -- it has to return a
// `Reading` like this one does -- and nothing in the panel needs to know.

import type { Hierarchy } from '../api';
import { readDelete, readEdit, readShape, type Change } from './edit';
import { toEnglish } from './hindi';
import { readIntent } from './intent';
import { parseCommand, matchPerson, type ParsedCommand, type Person } from './parseCommand';
import { splitTasks } from './splitTasks';
import { pastDay, readDuration, tidy } from './tidy';
import { askedAbout, topicOf, type Topic } from './topics';
import { readWhere, type WhereRead } from './where';

export interface Context {
  /** Everybody a task can be given to. */
  people: Person[];
  /** The signed-in person, so "me" and "my" mean somebody. */
  me?: string;
  /** The tree they can see, so a destination said aloud can be found. */
  hierarchy: Hierarchy | null;
  now?: Date;
}

/** A filter on a list of tasks: which dates. */
export type Due = 'overdue' | 'today' | 'tomorrow' | 'week';

/**
 * What a sentence asks for.
 *
 * `which` is how a task was referred to, ready to search for. An empty `which` means the sentence
 * pointed at a task without naming it -- "make it urgent", "delete it" -- and the panel takes that
 * to be the task it last touched.
 */
export type Reading = (
  | { kind: 'create'; tasks: ParsedCommand[]; sharedFrom: string | null; where: WhereRead }
  | { kind: 'update'; which: string; changes: Change[]; unknown: string[] }
  | { kind: 'complete'; which: string }
  | { kind: 'delete'; which: string }
  /** `day` is a local calendar day (YYYY-MM-DD) when the hours belong to another day. */
  | { kind: 'log_time'; seconds: number; which: string; day: string | null }
  | { kind: 'timer'; action: 'start' | 'stop'; which: string }
  | { kind: 'comment'; which: string; body: string }
  /** A list of tasks: someone's, or matching some words, or due at some point. */
  | { kind: 'find'; due: Due | null; person: Person | null; search: string; label: string }
  | { kind: 'ask'; question: string; topic: Topic; about: Person | null; day: string | null; which: string }
  | { kind: 'unknown' }
) & {
  /** What they said, as they said it. */
  said: string;
  /** What the rules read: tidied, and in English. */
  english: string;
  /** True when that is worth showing -- a translation or a repaired word, not just "please". */
  changed: boolean;
};

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const UNIT = '(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)';

/**
 * The words to search for a task by, without the words that only pointed at it.
 *
 * The search is a plain "name contains this phrase", so "the GST return task" finds nothing while
 * "GST return" finds it. Hindi particles go too: "GST return ko" is "GST return".
 */
export function searchable(which: string): string {
  let s = squash(which.replace(/[“”"'‘’]/g, ' ').replace(/[?!.,;:]+(?=\s|$)/g, ' '));
  for (let i = 0; i < 3; i += 1) {
    s = squash(s
      .replace(/^(?:please|the|a|an|my|this|that|our|on|for|to|of)\s+/i, '')
      .replace(/^tasks?\s+(?:called\s+|named\s+)?/i, '')
      .replace(/^(?:called|named)\s+/i, '')
      .replace(/\s+(?:task|tasks|please|ko|ka|ke|ki|pe|par|wala|wali|vala)$/i, ''));
  }
  s = squash(s.replace(/\s+(?:ko|ka|ke|ki)\s+/gi, ' '));
  return /^(?:it|that|this|them|one|the one)$/i.test(s) ? '' : s;
}

/** A due-date filter said in a question or a "show me". */
function dueOf(text: string): Due | null {
  if (/\b(?:overdue|late|past due|behind)\b/i.test(text)) return 'overdue';
  if (/\b(?:tomorrow|tmrw)\b/i.test(text)) return 'tomorrow';
  if (/\b(?:today|my day|right now)\b/i.test(text)) return 'today';
  if (/\b(?:this week|next 7 days|week|on my plate)\b/i.test(text)) return 'week';
  return null;
}

/** Whose tasks a "show me" asks for: "Asmita's tasks", "tasks for Aditya". Never a guess. */
function whose(text: string, people: Person[], me?: string): Person | null {
  const named = text.match(/\b([A-Za-z]+(?:\s+[A-Za-z]+)?)[’']s\s+(?:open\s+|overdue\s+|pending\s+)?(?:tasks?|work)\b/i)
    ?? text.match(/\b(?:tasks?|work)\s+(?:for|of|assigned to|with)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i)
    ?? text.match(/\b(?:for|of)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\s*$/i);
  if (!named) return askedAbout(text, people, me);
  const words = named[1].split(/\s+/);
  for (let n = words.length; n >= 1; n -= 1) {
    const hit = matchPerson(words.slice(0, n).join(' '), people, { fuzzy: false });
    if (hit && hit !== 'me' && hit.id !== me) return hit;
    if (hit === 'me') return null;
  }
  return null;
}

export function interpret(said: string, ctx: Context): Reading {
  const now = ctx.now ?? new Date();
  const { people, me, hierarchy } = ctx;
  // Politeness, punctuation, number words and slipped day names first, then the Hindi, then once
  // more for anything the translation produced.
  const first = tidy(said);
  const translated = toEnglish(first.text, now);
  const second = tidy(translated.text);
  const english = second.text;
  const base = { said, english, changed: translated.changed || first.repaired || second.repaired };
  // The question mark went with the rest of the punctuation; it is put back for the one reader
  // that cares whether it was there.
  const { intent, rest } = readIntent(first.asked ? `${english}?` : english);

  if (intent === 'create') {
    // Where it goes, read from the sentence. "Add a task to the skills section" names its
    // destination, and the words that name it are then taken out before the task is parsed --
    // otherwise "to the skills section" becomes part of the task's name.
    const where = readWhere(english, hierarchy);
    const read = (text: string) => {
      // A meeting produces several things at once, and the app has always made people type them
      // one at a time -- so they type none of them.
      const { tasks, sharedFrom } = splitTasks(text, people, me, now);
      return { tasks: tasks.length ? tasks : [parseCommand(text, people, me, now)], sharedFrom };
    };
    let got = read(where.from ? english.replace(where.from, ' ') : english);
    // Taking the place out should never take the whole name with it. If it did, the "place" was
    // the task, and the sentence is read again with it left in.
    if (where.from && !where.list && got.tasks.every((t) => !t.name)) {
      got = read(english);
      return { ...base, kind: 'create', ...got, where: { list: null, options: [], from: null, missed: null } };
    }
    return { ...base, kind: 'create', ...got, where };
  }

  if (intent === 'update') {
    const r = readEdit(english, people, me, now);
    return { ...base, kind: 'update', which: searchable(r.which), changes: r.changes, unknown: r.unknown };
  }

  if (intent === 'delete') {
    // "Remove Aarti from the audit" takes a person off a task; it does not delete the task.
    const shaped = readShape(english, people, me, now);
    if (shaped && shaped.changes.some((c) => c.field === 'remove_assignees' || c.field === 'assignees')) {
      return { ...base, kind: 'update', which: searchable(shaped.which), changes: shaped.changes, unknown: shaped.unknown };
    }
    return { ...base, kind: 'delete', which: searchable(readDelete(english) ?? '') };
  }

  if (intent === 'complete') {
    const which = rest.replace(/\b(?:as\s+)?(?:done|complete|completed|finished|closed)\s*$/i, '')
      .replace(/^i(?:'ve|\s+have)?\s+(?:just\s+)?(?:finished|done|completed)\s+/i, '');
    return { ...base, kind: 'complete', which: searchable(which) };
  }

  if (intent === 'log_time') {
    const duration = rest.match(new RegExp(`(\\d+(?:[.:]\\d+)?)\\s*(${UNIT})?\\b`, 'i'));
    const seconds = duration ? readDuration(`${duration[1]}${duration[2] ? ` ${duration[2]}` : ''}`) ?? 0 : 0;
    // Which day the hours belong to: "yesterday", "on Monday". Today unless they said otherwise.
    const when = pastDay(rest, now);
    let text = rest;
    if (when) text = text.replace(when.from, ' ');
    if (duration) text = text.replace(duration[0], ' ');
    text = squash(text
      .replace(/^(?:i\s+)?(?:log(?:ged)?|record(?:ed)?|put|add(?:ed)?|book(?:ed)?|spent|worked)\s+(?:in\s+)?/i, '')
      .replace(/\s+log(?:ged)?\s*$/i, ''));
    const onWhat = text.match(/\b(?:on|to|against|for|towards)\s+(.+)$/i)?.[1] ?? text;
    const which = searchable(onWhat.replace(/\s+(?:on|to|for|against)$/i, ''));
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const day = when && when.day.getTime() !== today.getTime() ? isoDay(when.day) : null;
    return { ...base, kind: 'log_time', seconds, which, day };
  }

  if (intent === 'timer') {
    const stop = /^(?:stop|end|pause)\b/i.test(english);
    const which = english
      .replace(/^(?:start|begin|stop|end|pause|resume|restart)\s+(?:the\s+|a\s+|my\s+)?(?:timer|tracking|time\s+tracking|clock|stopwatch|timing)\b/i, '')
      .replace(/^timer\b/i, '');
    return { ...base, kind: 'timer', action: stop ? 'stop' : 'start', which: searchable(which) };
  }

  if (intent === 'comment') {
    const t = english.replace(/^(?:add|post|leave|write|put)\s+(?:a\s+)?/i, '');
    // "comment on X: body", "comment on X saying body", "a comment to X that body".
    let m = t.match(/^(?:comment|note)\s+(?:on|to|for)\s+(.+?)\s*(?::|\bsaying\b|\bthat says\b|\bwhich says\b|\bthat\b|\s-\s|—)\s*(.+)$/i);
    if (m) return { ...base, kind: 'comment', which: searchable(m[1]), body: m[2].trim() };
    // "comment waiting for client docs on X": the body first, the task after the last "on".
    m = t.match(/^(?:comment|note)\s*:?\s+(.+)\s+(?:on|to)\s+(.+)$/i);
    if (m) return { ...base, kind: 'comment', which: searchable(m[2]), body: m[1].trim() };
    // "comment: body" -- on the task last touched.
    m = t.match(/^(?:comment|note)\s*:?\s*(.+)$/i);
    return { ...base, kind: 'comment', which: '', body: (m?.[1] ?? '').trim() };
  }

  if (intent === 'ask') {
    const topic = topicOf(english);
    // A question about something the assistant knows nothing of -- "what's the weather" -- is
    // said to be beyond it, rather than answered with a search that finds nothing.
    if (!topic) return { ...base, kind: 'unknown' };
    const when = pastDay(english, now);
    let which = '';
    if (topic === 'who') {
      which = searchable(english.replace(/^who(?:'s|\s+is|\s+are)?\s+(?:working|assigned|handling|doing|responsible)?\s*(?:on|to|for|with)?\s*/i, '')
        .replace(/^who\s+(?:has|owns|got)\s+/i, ''));
    } else if (topic === 'hours') {
      // "How much time did I spend on the GST return": hours on one task, not the week's total.
      const q = when ? english.replace(when.from, ' ') : english;
      const on = q.match(/\b(?:spend|spent|log|logged|put|tracked|worked|booked)\b.*?\b(?:on|for|against)\s+(.+)$/i)?.[1] ?? '';
      if (!/^(?:this|last|the)\s+(?:week|month)\b|^today\b/i.test(on.trim())) which = searchable(on);
    }
    return {
      ...base, kind: 'ask', question: english, topic,
      about: topic === 'who' ? null : askedAbout(english, people, me),
      day: when ? isoDay(when.day) : null,
      which,
    };
  }

  if (intent === 'find') {
    const person = whose(rest, people, me);
    const due = dueOf(rest);
    const search = person || due ? '' : searchable(rest
      .replace(/\b(?:what|which|show|find|list|search|is|are|my|me|all|tasks?|anything|open|pending|due)\b/gi, ' '));
    const who = person ? `${person.display_name || person.email}’s` : 'Your';
    const label = due === 'overdue' ? `Overdue — ${who.toLowerCase() === 'your' ? 'yours' : who.replace(/’s$/, '')}`
      : due === 'today' ? `${who} tasks due today`
        : due === 'tomorrow' ? `${who} tasks due tomorrow`
          : due === 'week' ? `${who} tasks due in the next 7 days`
            : search ? `Matching “${search}”` : `${who} open tasks`;
    return { ...base, kind: 'find', person, due, search, label };
  }

  return { ...base, kind: 'unknown' };
}
