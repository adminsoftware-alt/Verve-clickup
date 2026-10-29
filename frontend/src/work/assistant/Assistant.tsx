// The assistant: a panel in the corner that listens, works out what you meant, and does it.
//
// What it can do is said in one line (`CAN_DO_LINE`): make, change, finish and delete tasks, log
// time, run a timer, comment and tag, and answer questions about your own work. Anything that acts
// on work which already exists is proposed before it happens -- the panel says what it is about to
// do and waits -- which is what makes it safe to drive by voice in a firm whose task names carry
// client names. A new task is simply made, and the message after it carries Undo.
//
// Understanding lives in `interpret()`, which turns a sentence into a plain reading and never
// touches the server. This file takes that reading, looks up the tasks it names, shows what it
// found, and acts when told.
//
// It is drawn as a chat -- a Home screen, a thread, past chats -- because that is the shape every
// support widget has taught people to expect, and a shape that is recognised does not have to be
// explained. The promise underneath is still the small one: it reads one instruction at a time,
// shows its reading in the thread, and acts when told. Nothing in the thread is ever replaced, so
// what was asked and what came of it can always be read back in order.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, AudioLines, Check, ChevronRight, ListChecks, Loader2, Plus, SendHorizontal,
  Square, SquarePen, Trash2, X,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { ApiError, workApi, type RunningTimer, type Task } from '../api';
import { collabApi } from '../collabApi';
import { useMe, useWork } from '../WorkContext';
import { Avatar, PRIORITIES, StatusDot, formatDuration, parseDuration } from '../ui';
import { compactDate } from '../dates';
import type { ParsedCommand } from './parseCommand';
import { CAN_DO_LINE, INTENT_LABEL } from './intent';
import { interpret, type Reading } from './interpret';
import { answer as lookUp, listTasks, searchFor, type Answer } from './answer';
import { pickMatch } from './match';
import { places, type Where, type WhereRead } from './where';
import { readWhere } from './where';
import type { Change } from './edit';
import { sayRepeat, settle } from './recurrence';
import { forget, ownerOf, remember, sessions, when, type Session, type Turn } from './history';
import { useVoice } from './useVoice';
import { aiApi, type AiTurn } from './aiApi';
import { answer as answerGuide, begin, langOf, placeSaid, question, summary, wantsToBeAsked, type Guide } from './guide';
import { ChatBubble } from './Bubble';

/** The last List a task was put in, so the next one defaults somewhere sensible. Per person. */
const LAST_LIST = 'verve.assistant.lastList';

/**
 * The starters on the Home screen.
 *
 * A question is asked the moment it is tapped: asking changes nothing, so there is nothing to
 * check first. Anything that would make or change work is put in the box instead, to be finished
 * or corrected before it is sent -- tapping an example should never create a task called "call
 * the auditor tomorrow" that nobody meant.
 */
const PROMPTS: { label: string; text: string; send: boolean }[] = [
  { label: 'What’s due today?', text: 'What’s due today?', send: true },
  { label: 'Add “call the auditor tomorrow”', text: 'Add call the auditor tomorrow', send: false },
  { label: 'Log 1h on GST filing', text: 'Log 1h on GST filing', send: false },
  { label: 'Start a timer on …', text: 'Start a timer on ', send: false },
];

/** Said under the composer. Precise: a new task is made at once and can be undone; anything else waits. */
const PROMISE = 'English, Hindi or both · New tasks can be undone; other changes wait for your OK';

/**
 * Everywhere a task can go, from the one walker that reads the tree.
 *
 * This used to be a second copy of the same walk, which is how the dropdown and the destination
 * read out of a sentence came to disagree about which Lists existed at all.
 */
function useLists(): Where[] {
  const { hierarchy } = useWork();
  return useMemo(() => places(hierarchy), [hierarchy]);
}

/** A task a sentence pointed at, as the search found it. */
interface Found {
  /** The one it means, once that is settled -- by the search, or by the person picking. */
  task: Task | null;
  /** The words searched for, for saying what was not found. Empty when it said "it". */
  searched: string;
  /** Several that fit equally well: the person picks, the assistant does not guess. */
  options: Task[];
}

type Plan =
  /** `all` is every task found, which is usually just the one. `assumed` marks the defaults. */
  | { kind: 'create'; all: ParsedCommand[]; assumed: { who: boolean; start: boolean }[]; picked: boolean[]; sharedFrom: string | null; where: WhereRead }
  | ({ kind: 'log_time'; seconds: number; day: string | null } & Found)
  | ({ kind: 'timer'; action: 'start' } & Found)
  | { kind: 'timer'; action: 'stop'; running: RunningTimer | null }
  | ({ kind: 'complete' } & Found)
  /** A change to a task that already exists. `moveTo` is set when one of the changes is a move. */
  | ({ kind: 'update'; changes: Change[]; unknown: string[]; moveTo: Where | null; moveOptions: Where[] } & Found)
  | ({ kind: 'comment'; body: string } & Found)
  | ({ kind: 'delete' } & Found)
  | { kind: 'find'; label: string; tasks: Task[] }
  /** `answer` is null until they press the button, which is the only thing that looks it up. */
  | { kind: 'ask'; reading: Extract<Reading, { kind: 'ask' }>; answer: Answer | null }
  | { kind: 'unknown' };

/**
 * What a new task cannot be made without: a name.
 *
 * It used to be five more -- who, start, due, priority, estimate -- because the List view marks
 * those red. Asking for all of them made "call the auditor tomorrow" a form to fill in, and people
 * stopped saying things. Now who and start default to you and today, and the other three are
 * offered, not demanded.
 */
const NEEDED = ['name'] as const;
type Needed = typeof NEEDED[number];
/** Offered under the preview when the sentence did not say them. */
const OPTIONAL = ['due_date', 'priority', 'time_estimate_seconds'] as const;
type Optional = typeof OPTIONAL[number];

const WHAT_IT_WANTS: Record<Needed, string> = {
  // A sentence can say every detail and still not say what the work is -- "make me the assignee,
  // start today, due tomorrow, two hours". That is a question to ask, not a task called "".
  name: 'a name',
};

/** The answers given in the panel, applied to every task that did not say for itself. */
interface Filled {
  /** Only for a task whose sentence gave no name; one that did keeps its own. */
  name: string;
  due_date: string | null;
  priority: number | null;
  time_estimate_seconds: number | null;
}
const NOTHING_FILLED: Filled = { name: '', due_date: null, priority: null, time_estimate_seconds: null };

/** The required fields a parsed task is still missing, once the panel's answers are applied. */
function stillMissing(task: ParsedCommand, filled: Filled): Needed[] {
  return task.name.trim() || filled.name.trim() ? [] : ['name'];
}
/** The optional fields nobody has said yet, for the small "add if you like" row. */
function notSaid(task: ParsedCommand, filled: Filled): Optional[] {
  return OPTIONAL.filter((k) => !(task[k] ?? filled[k]));
}

/** A task as it will be created: what was said, with the panel's answers filling the gaps. */
const complete = (task: ParsedCommand, filled: Filled): ParsedCommand => ({
  ...task,
  name: task.name.trim() || filled.name.trim(),
  due_date: task.due_date ?? filled.due_date,
  priority: task.priority ?? filled.priority,
  time_estimate_seconds: task.time_estimate_seconds ?? filled.time_estimate_seconds,
});

/**
 * Who and when, where the sentence did not say: you, from today.
 *
 * A task said with a deadline already gone starts on that deadline rather than after it.
 */
function withDefaults(task: ParsedCommand, me: string | null): { task: ParsedCommand; assumed: { who: boolean; start: boolean } } {
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const who = !task.assignees.length && !!me;
  const start = !task.start_date;
  const startAt = task.due_date && new Date(task.due_date) < today ? task.due_date : today.toISOString();
  return {
    task: { ...task, assignees: who ? [me as string] : task.assignees, start_date: task.start_date ?? startAt },
    assumed: { who, start },
  };
}

const CHANGE_LABEL: Record<Change['field'], string> = {
  due_date: 'Due', start_date: 'Starts', priority: 'Priority', name: 'Name', estimate: 'Estimate',
  assignees: 'Assigned to', add_assignees: 'Assigned to', remove_assignees: 'Assigned to',
  add_tags: 'Tags', remove_tags: 'Tags', archived: 'Archived', recurrence: 'Repeats',
  list: 'Move to', status: 'Status',
};

/** Which of a List's statuses a spoken one means: its own name first, then what it is for. */
function pickStatus(said: string, statuses: { id: string; name: string; group: string }[]) {
  const flat = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const exact = statuses.find((s) => flat(s.name) === flat(said));
  if (exact) return exact;
  const group = /^(?:to\s*-?\s*do|todo|open|not started)$/i.test(said) ? 'not_started'
    : /^(?:done|complete|completed)$/i.test(said) ? 'done'
    : /^closed$/i.test(said) ? 'closed'
    : /^(?:in\s*-?\s*progress|doing|started)$/i.test(said) ? 'active'
    : null;
  return (group && statuses.find((s) => s.group === group)) ?? statuses.find((s) => flat(s.name).includes(flat(said))) ?? null;
}

type Members = { user: { id: string; display_name: string | null; email: string } }[];

/**
 * One change, as it stands now and as it will be: "Due 9 Oct → 16 Oct".
 *
 * "Changed the task" is not something anybody can check. The value it had is shown beside the one
 * it will get, so a misheard date is caught before it is saved rather than after.
 */
function describeChange(c: Change, task: Task | null, members: Members, lists: Where[], moveTo: Where | null): { from: string | null; to: string } {
  const person = (id: string) => {
    const m = members.find((x) => x.user.id === id);
    return m ? m.user.display_name || m.user.email : id;
  };
  const names = (ids: string[]) => (ids.length ? ids.map(person).join(', ') : 'nobody');
  const current = task?.assignees.map((a) => a.id) ?? [];
  const tags = task?.tags.map((t) => t.name) ?? [];
  const day = (iso: string | null | undefined) => (iso ? compactDate(iso) : 'none');
  const level = (p: number | null | undefined) => (p ? PRIORITIES[p]?.label ?? String(p) : 'none');
  const length = (s: number | null | undefined) => (s ? formatDuration(s) : 'none');
  const was = <T,>(value: T) => (task ? value : null);
  switch (c.field) {
    case 'list': return { from: was(lists.find((l) => l.id === task?.list_id)?.path ?? null), to: moveTo ? moveTo.path : `“${c.said}” — pick one below` };
    case 'status': return { from: was(task?.status.name ?? null), to: c.said.replace(/^./, (x) => x.toUpperCase()) };
    case 'due_date': return { from: was(day(task?.due_date)), to: c.value ? compactDate(c.value) : 'cleared' };
    case 'start_date': return { from: was(day(task?.start_date)), to: c.value ? compactDate(c.value) : 'cleared' };
    case 'priority': return { from: was(level(task?.priority)), to: c.value ? PRIORITIES[c.value].label : 'cleared' };
    case 'estimate': return { from: was(length(task?.time_estimate_seconds)), to: c.value ? formatDuration(c.value) : 'cleared' };
    case 'name': return { from: was(task?.name ?? null), to: c.value };
    case 'assignees': return { from: was(names(current)), to: names(c.value) };
    case 'add_assignees': return { from: was(names(current)), to: names([...new Set([...current, ...c.value])]) };
    case 'remove_assignees': return { from: was(names(current)), to: names(current.filter((id) => !c.value.includes(id))) };
    case 'add_tags': return { from: was(tags.join(', ') || 'none'), to: [...new Set([...tags, ...c.value])].join(', ') };
    case 'remove_tags': return {
      from: was(tags.join(', ') || 'none'),
      to: tags.filter((t) => !c.value.some((v) => v.toLowerCase() === t.toLowerCase())).join(', ') || 'none',
    };
    case 'archived': return { from: was(task?.archived ? 'yes' : 'no'), to: c.value ? 'yes' : 'no' };
    case 'recurrence': return {
      from: was(sayRepeat(task?.recurrence ?? null)),
      to: c.value ? sayRepeat(settle(c.value, task?.due_date ?? null)) : 'Does not repeat',
    };
    default: return { from: null, to: '' };
  }
}

/** A local calendar day at nine in the morning, for hours logged against a day already gone. */
const morningOf = (isoDay: string) => { const [y, m, d] = isoDay.split('-').map(Number); return new Date(y, m - 1, d, 9, 0, 0); };
const dayName = (isoDay: string) => morningOf(isoDay).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });


/** Which screen the panel is on. */
type View = 'home' | 'chat' | 'past' | 'pastOne';

/** What a result offers: put it back, while it still can be. */
interface ResultOpts { result?: boolean; undoIds?: string[] }

/**
 * One thing in the thread, in the order it happened.
 *
 * A proposal ("Mark done: GST filing -- Mark done / Cancel") is an entry like any other. Once it is
 * acted on or passed over it is frozen where it stands, with the plan as it was at that moment, so
 * the thread reads back as it happened instead of the newest card standing in for everything
 * before it.
 */
type Entry =
  | { key: string; at: number; who: 'me'; text: string; heard?: string }
  | ({ key: string; at: number; who: 'bot'; turn: Turn } & ResultOpts)
  | { key: string; at: number; who: 'plan'; said: string; state: 'open' | 'done' | 'dropped'; snapshot?: { plan: Plan; listId: string } }
  | { key: string; at: number; who: 'error'; text: string };

/**
 * Keys for the thread. Module-wide, so they never repeat however often the panel is opened; the
 * time is in them too, because a reloaded module starts counting again while the thread it is
 * drawing (in development, after a hot reload) still holds the old keys.
 */
let seq = 0;
const born = Date.now().toString(36);
/** Readings that change something; everything else is a question, and questions go to the AI. */
const ACTIONS = new Set<string>(['create', 'update', 'complete', 'delete', 'log_time', 'comment', 'timer']);
/** How long a chat stays open after its last message. */
const RESUME_WITHIN = 60 * 60 * 1000;
const nextKey = () => `e${born}-${++seq}`;

/** The kinds that wait in the thread as a card to confirm. Everything else simply replies. */
const WAITS = new Set<Plan['kind']>(['create', 'log_time', 'timer', 'complete', 'comment', 'update', 'delete']);

/** A past session as thread entries: what was said, and what came back. */
const toEntries = (turns: Turn[]): Entry[] => turns.flatMap((t): Entry[] => [
  ...(t.said ? [{ key: nextKey(), at: t.at, who: 'me' as const, text: t.said }] : []),
  { key: nextKey(), at: t.at, who: 'bot' as const, turn: t },
]);

/** Motion that is decoration, turned off for anybody who has asked for less of it. */
const calm = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const Assistant: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { workspace, members, hierarchy } = useWork();
  const me = useMe();
  const lists = useLists();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  /** Whose history and remembered List these are. */
  const owner = me && workspace ? ownerOf(me, workspace.id) : null;
  const myself = members.find((m) => m.user.id === me)?.user;
  const firstName = (myself?.display_name || myself?.email.split('@')[0] || '').trim().split(/\s+/)[0];

  const [view, setView] = useState<View>('home');
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [thinking, setThinking] = useState(false);
  // The List a new task goes to when the sentence or the person chose one. Cleared after every
  // command: a List said for one task is not meant for the next, and it used to stick.
  const [listChoice, setListChoice] = useState<{ id: string; from: 'said' | 'picked' } | null>(null);
  // Bumped when a List is remembered, so the default below is read again.
  const [remembered, setRemembered] = useState(0);
  // What was just made or changed, so it can be opened without hunting for it -- and so "it" in
  // the next sentence has something to mean. Carries its own List: an edited task is not in the
  // List a new one would have gone to.
  const [lastTask, setLastTask] = useState<{ id: string; name: string; listId: string } | null>(null);
  const lastRef = useRef(lastTask);
  lastRef.current = lastTask;
  // What was just made without being confirmed first, so it can be taken back.
  const [undoable, setUndoable] = useState<{ id: string; name: string; listId: string }[]>([]);
  // This conversation, and the archive behind it.
  const session = useRef({ id: `s${Date.now().toString(36)}`, startedAt: Date.now() });
  const [startedAt, setStartedAt] = useState(session.current.startedAt);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [past, setPast] = useState<Session[]>([]);
  const [opened, setOpened] = useState<Session | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  // Each reading is numbered, so a slow lookup for an older sentence cannot overwrite the newer.
  const reading = useRef(0);
  // The card in the thread the live plan belongs to, and the words it was read from.
  const openKey = useRef<string | null>(null);
  const openSaid = useRef('');

  // The answers to whatever the sentence left out, shared by every task in it.
  const [filled, setFilled] = useState<Filled>(NOTHING_FILLED);
  // Open only when somebody presses "change": the destination is shown, not asked for.
  const [picking, setPicking] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const people = useMemo(
    () => members.filter((m) => !m.deactivated).map((m) => ({ id: m.user.id, display_name: m.user.display_name, email: m.user.email })),
    [members],
  );

  // Where a task goes, guessed the way a colleague would: the List you are standing in, then
  // the one you used last, then your own, then whatever is first. Being on a List page and
  // having to pick that same List from a dropdown is the kind of small insult that stops people
  // using a thing.
  const defaultListId = useMemo(() => {
    void remembered;
    const here = pathname.startsWith('/l/') ? pathname.slice(3).split('/')[0] : null;
    const last = (() => {
      try { return owner ? window.localStorage.getItem(`${LAST_LIST}.${owner}`) : null; } catch { return null; }
    })();
    const known = (id: string | null) => (id && lists.some((l) => l.id === id) ? id : null);
    return known(here) ?? known(last) ?? hierarchy?.personal_list?.id ?? lists[0]?.id ?? '';
  }, [lists, hierarchy, pathname, owner, remembered]);
  const listId = listChoice?.id ?? defaultListId;

  // Read at the moment a card is frozen, which happens inside async work whose closure is older.
  const planRef = useRef(plan);
  planRef.current = plan;
  const listIdRef = useRef(listId);
  listIdRef.current = listId;
  const busy = useRef(false);
  busy.current = thinking;

  // A task being talked through, one question at a time (guide.ts).
  const [guide, setGuide] = useState<Guide | null>(null);
  const guideRef = useRef(guide);
  guideRef.current = guide;
  // Whether the last message was spoken: then a question it asks back opens the mic for the answer.
  // Replies are text only -- the assistant does not talk back.
  const spoken = useRef(false);
  const listenAgain = useRef<() => void>(() => {});

  /** Write down what was said and what came of it, in the thread and for next time. */
  // The AI's side of this conversation, so a follow-up ("and in HR?") has its context.
  const aiHistory = useRef<AiTurn[]>([]);
  const aiOff = useRef(false);
  const say = useCallback((said: string, reply: string, detail?: string, failed?: boolean,
                           extra?: Pick<Turn, 'tasks' | 'goTo'>, opts?: ResultOpts) => {
    const turn: Turn = { said: said.trim(), reply, detail, failed, ...extra, at: Date.now() };
    setEntries((prev) => [...prev, { key: nextKey(), at: turn.at, who: 'bot', turn, ...opts }]);
    // Talking a task through by voice: the mic opens again for the answer to the question just asked.
    if (spoken.current) window.setTimeout(() => { if (guideRef.current && spoken.current) listenAgain.current(); }, 400);
    if (owner) remember(owner, session.current.id, session.current.startedAt, turn);
  }, [owner]);

  /** A question for the AI, answered in the thread. False when the AI isn't there to ask (no key,
   *  down, busy), so the caller can fall back to the phrase rules. */
  const askAi = useCallback(async (said: string): Promise<boolean | string> => {
    if (!workspace || aiOff.current) return false;
    try {
      const { answer: raw } = await aiApi.ask(workspace.id, said, aiHistory.current);
      // Told to write plain text, a model still slips into Markdown now and then; the thread shows
      // text as it is, so "**Ganesh**" would arrive with its asterisks.
      const answer = raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`\n]+)`/g, '$1').replace(/^#{1,6}\s+/gm, '');
      aiHistory.current = [...aiHistory.current, { role: 'user' as const, content: said }, { role: 'assistant' as const, content: answer }].slice(-10);
      say(said, answer);
      return true;
    } catch (e) {
      // Not set up on this server: stop asking for the rest of the session.
      if (e instanceof ApiError && e.status === 503 && /isn.t set up/.test(e.message)) aiOff.current = true;
      return e instanceof Error ? e.message : false;
    }
  }, [workspace, say]);

  /** Something went wrong: said in the thread, where the thing it went wrong with is. */
  const fail = useCallback((message: string) => {
    setEntries((prev) => [...prev, { key: nextKey(), at: Date.now(), who: 'error', text: message }]);
  }, []);

  /**
   * Fix the open card where it stands, as it is now.
   *
   * Done, or passed over by a newer message. Either way it stays in the thread -- what was proposed
   * is part of the conversation -- but it can no longer be pressed.
   */
  const freeze = useCallback((state: 'done' | 'dropped') => {
    const key = openKey.current;
    if (!key) return;
    openKey.current = null;
    const snap = planRef.current;
    setEntries((prev) => prev.map((e) => (e.key === key && e.who === 'plan'
      ? { ...e, state, snapshot: snap ? { plan: snap, listId: listIdRef.current } : undefined }
      : e)));
  }, []);

  // The newest message in view, always. Not smoothly for anybody who has asked for less motion.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: calm() ? 'auto' : 'smooth' });
  }, [entries.length, thinking, view, plan]);

  // Where the keyboard goes on each screen: the big button on Home, the box in a chat.
  useEffect(() => {
    if (view === 'home') startButton.current?.focus({ preventScroll: true });
    if (view === 'chat') {
      const el = box.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }
  }, [view]);

  // The box grows with what is typed, up to a few lines, then scrolls.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [text, view]);

  /** Whatever a command chose, put back to the defaults once it is done. */
  const reset = useCallback(() => {
    setPlan(null);
    setListChoice(null);
    setPicking(false);
    setFilled(NOTHING_FILLED);
  }, []);

  /** The task a sentence named -- or, for "it", the one last touched. */
  const locate = useCallback(async (which: string, preferOpen: boolean): Promise<Found> => {
    if (!workspace) return { task: null, searched: which, options: [] };
    if (!which) {
      const last = lastRef.current;
      if (!last) return { task: null, searched: '', options: [] };
      const t = await workApi.task(last.id);
      return { task: t, searched: t.name, options: [] };
    }
    const found = await searchFor(workspace.id, which, 8);
    return { ...pickMatch(which, found, preferOpen), searched: which };
  }, [workspace]);

  /**
   * Turn a reading into a plan: look up what it names, and nothing more.
   *
   * A question, a search, and something it cannot do are answered in the thread here and now --
   * none of them changes anything, so there is nothing to wait for.
   */
  const resolve = useCallback(async (r: Reading): Promise<Plan | null> => {
    if (!workspace) return { kind: 'unknown' };
    switch (r.kind) {
      case 'create': {
        const made = r.tasks.map((t) => withDefaults(t, me ?? null));
        // Said outright, so it wins over the guess -- for this command only.
        if (r.where.list) setListChoice({ id: r.where.list.id, from: 'said' });
        return {
          kind: 'create', all: made.map((m) => m.task), assumed: made.map((m) => m.assumed),
          picked: made.map(() => true), sharedFrom: r.sharedFrom, where: r.where,
        };
      }
      case 'update': {
        const found = await locate(r.which, false);
        // A move names a place in words; resolving it is this side's job, not the parser's.
        const move = r.changes.find((c) => c.field === 'list');
        const target = move && move.field === 'list' ? readWhere(`in ${move.said}`, hierarchy) : null;
        return {
          kind: 'update', ...found, changes: r.changes,
          // "Which task?" is answered when "it" found the last one.
          unknown: found.task ? r.unknown.filter((u) => u !== 'which task did you mean?') : r.unknown,
          moveTo: target?.list ?? null, moveOptions: target?.options ?? [],
        };
      }
      case 'complete': return { kind: 'complete', ...(await locate(r.which, true)) };
      case 'delete': return { kind: 'delete', ...(await locate(r.which, false)) };
      case 'log_time': return { kind: 'log_time', seconds: r.seconds, day: r.day, ...(await locate(r.which, true)) };
      case 'comment': return { kind: 'comment', body: r.body, ...(await locate(r.which, false)) };
      case 'timer': {
        if (r.action === 'start') return { kind: 'timer', action: 'start', ...(await locate(r.which, true)) };
        const running = await workApi.runningTimer();
        // Nothing to stop is an answer, not a card with a button that cannot be pressed.
        if (!running) { say(r.said, 'No timer is running.'); return null; }
        return { kind: 'timer', action: 'stop', running };
      }
      case 'find': {
        // Questions go to the AI first: it reads the whole of what this person can see, where the
        // phrase rules only know a few shapes and took "kitne team hai" for "my tasks".
        if ((await askAi(r.said)) === true) return null;
        const found = await listTasks(r, workspace.id, me ?? null);
        say(r.said, found.tasks.length ? `${found.label} — ${found.tasks.length}` : `${found.label} — nothing matches.`, undefined, false, {
          tasks: found.tasks.map((t) => ({ id: t.id, name: t.name, listId: t.list_id, due: t.due_date })),
        });
        return { kind: 'find', ...found };
      }
      case 'ask': {
        if (!me) return { kind: 'unknown' };
        if ((await askAi(r.said)) === true) return null;
        const found = await lookUp(r, workspace.id, me, hierarchy);
        say(r.said, found.headline, found.detail, false, {
          tasks: found.tasks?.map((t) => ({ id: t.id, name: t.name, listId: t.list_id, due: t.due_date })),
          goTo: found.goTo,
        });
        return { kind: 'ask', reading: r, answer: found };
      }
      default: {
        // Not a command the rules know: the AI answers it from the app's data, as this person
        // sees it. Still never a task nobody asked for.
        const answered = await askAi(r.said);
        // Not set up, or the AI service is down or busy: say what it can do without it.
        if (answered !== true) say(r.said, 'I can’t do that yet.', typeof answered === 'string' ? `${answered} ${CAN_DO_LINE}` : CAN_DO_LINE, true);
        return { kind: 'unknown' };
      }
    }
  }, [workspace, me, hierarchy, locate, say, askAi]);

  /** Work out what the sentence asks for, looking tasks up where it needs to. */
  const think = useCallback(async (spoken: string) => {
    const mine = ++reading.current;
    const r = interpret(spoken, { people, me: me ?? undefined, hierarchy });
    setFilled(NOTHING_FILLED);
    // A List said in an earlier sentence is not meant for this one.
    setListChoice((c) => (c?.from === 'said' ? null : c));
    setThinking(true);
    try {
      const next = await resolve(r);
      if (mine !== reading.current) return;
      if (next && WAITS.has(next.kind)) {
        // A card that waits for the button, in the thread after the message it answers.
        const key = nextKey();
        openKey.current = key;
        openSaid.current = spoken;
        setEntries((prev) => [...prev, { key, at: Date.now(), who: 'plan', said: spoken, state: 'open' }]);
        setPlan(next);
      } else {
        setPlan(null);
      }
    } catch (e) {
      if (mine === reading.current) { fail((e as Error).message); setPlan(null); }
    } finally {
      if (mine === reading.current) setThinking(false);
    }
  }, [people, me, hierarchy, resolve, fail]);

  /** Create these, one at a time, so a failure half way still leaves what came before it. */
  const makeTasks = async (into: string, wanted: ParsedCommand[], remember_: boolean) => {
    const made: { id: string; name: string; listId: string }[] = [];
    let failed: string | null = null;
    for (const one of wanted) {
      try {
        const t = await workApi.createTask(into, {
          name: one.name, priority: one.priority, start_date: one.start_date,
          due_date: one.due_date, time_estimate_seconds: one.time_estimate_seconds,
          assignees: one.assignees,
          ...(one.recurrence ? { recurrence: settle(one.recurrence, one.due_date) } : {}),
        });
        made.push({ id: t.id, name: t.name, listId: into });
      } catch (e) {
        failed = `“${one.name}” could not be created: ${(e as Error).message}`;
        break;
      }
    }
    // Remembered only when it was not said in the sentence: "add X to the Payroll list" is about
    // that task, and the next one should not quietly go to Payroll too.
    if (remember_ && owner) {
      try { window.localStorage.setItem(`${LAST_LIST}.${owner}`, into); setRemembered((n) => n + 1); } catch { /* a private window; no matter */ }
    }
    return { made, failed };
  };

  /** Say what was made, keep it undoable, and point "it" at it. */
  const announceMade = (said: string, made: { id: string; name: string; listId: string }[], into: string) => {
    const place = lists.find((l) => l.id === into)?.name ?? 'your list';
    const line = made.length === 1 ? `Added “${made[0].name}” to ${place}.` : `Added ${made.length} tasks to ${place}.`;
    say(said, line, undefined, false,
      { tasks: made.map((m) => ({ id: m.id, name: m.name, listId: m.listId, due: null })) },
      { result: true, undoIds: made.map((m) => m.id) });
    setUndoable(made);
    setLastTask(made.length === 1 ? made[0] : made[made.length - 1] ?? null);
  };

  /**
   * Say a task and stop talking, and it exists.
   *
   * The panel used to read the sentence back, wait for a button, and ask again where it should go.
   * For a new task that is three steps to record one thought, which is three more than saying it
   * out loud, and it is the step people gave up at. So a finished sentence that is plainly a new
   * task is simply made -- and the message that follows carries Undo, which is the honest trade:
   * the confirmation moves from before the act to after it, where it costs nothing to ignore.
   *
   * Only creating. Changing, finishing and deleting a task still wait to be confirmed, because
   * those act on work that already exists and the assistant had to guess which.
   *
   * @returns true when it made something, so the caller knows not to fall through.
   */
  const autoCreate = useCallback(async (said: string): Promise<boolean> => {
    if (!workspace) return false;
    // Anything asked as a question waits on a card, however much it reads like a task: a question
    // made into a task on the spot is a task nobody wanted, in somebody's List, before they can stop it.
    if (/\?\s*$/.test(said)) return false;
    const r = interpret(said.trim(), { people, me: me ?? undefined, hierarchy });
    if (r.kind !== 'create') return false;
    // Several places share the name they used, or the one named does not exist: a question, not
    // a guess to make silently.
    if (!r.where.list && (r.where.options.length > 1 || r.where.missed)) return false;
    const into = r.where.list?.id ?? (listChoice?.from === 'picked' ? listChoice.id : defaultListId);
    if (!into) return false;
    const named = r.tasks.filter((t) => t.name.trim().length > 0).map((t) => withDefaults(t, me ?? null).task);
    if (!named.length) return false;  // nothing to call it; let the panel ask
    // Nor when any words went unread: spoken aloud, a misheard clause is the likeliest thing to
    // be wrong, and the panel can show it before it becomes a task.
    if (named.some((t) => t.confidence === 'low')) return false;

    setThinking(true);
    try {
      const { made, failed } = await makeTasks(into, named, !r.where.list);
      if (made.length) {
        announceMade(said, made, into);
        reset();
      }
      if (failed) fail(made.length ? `${failed} The ${made.length} before it were made.` : failed);
      return made.length > 0;
    } catch (e) {
      fail((e as Error).message);
      return false;
    } finally {
      setThinking(false);
    }
  }, [workspace, hierarchy, listChoice, defaultListId, people, me, lists, reset, owner, say, fail]);

  /**
   * Send a message: it goes into the thread, and the reply follows it.
   *
   * A new task is made at once (with Undo after it); a question is answered; anything that acts on
   * work which already exists becomes a card in the thread that waits for its button. A card still
   * waiting when the next message is sent is left where it is, marked as not done.
   */
  const post = useCallback(async (raw: string, byVoice = false) => {
    const said = raw.trim();
    if (!said || !workspace || busy.current) return;
    spoken.current = byVoice;
    setView('chat');
    setText('');
    const me_ = { key: nextKey(), at: Date.now(), who: 'me' as const, text: said };

    // Talking a task through: this message answers the question just asked.
    const g = guideRef.current;
    if (g) {
      setEntries((prev) => [...prev, me_]);
      const next = answerGuide(g, said, { people, me: me ?? null, hierarchy, suggested: [] });
      if (next.kind === 'cancel') {
        setGuide(null);
        say(said, g.lang === 'hi' ? 'Theek hai, task nahi banaya.' : 'OK — I won’t create it.');
        return;
      }
      if (next.kind === 'ask') {
        setGuide(next.guide);
        say(said, next.retry ?? question(next.guide).text);
        return;
      }
      setGuide(null);
      const d = next.guide.draft;
      setThinking(true);
      try {
        const set = await workApi.statuses('list', d.list!.id).catch(() => null);
        const status = set?.statuses.find((st) => st.group === (d.status === 'active' ? 'active' : 'not_started'));
        const t = await workApi.createTask(d.list!.id, {
          name: d.name, priority: d.priority, start_date: d.start, due_date: d.due, time_estimate_seconds: d.estimate,
          assignees: d.assignees.length ? d.assignees : me ? [me] : [], ...(status ? { status_id: status.id } : {}),
        });
        const made = { id: t.id, name: t.name, listId: d.list!.id };
        const line = summary(next.guide, people).replace(/ ban raha hai/, ' ban gaya').replace(/^Creating/, 'Created');
        say(said, `${line}.`, undefined, false, { tasks: [{ ...made, due: d.due }] }, { result: true, undoIds: [t.id] });
        setUndoable([made]);
        setLastTask(made);
      } catch (e) {
        fail(`${next.guide.lang === 'hi' ? 'Task nahi ban paya' : 'Couldn’t create it'}: ${(e as Error).message}`);
      } finally {
        setThinking(false);
      }
      return;
    }

    // "Ek task create karo": a task wanted and nothing said about it -- ask, like a person would.
    const first = interpret(said, { people, me: me ?? undefined, hierarchy });
    if (wantsToBeAsked(said, first.kind === 'create' && first.tasks.length === 1 ? first.tasks[0].name : undefined)) {
      freeze('dropped');
      reset();
      setEntries((prev) => [...prev, me_]);
      const started = { ...begin(langOf(said), first.kind === 'create' ? first.tasks[0] ?? null : null, said), near: placeSaid(said, hierarchy) };
      if (first.kind === 'create' && first.where.list) {
        started.draft.list = first.where.list;
        started.done.push('where');
      }
      setGuide(started);
      say(said, question(started).text);
      return;
    }
    // The card asked "Which task? Say its name." and this is the name: it fills the card in,
    // rather than dropping it and reading the name as a new message.
    const waiting = planRef.current;
    if (waiting && openKey.current && 'task' in waiting && !waiting.task && waiting.options.length <= 1
        && !ACTIONS.has(interpret(said, { people, me: me ?? undefined, hierarchy }).kind)) {
      const old = openKey.current;
      const key = nextKey();
      openKey.current = key;
      setEntries((prev) => [...prev.filter((e) => e.key !== old), { key: nextKey(), at: Date.now(), who: 'me', text: said },
        { key, at: Date.now(), who: 'plan', said, state: 'open' }]);
      setThinking(true);
      try {
        const found = await locate(said, waiting.kind === 'complete' || waiting.kind === 'log_time' || waiting.kind === 'timer');
        setPlan({ ...waiting, ...found, ...(waiting.kind === 'update' && found.task
          ? { unknown: waiting.unknown.filter((u) => u !== 'which task did you mean?') } : {}) } as Plan);
      } finally {
        setThinking(false);
      }
      return;
    }
    freeze('dropped');
    reset();
    // What the rules read, when that is not what was said -- a translation, or a word repaired --
    // shown under the message, so a bad reading can be spotted rather than becoming a task nobody
    // can explain.
    const r = interpret(said, { people, me: me ?? undefined, hierarchy });
    // A question goes to the AI as said, so the rules' reading of it would explain nothing.
    const asked = !aiOff.current && !ACTIONS.has(r.kind);
    setEntries((prev) => [...prev, { key: nextKey(), at: Date.now(), who: 'me', text: said, heard: r.changed && !asked ? r.english : undefined }]);
    if (await autoCreate(said)) return;
    await think(said);
  }, [workspace, freeze, reset, people, me, hierarchy, autoCreate, think, locate, say, fail]);

  // Stopping talking is the instruction: whatever was said is sent, and the same rules as typing
  // decide whether it is made, answered, or waits to be confirmed.
  const voice = useVoice((final) => { void post(final, true); });
  listenAgain.current = () => { if (!voice.listening) voice.start(); };
  // Indian English, always, and no switch to set.
  //
  // People here do not speak one language per sentence -- "GST return kal tak file karo" is one
  // sentence in two languages, and asking somebody to declare which one before they talk is asking
  // them to decide something they are not doing. en-IN is the recogniser that transcribes a mixed
  // sentence sensibly; it writes the Hindi words out in Latin, which toEnglish() already reads.
  // Devanagari still works when typed or pasted, through the same translation.
  useEffect(() => { if (voice.listening && voice.heard) setText(voice.heard); }, [voice.listening, voice.heard]);

  // Escape closes the panel, as it closes every other panel in the app. A microphone left on is
  // turned off on the way out.
  const cancelVoice = voice.cancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      cancelVoice();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, cancelVoice]);

  /** Put back what was just made, for when the assistant heard it wrong. */
  const undo = async () => {
    const gone = undoable;
    if (!gone.length || busy.current) return;
    setUndoable([]);
    setLastTask(null);
    setEntries((prev) => [...prev, { key: nextKey(), at: Date.now(), who: 'me', text: 'Undo' }]);
    setThinking(true);
    try {
      for (const t of gone) await workApi.deleteTask(t.id);
      say('Undo', gone.length === 1 ? `Removed “${gone[0].name}” again.` : `Removed ${gone.length} tasks again.`, undefined, false, undefined, { result: true });
    } catch (e) {
      fail(`Could not undo that: ${(e as Error).message}`);
    } finally {
      setThinking(false);
    }
  };

  /** The card's button: do what it says. */
  const act = async () => {
    if (!plan || !workspace || busy.current) return;
    const said = openSaid.current || (plan.kind === 'timer' ? 'stop timer' : '');
    setThinking(true);
    setUndoable([]);
    /** The result, kept in the thread after the card it came from. */
    const result = (line: string, task?: { id: string; name: string; listId: string } | null) => {
      freeze('done');
      say(said, line, undefined, false, task ? { tasks: [{ id: task.id, name: task.name, listId: task.listId, due: null }] } : undefined, { result: true });
      if (task !== undefined) setLastTask(task);
    };
    try {
      if (plan.kind === 'create') {
        const wanted = plan.all.filter((_, i) => plan.picked[i]).map((t) => complete(t, filled));
        // One at a time rather than all at once: if the fourth fails, the first three are still
        // made, and the message says which got through.
        const { made, failed } = await makeTasks(listId, wanted, listChoice?.from !== 'said');
        if (made.length) { freeze('done'); announceMade(said, made, listId); }
        if (failed) { fail(made.length ? `${failed} The ${made.length} before it were made.` : failed); return; }
      } else if (plan.kind === 'log_time' && plan.task && plan.seconds) {
        const task = plan.task;
        // Another day's hours are logged as a span on that day, so the timesheet files them there.
        const span = plan.day
          ? { started_at: morningOf(plan.day).toISOString(), ended_at: new Date(morningOf(plan.day).getTime() + plan.seconds * 1000).toISOString() }
          : undefined;
        await workApi.logTime(task.id, plan.seconds, undefined, span);
        result(`Logged ${formatDuration(plan.seconds)} on “${task.name}”${plan.day ? ` for ${dayName(plan.day)}` : ''}.`,
          { id: task.id, name: task.name, listId: task.list_id });
      } else if (plan.kind === 'timer' && plan.action === 'start' && plan.task) {
        const task = plan.task;
        await workApi.startTimer(task.id);
        result(`Timer running on “${task.name}”. Say “stop timer” when you are done.`, { id: task.id, name: task.name, listId: task.list_id });
      } else if (plan.kind === 'timer' && plan.action === 'stop' && plan.running) {
        const entry = await workApi.stopTimer();
        const r = plan.running;
        result(`Stopped the timer on “${r.task_name}”${entry.duration_seconds ? ` after ${formatDuration(entry.duration_seconds)}` : ''}.`,
          { id: r.entry.task_id, name: r.task_name, listId: r.list_id });
      } else if (plan.kind === 'complete' && plan.task) {
        const task = plan.task;
        const set = await workApi.statuses('list', task.list_id);
        const closed = set.statuses.find((s) => s.group === 'done') ?? set.statuses.find((s) => s.group === 'closed');
        if (!closed) throw new Error('That List has no done status.');
        await workApi.updateTask(task.id, { status_id: closed.id });
        result(`Marked “${task.name}” as ${closed.name}.`, { id: task.id, name: task.name, listId: task.list_id });
      } else if (plan.kind === 'comment' && plan.task && plan.body.trim()) {
        const task = plan.task;
        await collabApi.addComment(task.id, { body: plan.body.trim() });
        result(`Commented on “${task.name}”.`, { id: task.id, name: task.name, listId: task.list_id });
      } else if (plan.kind === 'update' && plan.task && plan.changes.length) {
        const task = plan.task;
        // Everything that is a field goes in one PATCH; adding and taking away people and tags
        // goes through the bulk edit, which merges with what is there; a move is its own call,
        // because a task's List is not one of its fields.
        const edit: Parameters<typeof workApi.updateTask>[1] = {};
        const bulk: Parameters<typeof workApi.bulkEdit>[0] = { task_ids: [task.id] };
        for (const c of plan.changes) {
          if (c.field === 'due_date') edit.due_date = c.value;
          else if (c.field === 'start_date') edit.start_date = c.value;
          else if (c.field === 'priority') edit.priority = c.value;
          else if (c.field === 'name') edit.name = c.value;
          else if (c.field === 'estimate') edit.time_estimate_seconds = c.value;
          else if (c.field === 'assignees') edit.assignees = c.value;
          else if (c.field === 'archived') edit.archived = c.value;
          else if (c.field === 'recurrence') edit.recurrence = c.value ? settle(c.value, edit.due_date ?? task.due_date) : null;
          else if (c.field === 'add_assignees') bulk.add_assignees = [...(bulk.add_assignees ?? []), ...c.value];
          else if (c.field === 'remove_assignees') bulk.remove_assignees = [...(bulk.remove_assignees ?? []), ...c.value];
          else if (c.field === 'add_tags') bulk.add_tags = [...(bulk.add_tags ?? []), ...c.value];
          else if (c.field === 'remove_tags') bulk.remove_tags = [...(bulk.remove_tags ?? []), ...c.value];
          else if (c.field === 'status') {
            // Every List names its own statuses, so the spoken one is matched against this task's.
            const set = await workApi.statuses('list', task.list_id);
            const st = pickStatus(c.said, set.statuses);
            if (!st) throw new Error(`“${task.name}” has no status called “${c.said}”. Its statuses are ${set.statuses.map((s) => s.name).join(', ')}.`);
            edit.status_id = st.id;
          }
        }
        if (Object.keys(edit).length) await workApi.updateTask(task.id, edit);
        if (Object.keys(bulk).length > 1) {
          const res = await workApi.bulkEdit(bulk);
          if (res.skipped.length) throw new Error(res.skipped.map((s) => s.reason).join('; '));
        }
        if (plan.moveTo) await workApi.bulkEdit({ task_ids: [task.id], list_id: plan.moveTo.id });
        const archived = plan.changes.find((c) => c.field === 'archived');
        result(archived && archived.field === 'archived'
          ? `${archived.value ? 'Archived' : 'Restored'} “${task.name}”.`
          : `Changed “${task.name}”${plan.moveTo ? `, and moved it to ${plan.moveTo.name}` : ''}.`,
        { id: task.id, name: (plan.changes.find((c) => c.field === 'name')?.says ?? task.name), listId: plan.moveTo?.id ?? task.list_id });
      } else if (plan.kind === 'delete' && plan.task) {
        // The one thing here with no undo, which is why the panel shows which task it found and
        // waits for the button rather than acting on a description.
        const gone = plan.task.name;
        await workApi.deleteTask(plan.task.id);
        result(`Deleted “${gone}”. That one cannot be undone.`, null);
      }
      reset();
    } catch (e) {
      // The card stays open, so it can be tried again or cancelled.
      fail((e as Error).message);
    } finally {
      setThinking(false);
    }
  };

  /** Leave the card as it is, unacted on. */
  const cancel = () => { freeze('dropped'); reset(); };

  /** A fresh conversation: a new session, an empty thread, and nothing for "it" to mean. */
  const startNew = () => {
    freeze('dropped');
    reset();
    session.current = { id: `s${Date.now().toString(36)}`, startedAt: Date.now() };
    setStartedAt(session.current.startedAt);
    setEntries([]);
    setUndoable([]);
    setLastTask(null);
    aiHistory.current = [];
    setGuide(null);
    setView('chat');
  };

  /** Pick an old conversation up where it stopped: later messages go on the end of it. */
  const resume = (s: Session) => {
    freeze('dropped');
    reset();
    session.current = { id: s.id, startedAt: s.startedAt };
    setStartedAt(s.startedAt);
    setEntries(toEntries(s.turns));
    setUndoable([]);
    setGuide(null);
    aiHistory.current = s.turns.slice(-5).flatMap((t): AiTurn[] => [{ role: 'user', content: t.said }, { role: 'assistant', content: t.reply }]);
    // "It" means the last task the conversation was about, as it would have when it stopped.
    const lastOne = [...s.turns].reverse().find((t) => t.tasks?.length === 1)?.tasks?.[0];
    setLastTask(lastOne ? { id: lastOne.id, name: lastOne.name, listId: lastOne.listId } : null);
    setOpened(null);
    setView('chat');
  };

  // Opened again soon after leaving, it carries on where it was; after an hour quiet, that chat
  // is closed and it opens on Home for a new one (the old one is under Past chats).
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !owner) return;
    resumed.current = true;
    const lastAt = (x: Session) => x.turns[x.turns.length - 1]?.at ?? x.startedAt;
    const latest = sessions(owner).sort((a, b) => lastAt(b) - lastAt(a))[0];
    if (latest?.turns.length && Date.now() - lastAt(latest) < RESUME_WITHIN) resume(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when whose history it is is known
  }, [owner]);

  const showPast = () => {
    setPast(owner ? sessions(owner).filter((x) => x.id !== session.current.id) : []);
    setView('past');
  };

  /** Opening something the thread points at closes the panel behind you. */
  const openTask = (listId: string, taskId: string) => { navigate(`/l/${listId}?task=${taskId}`); onClose(); };
  const goTo = (to: string) => { navigate(to); onClose(); };
  const listName = (id: string) => lists.find((l) => l.id === id)?.path ?? '';

  /** Everything the sentence did not say, across every task still ticked. */
  const needs: Needed[] = plan?.kind === 'create'
    ? [...new Set(plan.all.filter((_, i) => plan.picked[i]).flatMap((t) => stillMissing(t, filled)))]
    : [];
  const offered: Optional[] = plan?.kind === 'create'
    ? [...new Set(plan.all.filter((_, i) => plan.picked[i]).flatMap((t) => notSaid(t, filled)))]
    : [];

  /** Several tasks fit and none is picked yet: the button says so instead of guessing. */
  const choosing = !!plan && 'options' in plan && !plan.task && plan.options.length > 1;

  const ready =
    // Nothing is made without a name. The button says so, so this is not a disabled control with
    // no explanation attached to it.
    (plan?.kind === 'create' && plan.picked.some(Boolean) && !!listId && needs.length === 0)
    || (plan?.kind === 'log_time' && !!plan.task && plan.seconds > 0)
    || (plan?.kind === 'timer' && (plan.action === 'stop' ? !!plan.running : !!plan.task))
    || (plan?.kind === 'complete' && !!plan.task)
    || (plan?.kind === 'comment' && !!plan.task && !!plan.body.trim())
    // A change needs a task and something to do to it. A move also needs its destination settled,
    // so "move it to the special events list" waits while eight of them are offered.
    || (plan?.kind === 'update' && !!plan.task && plan.changes.length > 0
      && (!plan.changes.some((c) => c.field === 'list') || !!plan.moveTo))
    || (plan?.kind === 'delete' && !!plan.task);

  const chosen = plan?.kind === 'create' ? plan.picked.filter(Boolean).length : 0;
  const doWord = choosing ? 'Pick which one first'
    : plan?.kind === 'create'
      ? (needs.length ? `Still needs ${WHAT_IT_WANTS[needs[0]]}` : chosen > 1 ? `Create ${chosen} tasks` : 'Create')
      : plan?.kind === 'log_time' ? 'Log it'
        : plan?.kind === 'timer' ? (plan.action === 'stop' ? 'Stop the timer' : 'Start the timer')
          : plan?.kind === 'complete' ? 'Mark done'
            : plan?.kind === 'comment' ? 'Post the comment'
              : plan?.kind === 'update' ? (plan.changes.some((c) => c.field === 'archived') && plan.changes.length === 1 ? 'Archive it' : 'Make the change')
                : plan?.kind === 'delete' ? 'Delete it' : '';

  const chip = 'inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] ring-1 ring-gray-200';
  const assumedChip = 'inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-500';

  /** The task a plan acts on, or what went wrong finding it. Choices only while the card is live. */
  const target = (p: Found, live: boolean, onPick: (t: Task) => void) => (
    <>
      <p className="text-[15px] font-medium text-gray-900">
        {p.task
          ? p.task.name
          : p.options.length > 1
            ? <span className="text-gray-700">Which one?</span>
            : p.searched
              ? <span className="text-amber-700">No task found for “{p.searched}”</span>
              : <span className="text-amber-700">Which task? Say its name.</span>}
      </p>
      {p.task && listName(p.task.list_id) && <p className="text-[11px] text-gray-500">{listName(p.task.list_id)}</p>}
      {live && p.options.length > 1 && <Pick options={p.options} onPick={onPick} chosen={p.task} listName={listName} />}
    </>
  );

  /**
   * A proposal, as a card in the thread.
   *
   * `live` is the one card that can still be pressed; every earlier one is drawn from the plan as
   * it stood when it was done or passed over, without its controls.
   */
  const card = (p: Plan, live: boolean, state: 'open' | 'done' | 'dropped', lid: string) => {
    const set = (next: Plan) => { if (live) setPlan(next); };
    const place = lists.find((l) => l.id === lid) ?? null;
    return (
      <div className="w-full rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="mb-1.5 flex items-center gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-brand-700">{INTENT_LABEL[p.kind]}</p>
          {state === 'done' && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"><Check size={10} /> Done</span>}
          {state === 'dropped' && <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">Not done</span>}
        </div>

        {p.kind === 'create' && (
          <>
            {p.sharedFrom && (
              <p className="mb-2 text-[11px] text-gray-500">
                “{p.sharedFrom}” applied to each of these, except where one said otherwise.
              </p>
            )}
            {/* One row per task, each tickable. Three things heard and one misheard should
                cost a tick, not the whole sentence retyped. */}
            <ul className={p.all.length > 1 ? 'space-y-1.5' : ''}>
              {p.all.map((one, i) => (
                <li key={`${one.name}-${i}`} className={p.all.length > 1 ? 'flex items-start gap-2 rounded-lg bg-gray-50 p-2' : ''}>
                  {p.all.length > 1 && (
                    <input
                      type="checkbox" checked={p.picked[i]} disabled={!live}
                      aria-label={`Create “${one.name}”`}
                      onChange={() => set({ ...p, picked: p.picked.map((v, j) => (j === i ? !v : v)) })}
                      className="mt-1 shrink-0 accent-brand-600"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-[15px] font-medium ${p.picked[i] ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                      {one.name || <span className="text-gray-400">No name yet</span>}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {one.priority && (
                        <span className={chip}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITIES[one.priority].color }} />{PRIORITIES[one.priority].label}</span>
                      )}
                      {/* Assumed values are drawn quieter than said ones, so "you, from
                          today" reads as a default that can be changed, not as heard. */}
                      {one.start_date && (
                        <span className={p.assumed[i]?.start ? assumedChip : chip} aria-label={p.assumed[i]?.start ? 'Not said, so from today' : undefined}>
                          Starts {compactDate(one.start_date)}
                        </span>
                      )}
                      {one.due_date && <span className={chip}>Due {compactDate(one.due_date)}</span>}
                      {one.time_estimate_seconds != null && <span className={chip}>{formatDuration(one.time_estimate_seconds)}</span>}
                      {one.recurrence && <span className={chip}>{sayRepeat(settle(one.recurrence, one.due_date))}</span>}
                      {one.assignees.map((id) => {
                        const m = members.find((x) => x.user.id === id);
                        const mine = p.assumed[i]?.who && id === me;
                        return (
                          <span key={id} className={mine ? assumedChip : chip} aria-label={mine ? 'Not said, so yours' : undefined}>
                            {m && <Avatar user={m.user} size={14} />}{id === me ? 'You' : m ? m.user.display_name || m.user.email : id}
                          </span>
                        );
                      })}
                    </div>
                    {one.unknown.length > 0 && <p className="mt-1 text-xs text-amber-800">{one.unknown.join('; ')}</p>}
                  </div>
                </li>
              ))}
            </ul>
            {live && p.all.length > 1 && (
              <p className="mt-2 text-[11px] text-gray-500">{p.all.length} tasks heard. Untick any it misread.</p>
            )}

            {/* A name is the one thing it cannot be made without, asked for here. */}
            {live && needs.length > 0 && (
              <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5">
                <p className="text-[11px] font-medium text-amber-900">
                  Before this can be created, it needs {needs.map((n) => WHAT_IT_WANTS[n]).join(', ')}.
                </p>
                <label className="flex items-center gap-2 text-[11px] text-gray-600">
                  <span className="w-16 shrink-0">Name</span>
                  <input
                    aria-label="Task name" value={filled.name} placeholder="What is the work?"
                    onChange={(e) => setFilled({ ...filled, name: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                  />
                </label>
              </div>
            )}

            {/* The rest, offered rather than demanded: one more moment while the thought is
                still in their head, without stopping the task from being made. */}
            {live && offered.length > 0 && (
              <details className="mt-2 text-[11px] text-gray-500">
                <summary className="cursor-pointer select-none hover:text-gray-800">
                  Add {offered.map((o) => (o === 'due_date' ? 'a due date' : o === 'priority' ? 'a priority' : 'an estimate')).join(', ')} (optional)
                </summary>
                <div className="mt-2 space-y-2">
                  {offered.includes('due_date') && (
                    <label className="flex items-center gap-2 text-gray-600">
                      <span className="w-16 shrink-0">Due</span>
                      <input
                        type="date" aria-label="Due date"
                        value={filled.due_date ? filled.due_date.slice(0, 10) : ''}
                        onChange={(e) => setFilled({ ...filled, due_date: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null })}
                        className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                      />
                    </label>
                  )}
                  {offered.includes('priority') && (
                    <label className="flex items-center gap-2 text-gray-600">
                      <span className="w-16 shrink-0">Priority</span>
                      <select
                        aria-label="Priority" value={filled.priority ?? ''}
                        onChange={(e) => setFilled({ ...filled, priority: e.target.value ? Number(e.target.value) : null })}
                        className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                      >
                        <option value="">None</option>
                        {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{PRIORITIES[n].label}</option>)}
                      </select>
                    </label>
                  )}
                  {offered.includes('time_estimate_seconds') && (
                    <label className="flex items-center gap-2 text-gray-600">
                      <span className="w-16 shrink-0">Estimate</span>
                      <input
                        type="text" aria-label="Estimate" placeholder="2h, 90m"
                        defaultValue=""
                        onChange={(e) => setFilled({ ...filled, time_estimate_seconds: parseDuration(e.target.value) })}
                        className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                      />
                    </label>
                  )}
                </div>
              </details>
            )}

            {/* Said in the sentence, so it is already set -- "change" is for correcting it, not
                for doing the work again. */}
            {live && p.where.list && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-800">
                <Check size={12} className="shrink-0" />
                Going to <b className="font-medium">{p.where.list.path}</b>, from what you said.
              </p>
            )}
            {live && !p.where.list && p.where.options.length > 0 && (
              <div className="mt-2 rounded-lg bg-amber-50 p-2">
                <p className="mb-1 text-[11px] text-amber-900">{p.where.options.length} places are called that — which one?</p>
                <ul className="divide-y divide-amber-100 overflow-hidden rounded-md bg-white">
                  {p.where.options.map((w) => (
                    <li key={w.id}>
                      <button
                        type="button"
                        onClick={() => { setListChoice({ id: w.id, from: 'said' }); set({ ...p, where: { ...p.where, list: w, options: [] } }); }}
                        className="w-full px-2.5 py-1.5 text-left text-[13px] text-gray-700 hover:bg-gray-50"
                      >
                        {w.path}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {live && p.where.missed && (
              <p className="mt-2 text-[11px] text-amber-800">Nothing here is called “{p.where.missed}”, so pick where it should go.</p>
            )}

            {/* Where it goes is settled, not asked.
                A dropdown sitting under every new task was a second decision for something already
                decided -- by the sentence, by the List you are standing in, or by the last one you
                used. It is a line of text, and "change" is there for the once in twenty times
                that line is wrong. */}
            {(!live || !picking) && (
              <button
                type="button" disabled={!live} onClick={() => setPicking(true)}
                className="mt-2 flex w-full items-center gap-1.5 text-left text-[11px] text-gray-500 enabled:hover:text-gray-800"
              >
                <span>in</span>
                <b className="truncate font-medium text-gray-700">{place?.path ?? 'nowhere yet'}</b>
                {live && <span className="ml-auto shrink-0 underline underline-offset-2">change</span>}
              </button>
            )}
            {live && picking && (
              <div className="mt-2 flex items-center gap-2">
                <span className="shrink-0 text-xs text-gray-500">in</span>
                <select
                  autoFocus
                  aria-label="Which list it goes in" value={listId}
                  onChange={(e) => { setListChoice({ id: e.target.value, from: 'picked' }); setPicking(false); }}
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                >
                  {/* Grouped by Space, with the folder path on any List whose name repeats. */}
                  {[...new Map(lists.map((l) => [l.group, lists.filter((x) => x.group === l.group)]))].map(([group, inGroup]) => (
                    <optgroup key={group} label={group}>
                      {inGroup.map((l) => {
                        const twins = lists.filter((x) => x.name === l.name).length > 1;
                        return <option key={l.id} value={l.id}>{twins ? l.path : l.name}</option>;
                      })}
                    </optgroup>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        {p.kind === 'log_time' && (
          <>
            <p className="text-[15px] font-medium text-gray-900">
              {p.seconds ? formatDuration(p.seconds) : <span className="text-amber-700">How long?</span>}
              {p.day && <span className="font-normal text-gray-600"> on {dayName(p.day)}</span>}
            </p>
            {target(p, live, (t) => set({ ...p, task: t }))}
          </>
        )}

        {p.kind === 'timer' && p.action === 'start' && target(p, live, (t) => set({ ...p, task: t }))}
        {p.kind === 'timer' && p.action === 'stop' && (
          <p className="text-[15px] font-medium text-gray-900">
            {p.running
              ? <>Running on {p.running.task_name}<span className="font-normal text-gray-500"> since {new Date(p.running.entry.started_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span></>
              : <span className="text-gray-600">No timer is running.</span>}
          </p>
        )}

        {p.kind === 'complete' && target(p, live, (t) => set({ ...p, task: t }))}

        {p.kind === 'comment' && (
          <>
            {target(p, live, (t) => set({ ...p, task: t }))}
            {p.body
              ? <p className="mt-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5 text-[13px] text-gray-700 ring-1 ring-gray-200">{p.body}</p>
              : <p className="mt-1.5 text-xs text-amber-800">What should the comment say? “Comment on X: …”</p>}
          </>
        )}

        {p.kind === 'update' && (
          <>
            {target(p, live, (t) => set({ ...p, task: t }))}
            {/* Each change spelled out before it happens, with what it is now beside what it
                will be. "Due 9 Oct → 16 Oct" can be checked; "changed the task" cannot. */}
            {p.changes.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {p.changes.map((c, i) => {
                  const d = describeChange(c, p.task, members, lists, p.moveTo);
                  return (
                    <li key={`${c.field}-${i}`} className="flex flex-wrap items-center gap-1.5 text-[13px] text-gray-700">
                      <span className="w-20 shrink-0 text-gray-500">{CHANGE_LABEL[c.field]}</span>
                      {d.from !== null && <span className={`${chip} text-gray-400 line-through decoration-gray-300`}>{d.from}</span>}
                      {d.from !== null && <ArrowRight size={12} className="shrink-0 text-brand-600" />}
                      <span className={chip}>{d.to}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {live && p.moveOptions.length > 0 && !p.moveTo && (
              <div className="mt-2">
                <p className="mb-1 text-[11px] text-gray-500">{p.moveOptions.length} places match — which one?</p>
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-100 bg-white">
                  {p.moveOptions.map((w) => (
                    <li key={w.id}>
                      <button
                        type="button" onClick={() => set({ ...p, moveTo: w })}
                        className="w-full px-2.5 py-1.5 text-left text-[13px] text-gray-700 hover:bg-gray-50"
                      >
                        {w.path}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {p.unknown.length > 0 && <p className="mt-1.5 text-xs text-amber-800">{p.unknown.join('; ')}</p>}
          </>
        )}

        {p.kind === 'delete' && (
          <>
            {target(p, live, (t) => set({ ...p, task: t }))}
            {/* The only irreversible thing the assistant does, so it says so plainly and
                shows exactly which task it found before the button is pressed. */}
            {live && p.task && (
              <p className="mt-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[12px] text-red-800">
                This deletes the task and everything on it. It cannot be undone.
                {p.task.subtask_count ? ` It has ${p.task.subtask_count} subtask${p.task.subtask_count === 1 ? '' : 's'}.` : ''}
                {' '}To keep it out of the way instead, say “archive {p.task.name}”.
              </p>
            )}
          </>
        )}

        {/* The confirmation. Nothing above has happened yet; this is the button that does it. */}
        {live && (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button" onClick={act} disabled={!ready || thinking}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium text-white disabled:opacity-50 ${
                p.kind === 'delete' ? 'bg-red-600 enabled:hover:bg-red-700' : 'bg-brand-600 enabled:hover:bg-brand-700'}`}
            >
              {thinking ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {doWord}
            </button>
            <button
              type="button" onClick={cancel} disabled={thinking}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  };

  /** One entry of the thread. `readOnly` for a past chat, where nothing can be pressed again. */
  const row = (e: Entry, i: number, all: Entry[], readOnly: boolean) => {
    // The assistant's mark goes on the first of a run of its messages, as in any chat.
    const prev = all[i - 1];
    const first = !prev || prev.who === 'me';
    if (e.who === 'me') {
      return (
        <div key={e.key} className="flex flex-col items-end">
          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-50 [overflow-wrap:anywhere] px-3.5 py-2 text-[14px] leading-snug text-brand-900 ring-1 ring-brand-100">
            {e.text}
          </div>
          {e.heard && <p className="mt-1 max-w-[85%] text-right text-[11px] text-gray-500">Understood as “{e.heard}”</p>}
          <p className="mt-1 text-[10px] text-gray-400">{when(e.at)}</p>
        </div>
      );
    }
    let body: React.ReactNode;
    if (e.who === 'error') {
      body = <div className="rounded-2xl rounded-tl-md bg-red-50 px-3.5 py-2 text-[14px] leading-snug text-red-700" role="alert">{e.text}</div>;
    } else if (e.who === 'plan') {
      const live = !readOnly && e.state === 'open' && e.key === openKey.current && !!plan;
      const p = live ? plan : e.snapshot?.plan;
      if (!p) return null;
      body = card(p, live, live ? 'open' : e.state === 'open' ? 'dropped' : e.state, live ? listId : e.snapshot?.listId ?? '');
    } else {
      body = (
        <Reply
          entry={e} onOpen={openTask} onGo={goTo}
          // Undo stays on the message for what it made, and only while that is still the last
          // thing made: an Undo that would delete something else is worse than none.
          canUndo={!readOnly && !!e.undoIds?.length && undoable.map((u) => u.id).join() === e.undoIds.join()}
          onUndo={undo}
        />
      );
    }
    return (
      <div key={e.key} className="flex items-start gap-2">
        {first ? <Mark size={26} /> : <span className="w-[26px] shrink-0" />}
        {/* Never wider than the panel: a long task name wraps or truncates instead of pushing the thread sideways. */}
        <div className={`flex min-w-0 flex-col items-stretch ${e.who === 'plan' ? 'flex-1' : 'w-fit max-w-[85%]'}`}>
          {body}
          <p className="mt-1 text-[10px] text-gray-400">{when(e.at)}</p>
        </div>
      </div>
    );
  };

  /** Keep Tab inside the panel while it is open, and let typing on Home start a chat. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
    if (view === 'home' && !typing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      e.preventDefault();
      setText((s) => s + e.key);
      setView('chat');
      return;
    }
    if (e.key !== 'Tab' || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    )].filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const head = focusable[0];
    const tail = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
    else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
  };

  const iconButton = 'tap flex shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800';
  const tabs = (
    <div role="tablist" aria-label="Assistant" className="flex gap-1 border-b border-gray-200 px-3">
      {([['home', 'Home'], ['past', 'Past chats']] as const).map(([id, label]) => {
        const on = view === id;
        return (
          <button
            key={id} type="button" role="tab" aria-selected={on}
            onClick={() => (id === 'past' ? showPast() : setView('home'))}
            className={`-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium ${on ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
  const back = view === 'chat' ? () => setView('home') : view === 'pastOne' ? () => { setOpened(null); setView('past'); } : null;

  return (
    <div className="fixed inset-0 z-[125] flex items-end justify-end sm:p-5" onMouseDown={onClose}>
      <div
        ref={dialog}
        role="dialog" aria-modal="true" aria-label="Verveflow Assistant"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="assistant-in flex h-[100dvh] w-full flex-col overflow-hidden bg-white sm:h-[min(42rem,calc(100dvh-2.5rem))] sm:max-w-[25rem] sm:rounded-2xl sm:border sm:border-gray-200 sm:shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-2 px-3 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))]">
          {back && (
            <button type="button" onClick={back} aria-label={view === 'chat' ? 'Back to Home' : 'Back to past chats'} className={iconButton}>
              <ArrowLeft size={18} />
            </button>
          )}
          <Mark size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight text-gray-900">Verveflow Assistant</p>
            {view === 'pastOne' && opened && <p className="text-[11px] leading-tight text-gray-500">Past chat · {when(opened.startedAt)}</p>}
          </div>
          {view === 'chat' && entries.length > 0 && (
            <button type="button" onClick={startNew} aria-label="New chat"
              className="tap flex shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-brand-700 hover:bg-brand-50">
              <SquarePen size={16} /> New chat
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close (Esc)" className={iconButton}>
            <X size={18} />
          </button>
        </header>

        {(view === 'home' || view === 'past') && tabs}

        {view === 'home' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white">
            <div className="px-5 pb-5 pt-7">
              <p className="text-[26px] font-semibold leading-tight tracking-tight text-gray-900">
                Welcome{firstName ? ` ${firstName}` : ''} <span aria-hidden>👋</span>
              </p>
              <p className="mt-1 text-[17px] text-gray-500">How can I help you?</p>
            </div>
            <div className="space-y-2 px-4">
              {PROMPTS.map((pr) => (
                <button
                  key={pr.label} type="button"
                  onClick={() => { if (pr.send) void post(pr.text); else { setText(pr.text); setView('chat'); } }}
                  className="group flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-left text-[14px] text-gray-800 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50/50"
                >
                  <span className="min-w-0 flex-1">{pr.label}</span>
                  <ChevronRight size={16} className="shrink-0 text-gray-300 group-hover:text-brand-600" />
                </button>
              ))}
            </div>
            <div className="mt-auto space-y-2 px-4 pb-3 pt-6">
              {entries.length > 0 && (
                <button
                  type="button" onClick={() => setView('chat')}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Back to this chat
                </button>
              )}
              <button
                ref={startButton} type="button" onClick={startNew}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-[15px] font-medium text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                <Plus size={18} /> Start new chat
              </button>
            </div>
          </div>
        )}

        {view === 'past' && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {/* Yours only, in this workspace, and only in this browser. */}
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-xs font-medium text-gray-500">Kept in this browser only</p>
              {past.length > 0 && owner && (
                <button
                  type="button" onClick={() => { forget(owner); setPast([]); }}
                  className="text-[12px] text-gray-500 underline-offset-2 hover:text-red-700 hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
            {past.length === 0 && <p className="py-10 text-center text-[13px] text-gray-400">No past chats yet.</p>}
            <ul className="space-y-2">
              {past.map((s) => {
                const firstSaid = s.turns.find((t) => t.said)?.said ?? s.turns[0]?.reply ?? '';
                return (
                  <li key={s.id}>
                    <button
                      type="button" onClick={() => { setOpened(s); setView('pastOne'); }}
                      className="group flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <Mark size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-gray-900">{firstSaid}</span>
                        <span className="block text-[11px] text-gray-500">
                          {when(s.startedAt)} · {s.turns.length} {s.turns.length === 1 ? 'message' : 'messages'}
                        </span>
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-gray-300 group-hover:text-brand-600" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {view === 'pastOne' && opened && (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto border-t border-gray-100 bg-gray-50/60 px-3 py-4">
              {(() => { const all = toEntries(opened.turns); return all.map((e, i) => row(e, i, all, true)); })()}
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t border-gray-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button
                type="button" onClick={() => resume(opened)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
              >
                Continue this chat
              </button>
              {owner && (
                <button
                  type="button" aria-label="Delete this chat"
                  onClick={() => { forget(owner, opened.id); setOpened(null); showPast(); }}
                  className="tap rounded-xl border border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </>
        )}

        {view === 'chat' && (
          <>
            <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden border-t border-gray-100 bg-gray-50/60 px-3 py-4" aria-live="polite">
              {/* The greeting, so a new chat opens with the assistant saying what it is for. */}
              <div className="flex items-start gap-2">
                <Mark size={26} />
                <div className="flex max-w-[85%] flex-col items-start">
                  <div className="rounded-2xl rounded-tl-md bg-white px-3.5 py-2 text-[14px] leading-snug text-gray-800 ring-1 ring-gray-200">
                    Hi{firstName ? ` ${firstName}` : ''}, I’m your Verveflow assistant. Tell me what to do — create, change or finish
                    tasks, log time, or ask about your work. English, Hindi or both.
                  </div>
                  <p className="mt-1 text-[10px] text-gray-400">{when(startedAt)}</p>
                </div>
              </div>

              {entries.map((e, i) => row(e, i, entries, false))}

              {/* Working: three dots, nothing more. */}
              {thinking && (
                <div className="flex items-start gap-2" role="status" aria-label="Thinking">
                  {entries[entries.length - 1]?.who === 'me' ? <Mark size={26} /> : <span className="w-[26px] shrink-0" />}
                  <div className="flex min-w-0 flex-col items-start gap-2">
                    <div className="flex items-center gap-1 rounded-2xl rounded-tl-md bg-white px-3.5 py-3 ring-1 ring-gray-200">
                      {[0, 1, 2].map((n) => (
                        <span key={n} className="assistant-dot h-1.5 w-1.5 rounded-full bg-gray-400" style={{ animationDelay: `${n * 160}ms` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-gray-100 bg-white px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2.5">
              {/* Talking a task through: the likely answers, one tap each -- or just say it. */}
              {guide && !thinking && (() => {
                const q = question(guide);
                const hi = guide.lang === 'hi';
                const nearHere = guide.near ? lists.filter((l) => l.path.toLowerCase().includes(guide.near!.toLowerCase())).map((l) => l.id) : [];
                const chips = guide.step === 'where' && !guide.options.length
                  ? [...nearHere, defaultListId, ...lists.map((l) => l.id)].filter((id, i, all) => id && all.indexOf(id) === i).slice(0, 4)
                    .map((id) => lists.find((l) => l.id === id)?.path).filter((x): x is string => !!x)
                  : q.chips;
                const optional = guide.step !== 'name' && guide.step !== 'where';
                return (
                  <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Quick answers">
                    {chips.map((c) => (
                      <button key={c} type="button" onClick={() => void post(c)}
                        className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[13px] text-brand-800 hover:bg-brand-100">{c}</button>
                    ))}
                    {optional && (
                      <button type="button" onClick={() => void post('skip')} className="rounded-full border border-gray-200 px-3 py-1 text-[13px] text-gray-600 hover:bg-gray-50">
                        {hi ? 'Chhodo' : 'Skip'}
                      </button>
                    )}
                    <button type="button" onClick={() => void post('cancel')} className="rounded-full px-2 py-1 text-[13px] text-gray-400 hover:text-red-600">
                      {hi ? 'Rehne do' : 'Cancel'}
                    </button>
                  </div>
                );
              })()}
              <div className="flex items-end gap-1 rounded-2xl border border-gray-200 bg-white py-1 pl-3 pr-1 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/15">
                <textarea
                  ref={box} rows={1} value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    void post(text);
                  }}
                  aria-label="Type your message"
                  placeholder={voice.listening ? 'Listening…' : 'Type your message'}
                  className="max-h-36 min-h-[2.25rem] flex-1 resize-none border-0 bg-transparent py-2 text-[15px] leading-snug text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
                />
                {voice.supported && (
                  <button
                    type="button" onClick={voice.listening ? voice.stop : voice.start}
                    aria-label={voice.listening ? 'Stop listening' : 'Speak'}
                    className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${
                      voice.listening ? 'bg-red-600' : 'bg-brand-600 hover:bg-brand-700'}`}
                  >
                    {/* A voice assistant first: the mic is the big round button, and it pulses while it listens. */}
                    {voice.listening && <span className="absolute inset-0 animate-ping rounded-full bg-red-400/60 motion-reduce:animate-none" aria-hidden />}
                    {voice.listening ? <Square size={14} className="relative" fill="currentColor" /> : <AudioLines size={19} />}
                  </button>
                )}
                <button
                  type="button" onClick={() => void post(text)} disabled={!text.trim() || thinking}
                  aria-label="Send"
                  className="tap flex shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:bg-gray-200 disabled:text-gray-400"
                >
                  {thinking ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
                </button>
              </div>
              {voice.listening && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-red-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  Listening — take your time. It acts when you stop.
                </p>
              )}
              {voice.error && <p className="mt-1.5 text-[11px] text-amber-700" role="alert">{voice.error}</p>}
              <p className="mt-1.5 text-center text-[10px] text-gray-400">{PROMISE}</p>
            </div>
          </>
        )}

        {view !== 'chat' && (
          <p className="shrink-0 border-t border-gray-100 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-center text-[10px] text-gray-400">{PROMISE}</p>
        )}
      </div>
    </div>
  );
};

/** The assistant's mark: the launcher's navy circle, so the panel reads as what it opened. */
const Mark: React.FC<{ size: number }> = ({ size }) => (
  <span
    aria-hidden
    style={{ width: size, height: size }}
    className="flex shrink-0 items-center justify-center rounded-full bg-[#234788]"
  >
    <ChatBubble className={size >= 30 ? 'h-5 w-5' : 'h-4 w-4'} />
  </span>
);

/**
 * What the assistant said back.
 *
 * The panel used to replace the question with the answer, so an admin who asked about somebody by
 * name saw a figure with nothing around it and no way to tell what it was an answer to. Keeping
 * both, in the order they happened, is the whole difference between a result and a reply.
 *
 * A result -- something it did -- is drawn green with what can be done about it next: open the
 * task, or take it back.
 */
const Reply: React.FC<{
  entry: Extract<Entry, { who: 'bot' }>;
  onOpen: (listId: string, taskId: string) => void; onGo: (to: string) => void;
  canUndo: boolean; onUndo: () => void;
}> = ({ entry, onOpen, onGo, canUndo, onUndo }) => {
  const { turn, result } = entry;
  const one = result && turn.tasks?.length === 1 ? turn.tasks[0] : null;
  const tone = turn.failed
    ? 'bg-amber-50 text-amber-900 ring-amber-100'
    : result ? 'bg-emerald-50 text-emerald-900 ring-emerald-100' : 'bg-white text-gray-800 ring-gray-200';
  return (
    <div className={`min-w-0 max-w-full overflow-hidden rounded-2xl rounded-tl-md px-3.5 py-2 text-[14px] leading-snug ring-1 [overflow-wrap:anywhere] ${tone}`}>
      <p className="flex items-start gap-1.5">
        {result && !turn.failed && <Check size={15} className="mt-0.5 shrink-0" />}
        <span className="whitespace-pre-line">{turn.reply}</span>
      </p>
      {turn.detail && <p className="mt-1 text-[12px] leading-relaxed opacity-75">{turn.detail}</p>}
      {!one && turn.tasks && turn.tasks.length > 0 && (
        <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-100 bg-white">
          {turn.tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button" onClick={() => onOpen(t.listId, t.id)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-gray-50"
              >
                <span className="min-w-0 flex-1 truncate text-gray-800">{t.name}</span>
                {t.due && <span className="shrink-0 text-[11px] text-gray-400">{compactDate(t.due)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(one || canUndo || turn.goTo) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-medium">
          {canUndo && <button type="button" onClick={onUndo} className="underline-offset-2 hover:underline">Undo</button>}
          {one && <button type="button" onClick={() => onOpen(one.listId, one.id)} className="underline-offset-2 hover:underline">Open it</button>}
          {turn.goTo && (
            <button type="button" onClick={() => onGo(turn.goTo!.to)} className="text-brand-700 underline-offset-2 hover:underline">
              {turn.goTo.label} →
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * When a search found several, the person picks rather than the assistant guessing. Each carries
 * its List, because a firm with a GST return per client has a dozen tasks of the same name.
 */
const Pick: React.FC<{ options: Task[]; chosen: Task | null; onPick: (t: Task) => void; listName: (id: string) => string }> = ({ options, chosen, onPick, listName }) => (
  <div className="mt-2">
    <p className="mb-1 text-[11px] text-gray-500">{options.length} match — which one?</p>
    <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-100 bg-white">
      {options.map((t) => (
        <li key={t.id}>
          <button
            type="button" onClick={() => onPick(t)}
            className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] ${chosen?.id === t.id ? 'bg-brand-50 font-medium text-brand-800' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            {chosen?.id === t.id ? <Check size={12} className="shrink-0" /> : <ListChecks size={12} className="shrink-0 text-gray-300" />}
            <span className="min-w-0 flex-1">
              <span className="block [overflow-wrap:anywhere]">{t.name}</span>
              {listName(t.list_id) && <span className="block truncate text-[11px] font-normal text-gray-400">{listName(t.list_id)}</span>}
            </span>
            <StatusDot status={t.status} size={9} />
          </button>
        </li>
      ))}
    </ul>
  </div>
);
