// What somebody meant, before working out the details.
//
// "Add a task called X" and "log two hours on X" and "mark X done" are four words apart and
// nothing alike, so the first job is to tell them apart. Everything downstream is easier once
// the intent is known: a date in "add" is a due date, a date in "log" is which day the hours
// belong to, and a date in "find" is a filter.
//
// `ask` is the odd one out: it changes nothing. "How many hours have I logged this week?" has an
// answer the app already holds, and making somebody open a page and read a total off it is work the
// app could have done for them. It is kept apart from `find` because the two want different things
// -- `find` wants a list of tasks, `ask` wants a number with its working.
//
// An assistant that claims to understand everything and then shrugs is worse than one that says
// plainly what it can do. So a sentence is only a new task when it says so ("add", "remind me to")
// or opens like a piece of work ("call the auditor", "file the return"). Anything else -- "play some
// music", "what's the weather" -- is `unknown`, and the panel says what it can do instead of
// quietly making a task called "Play some music".

import { STATUS_WORDS } from './edit';
import { TASK_LIKE } from './verbs';

export type Intent =
  | 'create' | 'log_time' | 'timer' | 'complete' | 'update' | 'comment' | 'delete' | 'find' | 'ask' | 'unknown';

interface Rule {
  intent: Intent;
  /** Matched against the whole sentence. First rule to match wins, so order is meaning. */
  pattern: RegExp;
}

/** Politeness the reader can skip over. The tidy-up removes it first; these are for direct callers. */
const P = '^(?:please\\s+)?(?:(?:can|could|would)\\s+you\\s+(?:please\\s+)?)?';
const at = (body: string) => new RegExp(P + body, 'i');

const UNIT = '(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)';

/** A sentence that opens like a question. Questions are answered, never turned into tasks. */
const QUESTION = /^(?:how|who|whom|whose|what|what's|whats|which|when|where|why|did|do|does|have|has|am|is|are|was|were|any|anything|kya|kitne|kitna|kaun)\b/i;

/** Questions, in the order they are told apart. */
const ASKING: Rule[] = [
  // "Who is working on the GST return", "who has the audit" -- about a task, not a person.
  { intent: 'ask', pattern: /^who(?:'s|\s+is|\s+are)?\s+(?:working|assigned|handling|doing|responsible|on\b)|^who\s+(?:has|owns|got)\b/i },
  { intent: 'ask', pattern: /\b(?:how many|how much|how long)\b/i },
  { intent: 'ask', pattern: /^what\s+(?:did|have|has)\s+\w+\s+(?:finish|finished|complete|completed|close|closed|do|done|deliver|delivered|log|logged)\b/i },
  { intent: 'ask', pattern: /\b(?:who(?:'s| is)? my|who do i report to|which teams?)\b/i },
  { intent: 'ask', pattern: /\b(?:on my plate|do i have|have i got|what(?:'s| is| are)? (?:my|left))\b/i },
  // "What's due", "what is overdue", "which tasks…": a list.
  { intent: 'find', pattern: /^(?:what|which)(?:'s|\s+is|\s+are)?\s+(?:due|overdue|pending|left|open|late)\b/i },
  { intent: 'find', pattern: /^(?:anything|any\s+tasks?)\s+(?:due|overdue|pending|left)\b(?![^?]*\?$)/i },
  { intent: 'find', pattern: /^(?:what|which)\b.*\btasks?\b/i },
];

const RULES: Rule[] = [
  // Timers first: "start timer on the audit" opens with "start", which would otherwise be work.
  { intent: 'timer', pattern: at('(?:start|begin|stop|end|pause|resume|restart)\\s+(?:the\\s+|a\\s+|my\\s+)?(?:timer|tracking|time\\s+tracking|clock|stopwatch)\\b') },
  { intent: 'timer', pattern: at('(?:start|begin)\\s+(?:tracking|timing)\\b') },
  { intent: 'timer', pattern: at('(?:stop|pause)\\s+(?:tracking|timing)\\b') },
  { intent: 'timer', pattern: at('timer\\s+(?:on|for)\\b') },

  // Time next: "log 2 hours on the audit" also contains "the audit", which a looser rule for
  // "find" would happily claim.
  { intent: 'log_time', pattern: new RegExp(`\\b(log|record|put|add|book)\\s+(?:in\\s+)?\\d+(?:[.:]\\d+)?\\s*${UNIT}\\b`, 'i') },
  { intent: 'log_time', pattern: new RegExp(`\\b(?:spent|worked)\\s+\\d+(?:[.:]\\d+)?\\s*${UNIT}\\b`, 'i') },
  { intent: 'log_time', pattern: /^log\s+(?:my\s+)?(?:time|hours)\b/i },
  // A length said first, then what it was spent on: "2 hours on CWC data fix", "30 mins for the
  // audit". The assistant's own examples say it this way, and it is how a timesheet is spoken --
  // read as a new task, it made a task called "2 hours on CWC data fix". A length at the end is an
  // estimate ("prepare GST summary 2h"), which is why this one wants the length at the front.
  { intent: 'log_time', pattern: new RegExp(`^(?:i\\s+)?(?:did\\s+|worked\\s+|spent\\s+)?\\d+(?:[.:]\\d+)?\\s*${UNIT}\\b\\s+(?:on|for|against|towards)\\s+\\S`, 'i') },
  // Hinglish puts the verb last: "kal GST return pe 2 ghante log kiye".
  { intent: 'log_time', pattern: new RegExp(`\\d+(?:[.:]\\d+)?\\s*${UNIT}\\b.*\\blog(?:ged)?\\s*$`, 'i') },

  // A question asked mid-sentence, as Hinglish does: "mere kitne task pending hai".
  { intent: 'ask', pattern: /\b(?:how many|how much|how long)\b/i },

  // Comments: "comment on X: ...", "add a comment to X saying ...".
  { intent: 'comment', pattern: at('(?:(?:add|post|leave|write|put)\\s+(?:a\\s+)?)?comment\\b') },
  { intent: 'comment', pattern: at('(?:add|post|leave|write|put)\\s+(?:a\\s+)?note\\s+(?:on|to)\\b') },

  // Marking done. Anchored to the front, and the word "done" to the end: "add task mark attendance
  // done for interns" is a new task whose name happens to hold both words.
  { intent: 'complete', pattern: at('(?:mark|set|move)\\b.*\\b(?:as\\s+)?(?:done|complete|completed|finished|closed)\\s*$') },
  // Anchored to the front, like the edits below. Looked for anywhere, "close" made "create Close
  // books" and "set priority of Close books" into a request to mark something done -- and this
  // firm closes books every month, so the word is in half its task names.
  { intent: 'complete', pattern: at('(?:close|finish|complete)\\s+(?:the\\s+|my\\s+)?\\b') },
  { intent: 'complete', pattern: /^i(?:'ve|\s+have)?\s+(?:just\s+)?(?:finished|done|completed)\b/i },

  // Changing and deleting a task that already exists.
  //
  // Anchored to the front of the sentence, which matters more than it looks: "add a task to update
  // the client list" contains the word "update", and a rule that looked anywhere would read a new
  // task as an edit to an imaginary one. An instruction leads with its verb, so that is where this
  // looks -- and "add" is still the first word, so `create` still wins it.
  //
  // Clearing a field comes before deleting, because "remove the due date of the audit" and "remove
  // the audit" open identically and only one of them should empty a task off the board.
  { intent: 'update', pattern: at('(?:clear|remove|delete|unset)\\s+(?:the\\s+|its\\s+|all\\s+(?:the\\s+)?)?(?:due\\s*date|start\\s*date|end\\s*date|deadline|priority|assignees?|owners?|estimate|tags?)\\b') },
  { intent: 'update', pattern: at('(?:change|update|edit|modify|rename|re-?assign|un-?assign|assign|reschedule|postpone|push|move|shift|archive|un-?archive|restore|tag|untag|repeat|stop\\s+repeating|hand\\s+over|estimate)\\b') },
  // "Give the audit to Asmita", "hand the audit over to Asmita". Not "give a call to the bank",
  // which is work: the article says so.
  { intent: 'update', pattern: at('(?:give|hand|pass)\\s+(?!a\\b|an\\b)\\S.*\\s+to\\s+\\S') },
  // "Take Aarti off the audit".
  { intent: 'update', pattern: at('take\\s+\\S+(?:\\s+\\S+)?\\s+off\\b') },
  // Adding a tag or an estimate to an existing task opens with "add" too, so it is told apart here.
  { intent: 'update', pattern: at('(?:add|put)\\s+(?:the\\s+|a\\s+|an\\s+)?(?:tags?\\b|(?:time\\s+)?estimate(?:\\s+of)?\\s+\\d).*\\s(?:to|on|for)\\s') },
  { intent: 'update', pattern: new RegExp(`${P}(?:add|put)\\s+(?:an?\\s+)?\\d+(?:[.:]\\d+)?\\s*${UNIT}?\\s+(?:time\\s+)?estimate\\b`, 'i') },
  // "Make the audit high priority", "make it urgent", "make the audit repeat monthly".
  { intent: 'update', pattern: at('make\\s+(?!a\\b|an\\b|new\\b|sure\\b).+\\s(?:urgent|critical|high|important|normal|medium|low)(?:\\s+priority)?\\s*$') },
  { intent: 'update', pattern: at('make\\s+(?!a\\b|an\\b|new\\b|sure\\b).+\\s(?:repeat|recur)s?\\b') },
  { intent: 'update', pattern: at('set(?!\\s+(?:up|a|an)\\b)\\b.*\\b(?:priority|due|deadline|start|date|assignee|owner|estimate|name|title|status|to|as)\\b') },
  // A status other than done: "set the audit to in progress", "mark payroll as on hold".
  { intent: 'update', pattern: new RegExp(`${P}(?:set(?!\\s+up\\b)|mark|put|move)\\b.*\\s(?:to\\s+|as\\s+|in\\s+)?(?:${STATUS_WORDS})\\s*$`, 'i') },
  { intent: 'delete', pattern: at('(?:delete|remove|bin|discard|drop|get rid of|trash)\\b') },

  // "Show", "find", "list" and "search" are commands, so they lead the sentence. Looked for
  // anywhere, the word "list" alone turned "add a task to update the client list" into a search --
  // a real task name, and this firm's work is full of lists, boards and reviews.
  { intent: 'find', pattern: at('(?:show|find|list|search|give me|pull up|open my|see)\\b') },
  // "Asmita's tasks", "tasks for Aditya", "my tasks for today".
  { intent: 'find', pattern: /^(?:my\s+|\S+[’']s\s+)(?:open\s+|overdue\s+|pending\s+)?tasks?\b|^(?:open\s+|overdue\s+|pending\s+)?tasks?\s+(?:for|of|assigned to|due)\b/i },
  // Anything else ending in a question mark that does not ask for something to be done.
  { intent: 'ask', pattern: /^(?!.*\b(?:add|create|make|new|assign|log|record|mark|close|finish|move|set)\b).*\?\s*$/i },

  { intent: 'create', pattern: /\b(?:add|create|make|new|remind me to|i need to|i have to|i must|set up|schedule|note down)\b/i },
  // A bare instruction with a date in it is almost always a new task: "call the auditor tomorrow".
  { intent: 'create', pattern: /\b(?:today|tomorrow|tmrw|next week|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|eod|eow|eom|day after tomorrow|in \d+ (?:days?|weeks?))\b/i },
  { intent: 'create', pattern: /\bassign(?:ed)?\s+to\b/i },
  // And one that opens like a piece of work: "call the auditor", "file the GST return".
  { intent: 'create', pattern: TASK_LIKE },
];

export interface Read {
  intent: Intent;
  /** The sentence with the words that only announced the intent taken off the front. */
  rest: string;
}

/** Words whose only job was to say which kind this is. */
const STRIP: Partial<Record<Intent, RegExp>> = {
  complete: /^\s*(?:please\s+)?(?:(?:can|could|would) you\s+(?:please\s+)?)?(?:mark|set|move|close|finish|complete)\s+(?:the\s+|my\s+)?/i,
  find: /^\s*(?:please\s+)?(?:(?:can|could|would) you\s+(?:please\s+)?)?(?:show|find|list|search for|search|give me|pull up|see)\s+(?:me\s+)?(?:all\s+)?/i,
};

export function readIntent(input: string): Read {
  const text = input.trim();
  if (!text) return { intent: 'unknown', rest: '' };
  const rules = QUESTION.test(text) ? ASKING : RULES;
  for (const rule of rules) {
    if (!rule.pattern.test(text)) continue;
    const strip = STRIP[rule.intent];
    return { intent: rule.intent, rest: strip ? text.replace(strip, '').trim() : text };
  }
  // A question none of the rules above recognised is still a question: the answer side decides
  // whether it can say anything, and says so plainly when it cannot.
  if (QUESTION.test(text) || /\?\s*$/.test(text)) return { intent: 'ask', rest: text };
  return { intent: 'unknown', rest: text };
}

/** What each one is called when it is shown to a person. */
export const INTENT_LABEL: Record<Intent, string> = {
  create: 'New task',
  log_time: 'Log time',
  timer: 'Timer',
  complete: 'Mark done',
  update: 'Change a task',
  comment: 'Comment',
  delete: 'Delete a task',
  find: 'Find',
  ask: 'Answer',
  unknown: 'Not something I can do yet',
};

/** What it can do, said once, for the times it cannot do what was asked. */
export const CAN_DO_LINE =
  'I can create, change, complete and delete tasks, log time, start and stop timers, add comments and tags, '
  + 'and answer questions like “what’s overdue?”, “how many hours did I log yesterday?” or “who is working on the GST return?”.';
