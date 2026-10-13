// The bottom of a Dashboard: what needs attention, and the tasks behind it.
//
// The cards above answer "how much". This answers "so what": a health score for the board, four
// signals -- overdue, urgent and due soon, stalled, due today -- each one tap away from its tasks,
// what cannot be planned for want of a date or estimate, and on a board about several people,
// who is furthest behind. It is worked out on the server from the same tasks as the cards,
// under the same filters, so a highlight never mentions work the cards do not count.
//
// One list is open at a time rather than four side by side: four narrow columns were unreadable
// on a phone and cramped on a laptop, and the tile row already says where the trouble is.
import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarX2, CheckCircle2, ChevronRight, Clock, Flame, Hourglass, Sparkles, Timer, UserX } from 'lucide-react';

import { Avatar } from '../ui';
import { useWork } from '../WorkContext';
import type { InsightSection, InsightTask, Insights } from './api';

type Key = 'overdue' | 'urgent_soon' | 'stuck' | 'due_today';
type Tone = 'danger' | 'warning' | 'info' | 'good';

const SIGNALS: {
  key: Key; title: string; Icon: React.ElementType; tone: Tone; empty: string;
  /** One line of context under the count, from the tasks behind it. */
  context: (s: InsightSection) => string;
  note: (t: InsightTask) => string | undefined;
}[] = [
  {
    key: 'overdue', title: 'Overdue', Icon: AlertTriangle, tone: 'danger', empty: 'Nothing overdue.',
    context: (s) => { const d = Math.max(0, ...s.tasks.map((t) => t.days_late ?? 0)); return d ? `oldest ${d}d late` : 'all on time'; },
    note: (t) => (t.days_late ? `${t.days_late}d late` : undefined),
  },
  {
    key: 'urgent_soon', title: 'Urgent, due soon', Icon: Flame, tone: 'warning', empty: 'No urgent work at risk.',
    context: (s) => (s.count ? 'not started, due in 3 days' : 'none at risk'),
    note: (t) => (t.due_date ? new Date(t.due_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : undefined),
  },
  {
    key: 'stuck', title: 'Stalled', Icon: Hourglass, tone: 'warning', empty: 'Nothing stalled.',
    context: (s) => (s.count ? 'no update for a week' : 'everything moving'),
    note: (t) => (t.days_idle ? `${t.days_idle}d idle` : undefined),
  },
  {
    key: 'due_today', title: 'Due today', Icon: Clock, tone: 'info', empty: 'Nothing due today.',
    context: (s) => (s.count ? 'to finish today' : 'a clear day'),
    note: () => undefined,
  },
];

const SKIN: Record<Tone, { chip: string; active: string; tint: string; text: string; bar: string }> = {
  danger: { chip: 'bg-rose-50 text-rose-600', active: '!border-rose-300 !bg-rose-50/50', tint: 'bg-rose-50/60', text: 'text-rose-600', bar: 'bg-rose-500' },
  warning: { chip: 'bg-amber-50 text-amber-600', active: '!border-amber-300 !bg-amber-50/50', tint: 'bg-amber-50/60', text: 'text-amber-600', bar: 'bg-amber-500' },
  info: { chip: 'bg-sky-50 text-sky-600', active: '!border-sky-300 !bg-sky-50/50', tint: 'bg-sky-50/60', text: 'text-sky-600', bar: 'bg-sky-500' },
  good: { chip: 'bg-emerald-50 text-emerald-600', active: '!border-emerald-300 !bg-emerald-50/50', tint: 'bg-emerald-50/60', text: 'text-emerald-600', bar: 'bg-emerald-500' },
};

/**
 * The share of open work that is on time, and what to call it. Overdue only: a stalled task is
 * often overdue as well, and adding the two counted the same task twice.
 */
function health(x: Insights): { score: number; word: string; tone: Tone } {
  if (!x.open) return { score: 100, word: 'Nothing open', tone: 'good' };
  const score = Math.round((100 * Math.max(0, x.open - x.overdue.count)) / x.open);
  if (score >= 85) return { score, word: 'Good shape', tone: 'good' };
  if (score >= 60) return { score, word: 'Needs attention', tone: 'warning' };
  return { score, word: 'At risk', tone: 'danger' };
}

/** A ring that fills to the score. Drawn in SVG so it prints and scales without blurring. */
const HealthRing: React.FC<{ score: number; tone: Tone }> = ({ score, tone }) => {
  const r = 22, c = 2 * Math.PI * r;
  const stroke = { good: '#10b981', warning: '#f59e0b', danger: '#f43f5e', info: '#0ea5e9' }[tone];
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden className="shrink-0 -rotate-90">
      <circle cx="28" cy="28" r={r} fill="none" stroke="#eef0f3" strokeWidth="6" />
      {/* Nothing to fill at 0%: a round cap on a zero-length arc still draws a dot. */}
      {score > 0 && (
        <circle cx="28" cy="28" r={r} fill="none" stroke={stroke} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(c * score) / 100} ${c}`} style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.2,0.8,0.2,1)' }} />
      )}
    </svg>
  );
};

/** How late, as a chip whose colour deepens with the delay. */
const Late: React.FC<{ text: string; days?: number; tone: Tone }> = ({ text, days, tone }) => {
  const deep = tone === 'danger' && (days ?? 0) >= 14;
  return (
    <span className={`tabular shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
      deep ? 'bg-rose-600 text-white' : `${SKIN[tone].chip}`}`}>{text}</span>
  );
};

const TaskRow: React.FC<{ task: InsightTask; note?: string; tone: Tone; onOpen: (id: string) => void }> = ({ task, note, tone, onOpen }) => {
  const { listName } = useWork();
  return (
    <li>
      <button type="button" onClick={() => onOpen(task.id)}
        className="tap-row group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-gray-50">
        <span className={`h-2 w-2 shrink-0 rounded-full ${SKIN[tone].bar}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-gray-900">{task.name}</span>
          <span className="block truncate text-[11px] text-gray-400">{listName(task.list_id)}</span>
        </span>
        {note && <Late text={note} days={task.days_late ?? task.days_idle} tone={tone} />}
        <span className="hidden shrink-0 -space-x-1.5 sm:flex">{task.assignees.slice(0, 3).map((u) => <Avatar key={u.id} user={u} size={22} />)}</span>
        <ChevronRight size={15} className="shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-500" />
      </button>
    </li>
  );
};

const Signal: React.FC<{
  signal: (typeof SIGNALS)[number]; section: InsightSection; active: boolean; onPick: () => void;
}> = ({ signal, section, active, onPick }) => {
  const skin = SKIN[section.count ? signal.tone : 'good'];
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onPick}
      className={`ui-card relative flex min-w-0 items-start gap-3 p-3.5 text-left transition-all sm:p-4 ${
        active ? `${skin.active} shadow-(--ui-shadow-sm)` : 'hover:border-gray-300 hover:shadow-(--ui-shadow-sm)'}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${skin.chip}`}><signal.Icon size={17} /></span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-gray-500">{signal.title}</span>
        <span className={`tabular block text-2xl font-semibold leading-tight tracking-tight ${section.count ? skin.text : 'text-gray-900'}`}>{section.count}</span>
        <span className="block truncate text-[11px] text-gray-400">{signal.context(section)}</span>
      </span>
    </button>
  );
};

export const InsightsPanel: React.FC<{
  insights: Insights | null; error?: string | null; onOpenTask: (id: string) => void;
  /** Findings from elsewhere on the board -- the Workload band's capacity check -- said first. */
  extra?: { tone: Tone; text: string }[];
  /** Open someone's own Dashboard from their name, for viewers who may. */
  onOpenPerson?: (userId: string) => void;
}> = ({ insights, error, onOpenTask, extra = [], onOpenPerson }) => {
  // Open on the most pressing signal that has anything in it.
  const first = useMemo<Key>(() => SIGNALS.find((s) => insights?.[s.key].count)?.key ?? 'overdue', [insights]);
  const [picked, setPicked] = useState<Key | null>(null);
  const open = picked ?? first;

  if (error) return <p className="mt-8 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!insights) return <div className="skeleton mt-8 h-40 rounded-2xl" aria-busy="true" aria-label="Loading highlights" />;

  const h = health(insights);
  const signal = SIGNALS.find((s) => s.key === open)!;
  const section = insights[open];
  const missing = [
    { n: insights.no_due_date, label: 'no due date', Icon: CalendarX2 },
    { n: insights.no_estimate, label: 'no estimate', Icon: Timer },
    { n: insights.unassigned, label: 'unassigned', Icon: UserX },
  ].filter((m) => m.n > 0);
  const worst = Math.max(1, ...insights.people_behind.map((p) => p.overdue));

  return (
    <section aria-label="Highlights" className="mt-8 break-before-auto">
      {/* The verdict first: a score, a word, and what is behind it. */}
      <div className="ui-card mb-3 flex flex-wrap items-center gap-x-5 gap-y-3 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="relative">
            <HealthRing score={h.score} tone={h.tone} />
            <span className="tabular absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-gray-900">{h.score}%</span>
          </span>
          <span>
            <span className="flex items-center gap-1.5 text-base font-semibold text-gray-900"><Sparkles size={15} className="text-amber-500" /> Highlights</span>
            <span className={`text-sm font-medium ${SKIN[h.tone].text}`}>{h.word}</span>
            <span className="text-sm text-gray-400"> · {h.score}% of {insights.open} open tasks on time</span>
          </span>
        </div>
        {/* Wins and the Workload's own warning, as small notes beside the verdict. */}
        <ul className="flex min-w-0 flex-1 flex-wrap justify-start gap-2 sm:justify-end">
          {extra.map((x) => (
            <li key={x.text} className={`flex items-start gap-1.5 rounded-xl px-3 py-1.5 text-xs ${SKIN[x.tone].tint} ${SKIN[x.tone].text}`}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /><span className="text-gray-700">{x.text}</span>
            </li>
          ))}
          {insights.done_this_week > 0 && (
            <li className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 size={13} /> {insights.done_this_week} done this week
            </li>
          )}
        </ul>
      </div>

      {/* Four signals; the chosen one opens its tasks underneath. */}
      <div role="tablist" aria-label="What needs attention" className="no-print grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {SIGNALS.map((s) => (
          <Signal key={s.key} signal={s} section={insights[s.key]} active={open === s.key} onPick={() => setPicked(s.key)} />
        ))}
      </div>

      <div role="tabpanel" aria-label={signal.title} className="no-print ui-card mt-2.5 p-1.5 sm:p-2">
        {section.tasks.length ? (
          <ul>{section.tasks.map((t) => <TaskRow key={t.id} task={t} tone={signal.tone} note={signal.note(t)} onOpen={onOpenTask} />)}</ul>
        ) : (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400"><CheckCircle2 size={16} className="text-emerald-500" /> {signal.empty}</p>
        )}
        {section.count > section.tasks.length && (
          <p className="px-3 pb-2 pt-1 text-xs text-gray-400">and {section.count - section.tasks.length} more</p>
        )}
      </div>

      {/* On paper there is no tapping, so every list is printed. */}
      <div className="print-only mt-2 space-y-3">
        {SIGNALS.map((s) => (
          <div key={s.key} className="rounded-lg border border-gray-300 p-2">
            <p className="mb-1 text-sm font-semibold">{s.title} · {insights[s.key].count}</p>
            {insights[s.key].tasks.map((t) => <p key={t.id} className="text-xs">{t.name}{s.note(t) ? ` — ${s.note(t)}` : ''}</p>)}
          </div>
        ))}
      </div>

      {(missing.length > 0 || insights.people_behind.length > 0) && (
        <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
          {missing.length > 0 && (
            <div className="ui-card p-4">
              <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Can’t be planned yet</h4>
              <ul className="flex flex-wrap gap-2">
                {missing.map((m) => (
                  <li key={m.label} className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700 ring-1 ring-inset ring-gray-100">
                    <m.Icon size={15} className="text-gray-400" />
                    <span className="tabular font-semibold text-gray-900">{m.n}</span> {m.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {insights.people_behind.length > 0 && (
            <div className="ui-card p-4">
              <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Most overdue</h4>
              <ul className="space-y-1">
                {insights.people_behind.map((p) => {
                  const body = (
                    <>
                      <Avatar user={p.user} size={24} />
                      <span className="w-28 shrink-0 truncate text-left text-sm text-gray-800 sm:w-36">{p.user.display_name || p.user.email}</span>
                      <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                        <span className="absolute inset-y-0 left-0 rounded-full bg-rose-400" style={{ width: `${(100 * p.overdue) / worst}%` }} />
                      </span>
                      <span className="tabular w-8 shrink-0 text-right text-sm font-semibold text-rose-600">{p.overdue}</span>
                    </>
                  );
                  return (
                    <li key={p.user.id}>
                      {onOpenPerson ? (
                        <button type="button" onClick={() => onOpenPerson(p.user.id)} title="Open their dashboard"
                          className="tap-row flex w-full items-center gap-3 rounded-lg px-1.5 py-1 transition-colors hover:bg-gray-50">{body}</button>
                      ) : <span className="flex items-center gap-3 px-1.5 py-1">{body}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
