// The bottom of a Dashboard: what to know and what to do, in plain sentences.
//
// The cards above answer "how much" -- what is due today, what is overdue, the hours this week,
// what was finished -- so none of that is said again here. Highlights says what no card can:
// your day (what starts today or should have, a task past its estimate, a timer left on, unread
// @mentions, reminders, recurring work, next week), your Team (who is overloaded, who logged
// nothing, timesheets, work held up by a late task) and the firm (birthdays, work anniversaries,
// holidays, goals behind).
//
// Each kind of message can be hidden by whoever is reading -- remembered in this browser -- and
// a name on a Team or Company board opens that person's own board.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlarmClockOff, AlertCircle, AtSign, Bell, Cake, CalendarDays, CheckCircle2, CalendarX2, ChevronDown, Clock, EyeOff, Flag, Flame,
  Hourglass, Link2, ListChecks, MoreHorizontal, Palmtree, PartyPopper, PlayCircle, Repeat, Target, Timer, TimerOff, UserX, Users,
} from 'lucide-react';

import { Avatar, Menu, formatDuration } from '../ui';
import { useWork } from '../WorkContext';
import { useRunningTimer } from '../RunningTimer';
import { collabApi } from '../collabApi';
import { notify } from '../../components/notify';
import type { InsightSection, InsightTask, Insights } from './api';
import type { UserRef } from '../api';

type Tone = 'danger' | 'warning' | 'info' | 'good';
type Group = 'day' | 'team' | 'firm';

const GROUPS: { key: Group; title: (x: Insights) => string }[] = [
  // "Your day" on your own board; on anyone else's it is their work, not your day.
  { key: 'day', title: (x) => (x.who === 'me' ? 'For you' : x.who === 'person' ? `${x.who_name || 'Their'}'s work` : x.who === 'everyone' ? 'Work and people' : 'The work') },
  { key: 'team', title: (x) => (x.who === 'everyone' ? 'People' : 'Your team') },
  { key: 'firm', title: () => 'Around the firm' },
];

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const hrs = (seconds: number) => formatDuration(seconds) || '0h';
const nameOf = (u: UserRef) => u.display_name || u.email;
const HIDDEN_KEY = 'timetriq.highlights.hidden';

interface Point {
  key: string;
  group: Group;
  tone: Tone;
  Icon: React.ElementType;
  /** The sentence, with its figures in bold. */
  text: React.ReactNode;
  /** Tasks behind it, opened by a tap. */
  tasks?: InsightTask[];
  more?: number;
  note?: (t: InsightTask) => string | undefined;
  /** One button that does the obvious next thing, right from the row. */
  action?: Action;
  /** The same, on each task when the row is opened (e.g. Start). */
  taskAction?: { label: string; run: (t: InsightTask) => unknown };
}

interface Action { label: string; run: () => unknown }

/** What the rows can do: given by the panel, which has the timer, the router and the workspace. */
interface Acts {
  stopTimer: () => unknown;
  startTask: (id: string) => unknown;
  openTask: (id: string) => void;
  go: (path: string) => void;
  remind: (people: UserRef[], title: string) => unknown;
}

/** "You", "Harish", "The team" or "Everyone": who the board is about, as a sentence starts. */
function subject(x: Insights): { they: string; their: string; have: string } {
  if (x.who === 'me') return { they: 'You', their: 'your', have: 'have' };
  if (x.who === 'person') return { they: x.who_name || 'They', their: 'their', have: 'has' };
  if (x.who === 'team') return { they: 'The team', their: "the team's", have: 'has' };
  return { they: 'Everyone', their: "everyone's", have: 'has' };
}

const B: React.FC<{ children: React.ReactNode }> = ({ children }) => <b className="font-semibold text-gray-900">{children}</b>;

/** A person's name; on a board about several people it opens their own board, for those who may. */
const Who: React.FC<{ user: UserRef; open?: (id: string) => void }> = ({ user, open }) => (open
  ? <button type="button" onClick={(e) => { e.stopPropagation(); open(user.id); }} className="font-semibold text-brand-700 hover:underline">{nameOf(user)}</button>
  : <B>{nameOf(user)}</B>);

const names = (people: UserRef[], total: number, open?: (id: string) => void) => (
  <>
    {people.slice(0, 3).map((u, i) => (
      <React.Fragment key={u.id}>{i > 0 && (i === people.slice(0, 3).length - 1 && total <= 3 ? ' and ' : ', ')}<Who user={u} open={open} /></React.Fragment>
    ))}
    {total > 3 && <> and {total - 3} more</>}
  </>
);

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

function points(x: Insights, extra: { tone: Tone; text: string }[], open?: (id: string) => void, acts?: Acts): Point[] {
  const who = subject(x);
  const you = x.who === 'me';
  const out: Point[] = [];
  const section = (s: InsightSection) => ({ tasks: s.tasks, more: Math.max(0, s.count - s.tasks.length) });
  const isAre = (c: number) => (c === 1 ? 'is' : 'are');

  // --- your day ---------------------------------------------------------------------------------
  extra.forEach((e, i) => out.push({ key: `workload-${i}`, group: 'day', tone: e.tone, Icon: Flag, text: e.text }));

  if (x.starts_today.count) {
    out.push({
      key: 'starts-today', group: 'day', tone: 'info', Icon: PlayCircle, ...section(x.starts_today),
      ...(you && acts ? {
        action: x.starts_today.count === 1 && x.starts_today.tasks[0] ? { label: 'Start timer', run: () => acts.startTask(x.starts_today.tasks[0].id) } : undefined,
        taskAction: { label: 'Start', run: (t: InsightTask) => acts.startTask(t.id) },
      } : {}),
      text: <><B>{n(x.starts_today.count, 'task')}</B> start{x.starts_today.count === 1 ? 's' : ''} today. Get {x.starts_today.count === 1 ? 'it' : 'them'} moving.</>,
    });
  }
  if (x.late_start.count) {
    out.push({
      key: 'late-start', group: 'day', tone: 'warning', Icon: Hourglass, ...section(x.late_start),
      note: (t) => (t.days_late ? `${t.days_late}d since start` : undefined),
      text: <><B>{n(x.late_start.count, 'task')}</B> should have started and {x.late_start.count === 1 ? "hasn't" : "haven't"} yet.</>,
    });
  }
  if (x.urgent_soon.count) {
    out.push({
      key: 'urgent', group: 'day', tone: 'warning', Icon: Flame, ...section(x.urgent_soon),
      note: (t) => (t.due_date ? new Date(t.due_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : undefined),
      text: <><B>{n(x.urgent_soon.count, 'urgent task')}</B> {isAre(x.urgent_soon.count)} due in the next 3 days and not started yet.</>,
    });
  }
  if (x.over_estimate.count) {
    const top = x.over_estimate.tasks[0];
    out.push({
      key: 'over-estimate', group: 'day', tone: 'warning', Icon: Timer, ...section(x.over_estimate),
      action: x.over_estimate.count === 1 && top && acts ? { label: 'Re-estimate', run: () => acts.openTask(top.id) } : undefined,
      note: (t) => (t.tracked && t.estimate ? `${hrs(t.tracked)} of ${hrs(t.estimate)}` : undefined),
      text: x.over_estimate.count === 1 && top?.tracked && top.estimate
        ? <><B>{top.name}</B> has used <B>{hrs(top.tracked)}</B> of a {hrs(top.estimate)} estimate. Re-estimate it or ask for help.</>
        : <><B>{n(x.over_estimate.count, 'task')}</B> {isAre(x.over_estimate.count)} past {x.over_estimate.count === 1 ? 'its' : 'their'} time estimate.</>,
    });
  }
  x.running_timers.forEach((r, i) => {
    const since = new Date(r.since).toLocaleDateString(undefined, { weekday: 'long' });
    out.push({
      key: i === 0 ? 'timer' : `timer-${i}`, group: 'day', tone: 'danger', Icon: TimerOff,
      action: you && acts ? { label: 'Stop timer', run: acts.stopTimer } : undefined,
      text: <>{you ? 'Your' : <><Who user={r.user} open={open} />'s</>} timer on <B>{r.task_name}</B> has been running since {since}. Stop it and fix the hours.</>,
    });
  });
  if (x.mentions_unread || x.reminders_today.length) {
    if (x.mentions_unread) {
      out.push({ key: 'mentions', group: 'day', tone: 'info', Icon: AtSign,
        action: you && acts ? { label: 'Open Inbox', run: () => acts.go('/inbox') } : undefined,
        text: <>You have <B>{n(x.mentions_unread, 'unread @mention')}</B> in your Inbox.</> });
    }
    if (x.reminders_today.length) {
      out.push({ key: 'reminders', group: 'day', tone: 'info', Icon: Bell,
        text: <>Reminder{x.reminders_today.length === 1 ? '' : 's'} today: <B>{x.reminders_today.map((r) => r.title).join(', ')}</B>.</> });
    }
  }
  if (x.recurring_this_week.count) {
    out.push({
      key: 'recurring', group: 'day', tone: 'info', Icon: Repeat, ...section(x.recurring_this_week),
      note: (t) => (t.due_date ? new Date(t.due_date).toLocaleDateString(undefined, { weekday: 'short' }) : undefined),
      text: <><B>{n(x.recurring_this_week.count, 'recurring task')}</B> come{x.recurring_this_week.count === 1 ? 's' : ''} up this week.</>,
    });
  }
  if (x.stuck.count) {
    out.push({
      key: 'stuck', group: 'day', tone: 'warning', Icon: Hourglass, ...section(x.stuck),
      note: (t) => (t.days_idle ? `${t.days_idle}d idle` : undefined),
      text: <><B>{n(x.stuck.count, 'task')}</B> in progress {x.stuck.count === 1 ? 'has' : 'have'} had no update for over a week. Check whether {x.stuck.count === 1 ? "it's" : "they're"} blocked.</>,
    });
  }
  if (x.blocked_by_late.count) {
    out.push({
      key: 'blocked', group: 'day', tone: 'warning', Icon: Link2, ...section(x.blocked_by_late),
      note: (t) => (t.waiting_on ? `waits on ${t.waiting_on}` : undefined),
      text: <><B>{n(x.blocked_by_late.count, 'task')}</B> {isAre(x.blocked_by_late.count)} waiting on a task that is already late.</>,
    });
  }
  if (x.capacity_yesterday && !x.logged_yesterday && x.who !== 'team') {
    out.push({ key: 'yesterday', group: 'day', tone: 'warning', Icon: Clock,
      action: you && acts ? { label: 'Fill timesheet', run: () => acts.go('/timesheets') } : undefined,
      text: <>{who.they} logged <B>no time yesterday</B>. Fill in {who.their} timesheet while the day is fresh.</> });
  }
  if (x.capacity_yesterday && x.logged_yesterday >= x.capacity_yesterday && x.who !== 'team' && x.who !== 'everyone') {
    out.push({ key: 'full-day', group: 'day', tone: 'good', Icon: CheckCircle2,
      text: <>{who.they} logged a full day yesterday: <B>{hrs(x.logged_yesterday)}</B>. Nice work.</> });
  }
  if (x.next_week?.count) {
    out.push({ key: 'next-week', group: 'day', tone: 'info', Icon: CalendarDays,
      text: <>Next week: <B>{n(x.next_week.count, 'task')}</B> due{x.next_week.estimate ? <>, about <B>{hrs(x.next_week.estimate)}</B> of work</> : null}.</> });
  }
  const missing = [
    x.no_due_date ? `${x.no_due_date} without a due date` : '',
    x.no_estimate ? `${x.no_estimate} without an estimate` : '',
    x.unassigned ? `${x.unassigned} with nobody on ${x.unassigned === 1 ? 'it' : 'them'}` : '',
  ].filter(Boolean);
  if (missing.length) {
    out.push({ key: 'missing', group: 'day', tone: 'info', Icon: CalendarX2, text: <>Open tasks can't be planned yet: <B>{missing.join(', ')}</B>.</> });
  }

  // --- your Team --------------------------------------------------------------------------------
  x.overloaded.forEach((p, i) => out.push({
    key: i === 0 ? 'overloaded' : `overloaded-${i}`, group: 'team', tone: 'danger', Icon: Users,
    text: <><Who user={p.user} open={open} /> has <B>{hrs(p.planned)}</B> planned this week against {hrs(p.capacity)}. Move something off them.</>,
  }));
  if (x.no_time_yesterday.length) {
    const total = x.no_time_yesterday_count ?? x.no_time_yesterday.length;
    out.push({ key: 'no-time', group: 'team', tone: 'warning', Icon: UserX,
      action: acts ? { label: 'Remind', run: () => acts.remind(x.no_time_yesterday, "Please log yesterday's time in your timesheet") } : undefined,
      text: <>{names(x.no_time_yesterday, total, open)} logged <B>nothing yesterday</B>.</> });
  }
  if (x.timesheets_waiting.length) {
    out.push({ key: 'timesheets-waiting', group: 'team', tone: 'info', Icon: Clock,
      action: acts ? { label: 'Review', run: () => acts.go('/timesheets/approvals') } : undefined,
      text: <><B>{n(x.timesheets_waiting.length, 'timesheet')}</B> {isAre(x.timesheets_waiting.length)} waiting for approval: {names(x.timesheets_waiting.map((t) => t.user), x.timesheets_waiting.length, open)}.</> });
  }
  if (x.timesheets_missing.length) {
    const total = x.timesheets_missing_count ?? x.timesheets_missing.length;
    out.push({ key: 'timesheets-missing', group: 'team', tone: 'warning', Icon: Clock,
      action: acts ? { label: 'Remind', run: () => acts.remind(x.timesheets_missing, "Please send last week's timesheet") } : undefined,
      text: <>Last week's timesheet is <B>not sent</B> by {names(x.timesheets_missing, total, open)}.</> });
  }
  if (x.people_behind.length) {
    const top = x.people_behind[0];
    out.push({
      key: 'behind', group: 'team', tone: 'warning', Icon: Users,
      text: <><Who user={top.user} open={open} /> has the most overdue work ({n(top.overdue, 'task')}){x.people_behind.length > 1 ? <>, then {x.people_behind.slice(1, 3).map((p, i) => <React.Fragment key={p.user.id}>{i > 0 && ' and '}<Who user={p.user} open={open} /> ({p.overdue})</React.Fragment>)}</> : null}.</>,
    });
  }

  // --- the firm ---------------------------------------------------------------------------------
  if (x.birthdays.length) {
    out.push({ key: 'birthdays', group: 'firm', tone: 'good', Icon: Cake,
      text: <>It's {names(x.birthdays, x.birthdays.length)}'s birthday today. Wish {x.birthdays.length === 1 ? 'them' : 'them all'} well.</> });
  }
  x.anniversaries.forEach((a, i) => out.push({
    key: i === 0 ? 'anniversaries' : `anniversaries-${i}`, group: 'firm', tone: 'good', Icon: PartyPopper,
    text: <><Who user={a.user} /> joined <B>{n(a.years, 'year')}</B> ago today.</>,
  }));
  if (x.holidays_this_week.length) {
    out.push({ key: 'holidays', group: 'firm', tone: 'info', Icon: Palmtree,
      text: <>Holiday{x.holidays_this_week.length === 1 ? '' : 's'} this week: {x.holidays_this_week.map((h, i) => <React.Fragment key={h.day}>{i > 0 && ', '}<B>{h.name}</B> on {day(h.day)}</React.Fragment>)}. Plan around {x.holidays_this_week.length === 1 ? 'it' : 'them'}.</> });
  }
  x.goals_behind.forEach((g, i) => out.push({
    key: i === 0 ? 'goals' : `goals-${i}`, group: 'firm', tone: 'warning', Icon: Target,
    text: <>Goal <B>{g.name}</B> is <B>{Math.round(g.progress * 100)}%</B> done with {Math.round(g.expected * 100)}% of its time gone.</>,
  }));
  return out;
}

/** The kind a message belongs to, for hiding: every timer message hides with the first, and so on. */
const kindOf = (key: string) => key.replace(/-\d+$/, '');

function readHidden(): string[] {
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]') as string[]; } catch { return []; }
}
function writeHidden(keys: string[]) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(keys)); } catch { /* storage can be unavailable */ }
}

/** Snoozed kinds, each until a day: "kind" -> "2026-10-29". Gone again on that morning. */
const SNOOZE_KEY = 'timetriq.highlights.snoozed';
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const tomorrowIso = () => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function readSnoozed(): Record<string, string> {
  try {
    const all = JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}') as Record<string, string>;
    return Object.fromEntries(Object.entries(all).filter(([, until]) => until > todayIso()));
  } catch { return {}; }
}
function writeSnoozed(map: Record<string, string>) {
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(map)); } catch { /* storage can be unavailable */ }
}

/** Problems first: a timer left on before a holiday next week. */
const RANK: Record<Tone, number> = { danger: 0, warning: 1, info: 2, good: 3 };
/** One accent for the chrome; red and amber only where something needs doing, sky for good news. */
const DOT: Record<Tone, string> = { danger: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-[#234788]', good: 'bg-sky-500' };
const TILE: Record<Tone, string> = {
  danger: 'bg-red-50 text-red-600', warning: 'bg-amber-50 text-amber-600',
  info: 'bg-[#EEF2F8] text-[#234788]', good: 'bg-sky-50 text-sky-600',
};

/** The row's one button: does the thing, says so, and can't be pressed twice while it works. */
const ActionButton: React.FC<{ action: Action; tone: Tone; small?: boolean }> = ({ action, tone, small }) => {
  const [busy, setBusy] = useState(false);
  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try { await action.run(); } catch (err) { notify.error(err); } finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={run} aria-busy={busy}
      className={`shrink-0 rounded-md border font-semibold transition-colors ${small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]'} ${tone === 'danger'
        ? 'border-red-200 bg-white text-red-700 hover:bg-red-50'
        : 'border-[#C9D3E6] bg-white text-[#234788] hover:bg-[#EEF2F8]'} ${busy ? 'opacity-60' : ''}`}>
      {busy ? '…' : action.label}
    </button>
  );
};

/** Always on show: snooze till tomorrow, or hide the kind for good. */
const RowMenu: React.FC<{ onSnooze: () => void; onHide: () => void }> = ({ onSnooze, onHide }) => (
  <Menu
    align="right" width={210} label="More for this highlight"
    items={[
      { label: 'Snooze until tomorrow', icon: <AlarmClockOff size={14} />, onClick: onSnooze },
      { label: 'Hide messages like this', icon: <EyeOff size={14} />, onClick: onHide },
    ]}
    trigger={<span className="flex rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><MoreHorizontal size={15} /></span>}
  />
);

/** The tasks behind a highlight, opened under it. */
const TaskList: React.FC<{ point: Point; onOpenTask: (id: string) => void; indent?: boolean }> = ({ point, onOpenTask, indent = true }) => {
  const { listName } = useWork();
  return (
    <ul className={`mb-2 mr-2 space-y-0.5 ${indent ? 'ml-11' : 'ml-0'}`}>
      {point.tasks!.map((t) => (
        <li key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50">
          <button type="button" onClick={() => onOpenTask(t.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[point.tone]}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-gray-800">{t.name}</span>
              <span className="block truncate text-[11px] text-gray-400">{listName(t.list_id)}</span>
            </span>
            {point.note?.(t) && <span className="tabular max-w-40 shrink-0 truncate rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{point.note(t)}</span>}
            <span className="hidden shrink-0 -space-x-1 sm:flex">{t.assignees.slice(0, 3).map((u) => <Avatar key={u.id} user={u} size={18} />)}</span>
          </button>
          {point.taskAction && <ActionButton small tone={point.tone} action={{ label: point.taskAction.label, run: () => point.taskAction!.run(t) }} />}
        </li>
      ))}
      {!!point.more && <li className="px-2 pt-0.5 text-[11px] text-gray-400">and {point.more} more</li>}
    </ul>
  );
};

type RowProps = { point: Point; onOpenTask: (id: string) => void; onHide: () => void; onSnooze: () => void };

/** One highlight: its icon in the tone's colour, the sentence, its button, how many tasks, the menu. */
const PointRow: React.FC<RowProps> = ({ point, onOpenTask, onHide, onSnooze }) => {
  const [open, setOpen] = useState(false);
  const expandable = !!point.tasks?.length;
  const count = (point.tasks?.length ?? 0) + (point.more ?? 0);
  return (
    <li className="border-b border-gray-100 last:border-0">
      <div className={`flex items-start gap-3 rounded-lg px-2 py-3 transition-colors ${expandable ? 'cursor-pointer hover:bg-[#F7F9FC]' : ''}`}
        onClick={expandable ? () => setOpen(!open) : undefined} role={expandable ? 'button' : undefined} aria-expanded={expandable ? open : undefined}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${TILE[point.tone]}`}><point.Icon size={15} /></span>
        <span className="min-w-0 flex-1 pt-1 text-sm leading-relaxed text-gray-600">{point.text}</span>
        <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
          {point.action && <ActionButton tone={point.tone} action={point.action} />}
          {expandable && (
            <span className="flex items-center gap-0.5 rounded-full bg-gray-100 py-0.5 pl-2 pr-1 text-[11px] font-semibold tabular-nums text-gray-600">
              {count}<ChevronDown size={13} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </span>
          )}
          <span onClick={(e) => e.stopPropagation()}><RowMenu onHide={onHide} onSnooze={onSnooze} /></span>
        </span>
      </div>
      {expandable && open && <TaskList point={point} onOpenTask={onOpenTask} />}
    </li>
  );
};

/** What a tab says when it has nothing in it. */
const EMPTY: Record<Group, string> = {
  day: 'Nothing needs attention right now. The cards above have the numbers.',
  team: 'The team is on track: everyone logged time and no timesheet is waiting.',
  firm: 'No birthdays, work anniversaries or holidays this week.',
};

const EMPTY_MERGED = 'All on track: nothing is late, everyone logged time and no timesheet is waiting.';

export const InsightsPanel: React.FC<{
  insights: Insights | null; error?: string | null; onOpenTask: (id: string) => void;
  /** Findings from elsewhere on the board -- the Workload band's capacity check -- said first. */
  extra?: { tone: Tone; text: string }[];
  /** Given where the viewer may open other people's boards: names in a sentence then link there. */
  onOpenPerson?: (userId: string) => void;
  /** Read the highlights again after a row's button changed something (a timer stopped). */
  onChanged?: () => void;
}> = ({ insights, error, onOpenTask, extra = [], onOpenPerson, onChanged }) => {
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [snoozed, setSnoozed] = useState<Record<string, string>>(readSnoozed);
  const [tab, setTab] = useState<Group | null>(null);
  const navigate = useNavigate();
  const { stop, start } = useRunningTimer();
  const { workspace } = useWork();

  const hide = (key: string) => { const next = [...new Set([...hidden, kindOf(key)])]; setHidden(next); writeHidden(next); };
  const snooze = (key: string) => { const next = { ...snoozed, [kindOf(key)]: tomorrowIso() }; setSnoozed(next); writeSnoozed(next); };
  const showAll = () => { setHidden([]); writeHidden([]); setSnoozed({}); writeSnoozed({}); };

  const acts: Acts = {
    stopTimer: async () => { await stop(); notify.ok('Timer stopped'); onChanged?.(); },
    startTask: async (id) => { await start(id); notify.ok('Timer started'); onChanged?.(); },
    openTask: onOpenTask,
    go: (path) => navigate(path),
    remind: async (people, title) => {
      if (!workspace || !people.length) return;
      const at = new Date(Date.now() + 60_000).toISOString();
      await Promise.all(people.map((u) => collabApi.addReminder(workspace.id, { title, remind_at: at, user_id: u.id })));
      notify.ok(people.length === 1 ? `Reminded ${nameOf(people[0])}` : `Reminded ${people.length} people`);
    },
  };

  if (error) {
    return (
      <section aria-label="Highlights" className="ui-card mt-8 p-4">
        <p className="flex items-center gap-2 text-sm text-gray-500"><AlertCircle size={15} className="text-gray-400" /> Highlights couldn't load just now. They'll be back on the next refresh.</p>
      </section>
    );
  }
  // On a Team or Company board the work and the people behind it are the same people, so they
  // read as one list, worst first, instead of two tabs to flip between.
  const merged = insights?.who === 'team' || insights?.who === 'everyone';
  const all = (insights ? points(insights, extra, onOpenPerson, acts) : [])
    .map((p) => (merged && p.group === 'team' ? { ...p, group: 'day' as Group } : p));
  const shown = all
    .filter((p) => !hidden.includes(kindOf(p.key)) && !snoozed[kindOf(p.key)])
    .sort((a, b) => RANK[a.tone] - RANK[b.tone]);
  const quiet = all.length - shown.length;

  // Each board keeps to its own people: an Employee's own board has only their work; a Manager's
  // own board adds their team; a Team board its team; the Company board everyone and the firm's news.
  const hasTeam = !merged && all.some((p) => p.group === 'team');
  const tabs = GROUPS.filter((g) => (g.key === 'team' ? hasTeam : g.key === 'firm' ? insights?.who === 'everyone' : true));
  const inTab = (g: Group) => shown.filter((p) => p.group === g);
  const needs = (g: Group) => inTab(g).some((p) => p.tone === 'danger' || p.tone === 'warning');
  // Opens on the first tab with something in it; after that, on whichever was picked.
  const current: Group = tab ?? tabs.find((g) => inTab(g.key).length)?.key ?? 'day';
  const rows = inTab(current);

  return (
    <section aria-label="Highlights" className="ui-card mt-8 break-before-auto overflow-hidden">
      <header className="flex flex-wrap items-end gap-x-4 border-b border-gray-100 px-4 pt-3 sm:px-5">
        <h3 className="flex items-center gap-2 pb-3 text-base font-semibold text-gray-900">
          <span className="tile-3d h-7 w-7 rounded-lg" style={{ '--tile': '#234788' } as React.CSSProperties}><ListChecks size={15} /></span> Highlights
        </h3>
        {insights && tabs.length > 1 && (
          <nav role="tablist" aria-label="Highlights for" className="-mb-px flex gap-1 overflow-x-auto sm:ml-auto">
            {tabs.map((g) => {
              const on = g.key === current;
              const count = inTab(g.key).length;
              return (
                <button key={g.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(g.key)}
                  className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-3 pt-1.5 text-[13px] font-semibold transition-colors ${on
                    ? 'border-[#234788] text-[#142B57]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                  {g.title(insights)}
                  {count > 0 && (
                    <span className={`min-w-4.5 rounded-full px-1.5 text-center text-[11px] tabular-nums ${needs(g.key)
                      ? 'bg-red-50 text-red-700' : on ? 'bg-[#EEF2F8] text-[#234788]' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
                  )}
                </button>
              );
            })}
          </nav>
        )}
      </header>
      <div className="px-2 py-1 sm:px-3">
        {!insights ? (
          <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading highlights">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-6" />)}
          </div>
        ) : (
          <>
            {rows.length === 0
              ? <p className="px-2 py-6 text-center text-sm text-gray-500">{merged && current === 'day' ? EMPTY_MERGED : EMPTY[current]}</p>
              : <ul role="tabpanel">{rows.map((p) => <PointRow key={p.key} point={p} onOpenTask={onOpenTask} onHide={() => hide(p.key)} onSnooze={() => snooze(p.key)} />)}</ul>}
            {quiet > 0 && (
              <p className="flex items-center gap-2 border-t border-gray-100 px-2 py-2.5 text-xs text-gray-400">
                {n(quiet, 'message')} snoozed or hidden.
                <button type="button" onClick={showAll} className="font-medium text-[#234788] hover:underline">Show them again</button>
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
};
