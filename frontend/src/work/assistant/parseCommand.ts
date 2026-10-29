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

import type { Recurrence } from '../api';
import { parseTypedDate } from '../dates';
import { close } from './fuzzy';
import { isHindi, romanise } from './hindi';
import { readRepeat, settle } from './recurrence';
import { readDuration } from './tidy';

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
  /** How it repeats, when the sentence said so: "every monday", "monthly". */
  recurrence: Recurrence | null;
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
const LEAD_IN = /^(?:please\s+)?(?:can you\s+)?(?:\b(?:add|create|make|new|remind me to|i need to)\b\s*)?(?:\ba\b\s*)?(?:\b(?:task|todo|to-do|reminder)\b\s*)?(?:\b(?:called|named|for|to)\b\s*)?/i;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** A date said in full -- a whole day name or a number -- as opposed to "sun" or "sat". */
const FULL_DATE = /^(?:(?:next|this|coming)\s+)?(?:today|tomorrow|tmrw|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|weekend)$|\d/i;

/**
 * Words that are never somebody's name, in English and in Hinglish.
 *
 * "What is due today" was answered about Harish ("is") and "what am I working on" about Satyam
 * ("am"). Names are matched as whole words now, but a list of the words a question is built from is
 * the second fence: none of these can stand for a person, however the workspace's names are spelt.
 */
export const NOT_A_NAME = new RegExp('^(?:'
  + 'i|me|my|mine|myself|we|us|our|you|your|he|she|it|its|they|them|their|his|her|'
  + 'is|am|are|was|were|be|been|being|do|does|did|done|doing|have|has|had|can|could|will|would|shall|should|may|might|must|'
  + 'a|an|the|this|that|these|those|and|or|but|not|no|yes|so|if|then|than|'
  + 'on|in|at|to|of|for|by|from|with|about|into|onto|off|up|out|over|under|till|until|via|per|'
  + 'what|whats|which|who|whom|whose|when|where|why|how|any|anything|all|some|every|each|many|much|'
  + 'due|today|tomorrow|tmrw|yesterday|now|week|month|day|next|last|this|eod|eow|'
  + 'working|work|task|tasks|todo|open|pending|overdue|late|left|assigned|plate|time|hours?|log|logged|show|list|find|'
  + 'hai|hain|ho|hoon|hu|tha|thi|ka|ki|ke|ko|se|pe|par|mein|me|mera|meri|mere|mujhe|main|kya|kaun|kab|kitne|kitna|aaj|kal|tak|aur|bhi|ye|yeh|wo|woh|wala|wali'
  + ')$', 'i');

/** How sure a name has to be before it counts as a person. */
export interface MatchOptions {
  /**
   * 'any' lets a surname alone find somebody ("assign to yadav"); 'first' wants the first name or
   * the whole name, for places where a surname is far more likely to be a client ("for Sharma and
   * Co" is a client, not Aditya Sharma).
   */
  parts?: 'any' | 'first';
  /** Allow a letter or two of slip, for dictation and Devanagari. Off where a guess would mislead. */
  fuzzy?: boolean;
}

/**
 * Someone's first name, their full name, or their email -- whichever was said.
 *
 * Exported because editing a task needs exactly the same answer as creating one: "reassign it to
 * aarti" and "assign to aarti" must find the same Aarti, or the two halves of the assistant
 * disagree about who works here.
 *
 * Whole words only. It used to accept any piece of a name, so "do" found Sayam Doshi and the "MIS"
 * in "prepare MIS" found Pushpadevi Mishra -- and a question about your own tasks was answered
 * about somebody else's.
 */
export function matchPerson(word: string, people: Person[], options: MatchOptions = {}): Person | 'me' | null {
  const { parts = 'any', fuzzy = true } = options;
  const needle = word.trim().toLowerCase().replace(/^@/, '').replace(/[,.;:!?]+$/, '').replace(/[’']s$/, '');
  if (!needle) return null;
  if (/^(?:me|myself|my|mine|mera|meri|mere|mujhe)$/.test(needle)) return 'me';
  if (needle.length < 2) return null;
  // "is", "am", "on", "hai": the small words every sentence is made of are never anybody's name,
  // whoever happens to be called Isha, Aman or Satyam. Checked word by word, so "aarti is" is not
  // one person either.
  if (needle.split(/\s+/).some((w) => NOT_A_NAME.test(w))) return null;
  const named = (p: Person) => (p.display_name || p.email).toLowerCase();
  const exact = people.filter((p) => named(p) === needle || p.email.toLowerCase() === needle
    || p.email.toLowerCase().split('@')[0] === needle);
  if (exact.length === 1) return exact[0];
  // A first name, which is how people actually speak. Only when it picks out one person: two
  // Priyas and a guess is worse than asking.
  const byFirst = people.filter((p) => named(p).split(/\s+/)[0] === needle);
  if (byFirst.length === 1) return byFirst[0];
  if (byFirst.length > 1) return null;
  // Below three letters only an exact first name will do ("Om"): a two-letter surname or a
  // two-letter near miss is a guess.
  if (needle.replace(/\s+/g, '').length < 3) return null;
  if (parts === 'any') {
    // Any whole word of the name: a surname, or first and last said together.
    const words = needle.split(/\s+/);
    const byWords = people.filter((p) => {
      const theirs = named(p).split(/\s+/);
      return words.every((w) => theirs.includes(w));
    });
    if (byWords.length === 1) return byWords[0];
    if (byWords.length > 1) return null;
  }
  if (!fuzzy) return null;
  // Said in Devanagari, or misheard. "आरती" spells out as "aartee" and the person is saved as
  // "Aarti Yadav", so the last resort is a first name that is a letter or two away -- and only when
  // exactly one person is that close, because two near-misses is a guess.
  //
  // A stronger test than "close": four letters at least, and the same first letter. "amit" is not
  // a slip for "aman", and "satya" said mid-sentence is not Satyam unless nothing else fits.
  const spelled = isHindi(needle) ? romanise(needle).toLowerCase() : needle;
  if (spelled.length < 4 || /\s/.test(spelled)) return null;
  const nearly = people.filter((p) => {
    const first = named(p).split(/\s+/)[0];
    return first[0] === spelled[0] && close(spelled, first);
  });
  return nearly.length === 1 ? nearly[0] : null;
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
  // Trailing punctuation is tone: "call the auditor tomorrow!!" is the same task.
  let rest = squash(input).replace(/[\s.!?,;]+$/, '');

  // Take each clause out of the sentence as it is understood. Whatever survives is the name,
  // which is why the order matters: the longest and most distinctive patterns go first.
  const take = (pattern: RegExp, onMatch: (m: RegExpMatchArray) => boolean | void) => {
    const m = rest.match(pattern);
    if (!m) return;
    if (onMatch(m) !== false) rest = squash(rest.replace(m[0], ' '));
  };

  // "Remind me tomorrow to call the bank": the day sits between the lead-in and the work. Put it
  // at the end, where every other date is read from.
  const early = rest.match(/^((?:please\s+)?remind me)\s+((?:on\s+|by\s+)?\S+(?:\s+\S+)?)\s+to\s+(.+)$/i);
  if (early && parseTypedDate(early[2].replace(/^(?:on|by)\s+/i, ''), now)) rest = `${early[1]} to ${early[3]} ${early[2]}`;

  // "Add a task for Aarti to call the bank", "add a task for me to ...": who it is for, then the work.
  // "For me and Aarti" too: every name between "for" and "to" has to be somebody, or none is taken.
  const forWhom = rest.match(/^((?:please\s+)?(?:add|create|make|new)\s+(?:an?\s+)?(?:task|todo|to-do|reminder)\s+)for\s+(\S+(?:\s+\S+)?(?:\s+and\s+\S+(?:\s+\S+)?)*)\s+to\s+(.+)$/i);
  if (forWhom) {
    const named = forWhom[2].split(/\s+and\s+/i);
    const all = named.every((who) => {
      const pair = matchPerson(who, people, { parts: 'first', fuzzy: false });
      return pair || (who.split(/\s+/).length === 1 && matchPerson(who, people, { parts: 'first', fuzzy: false }));
    });
    if (all) rest = `${forWhom[1]}${forWhom[3]} assign to ${named.join(' and ')}`;
  }

  // --- how often ------------------------------------------------------------------------------
  // First, because "every monday" holds a weekday the date rules below would take for a due date.
  const repeat = readRepeat(rest, now);
  if (repeat) {
    rest = squash(rest.replace(repeat.from, ' '));
    found.push({ field: 'Repeats', from: repeat.from });
  }

  // --- a priority said before the word "task" --------------------------------------------------
  // "add an urgent task fix the server": the level sits where the article would, ahead of the
  // name, and the lead-in that strips "add a task" would otherwise leave "Urgent task fix...".
  let leadPriority: number | null = null;
  const lead = rest.match(/^((?:please\s+)?(?:add|create|make|new)\s+)(?:an?\s+)?(urgent|critical|important|high[\s-]priority|low[\s-]priority|normal[\s-]priority|high|low)\s+(task|todo|to-do|reminder)\b/i);
  if (lead) {
    leadPriority = PRIORITY_WORDS.find(([p]) => p.test(lead[2].replace('-', ' ')))?.[1] ?? null;
    found.push({ field: 'Priority', from: lead[2] });
    rest = squash(rest.replace(lead[0], `${lead[1]}${lead[3]}`));
  }

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

  // "@aarti", as a chat app writes it. The @ says it is a person, so any part of the name will do.
  for (const m of rest.matchAll(/(?:^|\s)@([a-z][\w.-]*)/gi)) {
    const hit = matchPerson(m[1], people, { fuzzy: false });
    if (!hit) { unknown.push(`nobody here is called "${m[1]}"`); continue; }
    assignees.push(hit === 'me' ? (me ?? '') : hit.id);
    found.push({ field: 'Assignee', from: `@${m[1]}` });
    rest = squash(rest.replace(m[0], ' '));
  }

  // "For Aarti": a person after "for", where a clause ends. Only a first name or a whole name --
  // "for Sharma and Co" is a client, and this firm also has an Aditya Sharma.
  if (!assignees.length) {
    for (const m of rest.matchAll(/\bfor\s+(\S+)(?:\s+(\S+))?/gi)) {
      const pair = m[2] ? matchPerson(`${m[1]} ${m[2]}`, people, { parts: 'first', fuzzy: false }) : null;
      const hit = pair ?? matchPerson(m[1], people, { parts: 'first', fuzzy: false });
      if (!hit) continue;
      const said = pair ? `${m[1]} ${m[2]}` : m[1];
      // `rest` is squashed, so the name sits one space after "for" and its words one space apart.
      const after = rest.slice((m.index ?? 0) + m[0].indexOf(m[1]) + said.length);
      const ends = (s: string) => /^\s*(?:$|[,.;]|\b(?:and|due|by|on|from|starting|start|priority|estimate|today|tomorrow|next|this|in|with)\b)/i.test(s);
      if (!ends(after)) continue;
      assignees.push(hit === 'me' ? (me ?? '') : hit.id);
      found.push({ field: 'Assignee', from: said });
      // "For Aarti and Aditya": more people, for as long as each word after "and" is somebody.
      // Stopping at the first name left "and Aditya" in the task's name and Aditya off the task.
      let taken = said;
      let tail = after;
      for (;;) {
        const more = tail.match(/^\s*(?:,|and|&)\s*(\S+)(?:\s+(\S+))?/i);
        if (!more) break;
        const both = more[2] ? matchPerson(`${more[1]} ${more[2]}`, people, { parts: 'first', fuzzy: false }) : null;
        const next = both ?? matchPerson(more[1], people, { parts: 'first', fuzzy: false });
        const name = both ? `${more[1]} ${more[2]}` : more[1];
        const piece = tail.slice(0, more[0].indexOf(more[1]) + name.length);
        if (!next || !ends(tail.slice(piece.length))) break;
        assignees.push(next === 'me' ? (me ?? '') : next.id);
        found.push({ field: 'Assignee', from: name });
        taken += piece;
        tail = tail.slice(piece.length);
      }
      rest = squash(rest.replace(new RegExp(`\\bfor\\s+${taken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), ' '));
      break;
    }
  }

  // --- how long -------------------------------------------------------------------------------
  let estimate: number | null = null;
  // "estimate 2h", and just as often "estimate is 1 hour" or "estimate: 90m".
  take(/\b(?:(?:time\s+)?(?:estimate[ds]?|est\b\.?)(?:\s+(?:is|as|of|at)\b)?\s*[:=]?|should take|takes|about|roughly)\s*(\d+(?:[.:]\d+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)?)\b/i, (m) => {
    const seconds = readDuration(m[1]);
    if (seconds === null) return false;
    estimate = seconds;
    found.push({ field: 'Estimate', from: m[1] });
  });

  // --- when -----------------------------------------------------------------------------------
  let start: Date | null = null;
  let due: Date | null = null;

  const vague = /^(?:this\s+)?(?:weekend|week|month|end of (?:week|month))$/i;
  const dateClause = (label: string, pattern: RegExp): Date | null => {
    const m = rest.match(pattern);
    if (!m) return null;
    let whole = m[0];
    let value = m[1];
    // "end date as this weekend, Friday" is one answer given twice. The clause has to stop at the
    // comma -- otherwise "due friday, call the auditor" swallows the task's name -- so instead it
    // reaches past one only when what follows is itself a date.
    const after = rest.slice((m.index ?? 0) + m[0].length);
    const more = after.match(/^\s*,\s*([a-z0-9][a-z0-9/–\- ]{0,20}?)(?=\s*(?:,|\.|$)|\s+\b(?:and|with|assign|priority|estimate)\b)/i);
    if (more && parseTypedDate(more[1].trim(), now)) {
      whole += more[0];
      value += `, ${more[1]}`;
    }
    let picked: Date | null = null;
    let pickedFrom = '';
    let pickedVague = true;
    for (const piece of value.split(/\s*,\s*|\s+or\s+/i)) {
      const words_ = piece.trim().split(/\s+/);
      // Longest first: "next friday" before "friday", "25 dec" before "25".
      for (let take_ = Math.min(3, words_.length); take_ >= 1; take_ -= 1) {
        const candidate = words_.slice(0, take_).join(' ');
        const d = parseTypedDate(candidate, now);
        if (!d) continue;
        const isVague = vague.test(candidate);
        if (picked && isVague) break;          // already have something; a vaguer word adds nothing
        if (picked && !pickedVague) break;     // already have something specific
        picked = d; pickedFrom = candidate; pickedVague = isVague;
        break;
      }
    }
    if (!picked) return null;
    // Only the date goes, not the words after it. "due friday high priority" reaches as far as
    // "high" before the clause stops, and taking all of it lost the priority and left the word
    // "priority" stranded in the name.
    if (whole === m[0] && m[0].endsWith(m[1]) && m[1].toLowerCase().startsWith(pickedFrom.toLowerCase())) {
      whole = m[0].slice(0, m[0].length - m[1].length) + m[1].slice(0, pickedFrom.length);
    }
    found.push({ field: label, from: pickedFrom });
    rest = squash(rest.replace(whole, ' '));
    return picked;
  };

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
        let b = parseTypedDate(right, now);
        // "From monday to friday", said on a Thursday, is Monday the 12th to Friday the 16th --
        // not back to the 9th. A weekday on the far side of a span means the next one after the
        // near side, so when it lands earlier it is read again from there.
        if (b && a && b < a) b = parseTypedDate(right, a);
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

  // Said outright: "start date as today", "end date is this weekend", "deadline 25 dec".
  //
  // After the span, not before it. "From monday to friday" is a span, and a start-date pattern
  // that matches "from" would take "monday" out of it and leave "to friday" stranded with nothing
  // on its left -- two dates said, one date kept.
  if (!start) {
    // "started" as well as "start": without the ending, "started is today" matched "start" and
    // read the date as "ed is today".
    start = dateClause('Starts', /\b(?:start(?:s|ed|ing)?|begin(?:s|ning)?)\b\s*(?:date|day)?\s*(?:as|is|of|on|from|:|=)?\s*([a-z0-9][a-z0-9/–\- ]*?)(?=\s*(?:,\s*)?\b(?:and|with|assign|priorit(?:y|ies)|estimate|end|due|deadline|finish|till|until|to|when)\b|[,.]|$)/i);
  }
  if (!due) {
    // "When it is tomorrow" is how a due date gets said aloud, once the start has been given.
    due = dateClause('Due', /\b(?:end|due|deadline|finish(?:es|ing)?|target|when\s+it(?:'s|\s+is)|when)\b\s*(?:date|day)?\s*(?:as|is|of|on|by|:|=)?\s*([a-z0-9][a-z0-9/–\- ]*?)(?=\s*(?:,\s*)?\b(?:and|with|assign|priorit(?:y|ies)|estimate|start|begin|from)\b|[,.]|$)/i);
  }

  if (!due) {
    // "By friday 2h", "by 20 Oct for the client": the date is the first word or three after "by",
    // not everything up to the end -- which, read whole, was no date at all and left "by friday"
    // in the task's name. Longest first, so "next friday" beats "next".
    for (const m of rest.matchAll(/\b(?:due|by|before|on|for)\s+([a-z0-9/\- ]+?)(?=\s+(?:and|assign|as|with|priority|estimate)\b|$)/gi)) {
      const words_ = m[1].trim().split(/\s+/);
      let hit: { d: Date; said: string } | null = null;
      // Shorter than everything after the word only after "by", "due" or "before", and only for a
      // date said in full: "for Sun Pharma" is a client, not a Sunday, and "on 2 clients" is work.
      const firm = /^(?:by|due|before)\s/i.test(m[0]);
      for (let n = words_.length > 3 ? 3 : words_.length; n >= 1 && !hit; n -= 1) {
        const said_ = words_.slice(0, n).join(' ');
        if (n < words_.length && !(firm && FULL_DATE.test(said_))) continue;
        const d = parseTypedDate(said_, now);
        if (d) hit = { d, said: said_ };
      }
      if (!hit) continue;
      due = hit.d;
      found.push({ field: 'Due', from: hit.said });
      const lead = m[0].slice(0, m[0].length - m[1].length);
      rest = squash(rest.replace(`${lead}${hit.said}`, ' '));
      break;
    }
  }
  if (!start && !due) {
    // A bare day at the end: "call the auditor tomorrow".
    // "In 3 days" and "the day after tomorrow" too, which are just as often how a deadline is said.
    take(/(?:^|\s)((?:the\s+)?day after tomorrow|in \d{1,3} (?:days?|weeks?|months?)|(?:this |next )?weekend|end of (?:the )?(?:week|month)|today|tomorrow|tmrw|yesterday|next week|next month|eom|eow|(?:next\s+)?(?:mon|tues?|wed(?:nes)?|thurs?|fri|sat(?:ur)?|sun)(?:day)?)\s*$/i, (m) => {
      m[1] = m[1].replace(/^the\s+/i, '').replace(/^end of the /i, 'end of ');
      const d = parseTypedDate(m[1], now);
      if (!d) return false;
      due = d;
      found.push({ field: 'Due', from: m[1].trim() });
    });
  }

  // --- how urgent -----------------------------------------------------------------------------
  // Every mention, not the first word on a fixed list: "priority normal ... make it priority high"
  // is somebody changing their mind, and what they said last is what they meant. Each mention
  // goes out of the name with its scaffolding -- "and make it as an", "priority is", "actually".
  let priority: number | null = null;
  const level = PRIORITY_WORDS.map(([p]) => p.source.replace(/^\\b\(|\)\\b$/g, '')).join('|');
  const mention = new RegExp(
    '(?:\\b(?:and\\s+)?(?:actually\\s+)?(?:make|set|mark)\\s+it\\s+(?:to\\s+|as\\s+)?(?:an?\\s+)?)?'
    + '(?:\\b(?:as|at|with)\\s+)?'
    + '(?:\\bpriorit(?:y|ies)\\s*(?:is|as|of|to|:|=)?\\s*)?'
    + `\\b(${level})\\b(?:\\s+priority\\b)?`, 'gi');
  // A bare level word with nothing around it ("high", "low") is only a priority where a clause
  // ends -- "Payroll run urgent", "..., high, and ...". In the middle of words it is the work
  // itself: "High court filing", "Low value invoices".
  const said = [...rest.matchAll(mention)].filter((m) => {
    if (squash(m[0]).toLowerCase() !== m[1].toLowerCase()) return true;
    const after = rest.slice((m.index ?? 0) + m[0].length);
    return /^\s*(?:$|[,.;]|and\b|with\b|due\b|by\b|start)/i.test(after);
  });
  if (said.length) {
    const word = said[said.length - 1][1];
    priority = PRIORITY_WORDS.find(([p]) => p.test(word))?.[1] ?? null;
    found.push({ field: 'Priority', from: squash(said[said.length - 1][0]) });
    for (const m of said) rest = squash(rest.replace(m[0], ' '));
    // "With normal priority" can still leave a lone "priority" where a clause used to be.
    rest = squash(rest.replace(/^\s*priority\b/i, ' ').replace(/\bpriority\s*(?=[,.]|$)/i, ' '));
  }
  if (priority === null) priority = leadPriority;

  // A length with its unit at the very end, and nothing introducing it: "draft memo 2h". Only
  // with the unit, so "call 2 clients" keeps its number.
  if (estimate === null) {
    take(/(?:^|\s)(\d+(?:[.:]\d+)?\s*(?:h|hr|hrs|hours?|m|mins?|minutes?))$/i, (m) => {
      const seconds = readDuration(m[1]);
      if (seconds === null) return false;
      estimate = seconds;
      found.push({ field: 'Estimate', from: m[1] });
    });
  }

  // A repeat on a fixed day says when the first one is due, if nothing else did.
  if (repeat?.first && !due) due = repeat.first;

  // --- what is left is the name ---------------------------------------------------------------
  // "assign to me and file the TDS return" leaves "and file the TDS return" once the names are
  // taken; the conjunction joined two clauses, and only one of them is still here.
  let name = squash(rest.replace(/^\s*(?:and|then)\s+/i, ''));
  name = squash(name.replace(LEAD_IN, ''));
  // Punctuation and joining words stranded where a clause used to be.
  //
  // Stripped in a loop rather than once, because lifting several clauses out of one sentence
  // leaves several layers of debris: "with , and ," is what remains of "with normal priority,
  // start date as today, and end date as Friday", and peeling one layer still leaves a sentence
  // made entirely of connectives. It settles in two or three passes; the cap is there so a
  // pattern that rewrites to itself cannot spin.
  for (let pass = 0; pass < 6; pass += 1) {
    const before = name;
    name = squash(name
      .replace(/\s*,\s*(?=[,;]|$)/g, '')
      .replace(/^[\s,;]+/, '')
      .replace(/[,;]+\s*$/, '')
      // Not "due" at the front: a due clause has already gone by now, and what is left is
      // "Due diligence", which is real work.
      .replace(/^\s*(?:and|then|with|as|for|to|the|by|on|at|of|actually|also)\b\s*/i, '')
      .replace(/\s*\b(?:and|then|with|as|for|to|the|by|on|due|at|of|actually|also)\s*$/i, ''));
    if (name === before) break;
  }
  // Nothing but punctuation left is nothing left. A task called "," helps nobody.
  if (!/[a-z0-9ऀ-ॿ]/i.test(name)) name = '';
  name = name.replace(/^["\u2018\u2019\u201c\u201d']|["\u2018\u2019\u201c\u201d']$/g, '').trim();
  if (name) name = name[0].toUpperCase() + name.slice(1);

  if (!name) unknown.push('no task name was left once everything else was understood');
  // A name that still carries instruction words means a clause was missed, and the person should
  // see that before a task called "Payroll run priority is" is made. ("Due" is not on this list:
  // "due diligence" is real work here.)
  const leftover = name.match(/\b(?:priorit(?:y|ies)|estimate[ds]?|assign(?:ed)?|start(?:s|ed|ing)?|deadline|today|tomorrow)\b/gi);
  if (leftover) unknown.push(`these words were not understood: ${[...new Set(leftover.map((w) => w.toLowerCase()))].join(', ')}`);

  return {
    name,
    priority,
    start_date: start ? iso(start) : null,
    due_date: due ? iso(due) : null,
    time_estimate_seconds: estimate,
    assignees: [...new Set(assignees)],
    recurrence: repeat ? settle(repeat.rule, due ? iso(due) : null, now) : null,
    found,
    unknown,
    confidence: unknown.length === 0 && name.length > 0 ? 'high' : 'low',
  };
}
