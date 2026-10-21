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

import type { Recurrence } from '../api';
import { parseTypedDate } from '../dates';
import { matchPerson, type Person } from './parseCommand';
import { readRepeat } from './recurrence';
import { readDuration } from './tidy';

/** One change to make. `says` is the words it came from, for showing the working. */
export type Change =
  | { field: 'due_date'; value: string | null; says: string }
  | { field: 'start_date'; value: string | null; says: string }
  | { field: 'priority'; value: number | null; says: string }
  | { field: 'name'; value: string; says: string }
  | { field: 'estimate'; value: number | null; says: string }
  /** Everybody on it, replaced: "reassign", "give", "hand over", "change the assignee". */
  | { field: 'assignees'; value: string[]; says: string }
  /** Somebody added, keeping whoever is on it already: "assign X to Laxmi". */
  | { field: 'add_assignees'; value: string[]; says: string }
  /** Somebody taken off, leaving the rest: "unassign Aarti from X". */
  | { field: 'remove_assignees'; value: string[]; says: string }
  /** Tags by name. A name the Space does not have yet is made, as it is from the task's own tag box. */
  | { field: 'add_tags'; value: string[]; says: string }
  | { field: 'remove_tags'; value: string[]; says: string }
  | { field: 'archived'; value: boolean; says: string }
  /** How it repeats; null stops it. A weekly or monthly rule takes its day from the task's due date. */
  | { field: 'recurrence'; value: Recurrence | null; says: string }
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
const VERB = /^(?:please\s+)?(?:can you\s+)?(?:change|update|edit|modify|rename|re-?assign|assign|reschedule|postpone|push(?:\s+back)?|move|shift|set|clear|remove|delete|unset|mark|put|make)\s+/i;

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
const MORE = /\s*,?\s+and\s+(?:also\s+)?(?=(?:make|set|change|mark|move|push|reschedule|re-?assign|assign|give|tag)\s+(?:it|its|the)\b)/i;

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
  const [first, ...more] = squash(input).replace(/[\s.!?,;]+$/, '').split(MORE);
  const read = readShape(first, people, me, now) ?? readOne(first, people, me, now);
  for (const clause of more) {
    // "make it high priority" says nothing a "set it to" would not, and "set it to" is a shape
    // the reader already knows.
    const said = /^make\s+it\s+(?:repeat|recur)/i.test(clause) ? clause : clause.replace(/^(?:make|give)\s+it\s+(?:an?\s+)?/i, 'set it to ');
    const extra = readShape(said, people, me, now) ?? readOne(said, people, me, now);
    read.changes.push(...extra.changes);
    read.unknown.push(...extra.unknown.filter((u) => u !== 'which task did you mean?'));
  }
  return read;
}

/** "Aarti", "Aarti and Laxmi", "me" -- everybody named, or null if any of them is nobody here. */
function everyone(said: string, people: Person[], me?: string): string[] | null {
  const names = said.split(/\s*(?:,|\band\b|&)\s*/i).map((w) => w.trim()).filter(Boolean);
  if (!names.length) return null;
  const ids: string[] = [];
  for (const n of names) {
    const hit = matchPerson(n, people);
    if (!hit) return null;
    ids.push(hit === 'me' ? me ?? '' : hit.id);
  }
  return ids;
}

/** How a task was referred to, with the words around it that only pointed at it. */
export function taskWords(said: string): string {
  return squash(said
    .replace(/^\s*(?:of|for|on|to)\s+/i, '')
    .replace(/^\s*(?:the|this|that|my)\s+/i, '')
    .replace(/^\s*task\s+(?:called\s+|named\s+)?/i, '')
    .replace(/\s*\btask\s*$/i, '')
    .replace(/^["“']|["”']$/g, ''));
}

const PRIORITY_LEVEL = '(urgent|critical|asap|top|high|important|normal|medium|low|minor)';
const DURATION = '(\\d+(?:[.:]\\d+)?\\s*(?:h|hr|hrs|hours?|m|mins?|minutes?)?)';

/**
 * Instructions with a shape of their own, read whole rather than field by field.
 *
 * "Assign the GST return to Laxmi" and "unassign Aarti from the GST return" put the task and the
 * person the other way round from each other, and "add tag X to Y" puts the value first -- none of
 * which the field-then-value reading below expects. Each is one pattern, tried in turn.
 */
export function readShape(input: string, people: Person[], me?: string, now = new Date()): EditRead | null {
  const text = squash(input).replace(/^(?:please\s+)?(?:can you\s+)?/i, '');
  const made = (which: string, change: Change): EditRead => {
    const w = taskWords(which);
    const it = /^(?:it|that|this|them)$/i.test(w);
    return { which: it ? '' : w, changes: [change], unknown: [] };
  };
  let m: RegExpMatchArray | null;

  // Archiving. The task stays, out of the way, and can be brought back.
  if ((m = text.match(/^(un-?archive|restore)\s+(.+)$/i))) return made(m[2], { field: 'archived', value: false, says: m[1] });
  if ((m = text.match(/^archive\s+(.+)$/i))) return made(m[1], { field: 'archived', value: true, says: 'archive' });

  // Tags: "add tag urgent-client to X", "tag X as urgent", "remove tag Y from X", "untag Y from X".
  const tags = (s: string) => s.split(/\s*(?:,|\band\b)\s*/i).map((t) => t.trim().replace(/^#/, '').replace(/^["“']|["”']$/g, '')).filter(Boolean);
  if ((m = text.match(/^(?:add|put)\s+(?:the\s+|a\s+)?tags?\s+(.+?)\s+(?:to|on)\s+(.+)$/i))) return made(m[2], { field: 'add_tags', value: tags(m[1]), says: m[1] });
  if ((m = text.match(/^tag\s+(.+?)\s+(?:as|with)\s+(.+)$/i))) return made(m[1], { field: 'add_tags', value: tags(m[2]), says: m[2] });
  if ((m = text.match(/^(?:remove|delete|take\s+off|drop)\s+(?:the\s+)?tags?\s+(.+?)\s+(?:from|off)\s+(.+)$/i))) return made(m[2], { field: 'remove_tags', value: tags(m[1]), says: m[1] });
  if ((m = text.match(/^untag\s+(.+?)\s+from\s+(.+)$/i))) return made(m[2], { field: 'remove_tags', value: tags(m[1]), says: m[1] });

  // An estimate added: "add estimate 2h to X", "add an estimate of 90 minutes to X", "add 2h estimate to X".
  if ((m = text.match(new RegExp(`^(?:add|put|give)\\s+(?:an?\\s+)?(?:time\\s+)?estimate\\s+(?:of\\s+)?${DURATION}\\s+(?:to|on|for)\\s+(.+)$`, 'i')))
    || (m = text.match(new RegExp(`^(?:add|put|give)\\s+(?:an?\\s+)?${DURATION}\\s+(?:time\\s+)?estimate\\s+(?:to|on|for)\\s+(.+)$`, 'i')))) {
    const seconds = readDuration(m[1]);
    if (seconds) return made(m[2], { field: 'estimate', value: seconds, says: m[1] });
  }
  if ((m = text.match(new RegExp(`^estimate\\s+(.+?)\\s+(?:at|as|to be)\\s+${DURATION}$`, 'i')))) {
    const seconds = readDuration(m[2]);
    if (seconds) return made(m[1], { field: 'estimate', value: seconds, says: m[2] });
  }

  // Taking somebody off: "unassign Aarti from X", "remove Aarti from X", "take Aarti off X".
  if ((m = text.match(/^(?:un-?assign|remove|take)\s+(.+?)\s+(?:from|off(?:\s+of)?)\s+(.+)$/i))) {
    const ids = everyone(m[1].replace(/^(?:the\s+)?(?:assignees?|owner)\s*/i, ''), people, me);
    if (ids) return made(m[2], { field: 'remove_assignees', value: ids, says: m[1] });
  }
  // Taking everybody off: "unassign X", "remove the assignee of X", "remove everyone from X".
  if ((m = text.match(/^un-?assign\s+(?:everyone\s+from\s+|everybody\s+from\s+)?(.+)$/i))
    || (m = text.match(/^(?:remove|clear)\s+(?:the\s+|all\s+(?:the\s+)?)?(?:assignees?|owners?)\s+(?:of|from|on)\s+(.+)$/i))
    || (m = text.match(/^(?:remove|take)\s+(?:everyone|everybody)\s+(?:from|off)\s+(.+)$/i))) {
    return made(m[1], { field: 'assignees', value: [], says: 'nobody' });
  }

  // Handing it over: "give X to Asmita", "hand over X to Asmita", "hand X over to Asmita".
  if ((m = text.match(/^(?:give|hand\s+over|hand|pass)\s+(.+?)\s+(?:over\s+)?to\s+(.+)$/i))) {
    const ids = everyone(m[2], people, me);
    if (ids) return made(m[1], { field: 'assignees', value: ids, says: m[2] });
  }
  // "make me the assignee of X", which the speech tidy-up has already made "assign to me of X".
  if ((m = text.match(/^assign\s+to\s+(.+?)\s+(?:of|on|for)\s+(.+)$/i))) {
    const ids = everyone(m[1], people, me);
    if (ids) return made(m[2], { field: 'add_assignees', value: ids, says: m[1] });
  }
  // "Assign it to me", which the speech tidy-up has already made "assign to me": the task is the
  // one last touched.
  if ((m = text.match(/^assign\s+to\s+(.+)$/i))) {
    const ids = everyone(m[1], people, me);
    if (ids) return { which: '', changes: [{ field: 'add_assignees', value: ids, says: m[1] }], unknown: [] };
  }
  // Adding somebody: "assign X to Laxmi". Not "reassign", which replaces, and is read below.
  if ((m = text.match(/^assign\s+(?!to\b)(.+)\s+to\s+(.+)$/i))) {
    const ids = everyone(m[2], people, me);
    if (ids) return made(m[1], { field: 'add_assignees', value: ids, says: m[2] });
  }

  // "make X high priority", "make it urgent", "make X a low priority".
  if ((m = text.match(new RegExp(`^make\\s+(.+?)\\s+(?:an?\\s+)?${PRIORITY_LEVEL}(?:\\s+priority)?$`, 'i')))) {
    const level = PRIORITY_WORDS.find(([p]) => p.test(m![2]))?.[1];
    if (level !== undefined) return made(m[1], { field: 'priority', value: level || null, says: m[2] });
  }

  // Repeats: "make X repeat every monday", "set X to repeat monthly", "repeat X every 2 weeks",
  // "stop repeating X".
  if ((m = text.match(/^(?:stop\s+repeating|don'?t\s+repeat|do\s+not\s+repeat|stop\s+the\s+repeat\s+(?:of|on))\s+(.+)$/i))
    || (m = text.match(/^(?:stop|end)\s+(.+?)\s+(?:from\s+)?(?:repeating|recurring)$/i))) {
    return made(m[1], { field: 'recurrence', value: null, says: 'stop repeating' });
  }
  if ((m = text.match(/^(?:make|set)\s+(.+?)\s+(?:to\s+)?(?:repeat|recur)s?\s+(.+)$/i))
    || (m = text.match(/^(?:repeat|recur)\s+(.+?)\s+((?:every|each|daily|weekly|monthly|yearly|annually|fortnightly|quarterly|on\s+week).*)$/i))
    || (m = text.match(/^(.+?)\s+(?:should\s+)?(?:repeats?|recurs?)\s+(.+)$/i))) {
    const repeat = readRepeat(m[2], now);
    // Left unsettled: a weekly or monthly rule takes its day from the task's own due date, which
    // only the caller knows once it has found the task.
    if (repeat) return made(m[1], { field: 'recurrence', value: repeat.rule, says: repeat.from });
  }
  return null;
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
  const asDuration = said ? readDuration(said) : null;
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
  // A field straight after the verb -- "remove the due date of X". Anywhere else the field words
  // are the task's own name: "delete task Update due date sheet" is a task that gets deleted.
  const after = text.replace(BIN, '').replace(/^(?:the|its)\s+/i, '');
  if (FIELDS.some((f) => after.search(f.pattern) === 0)) return null;
  const which = squash(text.replace(BIN, '')
    .replace(/^\s*(?:the|this|that|my)\s+/i, '')
    .replace(/^\s*tasks?\s+(?:called\s+|named\s+)?/i, '')
    .replace(/\s*\btasks?\s*$/i, '')
    .replace(/^["“']|["”']$/g, ''));
  return which || null;
}
