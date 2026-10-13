// What somebody meant, before working out the details.
//
// "Add a task called X" and "log two hours on X" and "mark X done" are four words apart and
// nothing alike, so the first job is to tell them apart. Everything downstream is easier once
// the intent is known: a date in "add" is a due date, a date in "log" is which day the hours
// belong to, and a date in "find" is a filter.
//
// `ask` is the fifth and the odd one out: it changes nothing. "How many hours have I logged this
// week?" has an answer the app already holds, and making somebody open a page and read a total
// off it is work the app could have done for them. It is kept apart from `find` because the two
// want different things -- `find` wants a list of tasks, `ask` wants a number with its working.
//
// Deliberately only five. An assistant that claims to understand everything and then shrugs is
// worse than one that says plainly what it can do -- so an unrecognised sentence becomes
// `unknown`, and the panel offers the five things rather than guessing a sixth.

import { STATUS_WORDS } from './edit';

export type Intent = 'create' | 'log_time' | 'complete' | 'update' | 'delete' | 'find' | 'ask' | 'unknown';

interface Rule {
  intent: Intent;
  /** Matched against the whole sentence. First rule to match wins, so order is meaning. */
  pattern: RegExp;
}

const RULES: Rule[] = [
  // Time first: "log 2 hours on the audit" also contains "the audit", which a looser rule for
  // "find" would happily claim.
  { intent: 'log_time', pattern: /\b(log|record|put|add)\s+(?:in\s+)?\d+(?:[.:]\d+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i },
  { intent: 'log_time', pattern: /\b(?:spent|worked)\s+\d+(?:[.:]\d+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i },
  { intent: 'log_time', pattern: /\blog\s+(?:my\s+)?(?:time|hours)\b/i },

  { intent: 'complete', pattern: /\b(?:mark|set|move)\b.*\b(?:as\s+)?(?:done|complete|completed|finished|closed)\b/i },
  // Anchored to the front, like the edits below. Looked for anywhere, "close" made "create Close
  // books" and "set priority of Close books" into a request to mark something done -- and this
  // firm closes books every month, so the word is in half its task names.
  { intent: 'complete', pattern: /^(?:please\s+)?(?:can you\s+)?(?:close|finish|complete)\s+(?:the\s+|my\s+)?\b/i },
  { intent: 'complete', pattern: /\bi(?:'ve|\s+have)?\s+(?:finished|done|completed)\b/i },

  // Changing and deleting a task that already exists.
  //
  // Anchored to the front of the sentence, which matters more than it looks: "add a task to update
  // the client list" contains the word "update", and a rule that looked anywhere would read a new
  // task as an edit to an imaginary one. An instruction leads with its verb, so that is where this
  // looks -- and "add" is still the first word, so `create` still wins it.
  //
  // Clearing a field comes before deleting, because "remove the due date of the audit" and "remove
  // the audit" open identically and only one of them should empty a task off the board.
  { intent: 'update', pattern: /^(?:please\s+)?(?:can you\s+)?(?:clear|remove|delete|unset)\s+(?:the\s+|its\s+)?(?:due\s*date|start\s*date|end\s*date|deadline|priority|assignee|owner|estimate)\b/i },
  { intent: 'update', pattern: /^(?:please\s+)?(?:can you\s+)?(?:change|update|edit|modify|rename|re-?assign|reschedule|postpone|push|move|shift)\b/i },
  { intent: 'update', pattern: /^(?:please\s+)?(?:can you\s+)?set\b.*\b(?:priority|due|deadline|start|date|assignee|owner|estimate|name|title|status)\b/i },
  // A status other than done: "set the audit to in progress", "mark payroll as on hold".
  { intent: 'update', pattern: new RegExp(`^(?:please\\s+)?(?:can you\\s+)?(?:set(?!\\s+up\\b)|mark|put|move)\\b.*\\s(?:to\\s+|as\\s+|in\\s+)?(?:${STATUS_WORDS})\\s*$`, 'i') },
  { intent: 'delete', pattern: /^(?:please\s+)?(?:can you\s+)?(?:delete|remove|bin|discard|drop|get rid of)\b/i },

  // Questions about their own figures, ahead of `find` -- which would otherwise take every
  // sentence beginning "what" and answer it with a list of tasks.
  //
  // These sit after `complete` on purpose: "mark the GST filing done?" is a request with a
  // question mark on the end, not a question, and "mark" is the better evidence of the two.
  { intent: 'ask', pattern: /\b(?:how many|how much|how long)\b/i },
  { intent: 'ask', pattern: /\b(?:who(?:'s| is)? my|who do i report to|which teams?)\b/i },
  { intent: 'ask', pattern: /\b(?:do i have|have i got|what(?:'s| is| are)? (?:my|left|on my))\b/i },
  { intent: 'ask', pattern: /\b(?:balance|leave|time off|timesheet|capacity)\b[^?]*\?\s*$/i },
  // Anything else ending in a question mark that does not ask for something to be done.
  { intent: 'ask', pattern: /^(?!.*\b(?:add|create|make|new|assign|log|record|mark|close|finish|move|set)\b).*\?\s*$/i },

  // "Show", "find", "list" and "search" are commands, so they lead the sentence. Looked for
  // anywhere, the word "list" alone turned "add a task to update the client list" into a search --
  // a real task name, and this firm's work is full of lists, boards and reviews.
  { intent: 'find', pattern: /^(?:please\s+)?(?:can you\s+)?(?:show|find|list|search|give me|pull up)\b/i },
  { intent: 'find', pattern: /\b(?:what|which)\b/i },
  { intent: 'find', pattern: /\b(?:anything|what's)\s+(?:due|overdue|pending|left)\b/i },

  { intent: 'create', pattern: /\b(?:add|create|make|new|remind me to|i need to|set up)\b/i },
  // A bare instruction with a date in it is almost always a new task: "call the auditor tomorrow".
  { intent: 'create', pattern: /\b(?:today|tomorrow|tmrw|next week|next month|monday|tuesday|wednesday|thursday|friday|eod|eow|eom)\b/i },
  { intent: 'create', pattern: /\bassign(?:ed)?\s+to\b/i },
];

export interface Read {
  intent: Intent;
  /** The sentence with the words that only announced the intent taken off the front. */
  rest: string;
}

/** Words whose only job was to say which of the four this is. */
const STRIP: Partial<Record<Intent, RegExp>> = {
  complete: /^\s*(?:please\s+)?(?:can you\s+)?(?:mark|set|move|close|finish|complete)\s+(?:the\s+|my\s+)?/i,
  find: /^\s*(?:please\s+)?(?:can you\s+)?(?:show|find|list|search for|search)\s+(?:me\s+)?(?:all\s+)?(?:my\s+)?/i,
};

export function readIntent(input: string): Read {
  const text = input.trim();
  if (!text) return { intent: 'unknown', rest: '' };
  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue;
    const strip = STRIP[rule.intent];
    return { intent: rule.intent, rest: strip ? text.replace(strip, '').trim() : text };
  }
  // A short phrase with no verb at all is a name, and a name is a new task.
  return { intent: text.split(/\s+/).length <= 8 ? 'create' : 'unknown', rest: text };
}

/** What each one is called when it is shown to a person. */
export const INTENT_LABEL: Record<Intent, string> = {
  create: 'New task',
  log_time: 'Log time',
  complete: 'Mark done',
  update: 'Change a task',
  delete: 'Delete a task',
  find: 'Find',
  ask: 'Answer',
  unknown: 'Not understood',
};
