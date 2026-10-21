// Making a task by talking it through.
//
// "Ek task create karo" says there is a task and nothing about it. Rather than a card full of
// blanks, the assistant asks the way a colleague would -- what's it called, how urgent, where it
// stands, when it starts and ends, how long, who's on it -- one question at a time, and last of
// all where to put it. Each answer can be typed or spoken, in English or Hinglish, and anything
// but the name and the place can be skipped.
//
// Pure: no React, no network. The panel holds a Guide, shows `question(guide)`, and feeds each
// answer to `answer(guide, said, ctx)`, which says what to do next.
import { parseTypedDate } from '../dates';
import { toEnglish, isHindi } from './hindi';
import { matchPerson, type ParsedCommand, type Person } from './parseCommand';
import { readDuration } from './tidy';
import { places, readWhere, type Where } from './where';
import type { Hierarchy } from '../api';

export type Step = 'name' | 'priority' | 'status' | 'start' | 'due' | 'estimate' | 'assignee' | 'where';
export const STEPS: Step[] = ['name', 'priority', 'status', 'start', 'due', 'estimate', 'assignee', 'where'];
export type Lang = 'hi' | 'en';
export type StartAs = 'not_started' | 'active';

export interface Draft {
  name: string;
  priority: number | null;
  status: StartAs;
  start: string | null;
  due: string | null;
  estimate: number | null;
  assignees: string[];
  list: Where | null;
}

export interface Guide {
  step: Step;
  lang: Lang;
  draft: Draft;
  /** Steps already answered (or answered by the first sentence), so they are not asked again. */
  done: Step[];
  /** When the place said matched several Lists: the ones to pick from. */
  options: Where[];
  /** A Space or Folder the first sentence named, whose Lists are offered first. */
  near?: string | null;
}

export interface Ctx {
  people: Person[];
  me: string | null;
  hierarchy: Hierarchy | null;
  /** Lists to offer as quick picks for "where": the remembered one first. */
  suggested: Where[];
  now?: Date;
}

export type Next =
  | { kind: 'ask'; guide: Guide; retry?: string }
  | { kind: 'ready'; guide: Guide }
  | { kind: 'cancel' };

const iso = (d: Date) => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x.toISOString(); };

/** Hinglish or Devanagari in, Hinglish questions out. */
export function langOf(said: string): Lang {
  return isHindi(said) || toEnglish(said).changed || /\b(karo|kar\s*do|banao|bana\s*do|ek|naya|chahiye)\b/i.test(said) ? 'hi' : 'en';
}

// Words that say "make a task" without saying what the task is.
const FILLER = new Set(('ek a an one new naya nayi koi task tasks kaam create add make banao banana bana banado bana do do karo kar karna karni '
  + 'hai h chahiye mujhe me i want to please plz pls ek se ko ke ka ki the for my mera mere ek aur another can you could you let us lets ' +
  'urgent high normal low important zaroori jaroori priority wala wali').split(/\s+/));
const SAYS_TASK = /\b(?:task|kaam)\b/i;
const SAYS_MAKE = /\b(?:create|add|make|new|naya|nayi|bana\w*|chahiye)\b/i;

/** "Ek task create karo", "create a task", "task banana hai": a task wanted, nothing said about it. */
export function isBareCreate(said: string, parsedName?: string): boolean {
  const text = said.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  if (!SAYS_TASK.test(text) || !SAYS_MAKE.test(text)) return false;
  const left = (t: string) => t.toLowerCase().split(/\s+/).filter((w) => w && !FILLER.has(w)
    && !/^(?:aaj|kal|parso|today|tomorrow|tak|by|due|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(w));
  return left(text).length === 0 || (parsedName !== undefined && left(parsedName).length === 0);
}

// Talking about making a task rather than naming one: "I want to create a task under marketing,
// what details do you need?", "can you help me add a task", "task banana hai, kya batana hoga".
// What follows "create a task" there is a question or a place, not the task's name.
const ABOUT_MAKING = /\b(?:i\s+want(?:\s+to)?|i(?:'d| would)\s+like|i\s+need|can\s+you|could\s+you|will\s+you|help\s+me|let'?s|please\s+(?:create|add|make)|what\s+(?:are|is|do|details|all)|which|details?|information|info|kya\s+(?:kya|batana|chahiye|details?)|kaise|batao\s+kya|mujhe\s+.*\b(?:banana|create|add)\b)/i;

/**
 * A task asked for, with nothing (or only talk) where its name would be.
 *
 * True for a bare "ek task create karo", and for a sentence that talks about making one -- those
 * used to be made at once, named after the whole sentence, in whatever List was open.
 */
export function wantsToBeAsked(said: string, parsedName?: string): boolean {
  if (isBareCreate(said, parsedName)) return true;
  const text = said.toLowerCase();
  if (!SAYS_TASK.test(text) || !SAYS_MAKE.test(text)) return false;
  const name = (parsedName ?? '').trim();
  return ABOUT_MAKING.test(text) || /\?\s*$/.test(said) || name.split(/\s+/).length > 12;
}

/** A Space or Folder said in the sentence ("under marketing"), so its Lists are offered first. */
export function placeSaid(said: string, hierarchy: Hierarchy | null): string | null {
  if (!hierarchy) return null;
  const text = ` ${said.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;
  const names: string[] = [];
  for (const sp of hierarchy.spaces ?? []) {
    names.push(sp.name);
    for (const f of sp.folders ?? []) names.push(f.name);
  }
  return names.sort((a, b) => b.length - a.length).find((n) => n.trim().length > 2 && text.includes(` ${n.toLowerCase()} `)) ?? null;
}

/** Start from what the first sentence already said ("ek urgent task banao kal tak" has two). */
export function begin(lang: Lang, from: ParsedCommand | null, original = ''): Guide {
  const named = from && !isBareCreate(`task create ${from.name}`, from.name) && !wantsToBeAsked(original || `create task ${from.name}`, from.name)
    ? from.name.trim() : '';
  const draft: Draft = {
    name: named, priority: from?.priority ?? (PRIORITY.find(([re]) => re.test(original.replace(/\d/g, '')))?.[1] ?? null), status: 'not_started',
    start: from?.start_date ?? null, due: from?.due_date ?? null, estimate: from?.time_estimate_seconds ?? null,
    assignees: from?.assignees.length ? from.assignees : [], list: null,
  };
  const done: Step[] = [];
  if (draft.name) done.push('name');
  if (draft.priority) done.push('priority');
  if (draft.start) done.push('start');
  if (draft.due) done.push('due');
  if (draft.estimate) done.push('estimate');
  if (draft.assignees.length) done.push('assignee');
  const guide: Guide = { step: 'name', lang, draft, done, options: [] };
  return { ...guide, step: nextStep(guide) ?? 'where' };
}

function nextStep(g: Guide): Step | null {
  return STEPS.find((s) => !g.done.includes(s)) ?? null;
}

const SKIP = /^(?:skip|next|pass|none|no|nahi|nahin|na|kuch nahi|koi nahi|chhodo|chodo|chhod do|chod do|pata nahi|baad mein|later|-)$/i;
const CANCEL = /^(?:cancel|stop|band karo|rehne do|rahne do|mat banao|nahi banana|chhodo yaar|forget it|never ?mind|ruk(?:o|jao)?)$/i;
const ME = /^(?:me|mujhe|mujhko|main|mai|mera|myself|i|khud)$/i;

const PRIORITY: [RegExp, number][] = [
  [/\b(?:urgent|critical|asap|emergency|zaroori|jaroori|zaruri|turant|abhi|1)\b/i, 1],
  [/\b(?:high|important|zyada|jyada|ucha|uchi|2)\b/i, 2],
  [/\b(?:normal|medium|theek|thik|aam|regular|3)\b/i, 3],
  [/\b(?:low|kam|minor|whenever|4)\b/i, 4],
];
export const PRIORITY_NAME: Record<number, string> = { 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' };

/** The question for the current step, to show and to say, and quick answers to tap. */
export function question(g: Guide): { text: string; chips: string[] } {
  const hi = g.lang === 'hi';
  const name = g.draft.name ? `“${g.draft.name}”` : '';
  switch (g.step) {
    case 'name': return { text: hi ? 'Theek hai! Task ka naam kya rakhein?' : 'Sure! What should the task be called?', chips: [] };
    case 'priority': return { text: hi ? `${name} ki priority kya hai — Urgent, High, Normal ya Low?` : `What priority is ${name} — Urgent, High, Normal or Low?`, chips: ['Urgent', 'High', 'Normal', 'Low'] };
    case 'status': return { text: hi ? 'Status kya rakhein — To do, ya kaam shuru ho chuka hai (In progress)?' : 'Status — To do, or already In progress?', chips: ['To do', 'In progress'] };
    case 'start': return { text: hi ? 'Kab se shuru karna hai?' : 'When does it start?', chips: hi ? ['Aaj', 'Kal', 'Monday'] : ['Today', 'Tomorrow', 'Monday'] };
    case 'due': return { text: hi ? 'Aur kab tak khatam karna hai? (end date)' : 'And when is it due?', chips: hi ? ['Kal', 'Parso', 'Friday', 'Next week'] : ['Tomorrow', 'Friday', 'Next week', 'End of month'] };
    case 'estimate': return { text: hi ? 'Kitna time lagega? Jaise “2 ghante” ya “30 min”.' : 'How long will it take? e.g. “2 hours” or “30 min”.', chips: ['30 min', '1 hour', '2 hours', '4 hours'] };
    case 'assignee': return { text: hi ? 'Kisko assign karun? Aapko, ya kisi aur ko?' : 'Who should do it — you, or someone else?', chips: [hi ? 'Mujhe' : 'Me'] };
    case 'where': return g.options.length > 1
      ? { text: hi ? 'Is naam ki kai lists hain — kaunsi?' : 'A few Lists match — which one?', chips: g.options.slice(0, 5).map((o) => o.path) }
      : { text: hi ? 'Aakhri sawaal — ye task kis list mein banau?' : 'Last thing — which List should it go in?', chips: [] };
  }
}

/** Read an answer to the current step. */
export function answer(g: Guide, raw: string, ctx: Ctx): Next {
  const said = raw.trim().replace(/[.!?]+$/, '');
  if (CANCEL.test(said)) return { kind: 'cancel' };
  const hi = g.lang === 'hi';
  const english = toEnglish(said, ctx.now).text.toLowerCase();
  const skip = SKIP.test(said) || SKIP.test(english);
  const retry = (text: string): Next => ({ kind: 'ask', guide: g, retry: text });
  const draft = { ...g.draft };
  const now = ctx.now ?? new Date();

  switch (g.step) {
    case 'name':
      if (!said || skip) return retry(hi ? 'Naam ke bina task nahi ban sakta — naam batao.' : 'A task needs a name — what is it called?');
      draft.name = said.replace(/^(?:naam|name|called|task)\s*(?:hai|is|:)?\s*/i, '').replace(/\s+(?:naam hai|hai)$/i, '').trim() || said;
      break;
    case 'priority': {
      if (!skip) {
        const hit = PRIORITY.find(([re]) => re.test(said) || re.test(english));
        if (!hit) return retry(hi ? 'Urgent, High, Normal ya Low — inme se ek boliye.' : 'Say Urgent, High, Normal or Low.');
        draft.priority = hit[1];
      }
      break;
    }
    case 'status':
      if (!skip) {
        if (/progress|chal raha|chalu|shuru ho|started|ongoing|working|kar raha|ho raha/i.test(`${said} ${english}`)) draft.status = 'active';
        else if (/to ?do|not started|baaki|pending|abhi nahi|new|naya|open/i.test(`${said} ${english}`)) draft.status = 'not_started';
        else return retry(hi ? '“To do” ya “In progress”?' : '“To do” or “In progress”?');
      }
      break;
    case 'start':
    case 'due': {
      if (skip) {
        if (g.step === 'start') draft.start = iso(now);
        break;
      }
      const day = parseTypedDate(english.replace(/^(?:from|starting|start|on|by|till|until|due|tak|se)\s+/, '').replace(/\s+(?:se|tak|ko)$/, ''), now)
        ?? parseTypedDate(english, now);
      if (!day) return retry(hi ? 'Date samajh nahi aayi — jaise “kal”, “Friday” ya “20 Oct” boliye.' : 'I didn’t catch the date — try “tomorrow”, “Friday” or “20 Oct”.');
      if (g.step === 'start') draft.start = iso(day);
      else {
        if (draft.start && day < new Date(new Date(draft.start).setHours(0, 0, 0, 0))) {
          return retry(hi ? 'End date start se pehle nahi ho sakti — dobara batao.' : 'The due date can’t be before the start — try again.');
        }
        draft.due = iso(day);
      }
      break;
    }
    case 'estimate':
      if (!skip) {
        const seconds = readDuration(english.replace(/\b(?:lagega|lagenge|lagta|approx|around|about|roughly)\b/g, '').trim())
          ?? readDuration(english.match(/\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/)?.[0] ?? '');
        if (!seconds) return retry(hi ? 'Jaise “2 ghante” ya “30 minute” boliye.' : 'Say something like “2 hours” or “30 min”.');
        draft.estimate = seconds;
      }
      break;
    case 'assignee': {
      if (skip || ME.test(said) || ME.test(english)) { draft.assignees = ctx.me ? [ctx.me] : []; break; }
      const words = said.split(/\s*(?:,|\band\b|\baur\b|&)\s*/i).map((w) => w.replace(/^(?:to|ko)\s+|\s+(?:ko|to)$/gi, '').trim()).filter(Boolean);
      const ids: string[] = [];
      for (const w of words) {
        const who = ME.test(w) ? 'me' : matchPerson(w, ctx.people);
        if (!who) return retry(hi ? `“${w}” naam ka koi nahi mila — poora naam boliye.` : `Nobody called “${w}” — say their full name.`);
        const id = who === 'me' ? ctx.me : who.id;
        if (id && !ids.includes(id)) ids.push(id);
      }
      draft.assignees = ids;
      break;
    }
    case 'where': {
      if (skip) return retry(hi ? 'List batana zaroori hai — kis list mein banau?' : 'It needs a List — which one?');
      const lower = said.toLowerCase();
      const everywhere = places(ctx.hierarchy);
      const sameName = everywhere.filter((o) => o.name.toLowerCase() === lower);
      const picked = [...g.options, ...everywhere].find((o) => o.path.toLowerCase() === lower)
        ?? (sameName.length === 1 ? sameName[0] : undefined);
      const read = picked ? { list: picked, options: [] as Where[] } : readWhere(/^(?:in|into|to|mein|me)\b/i.test(said) ? said : `in ${said}`, ctx.hierarchy);
      if (read.list) { draft.list = read.list; break; }
      if (read.options.length > 1) return { kind: 'ask', guide: { ...g, options: read.options } };
      return retry(hi ? `“${said}” naam ki koi list nahi mili — doosra naam boliye.` : `No List called “${said}” — try another name.`);
    }
  }
  const moved: Guide = { ...g, draft, done: [...g.done, g.step], options: [] };
  const step = nextStep(moved);
  if (!step) return { kind: 'ready', guide: moved };
  return { kind: 'ask', guide: { ...moved, step } };
}

/** What will be made, in one line, for the confirmation and for saying aloud. */
export function summary(g: Guide, people: Person[]): string {
  const d = g.draft;
  const hi = g.lang === 'hi';
  const day = (v: string | null) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');
  const who = d.assignees.map((id) => people.find((p) => p.id === id)).map((p) => p?.display_name || p?.email || 'someone').join(', ') || '—';
  const hours = d.estimate ? `${Math.round((d.estimate / 3600) * 10) / 10}h` : '—';
  const bits = [
    d.priority ? PRIORITY_NAME[d.priority] : null,
    d.status === 'active' ? 'In progress' : 'To do',
    `${day(d.start)} → ${day(d.due)}`,
    hours,
    who,
  ].filter(Boolean).join(' · ');
  return hi ? `“${d.name}” ${d.list?.name ?? ''} mein ban raha hai — ${bits}` : `Creating “${d.name}” in ${d.list?.name ?? ''} — ${bits}`;
}
