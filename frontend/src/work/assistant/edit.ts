// Changing a task that already exists, and deleting one.
//
// Creating by voice is the easy half: everything in the sentence is new, so anything understood is
// a field and anything left over is the name. Changing one is harder, because the sentence has to
// say *which* task as well as what to do to it, and the two are interleaved:
//
//     change the due date of the GST filing to next Friday
//     ^verb      ^field          ^which task      ^value
//
// So it is read in that order -- field, then value, then whatever is left is how they referred to
// the task -- and the caller searches for that. The search is the caller's job on purpose: this
// file never touches the API, which is what lets it be run against a few hundred sentences.
//
// Two things it refuses to do. It will not guess a field: "move the audit to Tuesday" is a date
// because Tuesday is a date, not because moving usually means dates, and when the value fits
// nothing it says so instead of picking. And it will not delete by description alone -- the caller
// has to show which task it found and wait, because there is no undo for the wrong one.

import { parseTypedDate } from '../dates';
import { parseDuration } from '../ui';
import { matchPerson, type Person } from './parseCommand';

/** One change to make. `says` is the words it came from, for showing the working. */
export type Change =
  | { field: 'due_date'; value: string | null; says: string }
  | { field: 'start_date'; value: string | null; says: string }
  | { field: 'priority'; value: number | null; says: string }
  | { field: 'name'; value: string; says: string }
  | { field: 'estimate'; value: number | null; says: string }
  | { field: 'assignees'; value: string[]; says: string }
  /** A move to another List. The name is resolved against the tree by the caller. */
  | { field: 'list'; said: string; says: string }
  /** A status, by name. Each List has its own, so the caller resolves it against the task's. */
  | { field: 'status'; said: string; says: string };

export interface EditRead {
  /** How they referred to the task, for the caller to search on. */
  which: string;
  changes: Change[];
  /** Anything that read like an instruction but fitted nothing. */
  unknown: string[];
}

const PRIORITY_WORDS: [RegExp, number][] = [
  [/^(?:urgent|critical|asap|emergency|top)(?:\s+priority)?$/i, 1],
  [/^(?:high|important)(?:\s+priority)?$/i, 2],
  [/^(?:normal|medium)(?:\s+priority)?$/i, 3],
  [/^(?:low|minor|whenever)(?:\s+priority)?$/i, 4],
  [/^(?:no|none|clear)(?:\s+priority)?$/i, 0],
];

/**
 * The words that name a field, longest first so "due date" beats "due".
 *
 * Deliberately without a pattern for the List. "Board", "section" and "space" turn up inside real
 * task names -- this firm has a "board pack" -- so a field scan over the whole sentence reads
 * "rename the board pack" as a move. A move is recognised from the value instead ("to the skills
 * list"), where those words mean what they say.
 */
const FIELDS: { field: Change['field']; pattern: RegExp }[] = [
  { field: 'start_date', pattern: /\b(?:start(?:ing)?\s*dates?|start\s*day|begin(?:ning)?\s*dates?)\b/i },
  { field: 'due_date', pattern: /\b(?:due\s*dates?|end\s*dates?|deadlines?|target\s*dates?|due\s*day)\b/i },
  { field: 'priority', pattern: /\bpriorit(?:y|ies)\b/i },
  { field: 'estimate', pattern: /\b(?:estimates?|time\s*estimates?)\b/i },
  { field: 'assignees', pattern: /\b(?:assignees?|owner)\b/i },
  { field: 'name', pattern: /\b(?:names?|titles?)\b/i },
  { field: 'status', pattern: /\bstatus\b/i },
  // Bare "date", last so "due date" and "start date" are read first. "Change the date of the audit
  // to Friday" names a field without saying which, and the due date is the one people mean.
  { field: 'due_date', pattern: /\bdates?\b/i },
];

/** The destination words, looked for in the value only. */
const PLACE_WORD = /\b(?:lists?|folders?|spaces?|sections?|boards?|projects?)\b/i;

/** Verbs that open an instruction to change something. */
const VERB = /^(?:please\s+)?(?:can you\s+)?(?:change|update|edit|modify|rename|re-?assign|assign|reschedule|postpone|push(?:\s+back)?|move|shift|set|clear|remove|delete|unset|mark|put)\s+/i;

/**
 * The status names people say, whatever a List actually calls them. Only these are read as a
 * status without the word "status" -- "move the audit to review" is a status, "move the audit to
 * the review list" is a move, and the place word is what tells them apart.
 */
export const STATUS_WORDS = "to[\\s-]?do|todo|open|not started|in[\\s-]?progress|doing|started|in review|review|on hold|hold|blocked|waiting|done|complete|completed|closed";
const STATUS = new RegExp(`^(?:${STATUS_WORDS})$`, 'i');
const STATUS_AT_END = new RegExp(`\\s+(?:as\\s+)?(${STATUS_WORDS})\\s*$`, 'i');

/**
 * Further changes said after the first: "... to friday and make it high priority". Each one is
 * read as its own short instruction about the same task.
 */
const MORE = /\s*,?\s+and\s+(?:also\s+)?(?=(?:make|set|change|mark|move|push|reschedule|re-?assign|assign|give)\s+(?:it|its|the)\b)/i;

/**
 * Verbs that name the field by themselves.
 *
 * "Reassign the board pack to Aarti" never says the word "assignee", and "rename" never says
 * "name". Taking the field from the verb also settles it before anything looks at the task's own
 * name, which is what stops "board pack" being read as a destination.
 */
const VERB_MEANS: [RegExp, Change['field']][] = [
  [/^(?:re-?assign|assign)$/i, 'assignees'],
  [/^re-?name$/i, 'name'],
  [/^(?:reschedule|postpone|push(?:\s+back)?)$/i, 'due_date'],
];

/** Verbs that mean "take the value away" when no new value follows. */
const CLEARING = /^(?:clear|remove|delete|unset)$/i;

/** "the due date of", "its priority for" -- the glue either side of a field name. */
const OF_AFTER = /\s*\b(?:of|for|on|from|in)\s*$/i;
const OF_BEFORE = /^\s*\b(?:of|for|on|from|in)\b\s*/i;

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const iso = (d: Date) => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x.toISOString(); };

/** Words that mean "take the value away" rather than naming one. */
const EMPTY = /^(?:nothing|none|no\s+\w+|empty|blank|unset|clear(?:ed)?|nobody)$/i;

/**
 * Read an instruction to change a task.
 *
 * @param me the signed-in person's id, so "assign it to me" has somebody to mean.
 */
export function readEdit(input: string, people: Person[], me?: string, now = new Date()): EditRead {
  const [first, ...more] = squash(input).split(MORE);
  const read = readOne(first, people, me, now);
  for (const clause of more) {
    // "make it high priority" says nothing a "set it to" would not, and "set it to" is a shape
    // the reader already knows.
    const said = clause.replace(/^(?:make|give)\s+it\s+(?:an?\s+)?/i, 'set it to ');
    const extra = readOne(said, people, me, now);
    read.changes.push(...extra.changes);
    read.unknown.push(...extra.unknown.filter((u) => u !== 'which task did you mean?'));
  }
  return read;
}

function readOne(input: string, people: Person[], me?: string, now = new Date()): EditRead {
  const unknown: string[] = [];
  const changes: Change[] = [];
  let rest = squash(input);

  const verb = rest.match(VERB);
  const verbWord = verb ? squash(verb[0]).replace(/^(?:please\s+)?(?:can you\s+)?/i, '').toLowerCase() : '';
  if (verb) rest = squash(rest.slice(verb[0].length));

  // --- the value ------------------------------------------------------------------------------
  //
  // Split off first, so everything after it is the new value and everything before it is the task
  // and the scaffolding. After the *last* "to" or "as", not the first: "move the task to be done
  // to Friday" has two, and the one introducing the value is the one nearest the end.
  let said = '';
  let valueSays = '';
  const joint = /\s+(?:to|as|into|=|:)\s+/gi;
  let last: RegExpExecArray | null = null;
  for (let m = joint.exec(rest); m; m = joint.exec(rest)) last = m;
  if (last) {
    said = squash(rest.slice(last.index + last[0].length));
    valueSays = rest.slice(last.index);
    rest = squash(rest.slice(0, last.index));
  } else {
    // "Mark the audit in progress" has no "to" -- the status itself is the last thing said.
    const st = rest.match(STATUS_AT_END);
    if (st && st.index !== undefined) {
      said = st[1];
      valueSays = st[0];
      rest = squash(rest.slice(0, st.index));
    }
  }

  // --- which field ----------------------------------------------------------------------------
  //
  // The verb first, then the words on the left of the value. Never the value itself, except for a
  // destination -- whose words only mean a place when they are the thing being pointed at.
  let field = VERB_MEANS.find(([p]) => p.test(verbWord))?.[1] ?? null;
  let fieldSays = field ? verbWord : '';
  if (!field) {
    for (const f of FIELDS) {
      const m = rest.match(f.pattern);
      if (!m) continue;
      field = f.field;
      fieldSays = m[0];
      // Take the field words out, with "the" in front and "of" either side, so what is left is
      // how they referred to the task and nothing else.
      rest = squash(rest.replace(new RegExp(`(?:\\bthe\\s+|\\bits\\s+)?${m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), ' '));
      rest = squash(squash(rest.replace(OF_AFTER, ' ')).replace(OF_BEFORE, ' '));
      break;
    }
  }
  if (!field && said && PLACE_WORD.test(said)) { field = 'list'; fieldSays = said; }

  // --- what the value is ----------------------------------------------------------------------
  const asDate = said ? parseTypedDate(said, now) : null;
  const asPriority = PRIORITY_WORDS.find(([p]) => p.test(said));
  const asPeople = said
    ? said.split(/\s*(?:,|and)\s*/i).map((w) => matchPerson(w.trim(), people)).filter(Boolean)
    : [];
  const everyoneNamed = asPeople.length > 0 && asPeople.length === said.split(/\s*(?:,|and)\s*/i).filter(Boolean).length;
  const asDuration = said ? parseDuration(said) : null;
  // "Clear the due date of the audit" names no new value, and the verb is the whole instruction.
  const emptied = (said !== '' && EMPTY.test(said)) || (said === '' && CLEARING.test(verbWord));

  /** Settle on a field when none was named, from what the value turned out to be. */
  const guess = (): Change['field'] | null => {
    if (asDate) return 'due_date';
    if (asPriority) return 'priority';
    if (everyoneNamed) return 'assignees';
    if (/\b(?:list|folder|space|section|board)\b/i.test(said)) return 'list';
    if (STATUS.test(said)) return 'status';
    return null;
  };
  const target = field ?? guess();

  if (target === 'due_date' || target === 'start_date') {
    if (emptied) changes.push({ field: target, value: null, says: valueSays || fieldSays });
    else if (asDate) changes.push({ field: target, value: iso(asDate), says: said });
    else if (said) unknown.push(`"${said}" is not a date I understand`);
    else unknown.push('no new date was given');
  } else if (target === 'priority') {
    if (asPriority) changes.push({ field: 'priority', value: asPriority[1] || null, says: said });
    else if (emptied) changes.push({ field: 'priority', value: null, says: valueSays || fieldSays });
    else unknown.push(said ? `"${said}" is not a priority` : 'no new priority was given');
  } else if (target === 'assignees') {
    if (emptied) changes.push({ field: 'assignees', value: [], says: valueSays || fieldSays });
    else if (everyoneNamed) {
      changes.push({ field: 'assignees', value: asPeople.map((p) => (p === 'me' ? me ?? '' : (p as Person).id)), says: said });
    } else unknown.push(said ? `nobody here is called "${said}"` : 'no new assignee was given');
  } else if (target === 'estimate') {
    if (emptied) changes.push({ field: 'estimate', value: null, says: valueSays || fieldSays });
    else if (asDuration) changes.push({ field: 'estimate', value: asDuration, says: said });
    else unknown.push(said ? `"${said}" is not a length of time` : 'no new estimate was given');
  } else if (target === 'name') {
    if (said) changes.push({ field: 'name', value: said.replace(/^["“']|["”']$/g, ''), says: said });
    else unknown.push('no new name was given');
  } else if (target === 'list') {
    if (said) changes.push({ field: 'list', said, says: said });
    else unknown.push('no destination was given');
  } else if (target === 'status') {
    if (said) changes.push({ field: 'status', said: said.toLowerCase(), says: said });
    else unknown.push('no new status was given');
  } else if (said) {
    unknown.push(`I could not tell what "${said}" was meant to change`);
  } else {
    unknown.push('nothing was said to change');
  }

  // --- which task -----------------------------------------------------------------------------
  // Whatever is left. "the", "task", and a dangling "it" are scaffolding, not part of the name.
  let which = squash(rest
    // "of" survives whenever the field was guessed from the value rather than matched by name,
    // because only a matched field takes its own scaffolding with it.
    .replace(/^\s*(?:of|for)\s+/i, '')
    .replace(/^\s*(?:the|this|that|my)\s+/i, '')
    .replace(/^\s*task\s+(?:called\s+|named\s+)?/i, '')
    .replace(/\s*\btask\s*$/i, '')
    .replace(/^["“']|["”']$/g, ''));
  if (/^(?:it|that|this|them)$/i.test(which)) which = '';
  if (!which && verbWord) unknown.push('which task did you mean?');

  return { which, changes, unknown };
}

/** Verbs that open an instruction to delete. */
const BIN = /^(?:please\s+)?(?:can you\s+)?(?:delete|remove|bin|discard|drop|get rid of)\s+/i;

/**
 * Read an instruction to delete a task.
 *
 * @returns the words naming the task, or null when the sentence is not a deletion. "Remove the due
 *          date of X" is not one -- that is an edit, and the field words are how you tell.
 */
export function readDelete(input: string): string | null {
  const text = squash(input);
  if (!BIN.test(text)) return null;
  if (FIELDS.some((f) => f.pattern.test(text))) return null;
  const which = squash(text.replace(BIN, '')
    .replace(/^\s*(?:the|this|that|my)\s+/i, '')
    .replace(/^\s*tasks?\s+(?:called\s+|named\s+)?/i, '')
    .replace(/\s*\btasks?\s*$/i, '')
    .replace(/^["“']|["”']$/g, ''));
  return which || null;
}
