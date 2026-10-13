// The bottom of a Dashboard: what to know and what to do, in plain sentences.
//
// The cards above answer "how much". This reads the same numbers back as a person would say
// them -- "you logged 6h yesterday", "3 tasks are due today, 2 of them urgent, so plan your day
// around them" -- most pressing first. A sentence with tasks behind it opens to show them.
//
// It is worked out on the server from the same tasks as the cards, under the same filters, so a
// highlight never mentions work the cards do not count.
import React, { useState } from 'react';
import {
  AlarmClock, AlertTriangle, CalendarClock, CalendarX2, CheckCircle2, ChevronDown, Clock, Flame, Hourglass, Sparkles, Trophy, Users,
} from 'lucide-react';

import { Avatar, formatDuration } from '../ui';
import { useWork } from '../WorkContext';
import type { InsightSection, InsightTask, Insights } from './api';

type Tone = 'danger' | 'warning' | 'info' | 'good';

const TONE: Record<Tone, { dot: string; icon: string; chip: string }> = {
  danger: { dot: 'bg-rose-500', icon: 'bg-rose-50 text-rose-600', chip: 'bg-rose-50 text-rose-700' },
  warning: { dot: 'bg-amber-500', icon: 'bg-amber-50 text-amber-600', chip: 'bg-amber-50 text-amber-700' },
  info: { dot: 'bg-sky-500', icon: 'bg-sky-50 text-sky-600', chip: 'bg-sky-50 text-sky-700' },
  good: { dot: 'bg-emerald-500', icon: 'bg-emerald-50 text-emerald-600', chip: 'bg-emerald-50 text-emerald-700' },
};

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const hrs = (seconds: number) => formatDuration(seconds) || '0h';

interface Point {
  key: string;
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

function points(x: Insights, extra: { tone: Tone; text: string }[]): Point[] {
  const who = subject(x);
  const out: Point[] = [];
  const section = (s: InsightSection) => ({ tasks: s.tasks, more: Math.max(0, s.count - s.tasks.length) });

  extra.forEach((e, i) => out.push({ key: `extra-${i}`, tone: e.tone, Icon: AlertTriangle, text: e.text }));

  // Today first: what is due, and how much of it is urgent.
  if (x.due_today.count) {
    out.push({
      key: 'today', tone: x.urgent_today ? 'danger' : 'warning', Icon: AlarmClock, ...section(x.due_today),
      text: <>{who.they} {who.have} <B>{n(x.due_today.count, 'task')} due today</B>{x.urgent_today ? <>, <B>{x.urgent_today} of them urgent</B></> : null}. Plan the day around {x.due_today.count === 1 ? 'it' : 'them'}.</>,
    });
  } else {
    out.push({ key: 'today', tone: 'good', Icon: CheckCircle2, text: <>Nothing is due today, a good day to clear older work.</> });
  }

  if (x.overdue.count) {
    const oldest = Math.max(0, ...x.overdue.tasks.map((t) => t.days_late ?? 0));
    out.push({
      key: 'overdue', tone: 'danger', Icon: AlertTriangle, ...section(x.overdue),
      note: (t) => (t.days_late ? `${t.days_late}d late` : undefined),
      text: <><B>{n(x.overdue.count, 'task')} {x.overdue.count === 1 ? 'is' : 'are'} overdue</B>{oldest ? <>, the oldest by <B>{n(oldest, 'day')}</B></> : null}. Finish or reschedule {x.overdue.count === 1 ? 'it' : 'them'} first.</>,
    });
  }

  if (x.urgent_soon.count) {
    out.push({
      key: 'urgent', tone: 'warning', Icon: Flame, ...section(x.urgent_soon),
      note: (t) => (t.due_date ? new Date(t.due_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : undefined),
      text: <><B>{n(x.urgent_soon.count, 'urgent task')}</B> {x.urgent_soon.count === 1 ? 'is' : 'are'} due in the next 3 days and not started yet.</>,
    });
  }

  if (x.stuck.count) {
    out.push({
      key: 'stuck', tone: 'warning', Icon: Hourglass, ...section(x.stuck),
      note: (t) => (t.days_idle ? `${t.days_idle}d idle` : undefined),
      text: <><B>{n(x.stuck.count, 'task')}</B> in progress {x.stuck.count === 1 ? 'has' : 'have'} had no update for over a week. Check whether {x.stuck.count === 1 ? "it's" : "they're"} blocked.</>,
    });
  }

  // Time: yesterday against the hours there were, then the week so far.
  if (x.capacity_yesterday) {
    out.push(x.logged_yesterday
      ? { key: 'yesterday', tone: x.logged_yesterday >= x.capacity_yesterday * 0.8 ? 'good' : 'info', Icon: Clock,
          text: <>{who.they} logged <B>{hrs(x.logged_yesterday)}</B> yesterday, of {hrs(x.capacity_yesterday)}.</> }
      : { key: 'yesterday', tone: 'warning', Icon: Clock,
          text: <>{who.they} logged <B>no time yesterday</B>. Fill in {who.their} timesheet while the day is fresh.</> });
  } else if (x.logged_yesterday) {
    out.push({ key: 'yesterday', tone: 'info', Icon: Clock, text: <><B>{hrs(x.logged_yesterday)}</B> logged yesterday.</> });
  }
  if (x.capacity_week) {
    const left = Math.max(0, x.capacity_week - x.logged_this_week);
    out.push({
      key: 'week', tone: 'info', Icon: CalendarClock,
      text: <>This week: <B>{hrs(x.logged_this_week)}</B> logged of {hrs(x.capacity_week)}{left ? <>, <B>{hrs(left)}</B> to go</> : null}{x.due_this_week ? <>, with <B>{n(x.due_this_week, 'task')}</B> due by Sunday</> : null}.</>,
    });
  } else if (x.due_this_week) {
    out.push({ key: 'week', tone: 'info', Icon: CalendarClock, text: <><B>{n(x.due_this_week, 'task')}</B> {x.due_this_week === 1 ? 'is' : 'are'} due by Sunday.</> });
  }

  const missing = [
    x.no_due_date ? `${x.no_due_date} without a due date` : '',
    x.no_estimate ? `${x.no_estimate} without an estimate` : '',
    x.unassigned ? `${x.unassigned} with nobody on ${x.unassigned === 1 ? 'it' : 'them'}` : '',
  ].filter(Boolean);
  if (missing.length) {
    out.push({ key: 'missing', tone: 'info', Icon: CalendarX2, text: <>Open tasks can't be planned yet: <B>{missing.join(', ')}</B>.</> });
  }

  if (x.people_behind.length) {
    const top = x.people_behind[0];
    out.push({
      key: 'behind', tone: 'warning', Icon: Users,
      text: <><B>{top.user.display_name || top.user.email}</B> has the most overdue work ({n(top.overdue, 'task')}){x.people_behind.length > 1 ? <>, then {x.people_behind.slice(1, 3).map((p) => `${p.user.display_name || p.user.email} (${p.overdue})`).join(' and ')}</> : null}.</>,
    });
  }

  if (x.done_yesterday || x.done_this_week) {
    out.push({
      key: 'wins', tone: 'good', Icon: Trophy,
      text: <>{x.done_yesterday ? <><B>{n(x.done_yesterday, 'task')}</B> finished yesterday{x.done_this_week ? ' and ' : ''}</> : null}{x.done_this_week ? <><B>{x.done_this_week}</B> this week</> : null}. Good progress.</>,
    });
  }
  return out;
}

const PointRow: React.FC<{ point: Point; onOpenTask: (id: string) => void }> = ({ point, onOpenTask }) => {
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
    <li className="border-b border-gray-100 last:border-0">
      {expandable ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
          className="tap-row flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-gray-50">{body}</button>
      ) : <div className="flex items-start gap-3 px-2 py-2.5">{body}</div>}
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
                {point.note?.(t) && <span className={`tabular shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${skin.chip}`}>{point.note(t)}</span>}
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
  /** Kept for callers; names in a sentence are not links. */
  onOpenPerson?: (userId: string) => void;
}> = ({ insights, error, onOpenTask, extra = [] }) => {
  if (error) return <p className="mt-8 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  return (
    <section aria-label="Highlights" className="ui-card mt-8 break-before-auto p-3 sm:p-4">
      <h3 className="mb-1 flex items-center gap-2 px-2 text-base font-semibold text-gray-900">
        <Sparkles size={16} className="text-amber-500" /> Highlights
      </h3>
      {!insights ? (
        <div className="space-y-2 p-2" aria-busy="true" aria-label="Loading highlights">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-6" />)}
        </div>
      ) : (
        <ul>{points(insights, extra).map((p) => <PointRow key={p.key} point={p} onOpenTask={onOpenTask} />)}</ul>
      )}
    </section>
  );
};
