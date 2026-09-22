import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Flag, LayoutGrid, List as ListIcon, Plus, SquareCheck } from 'lucide-react';
import { useAuth } from '../components/AuthContext';
import { useWork, useMe } from './WorkContext';
import { isDueTodayOrOverdue, useMyTasks } from './MyTasksContext';
import { workApi, type Task } from './api';
import { recentItems } from './recent';
import { TaskPanel } from './TaskPanel';
import { PriorityFlag, StatusDot, formatDue, fromDateInput, startOfDay } from './ui';
import { TimeTrackedCell } from './views/ListView';
import { planningApi, type HomeCard } from './planningApi';
import {
  DelegatedList, DoneList, LineupCard, ManageCardsDialog, MyWorkCard, TodaysPlanCard, completeLayout, useMyWorkTab,
} from './HomeCards';

const DAY_MS = 86_400_000;
type Mode = 'home' | 'assigned' | 'today';

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Where a task lives, e.g. "Learning / Learning - HR". */
function useLocationLabel() {
  const { locate } = useWork();
  return (listId: string) => (locate('list', listId)?.path ?? []).slice(-2).map((c) => c.name).join(' / ');
}

export const MyTasksPage: React.FC<{ mode: Mode }> = ({ mode }) => {
  const { refresh: refreshTree } = useWork();
  const { tasks, loading, error, refresh } = useMyTasks();
  const [openTask, setOpenTask] = useState<string | null>(null);

  const changed = () => { refresh(); refreshTree(); };
  const title = mode === 'home' ? 'My Tasks' : mode === 'assigned' ? 'Assigned to me' : 'Today & Overdue';

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex items-center gap-2 border-b border-gray-200 px-6 py-3.5">
        <SquareCheck size={18} className="text-gray-500" />
        <h1 className="text-base font-semibold text-gray-900">{title}</h1>
      </header>
      <main className="min-h-0 flex-1 overflow-auto bg-gray-50/60">
        {error && <div className="mx-6 mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {mode === 'home' ? (
          <Home tasks={tasks} onOpenTask={setOpenTask} />
        ) : (
          <GroupedTasks mode={mode} tasks={tasks} loading={loading} onOpenTask={setOpenTask} onCreated={changed} />
        )}
      </main>
      {openTask && <TaskPanel taskId={openTask} onClose={() => setOpenTask(null)} onChanged={changed} onOpen={setOpenTask} />}
    </div>
  );
};

// --- Home: Recents, Agenda, Priorities ----------------------------------------

const Card: React.FC<{ title: React.ReactNode; label?: string; action?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, label, action, className = '', children }) => (
  <section aria-label={label} className={`flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white ${className}`}>
    <header className="flex items-center justify-between px-5 pb-2 pt-4">
      <h2 className="text-[15px] font-semibold text-gray-800">{title}</h2>
      {action}
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">{children}</div>
  </section>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex h-full min-h-32 flex-col items-center justify-center px-4 text-center text-sm text-gray-400">{children}</div>
);

const Home: React.FC<{ tasks: Task[]; onOpenTask: (id: string) => void }> = ({ tasks, onOpenTask }) => {
  const { user } = useAuth();
  const { workspace } = useWork();
  const name = (user?.displayName || user?.email?.split('@')[0] || '').split(' ')[0];
  const [layout, setLayout] = useState<HomeCard[] | null>(null);
  const [managing, setManaging] = useState(false);
  useEffect(() => {
    if (workspace) planningApi.homeLayout(workspace.id).then((r) => setLayout(completeLayout(r.cards))).catch(() => setLayout(completeLayout(null)));
  }, [workspace]);
  const save = async (cards: HomeCard[] | null) => {
    if (!workspace) return;
    const r = await planningApi.saveHomeLayout(workspace.id, cards);
    setLayout(completeLayout(r.cards));
  };
  const render = (card: HomeCard) => {
    const className = card.size === 'full' ? 'h-80 xl:col-span-2' : 'h-80';
    switch (card.key) {
      case 'recents': return <Recents key={card.key} className={className} />;
      case 'agenda': return <Agenda key={card.key} tasks={tasks} onOpenTask={onOpenTask} className={className} />;
      case 'lineup': return <LineupCard key={card.key} onOpenTask={onOpenTask} className={className} />;
      case 'priorities': return <Priorities key={card.key} tasks={tasks} onOpenTask={onOpenTask} className={className} />;
      case 'planner': return <TodaysPlanCard key={card.key} onOpenTask={onOpenTask} className={className} />;
      case 'delegated': return <MyWorkCard key={card.key} kind="delegated" onOpenTask={onOpenTask} className={className} />;
      case 'done': return <MyWorkCard key={card.key} kind="done" onOpenTask={onOpenTask} className={className} />;
    }
  };
  return (
    <div className="px-6 py-6">
      <div className="mb-5 flex items-center gap-3">
        <h2 className="text-2xl font-semibold text-gray-900">{greeting(new Date())}{name ? `, ${name}` : ''}</h2>
        <button type="button" onClick={() => setManaging(true)} disabled={!layout} className="ml-auto flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50">
          <LayoutGrid size={14} /> Manage cards
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {layout?.filter((c) => !c.hidden).map(render)}
      </div>
      {managing && layout && <ManageCardsDialog layout={layout} onClose={() => setManaging(false)} onSave={save} />}
    </div>
  );
};

const Recents: React.FC<{ className?: string }> = ({ className }) => {
  const { locate } = useWork();
  const [items, setItems] = useState(recentItems);
  useEffect(() => {
    const update = () => setItems(recentItems());
    window.addEventListener('timetriq:recent', update);
    return () => window.removeEventListener('timetriq:recent', update);
  }, []);

  // Only show what is still there and still yours to open.
  const rows = items
    .map((item) => {
      const list = locate('list', item.kind === 'list' ? item.id : item.listId ?? '');
      if (!list) return null;
      const parent = item.kind === 'list' ? list.path.slice(-2, -1)[0]?.name : list.node.name;
      return { item, list, parent };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .slice(0, 10);

  return (
    <Card label="Recents" title="Recents" className={className}>
      {rows.length === 0 ? (
        <Empty>Lists and tasks you open will show up here.</Empty>
      ) : (
        rows.map(({ item, list, parent }) => (
          <Link
            key={`${item.kind}:${item.id}`}
            to={item.kind === 'list' ? `/l/${item.id}` : `/l/${list.node.id}?task=${item.id}`}
            className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm text-gray-800 no-underline hover:bg-gray-50"
          >
            {item.kind === 'list' ? <ListIcon size={16} className="shrink-0 text-gray-500" /> : <SquareCheck size={16} className="shrink-0 text-gray-500" />}
            <span className="min-w-0 truncate">{item.kind === 'list' ? list.node.name : item.name}</span>
            {parent && <span className="shrink-0 truncate text-gray-400">• in {parent}</span>}
          </Link>
        ))
      )}
    </Card>
  );
};

const Agenda: React.FC<{ tasks: Task[]; onOpenTask: (id: string) => void; className?: string }> = ({ tasks, onOpenTask, className }) => {
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const label = useLocationLabel();
  const key = isoDay(day);
  const onDay = tasks.filter((t) => [t.start_date, t.due_date].some((d) => d && isoDay(new Date(d)) === key));
  const isToday = key === isoDay(new Date());
  const overdue = isToday ? tasks.filter((t) => t.is_overdue && !onDay.includes(t)) : [];

  return (
    <Card
      label="Agenda"
      title="Agenda"
      className={className}
      action={
        <div className="flex items-center gap-1 text-sm">
          <button type="button" title="Previous day" onClick={() => setDay(new Date(day.getTime() - DAY_MS))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronLeft size={16} /></button>
          <button type="button" title="Next day" onClick={() => setDay(new Date(day.getTime() + DAY_MS))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronRight size={16} /></button>
          <span className="min-w-28 font-medium text-gray-700">{day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          {!isToday && (
            <button type="button" onClick={() => setDay(startOfDay(new Date()))} className="rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50">Today</button>
          )}
        </div>
      }
    >
      {onDay.length === 0 && overdue.length === 0 ? (
        <Empty>Nothing scheduled for this day.</Empty>
      ) : (
        <>
          {onDay.map((t) => (
            <AgendaItem key={t.id} task={t} where={label(t.list_id)} note={t.due_date && isoDay(new Date(t.due_date)) === key ? 'Due' : 'Starts'} onOpen={onOpenTask} />
          ))}
          {overdue.length > 0 && (
            <>
              <div className="px-2 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-red-600">Overdue</div>
              {overdue.map((t) => <AgendaItem key={t.id} task={t} where={label(t.list_id)} note={formatDue(t.due_date)} onOpen={onOpenTask} />)}
            </>
          )}
        </>
      )}
    </Card>
  );
};

const AgendaItem: React.FC<{ task: Task; where: string; note: string; onOpen: (id: string) => void }> = ({ task, where, note, onOpen }) => (
  <button
    type="button"
    onClick={() => onOpen(task.id)}
    className="mb-1 flex w-full items-center gap-2.5 rounded-md border-l-[3px] bg-indigo-50/60 px-2.5 py-1.5 text-left text-sm hover:bg-indigo-50"
    style={{ borderLeftColor: task.status.color }}
  >
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium text-gray-800">{task.name}</span>
      <span className="block truncate text-xs text-gray-500">{where}</span>
    </span>
    <span className={`shrink-0 text-xs ${task.is_overdue ? 'text-red-600' : 'text-gray-500'}`}>{note}</span>
  </button>
);

const Priorities: React.FC<{ tasks: Task[]; onOpenTask: (id: string) => void; className?: string }> = ({ tasks, onOpenTask, className }) => {
  const label = useLocationLabel();
  const top = tasks
    .filter((t) => t.priority === 1 || t.priority === 2)
    .sort((a, b) => (a.priority! - b.priority!) || ((a.due_date ? Date.parse(a.due_date) : Infinity) - (b.due_date ? Date.parse(b.due_date) : Infinity)));
  return (
    <Card label="Priorities" title={<span className="flex items-center gap-1.5">Priorities <span className="text-xs font-normal text-gray-400">Urgent and high-priority tasks assigned to you</span></span>} className={className}>
      {top.length === 0 ? (
        <Empty>
          <Flag size={28} className="mb-2 text-gray-300" />
          No urgent or high-priority tasks. Set a task's priority to see it here.
        </Empty>
      ) : (
        top.map((t) => <TaskRow key={t.id} task={t} where={label(t.list_id)} onOpen={onOpenTask} />)
      )}
    </Card>
  );
};

// --- Assigned to me / Today & Overdue ----------------------------------------------

const GRID = 'grid grid-cols-[minmax(0,1fr)_110px_100px_120px] items-center gap-2';

const TaskRow: React.FC<{ task: Task; where: string; onOpen: (id: string) => void }> = ({ task, where, onOpen }) => (
  <div onClick={() => onOpen(task.id)} className={`${GRID} cursor-pointer rounded-md px-2 py-2 text-sm hover:bg-gray-50`}>
    <div className="flex min-w-0 items-center gap-2">
      <StatusDot status={task.status} />
      <span className="truncate text-gray-800">{task.name}</span>
      <span className="shrink-0 truncate text-xs text-gray-400">{where}</span>
    </div>
    <div className={task.is_overdue ? 'text-red-600' : 'text-gray-600'}>{formatDue(task.due_date)}</div>
    <div><PriorityFlag priority={task.priority} /></div>
    <TimeTrackedCell task={task} />
  </div>
);

interface Group { key: string; title: string; color: string; tasks: Task[] }

function groupByDue(tasks: Task[], mode: Mode): Group[] {
  const today = startOfDay(new Date()).getTime();
  const groups: Group[] = [
    { key: 'overdue', title: 'Overdue', color: '#dc2626', tasks: [] },
    { key: 'today', title: 'Today', color: '#4f46e5', tasks: [] },
    { key: 'next', title: 'Next', color: '#0ea5e9', tasks: [] },
    { key: 'unscheduled', title: 'Unscheduled', color: '#9ca3af', tasks: [] },
  ];
  const [overdue, todayGroup, next, unscheduled] = groups;
  for (const t of tasks) {
    if (!t.due_date) { unscheduled.tasks.push(t); continue; }
    const due = new Date(t.due_date).getTime();
    if (due < today) overdue.tasks.push(t);
    else if (due < today + DAY_MS) todayGroup.tasks.push(t);
    else next.tasks.push(t);
  }
  groups.forEach((g) => g.tasks.sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || a.name.localeCompare(b.name)));
  return mode === 'today' ? [overdue, todayGroup] : groups;
}

const GroupedTasks: React.FC<{
  mode: Mode; tasks: Task[]; loading: boolean; onOpenTask: (id: string) => void; onCreated: () => void;
}> = ({ mode, tasks, loading, onOpenTask, onCreated }) => {
  const label = useLocationLabel();
  const { user } = useAuth();
  const meId = useMe();
  const { ensurePersonalList } = useMyTasks();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'todo' | 'done' | 'delegated'>('todo');
  const visible = mode === 'today' ? tasks.filter((t) => isDueTodayOrOverdue(t)) : tasks;
  const groups = useMemo(() => groupByDue(visible, mode), [visible, mode]);

  // New tasks go to your Personal List, assigned to you and (on Today) due today.
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || busy || !user) return;
    setBusy(true);
    try {
      const listId = await ensurePersonalList();
      if (!listId) return;
      await workApi.createTask(listId, {
        name: draft.trim(),
        assignees: [meId],
        ...(mode === 'today' ? { due_date: fromDateInput(isoDay(new Date())) } : {}),
      });
      setDraft('');
      onCreated();
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-6 py-5">
      {mode === 'assigned' && (
        <div role="tablist" aria-label="My Work" className="mb-4 flex gap-1 border-b border-gray-200">
          {([['todo', 'To do'], ['done', 'Done'], ['delegated', 'Delegated']] as const).map(([key, text]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === key ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{text}</button>
          ))}
        </div>
      )}
      {tab !== 'todo' ? <MyWorkTab kind={tab} onOpenTask={onOpenTask} /> : <>
      <form onSubmit={add} className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
        <Plus size={15} className="text-gray-400" />
        <input
          aria-label="New task"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={mode === 'today' ? 'Add a task due today to your Personal List' : 'Add a task to your Personal List'}
          className="flex-1 bg-transparent text-sm focus:outline-none"
        />
        <button type="submit" disabled={!draft.trim() || busy} className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40">Add</button>
      </form>

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">Loading your tasks…</div>
      ) : visible.length === 0 ? (
        <div className="py-16 text-center text-sm text-gray-400">
          {mode === 'today' ? 'Nothing due today or overdue. Nice work.' : 'No open tasks are assigned to you.'}
        </div>
      ) : (
        groups.map((group) => {
          const isCollapsed = collapsed.has(group.key);
          return (
            <section key={group.key} aria-label={`${group.title} tasks`} className="mb-4 rounded-xl border border-gray-200 bg-white px-3 py-2">
              <button
                type="button"
                onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(group.key)) n.delete(group.key); else n.add(group.key); return n; })}
                className="flex w-full items-center gap-2 px-1 py-1 text-left"
              >
                {isCollapsed ? <ChevronRight size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
                <span className="rounded px-1.5 py-0.5 text-xs font-semibold uppercase text-white" style={{ backgroundColor: group.color }}>{group.title}</span>
                <span className="text-sm text-gray-400">{group.tasks.length}</span>
              </button>
              {!isCollapsed && group.tasks.length > 0 && (
                <>
                  <div className={`${GRID} border-b border-gray-100 px-2 pb-1 pt-2 text-xs font-medium text-gray-400`}>
                    <span className="pl-6">Name</span><span>Due date</span><span>Priority</span><span>Time tracked</span>
                  </div>
                  {group.tasks.map((t) => <TaskRow key={t.id} task={t} where={label(t.list_id)} onOpen={onOpenTask} />)}
                </>
              )}
              {!isCollapsed && group.tasks.length === 0 && <div className="px-8 py-2 text-sm text-gray-400">No tasks</div>}
            </section>
          );
        })
      )}
      </>}
    </div>
  );
};

const MyWorkTab: React.FC<{ kind: 'done' | 'delegated'; onOpenTask: (id: string) => void }> = ({ kind, onOpenTask }) => {
  const { tasks } = useMyWorkTab(kind);
  if (tasks === null) return <div className="py-10 text-center text-sm text-gray-400">Loading…</div>;
  if (tasks.length === 0) {
    return <div className="py-16 text-center text-sm text-gray-400">{kind === 'done' ? 'Nothing finished in the last 30 days yet.' : 'No open tasks you created are assigned only to others.'}</div>;
  }
  return (
    <section aria-label={kind === 'done' ? 'Done tasks' : 'Delegated tasks'} className="rounded-xl border border-gray-200 bg-white px-3 py-2">
      <p className="px-2 pb-1 text-xs text-gray-400">{kind === 'done' ? 'Tasks assigned to you that were finished in the last 30 days.' : 'Open tasks you created and assigned to other people.'}</p>
      {kind === 'done' ? <DoneList tasks={tasks} onOpenTask={onOpenTask} /> : <DelegatedList tasks={tasks} onOpenTask={onOpenTask} />}
    </section>
  );
};
