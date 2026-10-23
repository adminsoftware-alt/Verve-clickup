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
import {
  AtSign, Bell, Cake, CalendarDays, CalendarX2, ChevronDown, Clock, Flag, Flame, Hourglass, Link2, Palmtree,
  PartyPopper, PlayCircle, Repeat, Sparkles, Target, Timer, TimerOff, UserX, Users, X,
} from 'lucide-react';

import { Avatar, formatDuration } from '../ui';
import { useWork } from '../WorkContext';
import type { InsightSection, InsightTask, Insights } from './api';
import type { UserRef } from '../api';

type Tone = 'danger' | 'warning' | 'info' | 'good';
type Group = 'day' | 'team' | 'firm';

const TONE: Record<Tone, { dot: string; icon: string; chip: string }> = {
  danger: { dot: 'bg-rose-500', icon: 'bg-rose-50 text-rose-600', chip: 'bg-rose-50 text-rose-700' },
  warning: { dot: 'bg-amber-500', icon: 'bg-amber-50 text-amber-600', chip: 'bg-amber-50 text-amber-700' },
  info: { dot: 'bg-sky-500', icon: 'bg-sky-50 text-sky-600', chip: 'bg-sky-50 text-sky-700' },
  good: { dot: 'bg-emerald-500', icon: 'bg-emerald-50 text-emerald-600', chip: 'bg-emerald-50 text-emerald-700' },
};
const GROUPS: { key: Group; title: (x: Insights) => string }[] = [
  // "Your day" on your own board; on anyone else's it is their work, not your day.
  { key: 'day', title: (x) => (x.who === 'me' ? 'Your day' : x.who === 'person' ? `${x.who_name || 'Their'}'s work` : x.who === 'team' ? "The team's work" : 'The work') },
  { key: 'team', title: (x) => (x.who === 'team' ? 'Your Team' : 'People') },
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

function points(x: Insights, extra: { tone: Tone; text: string }[], open?: (id: string) => void): Point[] {
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
      text: <>{you ? 'Your' : <><Who user={r.user} open={open} />'s</>} timer on <B>{r.task_name}</B> has been running since {since}. Stop it and fix the hours.</>,
    });
  });
  if (x.mentions_unread || x.reminders_today.length) {
    if (x.mentions_unread) {
      out.push({ key: 'mentions', group: 'day', tone: 'info', Icon: AtSign,
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
      text: <>{who.they} logged <B>no time yesterday</B>. Fill in {who.their} timesheet while the day is fresh.</> });
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
      text: <>{names(x.no_time_yesterday, total, open)} logged <B>nothing yesterday</B>.</> });
  }
  if (x.timesheets_waiting.length) {
    out.push({ key: 'timesheets-waiting', group: 'team', tone: 'info', Icon: Clock,
      text: <><B>{n(x.timesheets_waiting.length, 'timesheet')}</B> {isAre(x.timesheets_waiting.length)} waiting for approval: {names(x.timesheets_waiting.map((t) => t.user), x.timesheets_waiting.length, open)}.</> });
  }
  if (x.timesheets_missing.length) {
    const total = x.timesheets_missing_count ?? x.timesheets_missing.length;
    out.push({ key: 'timesheets-missing', group: 'team', tone: 'warning', Icon: Clock,
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

const PointRow: React.FC<{ point: Point; onOpenTask: (id: string) => void; onHide: () => void }> = ({ point, onOpenTask, onHide }) => {
  const [open, setOpen] = useState(false);
  const { listName } = useWork();
  const skin = TONE[point.tone];
  const expandable = !!point.tasks?.length;
  const body = (
    <>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${skin.icon}`}><point.Icon size={16} /></span>
      <span className="min-w-0 flex-1 pt-1 text-sm leading-relaxed text-gray-600">{point.text}</span>
      {expandable && <ChevronDown size={16} className={`mt-2 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />}
    </>
  );
  return (
    <li className="group/row relative border-b border-gray-100 last:border-0">
      {expandable ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
          className="tap-row flex w-full items-start gap-3 rounded-lg py-2.5 pl-2 pr-9 text-left transition-colors hover:bg-gray-50">{body}</button>
      ) : <div className="flex items-start gap-3 py-2.5 pl-2 pr-9">{body}</div>}
      <button type="button" onClick={onHide} title="Hide messages like this" aria-label="Hide messages like this"
        className="absolute right-1 top-2.5 rounded-md p-1 text-gray-300 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-600 focus:opacity-100 group-hover/row:opacity-100">
        <X size={14} />
      </button>
      {expandable && open && (
        <ul className="mb-2 ml-11 mr-2 space-y-0.5">
          {point.tasks!.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => onOpenTask(t.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-50">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${skin.dot}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-gray-800">{t.name}</span>
                  <span className="block truncate text-[11px] text-gray-400">{listName(t.list_id)}</span>
                </span>
                {point.note?.(t) && <span className={`tabular max-w-40 shrink-0 truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${skin.chip}`}>{point.note(t)}</span>}
                <span className="hidden shrink-0 -space-x-1 sm:flex">{t.assignees.slice(0, 3).map((u) => <Avatar key={u.id} user={u} size={18} />)}</span>
              </button>
            </li>
          ))}
          {!!point.more && <li className="px-2 pt-0.5 text-[11px] text-gray-400">and {point.more} more</li>}
        </ul>
      )}
    </li>
  );
};

export const InsightsPanel: React.FC<{
  insights: Insights | null; error?: string | null; onOpenTask: (id: string) => void;
  /** Findings from elsewhere on the board -- the Workload band's capacity check -- said first. */
  extra?: { tone: Tone; text: string }[];
  /** Given where the viewer may open other people's boards: names in a sentence then link there. */
  onOpenPerson?: (userId: string) => void;
}> = ({ insights, error, onOpenTask, extra = [], onOpenPerson }) => {
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const hide = (key: string) => { const next = [...new Set([...hidden, kindOf(key)])]; setHidden(next); writeHidden(next); };
  const showAll = () => { setHidden([]); writeHidden([]); };

  if (error) return <p className="mt-8 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  const all = insights ? points(insights, extra, onOpenPerson) : [];
  const shown = all.filter((p) => !hidden.includes(kindOf(p.key)));
  const hiddenHere = all.length - shown.length;
  return (
    <section aria-label="Highlights" className="ui-card mt-8 break-before-auto p-3 sm:p-4">
      <h3 className="mb-1 flex items-center gap-2 px-2 text-base font-semibold text-gray-900">
        <span className="tile-3d h-7 w-7 rounded-lg" style={{ '--tile': '#F59E0B' } as React.CSSProperties}><Sparkles size={15} /></span> Highlights
      </h3>
      {!insights ? (
        <div className="space-y-2 p-2" aria-busy="true" aria-label="Loading highlights">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-6" />)}
        </div>
      ) : (
        <>
          {shown.length === 0 && (
            <p className="px-2 py-3 text-sm text-gray-500">Nothing else needs your attention. The cards above have the numbers.</p>
          )}
          {GROUPS.map((g) => {
            const rows = shown.filter((p) => p.group === g.key);
            if (!rows.length) return null;
            return (
              <div key={g.key} className="mt-2">
                <p className="px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g.title(insights)}</p>
                <ul>{rows.map((p) => <PointRow key={p.key} point={p} onOpenTask={onOpenTask} onHide={() => hide(p.key)} />)}</ul>
              </div>
            );
          })}
          {hiddenHere > 0 && (
            <p className="mt-2 flex items-center gap-2 px-2 text-xs text-gray-400">
              {n(hiddenHere, 'message')} hidden.
              <button type="button" onClick={showAll} className="font-medium text-brand-700 hover:underline">Show them again</button>
            </p>
          )}
        </>
      )}
    </section>
  );
};
