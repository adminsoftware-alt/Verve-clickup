// The bottom of a Dashboard: what needs attention, in sentences, with the tasks behind them.
//
// The cards above answer "how much". This answers "so what": what is late and by how long,
// what is due today, what has stalled, what urgent thing is about to be late, what cannot be
// planned because it has no date or estimate, and -- on a board about several people -- who
// is furthest behind. It is worked out on the server from the same tasks as the cards, under
// the same filters, so a highlight never mentions work the cards do not count.
import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, Flame, Hourglass, Info, Lightbulb, Users } from 'lucide-react';

import { Avatar } from '../ui';
import type { InsightSection, InsightTask, Insights } from './api';

type Tone = 'danger' | 'warning' | 'info' | 'good';

const TONE: Record<Tone, { box: string; icon: string }> = {
  danger: { box: 'border-red-200 bg-red-50/70 text-red-900', icon: 'text-red-600' },
  warning: { box: 'border-amber-200 bg-amber-50/70 text-amber-900', icon: 'text-amber-600' },
  info: { box: 'border-blue-200 bg-blue-50/60 text-blue-900', icon: 'text-blue-600' },
  good: { box: 'border-emerald-200 bg-emerald-50/70 text-emerald-900', icon: 'text-emerald-600' },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The headline alerts, most pressing first. */
function alerts(x: Insights): { tone: Tone; icon: React.ReactNode; text: string }[] {
  const out: { tone: Tone; icon: React.ReactNode; text: string }[] = [];
  if (x.overdue.count) {
    const oldest = Math.max(...x.overdue.tasks.map((t) => t.days_late ?? 0));
    out.push({ tone: 'danger', icon: <AlertTriangle size={16} />,
      text: `${plural(x.overdue.count, 'task')} overdue${oldest ? ` — the oldest is ${plural(oldest, 'day')} late` : ''}.` });
  }
  if (x.urgent_soon.count) {
    out.push({ tone: 'warning', icon: <Flame size={16} />,
      text: `${plural(x.urgent_soon.count, 'urgent or high-priority task')} due in the next 3 days ${x.urgent_soon.count === 1 ? 'has' : 'have'} not been started.` });
  }
  if (x.stuck.count) {
    out.push({ tone: 'warning', icon: <Hourglass size={16} />,
      text: `${plural(x.stuck.count, 'task')} in progress with no update for over a week — possible bottleneck.` });
  }
  if (x.due_today.count) {
    out.push({ tone: 'info', icon: <Clock size={16} />, text: `${plural(x.due_today.count, 'task')} due today.` });
  }
  const missing = [
    x.no_due_date ? `${x.no_due_date} without a due date` : '',
    x.no_estimate ? `${x.no_estimate} without an estimate` : '',
    x.unassigned ? `${x.unassigned} with nobody assigned` : '',
  ].filter(Boolean);
  if (missing.length) {
    out.push({ tone: 'info', icon: <Info size={16} />, text: `Open tasks missing details: ${missing.join(', ')}. They can't be planned until they have them.` });
  }
  if (!x.overdue.count && !x.urgent_soon.count && !x.stuck.count) {
    out.push({ tone: 'good', icon: <CheckCircle2 size={16} />, text: 'Nothing overdue, stalled or at risk. Good shape.' });
  }
  if (x.done_this_week) {
    out.push({ tone: 'good', icon: <CheckCircle2 size={16} />, text: `${plural(x.done_this_week, 'task')} finished this week.` });
  }
  return out;
}

const TaskRow: React.FC<{ task: InsightTask; note?: string; onOpen: (id: string) => void }> = ({ task, note, onOpen }) => (
  <li>
    <button type="button" onClick={() => onOpen(task.id)}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-50">
      <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800">{task.name}</span>
      {note && <span className="shrink-0 text-[11px] font-medium text-gray-500">{note}</span>}
      <span className="flex shrink-0 -space-x-1">{task.assignees.slice(0, 3).map((u) => <Avatar key={u.id} user={u} size={18} />)}</span>
    </button>
  </li>
);

const List: React.FC<{
  title: string; icon: React.ReactNode; section: InsightSection; empty: string;
  note?: (t: InsightTask) => string | undefined; onOpen: (id: string) => void;
}> = ({ title, icon, section, empty, note, onOpen }) => (
  <div className="ui-card break-inside-avoid p-3">
    <h4 className="mb-1 flex items-center gap-2 px-2 text-[13px] font-semibold text-gray-900">
      <span className="text-gray-400">{icon}</span>{title}
      <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">{section.count}</span>
    </h4>
    {section.tasks.length ? (
      <ul>{section.tasks.map((t) => <TaskRow key={t.id} task={t} note={note?.(t)} onOpen={onOpen} />)}</ul>
    ) : <p className="px-2 py-2 text-xs text-gray-400">{empty}</p>}
    {section.count > section.tasks.length && <p className="px-2 pt-1 text-[11px] text-gray-400">and {section.count - section.tasks.length} more</p>}
  </div>
);

export const InsightsPanel: React.FC<{
  insights: Insights | null; error?: string | null; onOpenTask: (id: string) => void;
  /** Findings from elsewhere on the board -- the Workload band's capacity check -- said first. */
  extra?: { tone: Tone; text: string }[];
  /** Open someone's own Dashboard from their name, for viewers who may. */
  onOpenPerson?: (userId: string) => void;
}> = ({ insights, error, onOpenTask, extra = [], onOpenPerson }) => (
  <section aria-label="Highlights" className="mt-8 break-before-auto">
    <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-500"><Lightbulb size={15} /></span> Highlights
    </h3>
    {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : !insights ? (
      <div className="skeleton h-28 rounded-xl" aria-busy="true" aria-label="Loading highlights" />
    ) : (
      <>
        <ul className="mb-4 grid gap-2 lg:grid-cols-2">
          {[...extra.map((x) => ({ ...x, icon: x.tone === 'danger' ? <AlertTriangle size={16} /> : <Info size={16} /> })), ...alerts(insights)].map((a) => (
            <li key={a.text} className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] ${TONE[a.tone].box}`}>
              <span className={`mt-0.5 shrink-0 ${TONE[a.tone].icon}`}>{a.icon}</span>{a.text}
            </li>
          ))}
        </ul>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <List title="Overdue" icon={<AlertTriangle size={15} />} section={insights.overdue} empty="Nothing overdue."
            note={(t) => (t.days_late ? `${t.days_late}d late` : undefined)} onOpen={onOpenTask} />
          <List title="Urgent, due soon" icon={<Flame size={15} />} section={insights.urgent_soon} empty="No urgent work at risk."
            note={(t) => (t.due_date ? new Date(t.due_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : undefined)} onOpen={onOpenTask} />
          <List title="Stalled in progress" icon={<Hourglass size={15} />} section={insights.stuck} empty="Nothing stalled."
            note={(t) => (t.days_idle ? `${t.days_idle}d idle` : undefined)} onOpen={onOpenTask} />
          <List title="Due today" icon={<Clock size={15} />} section={insights.due_today} empty="Nothing due today." onOpen={onOpenTask} />
        </div>
        {insights.people_behind.length > 0 && (
          <div className="ui-card mt-3 p-3">
            <h4 className="mb-2 flex items-center gap-2 px-2 text-[13px] font-semibold text-gray-900">
              <Users size={15} className="text-gray-400" /> Most overdue work
            </h4>
            <ul className="flex flex-wrap gap-2 px-2">
              {insights.people_behind.map((p) => {
                const body = (
                  <>
                    <Avatar user={p.user} size={22} />
                    {p.user.display_name || p.user.email}
                    <span className="font-semibold text-red-700">{p.overdue}</span>
                  </>
                );
                const cls = 'flex items-center gap-2 rounded-full border border-red-100 bg-red-50/60 py-1 pl-1 pr-3 text-[13px] text-gray-800';
                return (
                  <li key={p.user.id}>
                    {onOpenPerson ? (
                      <button type="button" onClick={() => onOpenPerson(p.user.id)} title="Open their dashboard"
                        className={`${cls} transition-colors hover:border-red-200 hover:bg-red-50`}>{body}</button>
                    ) : <span className={cls}>{body}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </>
    )}
  </section>
);
