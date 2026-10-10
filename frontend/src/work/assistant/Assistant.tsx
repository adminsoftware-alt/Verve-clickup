// The assistant: a panel in the corner that listens, works out what you meant, and does it.
//
// Four things, because four things it does well beat twelve it guesses at: start a task, log
// hours against one, close one, and find some. Each is proposed before it happens -- the panel
// says what it is about to do and waits -- which is what makes it safe to drive by voice in a
// firm whose task names carry client names.
//
// It is not a chat. Nothing here pretends to converse: it reads one instruction, shows its
// reading, and acts when told. That is a smaller promise than a chatbot makes and a much easier
// one to keep.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, CornerDownLeft, History, ListChecks, Loader2, Mic, Sparkles, Square, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { isOpen, workApi, type Task } from '../api';
import { useMe, useWork } from '../WorkContext';
import { Avatar, PRIORITIES, StatusDot, formatDuration, parseDuration } from '../ui';
import { compactDate } from '../dates';
import { parseCommand, type ParsedCommand } from './parseCommand';
import { splitTasks } from './splitTasks';
import { INTENT_LABEL, readIntent, type Intent } from './intent';
import { answer as lookUp, type Answer } from './answer';
import { readWhere, places, type Where, type WhereRead } from './where';
import { readDelete, readEdit, type Change } from './edit';
import { toEnglish } from './hindi';
import { forget, remember, sessions, when, type Session, type Turn } from './history';
import { useVoice } from './useVoice';

/** The last List a task was put in, so the next one defaults somewhere sensible. */
const LAST_LIST = 'verve.assistant.lastList';

/** Three, short, as a nudge rather than a menu. It still understands all seven kinds. */
const CAN_DO: { intent: Intent; example: string }[] = [
  { intent: 'create', example: 'Call the auditor tomorrow' },
  { intent: 'log_time', example: 'Log 2 hours on the Sharma audit' },
  { intent: 'ask', example: "What's overdue?" },
];

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

type Plan =
  /** `parsed` is the first one; `all` is every task found, which is usually just the one. */
  | { kind: 'create'; parsed: ParsedCommand; all: ParsedCommand[]; picked: boolean[]; sharedFrom: string | null; where: WhereRead }
  | { kind: 'log_time'; seconds: number; task: Task | null; searched: string; options: Task[] }
  | { kind: 'complete'; task: Task | null; searched: string; options: Task[] }
  /** A change to a task that already exists. `moveTo` is set when one of the changes is a move. */
  | {
    kind: 'update'; task: Task | null; searched: string; options: Task[];
    changes: Change[]; unknown: string[]; moveTo: Where | null; moveOptions: Where[];
  }
  | { kind: 'delete'; task: Task | null; searched: string; options: Task[] }
  | { kind: 'find'; label: string; tasks: Task[] }
  /** `answer` is null until they press the button, which is the only thing that looks it up. */
  | { kind: 'ask'; question: string; answer: Answer | null }
  | { kind: 'unknown' };

/**
 * The five things a task has to say before it is worth having.
 *
 * The same five the List view marks in red: who is on it, when it runs, how big it is and how
 * urgent. Red after the fact tells somebody they have made a bad task and leaves them to go and
 * mend it; asked for before, it is one more moment while the thought is still in their head.
 *
 * Only for tasks a person makes here. Subtasks inherit their parent's plan, and anything the
 * system raises -- a template, a recurrence, an import -- has nobody to ask.
 */
const NEEDED = ['assignees', 'start_date', 'due_date', 'priority', 'time_estimate_seconds'] as const;
type Needed = typeof NEEDED[number];

const WHAT_IT_WANTS: Record<Needed, string> = {
  assignees: 'who it is for',
  start_date: 'a start date',
  due_date: 'a due date',
  priority: 'a priority',
  time_estimate_seconds: 'an estimate',
};

/** The required fields a parsed task is still missing, once the shared answers are applied. */
function stillMissing(task: ParsedCommand, filled: Filled): Needed[] {
  const has: Record<Needed, boolean> = {
    assignees: task.assignees.length > 0 || filled.assignees.length > 0,
    start_date: !!(task.start_date ?? filled.start_date),
    due_date: !!(task.due_date ?? filled.due_date),
    priority: !!(task.priority ?? filled.priority),
    time_estimate_seconds: !!(task.time_estimate_seconds ?? filled.time_estimate_seconds),
  };
  return NEEDED.filter((k) => !has[k]);
}

/** The answers given in the panel, applied to every task that did not say for itself. */
interface Filled {
  assignees: string[];
  start_date: string | null;
  due_date: string | null;
  priority: number | null;
  time_estimate_seconds: number | null;
}
const NOTHING_FILLED: Filled = {
  assignees: [], start_date: null, due_date: null, priority: null, time_estimate_seconds: null,
};

/** A task as it will be created: what was said, with the panel's answers filling the gaps. */
const complete = (task: ParsedCommand, filled: Filled): ParsedCommand => ({
  ...task,
  assignees: task.assignees.length ? task.assignees : filled.assignees,
  start_date: task.start_date ?? filled.start_date,
  due_date: task.due_date ?? filled.due_date,
  priority: task.priority ?? filled.priority,
  time_estimate_seconds: task.time_estimate_seconds ?? filled.time_estimate_seconds,
});

/** What was said, and what the rules read it as, when the two differ. */
interface Heard { spoken: string; english: string }

const CHANGE_LABEL: Record<Change['field'], string> = {
  due_date: 'Due', start_date: 'Starts', priority: 'Priority',
  name: 'Name', estimate: 'Estimate', assignees: 'Assigned to', list: 'Move to',
};

/** One change, in the words it will take effect in. */
function describeChange(c: Change, members: { user: { id: string; display_name: string | null; email: string } }[], moveTo: Where | null): string {
  if (c.field === 'list') return moveTo ? moveTo.path : `“${c.said}” — pick one below`;
  if (c.field === 'due_date' || c.field === 'start_date') return c.value ? compactDate(c.value) : 'cleared';
  if (c.field === 'priority') return c.value ? PRIORITIES[c.value].label : 'cleared';
  if (c.field === 'estimate') return c.value ? formatDuration(c.value) : 'cleared';
  if (c.field === 'assignees') {
    if (!c.value.length) return 'nobody';
    return c.value.map((id) => {
      const m = members.find((x) => x.user.id === id);
      return m ? m.user.display_name || m.user.email : id;
    }).join(', ');
  }
  return c.value;
}

export const Assistant: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { workspace, members, hierarchy } = useWork();
  const me = useMe();
  const lists = useLists();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  const [text, setText] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [thinking, setThinking] = useState(false);
  const [listId, setListId] = useState('');
  const [done, setDone] = useState<string | null>(null);
  // What was just made, so it can be opened without hunting for it.
  // Carries its own List: an edited task is not in the List a new one would have gone to, and
  // "Open it" pointed at the create destination regardless.
  const [lastTask, setLastTask] = useState<{ id: string; name: string; listId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What was just made without being confirmed first, so it can be taken back.
  const [undoable, setUndoable] = useState<{ id: string; name: string; listId: string }[]>([]);
  // This visit's exchanges, and the archive behind them.
  const session = useRef({ id: `s${Date.now().toString(36)}`, startedAt: Date.now() });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<Session[] | null>(null);
  const transcript = useRef<HTMLDivElement>(null);

  /** Write down what was said and what came of it, for this panel and for next time. */
  const say = useCallback((said: string, reply: string, detail?: string, failed?: boolean,
                           extra?: Pick<Turn, 'tasks' | 'goTo'>) => {
    const turn: Turn = { said: said.trim(), reply, detail, failed, ...extra, at: Date.now() };
    setTurns((prev) => [...prev, turn]);
    remember(session.current.id, session.current.startedAt, turn);
  }, []);

  // The answers to whatever the sentence left out, shared by every task in it.
  const [filled, setFilled] = useState<Filled>(NOTHING_FILLED);
  // Open only when somebody presses "change": the destination is shown, not asked for.
  const [picking, setPicking] = useState(false);
  // Shown only when the rules read something other than what was said, which in practice means
  // Hindi. A translation nobody can see is a translation nobody can correct.
  const [heard, setHeard] = useState<Heard | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const people = useMemo(
    () => members.filter((m) => !m.deactivated).map((m) => ({ id: m.user.id, display_name: m.user.display_name, email: m.user.email })),
    [members],
  );

  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }, [turns.length]);
  // Where a task goes, guessed the way a colleague would: the List you are standing in, then
  // the one you used last, then your own, then whatever is first. Being on a List page and
  // having to pick that same List from a dropdown is the kind of small insult that stops people
  // using a thing.
  useEffect(() => {
    if (listId) return;
    const here = pathname.startsWith('/l/') ? pathname.slice(3).split('/')[0] : null;
    const remembered = (() => {
      try { return window.localStorage.getItem(LAST_LIST); } catch { return null; }
    })();
    const known = (id: string | null) => (id && lists.some((l) => l.id === id) ? id : null);
    setListId(known(here) ?? known(remembered) ?? hierarchy?.personal_list?.id ?? lists[0]?.id ?? '');
  }, [lists, hierarchy, listId, pathname, search]);

  /**
   * Work out what the sentence asks for, looking tasks up where it needs to.
   *
   * @param explicit they pressed the button, rather than this running off a pause in typing.
   *                 Only then is a question actually answered -- see the `ask` branch.
   */
  const think = useCallback(async (said: string, explicit = false) => {
    const spoken = said.trim();
    setError(null);
    setDone(null);
    if (!spoken || !workspace) { setPlan(null); setHeard(null); return; }
    // Hindi first, and everything after it works in English. One parser, one set of rules, one set
    // of bugs -- rather than a second parser that only the Hindi speakers ever meet.
    const { text: sentence, changed } = toEnglish(spoken);
    setHeard(changed ? { spoken, english: sentence } : null);
    setFilled(NOTHING_FILLED);
    const { intent, rest } = readIntent(sentence);
    setThinking(true);
    try {
      if (intent === 'create') {
        // Where it goes, read from the sentence. "Add a task to the skills section" names its
        // destination, and the words that name it are then taken out before the task is parsed --
        // otherwise "to the skills section" becomes part of the task's name.
        const where = readWhere(sentence, hierarchy);
        const forParsing = where.from ? sentence.replace(where.from, ' ') : sentence;
        // A meeting produces several things at once, and the app has always made people type
        // them one at a time -- so they type none of them.
        const { tasks, sharedFrom } = splitTasks(forParsing, people, me ?? undefined);
        const all = tasks.length ? tasks : [parseCommand(forParsing, people, me ?? undefined)];
        setPlan({ kind: 'create', parsed: all[0], all, picked: all.map(() => true), sharedFrom, where });
        // Said outright, so it wins over whatever the dropdown had guessed.
        if (where.list) setListId(where.list.id);
        return;
      }

      if (intent === 'update') {
        const read = readEdit(sentence, people, me ?? undefined);
        const found = read.which ? await workApi.searchTasks(workspace.id, read.which, 6) : [];
        // A move names a place in words; resolving it is this side's job, not the parser's.
        const move = read.changes.find((c) => c.field === 'list');
        const target = move ? readWhere(`in ${move.said}`, hierarchy) : null;
        setPlan({
          kind: 'update', task: found[0] ?? null, searched: read.which, options: found,
          changes: read.changes, unknown: read.unknown,
          moveTo: target?.list ?? null, moveOptions: target?.options ?? [],
        });
        return;
      }

      if (intent === 'delete') {
        const which = readDelete(sentence);
        const found = which ? await workApi.searchTasks(workspace.id, which, 6) : [];
        setPlan({ kind: 'delete', task: found[0] ?? null, searched: which ?? '', options: found });
        return;
      }
      if (intent === 'log_time') {
        const m = rest.match(/(\d+(?:[.:]\d+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)?)/i);
        const seconds = m ? parseDuration(m[1]) ?? 0 : 0;
        // Whatever follows "on" or "to" is the task; failing that, the words after the duration.
        const onWhat = rest.match(/\b(?:on|to|against|for)\s+(?:the\s+)?(.+)$/i)?.[1]
          ?? rest.replace(/.*?(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i, '').trim();
        const found = onWhat ? await workApi.searchTasks(workspace.id, onWhat, 6) : [];
        setPlan({ kind: 'log_time', seconds, task: found[0] ?? null, searched: onWhat, options: found });
        return;
      }
      if (intent === 'complete') {
        const name = rest.replace(/\b(?:as\s+)?(?:done|complete|completed|finished|closed)\b/i, '').trim();
        const found = name ? await workApi.searchTasks(workspace.id, name, 6) : [];
        setPlan({ kind: 'complete', task: found[0] ?? null, searched: name, options: found });
        return;
      }
      /** The list of tasks a "show me…" asks for. */
      const asFind = async (phrase: string): Promise<Plan> => {
        const all = await workApi.allTasks(workspace.id);
        const mine = all.tasks.filter((t) => t.assignees.some((a) => a.id === me));
        const now = new Date();
        let label = 'Your open tasks';
        let tasks = mine;
        if (/overdue|late/i.test(phrase)) {
          label = 'Overdue and assigned to you';
          tasks = mine.filter((t) => t.due_date && new Date(t.due_date) < now && isOpen(t));
        } else if (/today/i.test(phrase)) {
          label = 'Due today';
          const end = new Date(now); end.setHours(23, 59, 59, 999);
          tasks = mine.filter((t) => t.due_date && new Date(t.due_date) <= end && isOpen(t));
        } else if (/week/i.test(phrase)) {
          label = 'Due in the next 7 days';
          const end = new Date(now); end.setDate(end.getDate() + 7);
          tasks = mine.filter((t) => t.due_date && new Date(t.due_date) <= end && isOpen(t));
        } else {
          const words = phrase.replace(/\b(what|which|show|find|list|search|is|are|my|me|all|tasks?|anything)\b/gi, '').trim();
          if (words) {
            label = `Matching “${words}”`;
            tasks = await workApi.searchTasks(workspace.id, words, 12);
          } else {
            tasks = mine.filter(isOpen);
          }
        }
        return { kind: 'find', label, tasks: tasks.slice(0, 12) };
      };

      if (intent === 'ask') {
        // "What's overdue?" wants a list; "how many are overdue?" wants a number. Both arrive
        // here, and a question the answers do not cover falls through to the list rather than
        // being told it was not understood -- a list is never the wrong answer to a question
        // about your own work, it is just a less direct one.
        if (!me) { setPlan(await asFind(rest)); return; }
        // Looked up only when they press the button. A question is typed a word at a time, and
        // answering at every pause would mean three or four round trips per question asked.
        if (!explicit) { setPlan({ kind: 'ask', question: sentence, answer: null }); return; }
        const found = await lookUp(sentence, workspace.id, me, hierarchy, people);
        if (found) {
          setPlan({ kind: 'ask', question: sentence, answer: found });
          say(spoken, found.headline, found.detail, false, {
            tasks: found.tasks?.map((t) => ({ id: t.id, name: t.name, listId: t.list_id, due: t.due_date })),
            goTo: found.goTo,
          });
        } else {
          const list = await asFind(rest);
          setPlan(list);
          if (list.kind === 'find') say(spoken, `${list.label} — ${list.tasks.length}`);
        }
        return;
      }

      if (intent === 'find') {
        setPlan(await asFind(rest));
        return;
      }
      setPlan({ kind: 'unknown' });
    } catch (e) {
      setError((e as Error).message);
      setPlan(null);
    } finally {
      setThinking(false);
    }
  }, [workspace, people, me, hierarchy]);

  /** The last words looked up on purpose, so the re-read below does not undo the answer. */
  const asked = useRef('');

  /** Look this up now, rather than at the next pause in typing. */
  const send = useCallback((said: string) => {
    // Trimmed, and the check below trims too. Comparing a trimmed sentence against the raw box
    // meant one trailing space was enough for the re-read to fire and put the answer back to
    // unanswered -- and a dictated sentence very often ends in one.
    asked.current = said.trim();
    think(said.trim(), true);
  }, [think]);

  // Re-read as they type, but not on every keystroke: the lookups hit the server. Text that was
  // just sent on purpose is skipped -- otherwise the pause that follows pressing the button
  // would re-read the sentence and throw the answer away.
  useEffect(() => {
    if (asked.current === text.trim()) return;
    const t = window.setTimeout(() => { think(text); }, text ? 400 : 0);
    return () => window.clearTimeout(t);
  }, [text, think]);

  const voice = useVoice((final) => {
    setText(final);
    const intent = readIntent(toEnglish(final).text).intent;
    // Stopping talking is the instruction. A question gets answered, a new task gets made, and
    // anything that acts on work which already exists still waits to be confirmed.
    if (intent === 'ask') send(final);
    else if (intent === 'create') void autoCreate(final);
  });
  // Indian English, always, and no switch to set.
  //
  // People here do not speak one language per sentence -- "GST return kal tak file karo" is one
  // sentence in two languages, and asking somebody to declare which one before they talk is asking
  // them to decide something they are not doing. en-IN is the recogniser that transcribes a mixed
  // sentence sensibly; it writes the Hindi words out in Latin, which toEnglish() already reads.
  // Devanagari still works when typed or pasted, through the same translation.
  useEffect(() => { if (voice.listening && voice.heard) setText(voice.heard); }, [voice.listening, voice.heard]);

  /** Create these, one at a time, so a failure half way still leaves what came before it. */
  const makeTasks = async (into: string, wanted: ParsedCommand[]) => {
    const made: { id: string; name: string; listId: string }[] = [];
    let failed: string | null = null;
    for (const one of wanted) {
      try {
        const t = await workApi.createTask(into, {
          name: one.name, priority: one.priority, start_date: one.start_date,
          due_date: one.due_date, time_estimate_seconds: one.time_estimate_seconds,
          assignees: one.assignees,
        });
        made.push({ id: t.id, name: t.name, listId: into });
      } catch (e) {
        failed = `“${one.name}” could not be created: ${(e as Error).message}`;
        break;
      }
    }
    try { window.localStorage.setItem(LAST_LIST, into); } catch { /* a private window; no matter */ }
    return { made, failed };
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
    const sentence = toEnglish(said.trim()).text;
    if (!sentence || readIntent(sentence).intent !== 'create') return false;

    const where = readWhere(sentence, hierarchy);
    // Several places share the name they used: that is a question, not a guess to make silently.
    if (!where.list && where.options.length > 1) return false;
    const into = where.list?.id ?? listId;
    if (!into) return false;

    const forParsing = where.from ? sentence.replace(where.from, ' ') : sentence;
    const { tasks } = splitTasks(forParsing, people, me ?? undefined);
    const all = tasks.length ? tasks : [parseCommand(forParsing, people, me ?? undefined)];
    const named = all.filter((t) => t.name.trim().length > 0);
    if (!named.length) return false;  // nothing to call it; let the panel ask
    // And only when the sentence already said everything a task has to carry. Anything short of
    // that stops here and the panel asks for the rest, rather than making a task that is wrong
    // the moment it exists and leaving somebody to find the red and mend it.
    if (named.some((t) => stillMissing(t, NOTHING_FILLED).length > 0)) return false;

    setThinking(true);
    setError(null);
    try {
      const { made, failed } = await makeTasks(into, named);
      if (made.length) {
        const place = lists.find((l) => l.id === into)?.name ?? 'your list';
        const line = made.length === 1
          ? `Added “${made[0].name}” to ${place}.`
          : `Added ${made.length} tasks to ${place}.`;
        setDone(line);
        say(said, line);
        setUndoable(made);
        setLastTask(made.length === 1 ? made[0] : null);
        setText('');
        setPlan(null);
        setHeard(null);
      }
      if (failed) setError(made.length ? `${failed} The ${made.length} before it were made.` : failed);
      return made.length > 0;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setThinking(false);
    }
  }, [workspace, hierarchy, listId, people, me, lists]);

  /** Put back what was just made, for when the assistant heard it wrong. */
  const undo = async () => {
    const gone = undoable;
    setUndoable([]);
    setDone(null);
    setLastTask(null);
    try {
      for (const t of gone) await workApi.deleteTask(t.id);
      setDone(gone.length === 1 ? `Removed “${gone[0].name}” again.` : `Removed ${gone.length} tasks again.`);
    } catch (e) {
      setError(`Could not undo that: ${(e as Error).message}`);
    }
  };

  const act = async () => {
    if (!plan || !workspace) return;
    setThinking(true);
    setError(null);
    try {
      if (plan.kind === 'create') {
        const wanted = plan.all.filter((_, i) => plan.picked[i]).map((t) => complete(t, filled));
        // One at a time rather than all at once: if the fourth fails, the first three are still
        // made, and the message says which got through.
        const made: { id: string; name: string; listId: string }[] = [];
        let failed: string | null = null;
        for (const one of wanted) {
          try {
            const t = await workApi.createTask(listId, {
              name: one.name, priority: one.priority, start_date: one.start_date,
              due_date: one.due_date, time_estimate_seconds: one.time_estimate_seconds,
              assignees: one.assignees,
            });
            made.push({ id: t.id, name: t.name, listId });
          } catch (e) {
            failed = `“${one.name}” could not be created: ${(e as Error).message}`;
            break;
          }
        }
        try { window.localStorage.setItem(LAST_LIST, listId); } catch { /* a private window; no matter */ }
        if (made.length === 1) setDone(`Created “${made[0].name}”. Say another, or close this.`);
        else if (made.length > 1) setDone(`Created ${made.length} tasks. Say another, or close this.`);
        setLastTask(made.length === 1 ? made[0] : null);
        if (failed) { setError(made.length ? `${failed} The ${made.length} before it were made.` : failed); return; }
      } else if (plan.kind === 'log_time' && plan.task && plan.seconds) {
        await workApi.logTime(plan.task.id, plan.seconds);
        setDone(`Logged ${formatDuration(plan.seconds)} on “${plan.task.name}”.`);
      } else if (plan.kind === 'complete' && plan.task) {
        const set = await workApi.statuses('list', plan.task.list_id);
        const closed = set.statuses.find((s) => s.group === 'done') ?? set.statuses.find((s) => s.group === 'closed');
        if (!closed) throw new Error('That List has no done status.');
        await workApi.updateTask(plan.task.id, { status_id: closed.id });
        setDone(`Marked “${plan.task.name}” as ${closed.name}.`);
      } else if (plan.kind === 'update' && plan.task && plan.changes.length) {
        // Everything that is a field goes in one PATCH; a move is a different call, because a
        // task's List is not one of its fields.
        const edit: Parameters<typeof workApi.updateTask>[1] = {};
        for (const c of plan.changes) {
          if (c.field === 'due_date') edit.due_date = c.value;
          else if (c.field === 'start_date') edit.start_date = c.value;
          else if (c.field === 'priority') edit.priority = c.value;
          else if (c.field === 'name') edit.name = c.value;
          else if (c.field === 'estimate') edit.time_estimate_seconds = c.value;
          else if (c.field === 'assignees') edit.assignees = c.value;
        }
        if (Object.keys(edit).length) await workApi.updateTask(plan.task.id, edit);
        if (plan.moveTo) await workApi.bulkEdit({ task_ids: [plan.task.id], list_id: plan.moveTo.id });
        setDone(`Changed “${plan.task.name}”${plan.moveTo ? `, and moved it to ${plan.moveTo.name}` : ''}.`);
        setLastTask({ id: plan.task.id, name: plan.task.name, listId: plan.moveTo?.id ?? plan.task.list_id });
      } else if (plan.kind === 'delete' && plan.task) {
        // The one thing here with no undo, which is why the panel shows which task it found and
        // waits for the button rather than acting on a description.
        const gone = plan.task.name;
        await workApi.deleteTask(plan.task.id);
        setDone(`Deleted “${gone}”. That one cannot be undone.`);
        setLastTask(null);
      }
      setText('');
      setPlan(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setThinking(false);
    }
  };

  /** Opening something the transcript points at closes the panel behind you. */
  const openTask = (listId: string, taskId: string) => { navigate(`/l/${listId}?task=${taskId}`); onClose(); };
  const goTo = (to: string) => { navigate(to); onClose(); };

  /** Everything the sentence did not say, across every task still ticked. */
  const needs: Needed[] = plan?.kind === 'create'
    ? [...new Set(plan.all.filter((_, i) => plan.picked[i]).flatMap((t) => stillMissing(t, filled)))]
    : [];

  /** The List a new task will go to, for the line that shows it. */
  const here = lists.find((l) => l.id === listId) ?? null;

  /** A question nobody has looked up yet. The button asks it instead of doing anything. */
  const pendingQuestion = plan?.kind === 'ask' && !plan.answer;

  const ready =
    pendingQuestion
    // Nothing is made until it carries all five. The button says what is left, so this is not a
    // disabled control with no explanation attached to it.
    || (plan?.kind === 'create' && plan.picked.some(Boolean) && !!listId && needs.length === 0)
    || (plan?.kind === 'log_time' && !!plan.task && plan.seconds > 0)
    || (plan?.kind === 'complete' && !!plan.task)
    // A change needs a task and something to do to it. A move also needs its destination settled,
    // so "move it to the special events list" waits while eight of them are offered.
    || (plan?.kind === 'update' && !!plan.task && plan.changes.length > 0
      && (!plan.changes.some((c) => c.field === 'list') || !!plan.moveTo))
    || (plan?.kind === 'delete' && !!plan.task);

  const chosen = plan?.kind === 'create' ? plan.picked.filter(Boolean).length : 0;
  const doWord = pendingQuestion
    ? 'Answer that'
    : plan?.kind === 'create'
      ? (needs.length
        ? `Still needs ${WHAT_IT_WANTS[needs[0]]}${needs.length > 1 ? ` and ${needs.length - 1} more` : ''}`
        : chosen > 1 ? `Create ${chosen} tasks` : 'Create')
      : plan?.kind === 'log_time' ? 'Log it'
        : plan?.kind === 'complete' ? 'Mark done'
          : plan?.kind === 'update' ? 'Make the change'
            : plan?.kind === 'delete' ? 'Delete it' : '';

  /** The one button: it answers a question, or it does the thing. */
  const submit = () => { if (pendingQuestion) send(text.trim()); else act(); };
  const chip = 'inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] ring-1 ring-gray-200';

  return (
    <div className="fixed inset-0 z-[125] flex items-end justify-end p-3 sm:p-5" onMouseDown={onClose}>
      <div
        role="dialog" aria-label="Assistant"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[min(42rem,88vh)] w-full max-w-[26rem] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white">
            <Sparkles size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-gray-900">Assistant</p>
            <p className="text-[11px] leading-tight text-gray-500">Say it, and it will show you before it does it</p>
          </div>
          <button
            type="button"
            onClick={() => setHistory(history ? null : sessions().filter((x) => x.id !== session.current.id))}
            aria-label={history ? 'Back to the assistant' : 'Earlier conversations'}
            title={history ? 'Back' : 'Earlier conversations'}
            className={`tap rounded-lg ${history ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'}`}
          >
            <History size={16} />
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="tap rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={17} />
          </button>
        </header>

        <div ref={transcript} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/* Earlier conversations, in place of this one. */}
          {history && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-gray-700">Earlier conversations</p>
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { forget(); setHistory([]); }}
                    className="text-[11px] text-gray-400 underline-offset-2 hover:text-gray-700 hover:underline"
                  >
                    Clear all
                  </button>
                )}
              </div>
              {history.length === 0 && <p className="py-6 text-center text-[13px] text-gray-400">Nothing yet.</p>}
              <div className="space-y-3">
                {history.map((h) => (
                  <div key={h.id} className="rounded-xl border border-gray-200 p-2.5">
                    <p className="mb-1.5 text-[11px] font-medium text-gray-400">{when(h.startedAt)}</p>
                    <div className="space-y-2">
                      {h.turns.map((t, i) => <Exchange key={`${h.id}-${i}`} turn={t} onOpen={openTask} onGo={goTo} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* This conversation. Kept above whatever is being worked out now, so pressing the
              button and reading the answer happen in the same place rather than one replacing
              the other -- which was the complaint: an answer arrived and the question was gone. */}
          {!history && turns.length > 0 && (
            <div className="mb-3 space-y-2">
              {turns.map((t, i) => <Exchange key={i} turn={t} onOpen={openTask} onGo={goTo} />)}
            </div>
          )}

          {!history && (<>
          {done && (
            <div className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <p className="flex items-start gap-2"><Check size={15} className="mt-0.5 shrink-0" /> {done}</p>
              <div className="mt-1 flex items-center gap-3 pl-6">
                {lastTask && (
                  <button
                    type="button"
                    onClick={() => { navigate(`/l/${lastTask.listId}?task=${lastTask.id}`); onClose(); }}
                    className="text-xs font-medium text-emerald-900 underline-offset-2 hover:underline"
                  >
                    Open it
                  </button>
                )}
                {/* The confirmation, moved to after the act. Nothing was asked before making the
                    task, so this is what makes that safe -- and it costs nothing to ignore. */}
                {undoable.length > 0 && (
                  <button type="button" onClick={undo}
                    className="text-xs font-medium text-emerald-900 underline-offset-2 hover:underline">
                    Undo
                  </button>
                )}
              </div>
            </div>
          )}

          {/* One line, not a menu.
              This used to be seven cards, one per thing the assistant can do, which read as a
              form to study before speaking. The whole point is that you say what you want in your
              own words -- a list of the sanctioned phrasings works against that. Three short
              examples underneath, small enough to glance past. */}
          {!text.trim() && !done && (
            <div className="py-2">
              <p className="text-[15px] text-gray-700">Say what you want.</p>
              <p className="mt-1 text-xs text-gray-500">English, Hindi or both.</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {CAN_DO.map((c) => (
                  <button
                    key={c.intent} type="button" onClick={() => setText(c.example)}
                    className="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-500 hover:border-brand-300 hover:bg-brand-50/50 hover:text-gray-800"
                  >
                    {c.example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {thinking && !plan && (
            <p className="flex items-center gap-2 py-4 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Working out what you meant…</p>
          )}

          {/* What the rules read, when that is not what was said. Shown so a bad translation can be
              spotted and corrected, rather than producing a task nobody can explain. */}
          {heard && (
            <p className="mb-2 rounded-lg bg-indigo-50/70 px-2.5 py-1.5 text-[11px] leading-relaxed text-indigo-900">
              Understood as “{heard.english}”
            </p>
          )}

          {/* No card for a question already answered: the reply is in the transcript, and the card
              would be an empty box with the word ANSWER at the top of it. */}
          {plan && !(plan.kind === 'ask' && plan.answer) && (
            <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-brand-700">
                {INTENT_LABEL[plan.kind === 'unknown' ? 'unknown' : plan.kind]}
              </p>

              {plan.kind === 'create' && (
                <>
                  {plan.sharedFrom && (
                    <p className="mb-2 text-[11px] text-gray-500">
                      “{plan.sharedFrom}” applied to each of these, except where one said otherwise.
                    </p>
                  )}
                  {/* One row per task, each tickable. Three things heard and one misheard should
                      cost a tick, not the whole sentence retyped. */}
                  <ul className={plan.all.length > 1 ? 'space-y-1.5' : ''}>
                    {plan.all.map((one, i) => (
                      <li key={`${one.name}-${i}`} className={plan.all.length > 1 ? 'flex items-start gap-2 rounded-lg bg-white p-2' : ''}>
                        {plan.all.length > 1 && (
                          <input
                            type="checkbox" checked={plan.picked[i]}
                            aria-label={`Create “${one.name}”`}
                            onChange={() => setPlan({ ...plan, picked: plan.picked.map((v, j) => (j === i ? !v : v)) })}
                            className="mt-1 shrink-0 accent-brand-600"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={`text-[15px] font-medium ${plan.picked[i] ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                            {one.name || <span className="text-gray-400">No name yet</span>}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {one.priority && (
                              <span className={chip}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITIES[one.priority].color }} />{PRIORITIES[one.priority].label}</span>
                            )}
                            {one.start_date && <span className={chip}>Starts {compactDate(one.start_date)}</span>}
                            {one.due_date && <span className={chip}>Due {compactDate(one.due_date)}</span>}
                            {one.time_estimate_seconds != null && <span className={chip}>{formatDuration(one.time_estimate_seconds)}</span>}
                            {one.assignees.map((id) => {
                              const m = members.find((x) => x.user.id === id);
                              return <span key={id} className={chip}>{m && <Avatar user={m.user} size={14} />}{m ? m.user.display_name || m.user.email : id}</span>;
                            })}
                          </div>
                          {one.unknown.length > 0 && <p className="mt-1 text-xs text-amber-800">{one.unknown.join('; ')}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {plan.all.length > 1 && (
                    <p className="mt-2 text-[11px] text-gray-500">
                      {plan.all.length} tasks heard. Untick any it misread.
                    </p>
                  )}

                  {/* Whatever the sentence left out, asked for here rather than marked in red
                      afterwards. One set of answers covers every task in the sentence -- "all of
                      these, mine, due Friday" is how people say it -- and anything a task said
                      for itself keeps what it said. */}
                  {needs.length > 0 && (
                    <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5">
                      <p className="text-[11px] font-medium text-amber-900">
                        Before this can be created, it needs {needs.map((n) => WHAT_IT_WANTS[n]).join(', ')}.
                      </p>
                      {needs.includes('assignees') && (
                        <label className="flex items-center gap-2 text-[11px] text-gray-600">
                          <span className="w-16 shrink-0">Who</span>
                          <select
                            aria-label="Who it is for" value={filled.assignees[0] ?? ''}
                            onChange={(e) => setFilled({ ...filled, assignees: e.target.value ? [e.target.value] : [] })}
                            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                          >
                            <option value="">Pick a person</option>
                            {me && <option value={me}>Me</option>}
                            {members.filter((m) => !m.deactivated && m.user.id !== me).map((m) => (
                              <option key={m.user.id} value={m.user.id}>{m.user.display_name || m.user.email}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      {needs.includes('start_date') && (
                        <label className="flex items-center gap-2 text-[11px] text-gray-600">
                          <span className="w-16 shrink-0">Starts</span>
                          <input
                            type="date" aria-label="Start date"
                            value={filled.start_date ? filled.start_date.slice(0, 10) : ''}
                            onChange={(e) => setFilled({ ...filled, start_date: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null })}
                            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                          />
                        </label>
                      )}
                      {needs.includes('due_date') && (
                        <label className="flex items-center gap-2 text-[11px] text-gray-600">
                          <span className="w-16 shrink-0">Due</span>
                          <input
                            type="date" aria-label="Due date"
                            value={filled.due_date ? filled.due_date.slice(0, 10) : ''}
                            onChange={(e) => setFilled({ ...filled, due_date: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null })}
                            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                          />
                        </label>
                      )}
                      {needs.includes('priority') && (
                        <label className="flex items-center gap-2 text-[11px] text-gray-600">
                          <span className="w-16 shrink-0">Priority</span>
                          <select
                            aria-label="Priority" value={filled.priority ?? ''}
                            onChange={(e) => setFilled({ ...filled, priority: e.target.value ? Number(e.target.value) : null })}
                            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                          >
                            <option value="">Pick one</option>
                            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{PRIORITIES[n].label}</option>)}
                          </select>
                        </label>
                      )}
                      {needs.includes('time_estimate_seconds') && (
                        <label className="flex items-center gap-2 text-[11px] text-gray-600">
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
                  )}
                </>
              )}

              {plan.kind === 'log_time' && (
                <>
                  <p className="text-[15px] font-medium text-gray-900">
                    {plan.seconds ? formatDuration(plan.seconds) : <span className="text-amber-700">How long?</span>}
                    {plan.task && <span className="font-normal text-gray-600"> on {plan.task.name}</span>}
                  </p>
                  {!plan.task && <p className="mt-1 text-xs text-amber-800">No task found for “{plan.searched}”.</p>}
                  {plan.options.length > 1 && <Pick options={plan.options} onPick={(t) => setPlan({ ...plan, task: t })} chosen={plan.task} />}
                </>
              )}

              {plan.kind === 'complete' && (
                <>
                  <p className="text-[15px] font-medium text-gray-900">
                    {plan.task ? plan.task.name : <span className="text-amber-700">No task found for “{plan.searched}”</span>}
                  </p>
                  {plan.options.length > 1 && <Pick options={plan.options} onPick={(t) => setPlan({ ...plan, task: t })} chosen={plan.task} />}
                </>
              )}

              {plan.kind === 'find' && (
                <>
                  <p className="text-[13px] text-gray-600">{plan.label} — {plan.tasks.length}</p>
                  <ul className="mt-1.5 divide-y divide-gray-100 overflow-hidden rounded-lg bg-white">
                    {plan.tasks.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button" onClick={() => { navigate(`/l/${t.list_id}?task=${t.id}`); onClose(); }}
                          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-gray-50"
                        >
                          <StatusDot status={t.status} size={10} />
                          <span className="min-w-0 flex-1 truncate text-gray-800">{t.name}</span>
                          {t.due_date && <span className="shrink-0 text-[11px] text-gray-400">{compactDate(t.due_date)}</span>}
                        </button>
                      </li>
                    ))}
                    {plan.tasks.length === 0 && <li className="px-2.5 py-2 text-[13px] text-gray-400">Nothing matches.</li>}
                  </ul>
                </>
              )}

              {plan.kind === 'update' && (
                <>
                  <p className="text-[15px] font-medium text-gray-900">
                    {plan.task ? plan.task.name : <span className="text-amber-700">No task found for “{plan.searched}”</span>}
                  </p>
                  {/* Each change spelled out before it happens. "Changed the task" is not something
                      anybody can check; "Due 16 Oct, was 9 Oct" is. */}
                  {plan.changes.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {plan.changes.map((c, i) => (
                        <li key={`${c.field}-${i}`} className="flex items-center gap-1.5 text-[13px] text-gray-700">
                          <ArrowRight size={12} className="shrink-0 text-brand-600" />
                          <span>{CHANGE_LABEL[c.field]}</span>
                          <span className={chip}>{describeChange(c, members, plan.moveTo)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {plan.moveOptions.length > 0 && !plan.moveTo && (
                    <div className="mt-2">
                      <p className="mb-1 text-[11px] text-gray-500">{plan.moveOptions.length} places match — which one?</p>
                      <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white">
                        {plan.moveOptions.map((w) => (
                          <li key={w.id}>
                            <button
                              type="button" onClick={() => setPlan({ ...plan, moveTo: w })}
                              className="w-full px-2.5 py-1.5 text-left text-[13px] text-gray-700 hover:bg-gray-50"
                            >
                              {w.path}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {plan.unknown.length > 0 && <p className="mt-1.5 text-xs text-amber-800">{plan.unknown.join('; ')}</p>}
                  {plan.options.length > 1 && <Pick options={plan.options} onPick={(t) => setPlan({ ...plan, task: t })} chosen={plan.task} />}
                </>
              )}

              {plan.kind === 'delete' && (
                <>
                  <p className="text-[15px] font-medium text-gray-900">
                    {plan.task ? plan.task.name : <span className="text-amber-700">No task found for “{plan.searched}”</span>}
                  </p>
                  {/* The only irreversible thing the assistant does, so it says so plainly and
                      shows exactly which task it found before the button is pressed. */}
                  {plan.task && (
                    <p className="mt-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[12px] text-red-800">
                      This deletes the task and everything on it. It cannot be undone.
                      {plan.task.subtask_count ? ` It has ${plan.task.subtask_count} subtask${plan.task.subtask_count === 1 ? '' : 's'}.` : ''}
                    </p>
                  )}
                  {plan.options.length > 1 && <Pick options={plan.options} onPick={(t) => setPlan({ ...plan, task: t })} chosen={plan.task} />}
                </>
              )}

              {/* An answered question is shown in the transcript above and nowhere else.
                  It used to be drawn here as well, so asking about somebody by name printed the
                  same two lines twice over -- once as the reply and once as a result card. */}
              {plan.kind === 'ask' && !plan.answer && (
                <p className="text-[13px] text-gray-600">
                  A question about your own work. Press <span className="font-medium text-gray-800">Answer that</span> and
                  I will look it up.
                </p>
              )}

              {plan.kind === 'unknown' && (
                <p className="text-[13px] text-gray-600">
                  I did not follow that. I can start a task, log hours, mark one done, find some, or answer a
                  question about your own work — try one of the examples.
                </p>
              )}
            </div>
          )}

          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
          </>)}
        </div>

        <div className="shrink-0 border-t border-gray-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="relative">
            <textarea
              ref={box} rows={2} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey) return;
                e.preventDefault();
                // Enter asks the question or does the thing; failing both, it re-reads what is
                // there, which is what somebody pressing Enter at a half-read sentence wants.
                if (ready) { submit(); return; }
                if (!text.trim()) return;
                // Typed and sent before the preview caught up: make it rather than make them
                // press twice. Anything that is not a new task still goes through the preview.
                void autoCreate(text).then((made) => { if (!made) send(text.trim()); });
              }}
              aria-label="Say or type what you want, or ask a question"
              placeholder={voice.listening ? 'Listening…' : 'Say it, type it, or ask a question'}
              className="w-full resize-none rounded-xl border border-gray-300 py-2.5 pl-3 pr-11 text-[15px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            />
            {voice.supported && (
              <button
                type="button" onClick={voice.listening ? voice.stop : voice.start}
                aria-label={voice.listening ? 'Stop listening' : 'Speak'}
                className={`tap absolute right-1.5 top-1.5 rounded-lg ${voice.listening ? 'bg-red-50 text-red-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'}`}
              >
                {voice.listening ? <Square size={15} /> : <Mic size={17} />}
              </button>
            )}
            {/* Send. A typed question needs something to press -- waiting for a pause to be
                noticed is fine for a task taking shape, and unnerving when you asked something
                and nothing happened. */}
            <button
              type="button"
              onClick={() => {
                if (ready) { submit(); return; }
                void autoCreate(text).then((made) => { if (!made) send(text.trim()); });
              }}
              disabled={!text.trim() || thinking}
              aria-label={pendingQuestion ? 'Answer that' : 'Send'}
              title={pendingQuestion ? 'Answer that' : 'Send'}
              className={`tap absolute bottom-1.5 right-1.5 rounded-lg disabled:opacity-40 ${
                pendingQuestion ? 'bg-brand-600 text-white hover:bg-brand-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              {thinking ? <Loader2 size={15} className="animate-spin" /> : <CornerDownLeft size={15} />}
            </button>
          </div>

          {voice.listening && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-red-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              Listening — take your time. It acts when you stop.
            </p>
          )}
          {voice.error && <p className="mt-1.5 text-[11px] text-amber-700">{voice.error}</p>}

          {/* Said in the sentence, so it is already set -- the dropdown below is for correcting it,
              not for doing the work again. */}
          {plan?.kind === 'create' && plan.where.list && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-800">
              <Check size={12} className="shrink-0" />
              Going to <b className="font-medium">{plan.where.list.path}</b>, from what you said.
            </p>
          )}
          {plan?.kind === 'create' && !plan.where.list && plan.where.options.length > 0 && (
            <div className="mt-2 rounded-lg bg-amber-50 p-2">
              <p className="mb-1 text-[11px] text-amber-900">
                {plan.where.options.length} places are called that — which one?
              </p>
              <ul className="divide-y divide-amber-100 overflow-hidden rounded-md bg-white">
                {plan.where.options.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      onClick={() => { setListId(w.id); setPlan({ ...plan, where: { ...plan.where, list: w, options: [] } }); }}
                      className="w-full px-2.5 py-1.5 text-left text-[13px] text-gray-700 hover:bg-gray-50"
                    >
                      {w.path}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan?.kind === 'create' && plan.where.missed && (
            <p className="mt-2 text-[11px] text-amber-800">
              Nothing here is called “{plan.where.missed}”, so pick where it should go.
            </p>
          )}

          {/* Where it goes is settled, not asked.
              A dropdown sitting under every new task was a second decision for something already
              decided -- by the sentence, by the List you are standing in, or by the last one you
              used. It is a line of text now, and "change" is there for the once in twenty times
              that line is wrong. */}
          {plan?.kind === 'create' && !picking && (
            <button
              type="button" onClick={() => setPicking(true)}
              className="mt-2 flex w-full items-center gap-1.5 text-left text-[11px] text-gray-500 hover:text-gray-800"
            >
              <span>in</span>
              <b className="truncate font-medium text-gray-700">{here?.path ?? 'nowhere yet'}</b>
              <span className="ml-auto shrink-0 underline underline-offset-2">change</span>
            </button>
          )}
          {plan?.kind === 'create' && picking && (
            <div className="mt-2 flex items-center gap-2">
              <span className="shrink-0 text-xs text-gray-500">in</span>
              <select
                autoFocus
                aria-label="Which list it goes in" value={listId}
                onChange={(e) => { setListId(e.target.value); setPicking(false); }}
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

          {doWord && (
            <button
              type="button" onClick={submit} disabled={!ready || thinking}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {thinking ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />} {doWord}
            </button>
          )}
          {/* Precise, now that questions answer themselves: reading is not changing. */}
          <p className="mt-2 text-center text-[10px] text-gray-400">Nothing is created or changed until you press the button.</p>
        </div>
      </div>
    </div>
  );
};

/**
 * One thing said and what came back, drawn as a conversation.
 *
 * The panel used to replace the question with the answer, so an admin who asked about somebody by
 * name saw a figure with nothing around it and no way to tell what it was an answer to. Keeping
 * both, in the order they happened, is the whole difference between a result and a reply.
 */
const Exchange: React.FC<{
  turn: Turn; onOpen: (listId: string, taskId: string) => void; onGo: (to: string) => void;
}> = ({ turn, onOpen, onGo }) => (
  <div className="space-y-1">
    <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-3 py-1.5 text-[13px] leading-snug text-white">
      {turn.said}
    </p>
    <div className={`w-fit max-w-[90%] rounded-2xl rounded-bl-sm px-3 py-1.5 text-[13px] leading-snug ${
      turn.failed ? 'bg-red-50 text-red-800' : 'bg-gray-100 text-gray-800'}`}
    >
      <p>{turn.reply}</p>
      {turn.detail && <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{turn.detail}</p>}
      {turn.tasks && turn.tasks.length > 0 && (
        <ul className="mt-1.5 divide-y divide-gray-200/70 overflow-hidden rounded-lg bg-white">
          {turn.tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button" onClick={() => onOpen(t.listId, t.id)}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] hover:bg-gray-50"
              >
                <span className="min-w-0 flex-1 truncate text-gray-800">{t.name}</span>
                {t.due && <span className="shrink-0 text-[10px] text-gray-400">{compactDate(t.due)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {turn.goTo && (
        <button
          type="button" onClick={() => onGo(turn.goTo!.to)}
          className="mt-1 text-[11px] font-medium text-brand-700 underline-offset-2 hover:underline"
        >
          {turn.goTo.label} →
        </button>
      )}
    </div>
  </div>
);

/** When a search found several, the person picks rather than the assistant guessing. */
const Pick: React.FC<{ options: Task[]; chosen: Task | null; onPick: (t: Task) => void }> = ({ options, chosen, onPick }) => (
  <div className="mt-2">
    <p className="mb-1 text-[11px] text-gray-500">{options.length} matched — which one?</p>
    <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white">
      {options.map((t) => (
        <li key={t.id}>
          <button
            type="button" onClick={() => onPick(t)}
            className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] ${chosen?.id === t.id ? 'bg-brand-50 font-medium text-brand-800' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            {chosen?.id === t.id ? <Check size={12} className="shrink-0" /> : <ListChecks size={12} className="shrink-0 text-gray-300" />}
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
          </button>
        </li>
      ))}
    </ul>
  </div>
);
