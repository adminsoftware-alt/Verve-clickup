import React, { useMemo, useState } from 'react';
import type { Task, UserRef } from '../api';
import { Avatar, StatusDot, formatDue, formatDuration } from '../ui';

const WEEK = 7 * 86_400_000;

interface Person {
  key: string;
  user: UserRef | null;
  active: Task[];
  next: Task[];
  done: Task[];
  overdue: number;
  estimate: number;
}

const byDue = (a: Task, b: Task) => (a.due_date ? new Date(a.due_date).getTime() : Infinity) - (b.due_date ? new Date(b.due_date).getTime() : Infinity);

/**
 * ClickUp's Team view: a card per person with what they're working on, what's up next
 * and what they finished this week, so a lead can see the whole team at a glance.
 */
export const TeamView: React.FC<{
  tasks: Task[]; // filtered; closed tasks included
  people: UserRef[];
  listName: (listId: string) => string | null;
  onOpenTask: (id: string) => void;
}> = ({ tasks, people, listName, onOpenTask }) => {
  const [everyone, setEveryone] = useState(false);
  const cards = useMemo(() => {
    const out = new Map<string, Person>();
    const card = (key: string, user: UserRef | null) => {
      if (!out.has(key)) out.set(key, { key, user, active: [], next: [], done: [], overdue: 0, estimate: 0 });
      return out.get(key)!;
    };
    const now = Date.now();
    tasks.forEach((t) => {
      const owners = t.assignees.length ? t.assignees.map((u) => card(u.id, people.find((p) => p.id === u.id) ?? u)) : [card('none', null)];
      const finished = t.status.group === 'done' || t.status.group === 'closed';
      const when = t.date_done || t.date_closed;
      owners.forEach((p) => {
        if (finished) {
          if (when && now - new Date(when).getTime() < WEEK) p.done.push(t);
          return;
        }
        (t.status.group === 'active' ? p.active : p.next).push(t);
        if (t.is_overdue) p.overdue += 1;
        p.estimate += t.time_estimate_seconds ?? 0;
      });
    });
    if (everyone) people.forEach((u) => card(u.id, u));
    return [...out.values()].sort((a, b) => {
      if (a.key === 'none') return 1;
      if (b.key === 'none') return -1;
      const load = (p: Person) => p.active.length + p.next.length;
      return load(b) - load(a) || (a.user?.display_name || a.user?.email || '').localeCompare(b.user?.display_name || b.user?.email || '');
    });
  }, [tasks, people, everyone]);

  const row = (t: Task) => (
    <li key={t.id}>
      <button type="button" onClick={() => onOpenTask(t.id)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-gray-50">
        <StatusDot status={t.status} size={11} />
        <span className={`min-w-0 flex-1 truncate text-sm ${t.status.group === 'closed' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{t.name}</span>
        {t.due_date && <span className={`shrink-0 text-[11px] ${t.is_overdue ? 'font-medium text-red-600' : 'text-gray-400'}`}>{formatDue(t.due_date)}</span>}
      </button>
      <span className="sr-only">{listName(t.list_id)}</span>
    </li>
  );
  const section = (title: string, items: Task[], empty: string) => (
    <section className="mt-2">
      <h4 className="px-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title} <span className="font-normal">{items.length || ''}</span></h4>
      {items.length ? <ul>{items.slice(0, 6).map(row)}</ul> : <p className="px-1.5 py-1 text-xs text-gray-300">{empty}</p>}
      {items.length > 6 && <p className="px-1.5 text-[11px] text-gray-400">+{items.length - 6} more</p>}
    </section>
  );

  return (
    <div className="px-6 py-4">
      <label className="mb-3 flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Show people with no tasks here
      </label>
      {cards.length === 0 ? <p className="py-12 text-center text-sm text-gray-400">No tasks match.</p> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" role="list" aria-label="Team">
          {cards.map((p) => (
            <article key={p.key} role="listitem" aria-label={p.user ? p.user.display_name || p.user.email : 'Unassigned'} className="flex flex-col rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <header className="flex items-center gap-2">
                {p.user ? <Avatar user={p.user} size={30} /> : <span className="h-[30px] w-[30px] rounded-full bg-gray-200" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{p.user ? p.user.display_name || p.user.email : 'Unassigned'}</p>
                  <p className="text-[11px] text-gray-500">
                    {p.active.length + p.next.length} open{p.estimate ? ` · ${formatDuration(p.estimate)} estimated` : ''}
                  </p>
                </div>
                {p.overdue > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{p.overdue} overdue</span>}
              </header>
              {section('Working on', [...p.active].sort(byDue), 'Nothing in progress')}
              {section('Up next', [...p.next].sort(byDue), 'Nothing to start')}
              {section('Done this week', p.done, 'Nothing finished yet')}
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
