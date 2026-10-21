// What a question is about, and whom -- read without asking the server anything.
//
// Kept apart from answer.ts, which does the looking up, so the reading can be tested against a few
// hundred questions without a network.

import { matchPerson, NOT_A_NAME, type Person } from './parseCommand';

export type Topic =
  | 'who' | 'hours' | 'manager' | 'team' | 'inbox' | 'spaces' | 'dashboards'
  | 'done' | 'doing' | 'todo' | 'overdue' | 'plan' | 'tomorrow' | 'week' | 'today' | 'tasks';

/**
 * What a question is about. The first match wins, so the order is the meaning.
 *
 * "Who is working on X" comes first: it is a question about a task, and every word after "on" is
 * that task's name -- which can hold anything, "hours" and "report" included.
 */
const TOPICS: { key: Topic; pattern: RegExp }[] = [
  { key: 'who', pattern: /^who(?:'s|\s+is|\s+are)?\s+(?:working|assigned|handling|doing|responsible|on\b)|^who\s+(?:has|owns|got)\b/i },
  { key: 'hours', pattern: /\b(hours?|timesheet|logged|tracked|billable|capacity)\b|\bhow much time\b|\btime\b.*\blog\b|\blog\b.*\btime\b|\bdid i log\b/i },
  { key: 'manager', pattern: /\b(my (manager|boss|reporting manager)|who(?:'s| is) my (manager|boss)|who do i report to)\b/i },
  // "which teams am i in" is the phrasing the intent reader already recognises as a question, so
  // it has to be a phrasing this recognises too -- otherwise the panel accepts the question and
  // then says it did not follow it, which is the worst of the three possible answers.
  { key: 'team', pattern: /\b(my team|teammates?|direct reports?|reports? to me|who (?:is|are) (?:in|on) my|(?:which|what) teams?|teams? am i in)\b/i },
  { key: 'inbox', pattern: /\b(notifications?|unread|inbox|mentions?|alerts?)\b/i },
  { key: 'spaces', pattern: /\b(spaces?|folders?|boards?|sections?|which lists?|what lists?|where can i)\b/i },
  { key: 'dashboards', pattern: /\b(dashboards?|reports?)\b/i },
  // The three states of a task, ahead of the plain task topics: "what have I finished this week"
  // must not be answered with what is still left.
  { key: 'done', pattern: /\b(finished|finish|completed?|done|closed|delivered)\b/i },
  { key: 'doing', pattern: /\b(in progress|underway|ongoing|working on|started)\b/i },
  { key: 'todo', pattern: /\b(to ?dos?|not started|yet to start|untouched)\b/i },
  { key: 'overdue', pattern: /\b(overdue|late|behind|slipped|past due)\b/i },
  { key: 'plan', pattern: /\b(plan|schedule|agenda|calendar|my day)\b/i },
  { key: 'tomorrow', pattern: /\b(tomorrow|tmrw)\b/i },
  // "On my plate this week" is a week; "on my plate" alone is today.
  { key: 'week', pattern: /\b(this week|next week|7 days|coming days|week)\b/i },
  { key: 'today', pattern: /\b(today|right now|my plate)\b/i },
  { key: 'tasks', pattern: /\b(tasks?|work|workload|assigned|how many|how much|pending)\b/i },
];

export function topicOf(question: string): Topic | null {
  return TOPICS.find((t) => t.pattern.test(question))?.key ?? null;
}

/** Words that are never somebody's name, however a name list happens to be spelled. */
const NEVER_A_NAME = /^(?:how|many|much|what|which|who|whom|whose|is|are|am|do|does|did|have|has|had|the|a|an|on|in|of|for|to|by|at|my|me|mine|myself|i|we|our|you|your|task|tasks|work|open|due|today|tomorrow|yesterday|week|this|next|last|overdue|done|finished|hours?|time|log|logged|pending|show|list|find|all|any|anything|with|working|assigned)$/i;

/**
 * Somebody else the question is about: "how many tasks are overdue of Aditi Jain".
 *
 * Asked without this, the answer came back about the person asking -- a manager checking on their
 * team was quietly told their own numbers, which is the worst kind of wrong answer because it
 * looks like an answer.
 *
 * And the opposite mistake is worse still. This used to accept a piece of a name, so "how many
 * open tasks do I have" was answered for Sayam Doshi ("do") -- so now:
 *
 *   A name counts only as a whole word, never inside another word, and never misspelt.
 *   "I", "my" and "me" mean the asker. A name in the same sentence still wins when it is plainly
 *   the subject -- "show me Asmita's tasks", "tasks for Aditya", "does Aditya have" -- and not
 *   otherwise.
 *
 * Whether they are allowed to see that person's work is not decided here: the request is made in
 * the asker's name and the server refuses if they may not, which is the one place that knows.
 */
export function askedAbout(question: string, people: Person[], me?: string): Person | null {
  const words = question.replace(/[?,.!]/g, ' ').split(/\s+/).filter(Boolean);
  const firstPerson = words.some((w) => /^(?:i|me|my|mine|myself|i'm|i've|mera|meri|mere|mujhe|main)$/i.test(w));
  for (let size = 2; size >= 1; size -= 1) {
    for (let i = 0; i + size <= words.length; i += 1) {
      const phrase = words.slice(i, i + size).join(' ');
      const bare = phrase.replace(/[’']s$/, '');
      if (bare.split(' ').some((w) => NEVER_A_NAME.test(w) || NOT_A_NAME.test(w))) continue;
      const hit = matchPerson(phrase, people, { fuzzy: false });
      if (!hit || hit === 'me' || hit.id === me) continue;
      if (!firstPerson) return hit;
      // With "I" or "my" in the sentence too, only a name that is clearly the subject counts.
      const before = words[i - 1]?.toLowerCase() ?? '';
      const possessive = /[’']s$/.test(words[i + size - 1]);
      if (possessive || /^(?:for|of|does|did|has|is|about|to)$/.test(before)) return hit;
    }
  }
  return null;
}
