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
import { collabApi } from '../collabApi';
import { dashApi, type DashboardSummary } from '../dashboards/api';
import { peopleApi } from '../teams/peopleApi';
import { hrs, isoDay, parseDay, sheetApi } from '../timesheets/api';
import { places } from './where';
import type { Reading } from './interpret';
import { holdingAll, pickMatch, significant } from './match';

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

const shortDay = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type AskReading = Extract<Reading, { kind: 'ask' }>;
type FindReading = Extract<Reading, { kind: 'find' }>;

const nameOf = (u: { display_name: string | null; email: string }) => u.display_name || u.email;
const plainDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

/**
 * Search for a task by what somebody called it.
 *
 * The server matches the whole phrase inside a name, so "GST return Sharma" finds nothing when the
 * task is "Sharma - GST return". When the phrase finds nothing, the rarest-looking word is searched
 * instead and only the tasks holding every word are kept.
 */
export async function searchFor(workspaceId: string, which: string, limit = 8): Promise<Task[]> {
  if (!which.trim()) return [];
  const found = await workApi.searchTasks(workspaceId, which, limit);
  if (found.length) return found;
  const words = significant(which).sort((a, b) => b.length - a.length);
  if (words.length < 2) return [];
  return holdingAll(which, await workApi.searchTasks(workspaceId, words[0], 25)).slice(0, limit);
}

/**
 * Answer a question about the signed-in person's own work.
 *
 * @param me the signed-in person's id, used only to pick their own tasks out of the list.
 */
export async function answer(
  ask: AskReading, workspaceId: string, me: string, hierarchy?: Hierarchy | null,
): Promise<Answer> {
  const { topic, about } = ask;
  const question = ask.question;
  const now = new Date();

  if (topic === 'who') {
    const found = await searchFor(workspaceId, ask.which, 8);
    if (!found.length) {
      return { headline: ask.which ? `No task called “${ask.which}” turned up.` : 'Which task do you mean?', detail: 'Try a few words of its name.' };
    }
    const { task } = pickMatch(ask.which, found);
    const who = (t: Task) => (t.assignees.length ? t.assignees.map(nameOf).join(', ') : 'nobody');
    if (task) {
      return {
        headline: task.assignees.length ? `${who(task)} ${task.assignees.length === 1 ? 'is' : 'are'} on “${task.name}”.` : `Nobody is assigned to “${task.name}”.`,
        detail: `${task.status.name}${task.due_date ? ` · due ${shortDay(new Date(task.due_date))}` : ''}`,
        tasks: [task],
      };
    }
    // Several with that name: say who is on each, rather than picking one to answer about.
    return {
      headline: `${found.length} tasks match “${ask.which}”.`,
      detail: found.slice(0, 6).map((t) => `${t.name}: ${who(t)}`).join(' · '),
      tasks: found.slice(0, 6),
    };
  }

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
    // No user id unless somebody else was named: the endpoint then answers for whoever is asking.
    // Named, it is asked for theirs, in the asker's name, and a refusal is passed on as one --
    // "how many hours did Aarti log" used to be answered with the asker's own hours.
    const whose = about ? { userId: about.id } : {};
    const subject = about ? nameOf({ display_name: about.display_name ?? null, email: about.email }) : null;
    const sheetFor = async (start: string) => {
      try {
        return await sheetApi.get(workspaceId, start, whose);
      } catch (e) {
        if (subject) throw new Error(`You cannot see ${subject}'s timesheet. Only an admin, their approver, or they can.`);
        throw e;
      }
    };
    const logged_ = (what: string) => (subject ? `${subject} logged ${what}` : `${what} logged`);

    // Time on one task -- "how much time did I spend on the GST return" -- comes from that task.
    if (ask.which) {
      const found = await searchFor(workspaceId, ask.which, 8);
      const { task, options } = pickMatch(ask.which, found);
      if (!task) {
        return options.length
          ? { headline: `${options.length} tasks match “${ask.which}” — which one?`, detail: 'Ask again with more of its name.', tasks: options }
          : { headline: `No task called “${ask.which}” turned up.`, detail: 'Try a few words of its name.' };
      }
      const time = await workApi.taskTime(task.id);
      const forWhom = about?.id ?? me;
      const theirs = time.entries.filter((e) => e.user.id === forWhom).reduce((sum, e) => sum + (e.duration_seconds ?? 0), 0);
      const who = subject ?? 'You';
      return {
        headline: theirs ? `${who} ${subject ? 'has' : 'have'} logged ${hrs(theirs)} on “${task.name}”.` : `${who} ${subject ? 'has' : 'have'} not logged any time on “${task.name}”.`,
        detail: time.shows_everyone && time.total_seconds !== theirs ? `${hrs(time.total_seconds)} by everyone.` : undefined,
        tasks: [task],
      };
    }
    // A particular day -- "yesterday", "on Monday" -- is read off the week that day falls in, which
    // may be last week's sheet.
    if (ask.day && ask.day !== isoDay(now)) {
      const daySheet = await sheetFor(ask.day);
      const at = daySheet.days.indexOf(ask.day);
      const seconds = at >= 0 ? daySheet.tracked_per_day[at] : 0;
      const when = plainDay(ask.day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
      const capacity = at >= 0 ? daySheet.capacity_per_day[at] : 0;
      const rows = at >= 0 ? daySheet.rows.filter((r) => r.seconds_per_day[at] > 0).length : 0;
      return {
        headline: seconds ? `${logged_(hrs(seconds))} on ${when}.` : `Nothing logged on ${when}${subject ? ` by ${subject}` : ''}.`,
        detail: [
          seconds ? `Across ${plural(rows, 'task')}.` : null,
          capacity ? `${subject ? 'Their' : 'Your'} day is ${hrs(capacity)}.` : null,
          `${hrs(daySheet.total_seconds)} that week.`,
        ].filter(Boolean).join(' '),
        goTo: { label: subject ? 'Open timesheets' : 'Open my timesheet', to: '/timesheets' },
      };
    }
    const sheet = await sheetFor(isoDay(now));
    const able = sheet.capacity_per_day.reduce((a, b) => a + b, 0);
    const logged = sheet.total_seconds;
    const todayAt = sheet.days.indexOf(isoDay(now));
    const todaySeconds = todayAt >= 0 ? sheet.tracked_per_day[todayAt] : null;

    if ((/\btoday\b/i.test(question) || ask.day === isoDay(now)) && todaySeconds !== null) {
      return {
        headline: todaySeconds ? `${logged_(hrs(todaySeconds))} today.` : `Nothing logged today yet${subject ? ` by ${subject}` : ''}.`,
        detail: `${hrs(logged)} so far this week, across ${plural(sheet.rows.length, 'task')}.`,
        goTo: { label: subject ? 'Open timesheets' : 'Open my timesheet', to: '/timesheets' },
      };
    }
    const left = Math.max(0, able - logged);
    return {
      headline: `${logged_(hrs(logged))} this week${able ? ` of ${hrs(able)}` : ''}.`,
      detail: [
        // period_start is the server's own week, so the label cannot disagree with the figure.
        `Week of ${shortDay(parseDay(sheet.period_start))}, across ${plural(sheet.rows.length, 'task')}.`,
        able ? (left > 0 ? `${hrs(left)} still to account for.` : `${subject ? 'The' : 'Your'} week is fully accounted for.`) : null,
        sheet.submission ? `Timesheet ${sheet.submission.status === 'pending' ? 'submitted, awaiting approval' : sheet.submission.status.replace('_', ' ')}.` : null,
      ].filter(Boolean).join(' '),
      goTo: { label: subject ? 'Open timesheets' : 'Open my timesheet', to: '/timesheets' },
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

  if (topic === 'tomorrow') {
    const due = open.filter((t) => t.due_date && sameDay(new Date(t.due_date), tomorrowOf(now)));
    return {
      headline: due.length ? `${plural(due.length, 'task')} due tomorrow.` : `${nothingOfTheirs} is due tomorrow.`,
      detail: overdue.length ? `${overdue.length} ${overdue.length === 1 ? 'is' : 'are'} already overdue.` : `${open.length} open in total.`,
      tasks: byDue(due).slice(0, 10),
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

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const tomorrowOf = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() + 1); return x; };

/**
 * The list a "show me..." asks for: someone's tasks, tasks matching some words, or tasks due at
 * some point -- your own unless a colleague was named.
 *
 * Somebody else's come from their own endpoint, in the asker's name, so the server decides whether
 * they may see them; a refusal is passed on as one rather than turning into a list of the asker's.
 */
export async function listTasks(find: FindReading, workspaceId: string, me: string | null): Promise<{ label: string; tasks: Task[] }> {
  const now = new Date();
  if (find.search) return { label: find.label, tasks: await searchFor(workspaceId, find.search, 12) };
  let pool: Task[];
  if (find.person) {
    try {
      pool = await peopleApi.tasks(workspaceId, find.person.id, false);
    } catch {
      throw new Error(`You cannot see ${nameOf({ display_name: find.person.display_name ?? null, email: find.person.email })}'s work. Only an admin, or the person themselves, can.`);
    }
  } else {
    const all = await workApi.allTasks(workspaceId);
    pool = all.tasks.filter((t) => t.assignees.some((a) => a.id === me));
  }
  const open = pool.filter(isOpen);
  const endOf = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  const inAWeek = new Date(now); inAWeek.setDate(inAWeek.getDate() + 7);
  const byDue = (list: Task[]) => [...list].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  // "Due today" and "this week" are what falls in that window. Overdue work is its own question;
  // listing September's late tasks under "due today" answered the wrong one.
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const between = (t: Task, until: Date) => !!t.due_date && new Date(t.due_date) >= startOfToday && new Date(t.due_date) <= until;
  const tasks = find.due === 'overdue' ? open.filter((t) => t.is_overdue)
    : find.due === 'today' ? open.filter((t) => between(t, endOf(now)))
      : find.due === 'tomorrow' ? open.filter((t) => t.due_date && sameDay(new Date(t.due_date), tomorrowOf(now)))
        : find.due === 'week' ? open.filter((t) => between(t, endOf(inAWeek)))
          : open;
  return { label: find.label, tasks: byDue(tasks).slice(0, 12) };
}
