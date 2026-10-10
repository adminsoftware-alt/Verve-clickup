// One breath, several tasks.
//
// This is what a meeting actually produces: "call the auditor, file the Sharma GST return and
// book the venue for Friday". Three things, said once, which the app has always made somebody
// type three times -- and so they type none of them.
//
// The whole difficulty is one question: is a comma separating two tasks, or separating a task
// from its own due date? "Prepare the board pack, should take 2h, due Friday" is one task with
// three clauses; "call the auditor, file the return" is two tasks. To a splitter working on
// punctuation they look identical.
//
// Two rules settle it, and both came from running this rather than reasoning about it:
//
//   An instruction starts with a verb. "File the return" is a task; "Co accounts" is not -- which
//   is what stops "review Sharma and Co accounts" becoming two tasks for nobody. Half this firm's
//   clients are called "X and Co", so this one is not a nicety.
//
//   A fragment that is not an instruction belongs to the one before it. "...and assign to Aarti"
//   is a clause of the previous task, so it is handed back rather than cancelling the split.

import { parseCommand, type ParsedCommand, type Person } from './parseCommand';
import { IMPERATIVE } from './verbs';

/** Strong breaks: nobody writes these inside a single task. */
const HARD_SPLIT = /\n+|\s*;\s*|\s+(?:and\s+)?then\s+|\s*•\s*|\s+-\s+(?=[A-Za-z])/;

/**
 * "add three tasks:" / "create the following, due Friday:" -- everything after the colon is the
 * list, and everything before it may carry a date or an assignee meant for all of them.
 *
 * Anchored on the colon rather than on a vocabulary: people say "three", "a couple of", "the
 * following items", and a list of the words they might use is a list that is always one short.
 */
const PREAMBLE = /^\s*(?:please\s+)?(?:can you\s+)?(?:add|create|make|note|capture|log)\b[^:\n]{0,60}?[:—]\s*/i;

/** "1. foo 2. bar" or "1) foo 2) bar", which is how notes are actually written. */
const NUMBERED = /(?:^|\s)\d{1,2}[.)]\s+/;

export interface MultiRead {
  /** One per task found. A single task comes back as a list of one, so callers need no branch. */
  tasks: ParsedCommand[];
  /** What was said before the colon and applied to every one of them, if anything. */
  sharedFrom: string | null;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[,\s]+|[,.;\s]+$/g, '').trim();

/** Does this fragment stand on its own as a task, or is it a clause belonging to the last one? */
function standsAlone(fragment: string, people: Person[], me?: string, now?: Date): ParsedCommand | null {
  const text = clean(fragment);
  if (text.length < 3) return null;
  if (!IMPERATIVE.test(text)) return null;
  const parsed = parseCommand(text, people, me, now);
  // Nothing left once the dates and names are lifted out means there was no task in it.
  if (!parsed.name || parsed.name.length < 3) return null;
  return parsed;
}

/**
 * Read a sentence as one task or several.
 *
 * @param me the signed-in person's id, so "assign to me" has somebody to mean.
 */
export function splitTasks(input: string, people: Person[], me?: string, now = new Date()): MultiRead {
  const whole = input.trim();
  if (!whole) return { tasks: [], sharedFrom: null };

  // Anything before an "add these tasks:" colon applies to all of them -- "due Friday: X and Y"
  // is one date and two tasks, and splitting it off is the only way both get the date.
  let body = whole;
  let sharedFrom: string | null = null;
  const lead = whole.match(PREAMBLE);
  if (lead) {
    const before = lead[0].replace(/[:—]\s*$/, '').trim();
    body = whole.slice(lead[0].length);
    // Only worth calling it shared context if it says something beyond "add three tasks".
    const read = parseCommand(before, people, me, now);
    if (read.due_date || read.priority || read.assignees.length) sharedFrom = before;
  }

  // Hard breaks first: a newline or a semicolon is never inside one task.
  let pieces = body.split(HARD_SPLIT).map(clean).filter(Boolean);
  if (pieces.length === 1 && NUMBERED.test(body)) {
    pieces = body.split(NUMBERED).map(clean).filter(Boolean);
  }

  // Then the soft ones -- comma and "and".
  if (pieces.length === 1) {
    const soft = body.split(/\s*,\s*|\s+and\s+/i).map(clean).filter(Boolean);
    if (soft.length > 1 && standsAlone(soft[0], people, me, now)) {
      const joined: string[] = [];
      for (const fragment of soft) {
        if (joined.length && !standsAlone(fragment, people, me, now)) {
          // Put the word back that the split took out. "and" reads correctly either way here,
          // because what follows is a clause the parser knows how to lift out again.
          joined[joined.length - 1] = `${joined[joined.length - 1]} and ${fragment}`;
        } else {
          joined.push(fragment);
        }
      }
      if (joined.length > 1) pieces = joined;
    }
  }

  const shared = sharedFrom ? parseCommand(sharedFrom, people, me, now) : null;
  const tasks = pieces
    .map((p) => parseCommand(p, people, me, now))
    .filter((t) => t.name.length > 0)
    .map((t) => (shared
      ? {
        ...t,
        // Only where the task did not say so itself: a task with its own date keeps it.
        due_date: t.due_date ?? shared.due_date,
        start_date: t.start_date ?? shared.start_date,
        priority: t.priority ?? shared.priority,
        assignees: t.assignees.length ? t.assignees : shared.assignees,
      }
      : t));

  return { tasks, sharedFrom };
}
