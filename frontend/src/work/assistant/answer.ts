// Answering a question about your own work, from your own data.
//
// "How many tasks do I have?", "how many hours this week?", "how much leave is left?", "who is
// my manager?" are all questions the app already knows the answer to and makes somebody navigate
// to find. Each one is a page, a filter and a count -- fine once, tiresome daily.
//
// Everything here reads through the same endpoints the person's own screens use, so it can only
// ever show them what they were already allowed to see. There is no privileged path: the
// timesheet and balance calls are made without a user id, which is what makes them return the
// caller's own and nobody else's.
//
// Two rules the answers keep:
//
//   Every number shows its working -- "5 of your 23 open tasks" rather than "5" -- because a
//   count with no denominator cannot be acted on, and a quietly wrong one looks exactly like a
//   right one.
//
//   A question this cannot answer returns null rather than something adjacent. An assistant that
//   answers a question you did not ask is worse than one that says it did not follow.

import { isOpen, workApi, type Hierarchy, type Task } from '../api';
import { matchPerson, type Person } from './parseCommand';
import { collabApi } from '../collabApi';
import { dashApi, type DashboardSummary } from '../dashboards/api';
import { peopleApi } from '../teams/peopleApi';
import { hrs, isoDay, parseDay, sheetApi } from '../timesheets/api';
import { places } from './where';

export interface Answer {
  /** The answer itself, in one line. */
  headline: string;
  /** How it was arrived at, so a wrong number can be spotted rather than believed. */
  detail?: string;
  /** Tasks worth showing underneath it, if the question was about tasks. */
  tasks?: Task[];
  /** Where to go and see it in full. */
  goTo?: { label: string; to: string };
}

/**
 * What a question is about. The first match wins, so the order is the meaning.
 *
 * Leave comes before hours because "how much time off do I have" is a question about leave, and
 * a pattern looking for the word "time" would happily take it.
 */
const TOPICS: { key: string; pattern: RegExp }[] = [
  { key: 'hours', pattern: /\b(hours?|timesheet|logged|tracked|billable|capacity)\b/i },
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
  { key: 'done', pattern: /\b(finished|completed?|done|closed|delivered)\b/i },
  { key: 'doing', pattern: /\b(in progress|underway|ongoing|working on|started)\b/i },
  { key: 'todo', pattern: /\b(to ?dos?|not started|yet to start|untouched)\b/i },
  { key: 'overdue', pattern: /\b(overdue|late|behind|slipped|past due)\b/i },
  { key: 'plan', pattern: /\b(plan|schedule|agenda|calendar|my day)\b/i },
  { key: 'today', pattern: /\b(today|right now|my plate)\b/i },
  { key: 'week', pattern: /\b(this week|next week|week|7 days|coming days)\b/i },
  { key: 'tasks', pattern: /\b(tasks?|work|workload|assigned|how many|how much)\b/i },
];

const shortDay = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Answer a question about the signed-in person's own work.
 *
 * @param me the signed-in person's id, used only to pick their own tasks out of the list.
 * @returns null when this is not a question it can answer, so the caller can say so plainly
 *          rather than inventing something.
 */
/**
 * Somebody else the question is about: "how many tasks are overdue of Aditi Jain".
 *
 * Asked without this, the answer came back about the person asking -- a manager checking on their
 * team was quietly told their own numbers, which is the worst kind of wrong answer because it
 * looks like an answer.
 *
 * Only a name that belongs to somebody here counts, and only when it is not the asker. Whether
 * they are allowed to see that person's work is not decided here: the request for it is made in
 * their own name and the server refuses if they may not, which is the one place that knows.
 */
function askedAbout(question: string, people: Person[], me: string): Person | null {
  const words = question.replace(/[?,.]/g, ' ').split(/\s+/).filter(Boolean);
  for (let size = 2; size >= 1; size -= 1) {
    for (let i = 0; i + size <= words.length; i += 1) {
      const phrase = words.slice(i, i + size).join(' ');
      // "me", "my" and the like resolve to the asker, which is the default anyway.
      if (/^(?:me|my|mine|myself|i)$/i.test(phrase)) continue;
      const hit = matchPerson(phrase, people);
      if (hit && hit !== 'me' && hit.id !== me) return hit;
    }
  }
  return null;
}

export async function answer(
  question: string, workspaceId: string, me: string, hierarchy?: Hierarchy | null,
  people: Person[] = [],
): Promise<Answer | null> {
  const topic = TOPICS.find((t) => t.pattern.test(question))?.key;
  if (!topic) return null;
  const now = new Date();
  const about = askedAbout(question, people, me);

  if (topic === 'inbox') {
    const counts = await collabApi.counts(workspaceId);
    const total = counts.primary + counts.other;
    return {
      headline: total ? `${plural(total, 'unread notification')}.` : 'Nothing unread.',
      detail: total
        ? [counts.primary ? `${counts.primary} need you` : null, counts.other ? `${counts.other} for information` : null,
          counts.later ? `${counts.later} snoozed` : null].filter(Boolean).join(' · ')
        : counts.later ? `${counts.later} snoozed for later.` : undefined,
      goTo: { label: 'Open notifications', to: '/inbox' },
    };
  }

  if (topic === 'spaces') {
    const all = places(hierarchy ?? null);
    const spaces = [...new Set(all.map((l) => l.group))];
    return {
      headline: `${plural(spaces.length, 'Space')}, with ${plural(all.length, 'List')} in them.`,
      detail: spaces.join(' · ') || 'You are not in any Space yet.',
      goTo: { label: 'Open all Spaces', to: '/spaces' },
    };
  }

  if (topic === 'dashboards') {
    const boards = await dashApi.list(workspaceId);
    return {
      headline: boards.length ? `${plural(boards.length, 'dashboard')} you can open.` : 'No dashboards are shared with you.',
      detail: boards.slice(0, 6).map((b: DashboardSummary) => b.name).join(' · ') || undefined,
      goTo: { label: 'Open Dashboards', to: '/dashboards' },
    };
  }

  if (topic === 'hours') {
    // Today's date, not a computed Monday. This workspace's week begins on a Sunday and another
    // one may not, and the endpoint snaps whatever day it is given to the week that day falls
    // in -- so handing it today is the only way "this week" means the week they are in. A
    // Monday worked out here would have reported last week's total every Sunday.
    //
    // No user id either: the endpoint then answers for whoever is asking, which is the point.
    const sheet = await sheetApi.get(workspaceId, isoDay(now));
    const able = sheet.capacity_per_day.reduce((a, b) => a + b, 0);
    const logged = sheet.total_seconds;
    const todayAt = sheet.days.indexOf(isoDay(now));
    const todaySeconds = todayAt >= 0 ? sheet.tracked_per_day[todayAt] : null;

    if (/\btoday\b/i.test(question) && todaySeconds !== null) {
      return {
        headline: todaySeconds ? `${hrs(todaySeconds)} logged today.` : 'Nothing logged today yet.',
        detail: `${hrs(logged)} so far this week, across ${plural(sheet.rows.length, 'task')}.`,
        goTo: { label: 'Open my timesheet', to: '/timesheets' },
      };
    }
    const left = Math.max(0, able - logged);
    return {
      headline: `${hrs(logged)} logged this week${able ? ` of ${hrs(able)}` : ''}.`,
      detail: [
        // period_start is the server's own week, so the label cannot disagree with the figure.
        `Week of ${shortDay(parseDay(sheet.period_start))}, across ${plural(sheet.rows.length, 'task')}.`,
        able ? (left > 0 ? `${hrs(left)} still to account for.` : 'Your week is fully accounted for.') : null,
        sheet.submission ? `Timesheet ${sheet.submission.status === 'pending' ? 'submitted, awaiting approval' : sheet.submission.status.replace('_', ' ')}.` : null,
      ].filter(Boolean).join(' '),
      goTo: { label: 'Open my timesheet', to: '/timesheets' },
    };
  }

  if (topic === 'manager') {
    const person = await peopleApi.get(workspaceId, me);
    if (!person.manager_id) {
      return { headline: 'You have no reporting manager set.', detail: 'An admin sets this on your profile in Teams & People.', goTo: { label: 'Teams & People', to: '/people' } };
    }
    const boss = await peopleApi.get(workspaceId, person.manager_id);
    const name = boss.user.display_name || boss.user.email;
    return {
      headline: `You report to ${name}.`,
      detail: [boss.designation, boss.department].filter(Boolean).join(' · ') || undefined,
      goTo: { label: 'Teams & People', to: '/people' },
    };
  }

  if (topic === 'team') {
    const [person, teams] = await Promise.all([peopleApi.get(workspaceId, me), peopleApi.teams(workspaceId)]);
    const mine = teams.filter((t) => person.team_ids.includes(t.id));
    return {
      headline: mine.length
        ? `You are in ${mine.map((t) => t.name).join(', ')}.`
        : 'You are not in any Team yet.',
      detail: person.direct_reports
        ? `${plural(person.direct_reports, 'person', 'people')} report${person.direct_reports === 1 ? 's' : ''} to you.`
        : 'Nobody reports to you.',
      goTo: { label: 'Teams & People', to: '/people' },
    };
  }

  // Everything left is a question about tasks, and they differ only in which ones.
  // Closed tasks are asked for too -- "what did I finish this week" -- so they have to be fetched.
  //
  // Asked about somebody else, the question goes to that person's own endpoint, in the asker's
  // name. If they may not see it the server says so, and that refusal is passed on rather than
  // quietly turning into an answer about themselves.
  let mine: Task[];
  if (about) {
    try {
      mine = await peopleApi.tasks(workspaceId, about.id, /* includeClosed */ topic === 'done');
    } catch {
      return {
        headline: `You cannot see ${about.display_name || about.email}'s work.`,
        detail: 'Only an admin, or the person themselves, can. Ask an admin if you need it.',
      };
    }
  } else {
    const page = await workApi.allTasks(workspaceId, /* includeClosed */ topic === 'done');
    mine = page.tasks.filter((t) => t.assignees.some((a) => a.id === me));
  }
  // isOpen, not a test for "closed": a task in the done group is finished whether or not anything
  // archived it, and counting those as outstanding made this disagree with the My Tasks page.
  const open = mine.filter(isOpen);
  // "your" / "Nothing of yours" become the person's name when the question was about them.
  const who = about ? (about.display_name || about.email) : null;
  const theirs = who ? `${who}'s` : 'your';
  const nothingOfTheirs = who ? `Nothing of ${who}'s` : 'Nothing of yours';

  const byDue = (list: Task[]) => [...list].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  // is_overdue is the server's own answer, so a task is overdue here exactly when it is overdue
  // on the dashboard -- rather than whenever this browser's clock and timezone say so.
  const overdue = open.filter((t) => t.is_overdue);
  const upTo = (end: Date) => open.filter((t) => t.due_date && new Date(t.due_date) <= end && !t.is_overdue);
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const inAWeek = new Date(now); inAWeek.setDate(inAWeek.getDate() + 7);
  const myTasks = who
    ? { label: `Open ${who}'s work`, to: '/people' }
    : { label: 'Open My Tasks', to: '/my-tasks' };

  if (topic === 'done') {
    // "This week" unless they said otherwise: everything ever finished is a number nobody wants.
    const since = new Date(now);
    if (/\bmonth\b/i.test(question)) since.setMonth(since.getMonth() - 1);
    else if (/\btoday\b/i.test(question)) since.setHours(0, 0, 0, 0);
    else since.setDate(since.getDate() - 7);
    const finished = mine.filter((t) => !isOpen(t) && (t.date_done ?? t.date_closed)
      && new Date((t.date_done ?? t.date_closed) as string) >= since);
    const span = /\bmonth\b/i.test(question) ? 'in the last month' : /\btoday\b/i.test(question) ? 'today' : 'in the last 7 days';
    return {
      headline: finished.length ? `${plural(finished.length, 'task')} finished ${span}.` : `Nothing finished ${span}.`,
      detail: `${open.length} still open.`,
      tasks: finished.slice(0, 10),
      goTo: myTasks,
    };
  }

  if (topic === 'doing' || topic === 'todo') {
    const want = topic === 'doing' ? 'active' : 'not_started';
    const some = open.filter((t) => t.status.group === want);
    const word = topic === 'doing' ? 'in progress' : 'not started yet';
    return {
      headline: some.length ? `${plural(some.length, 'task')} ${word}.` : `Nothing is ${word}.`,
      detail: `Of ${plural(open.length, 'open task')} — ${open.filter((t) => t.status.group === 'active').length} in progress, ${open.filter((t) => t.status.group === 'not_started').length} not started.`,
      tasks: byDue(some).slice(0, 10),
      goTo: myTasks,
    };
  }

  if (topic === 'plan') {
    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
    const today = open.filter((t) => t.due_date && new Date(t.due_date) <= endOfDay);
    const started = open.filter((t) => t.status.group === 'active');
    return {
      headline: today.length
        ? `${plural(today.length, 'thing')} on today${overdue.length ? `, ${overdue.length} of them already overdue` : ''}.`
        : 'Nothing is due today.',
      detail: [
        started.length ? `${started.length} in progress` : null,
        `${open.length} open in all`,
      ].filter(Boolean).join(' · '),
      tasks: byDue(today).slice(0, 10),
      goTo: { label: 'Open my day', to: '/my-tasks/today' },
    };
  }

  if (topic === 'overdue') {
    const worst = byDue(overdue)[0];
    // Three sentences rather than one with holes in it. "1 of your 1 open tasks is overdue" and
    // "all 0 open tasks are on time" are both arithmetically right and both read like a bug.
    const overdueLine = !open.length
      ? `${who ?? 'You'} ${who ? 'has' : 'have'} no open tasks at all, so nothing is overdue.`
      : !overdue.length
        ? `${nothingOfTheirs} is overdue — all ${plural(open.length, 'open task')} ${open.length === 1 ? 'is' : 'are'} on time.`
        : overdue.length === open.length
          ? (open.length === 1 ? `The only open task is ${who ? '' : 'yours, and '}overdue.` : `All ${open.length} of ${theirs} open tasks are overdue.`)
          : `${overdue.length} of ${theirs} ${open.length} open tasks ${overdue.length === 1 ? 'is' : 'are'} overdue.`;
    return {
      headline: overdueLine,
      detail: worst?.due_date
        ? (overdue.length > 1
          ? `Oldest is “${worst.name}”, due ${shortDay(new Date(worst.due_date))}.`
          : `“${worst.name}” was due ${shortDay(new Date(worst.due_date))}.`)
        : undefined,
      tasks: byDue(overdue).slice(0, 10),
      goTo: myTasks,
    };
  }

  if (topic === 'today') {
    const today = upTo(endOfToday);
    return {
      headline: today.length ? `${plural(today.length, 'task')} due today.` : `${nothingOfTheirs} is due today.`,
      detail: [
        `${open.length} open in total`,
        overdue.length ? `${overdue.length} already overdue` : null,
      ].filter(Boolean).join(' · '),
      tasks: byDue([...overdue, ...today]).slice(0, 10),
      goTo: myTasks,
    };
  }

  if (topic === 'week') {
    const week = upTo(inAWeek);
    return {
      headline: week.length ? `${plural(week.length, 'task')} due in the next 7 days.` : `${nothingOfTheirs} falls due in the next 7 days.`,
      detail: overdue.length ? `${overdue.length} more ${overdue.length === 1 ? 'is' : 'are'} already overdue.` : 'None of them is overdue.',
      tasks: byDue(week).slice(0, 10),
      goTo: myTasks,
    };
  }

  // A plain "how many tasks do I have?"
  const undated = open.filter((t) => !t.due_date).length;
  const urgent = open.filter((t) => t.priority === 1).length;
  return {
    headline: open.length ? `${plural(open.length, 'open task')} assigned to ${who ?? 'you'}.` : `Nothing open is assigned to ${who ?? 'you'}.`,
    detail: open.length
      ? [
        overdue.length ? `${overdue.length} overdue` : null,
        upTo(endOfToday).length ? `${upTo(endOfToday).length} due today` : null,
        upTo(inAWeek).length ? `${upTo(inAWeek).length} due this week` : null,
        urgent ? `${urgent} urgent` : null,
        undated ? `${undated} with no date` : null,
      ].filter(Boolean).join(' · ') || 'None of them is overdue or dated.'
      : undefined,
    tasks: byDue(open).slice(0, 10),
    goTo: myTasks,
  };
}
