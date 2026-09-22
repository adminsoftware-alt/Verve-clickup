import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, CalendarDays, CheckCircle2, GripVertical, ListOrdered, Send, X } from 'lucide-react';
import type { Task } from './api';
import { useWork } from './WorkContext';
import { Modal } from './dashboards/dialogs';
import { TaskPicker } from './task/TaskLinks';
import { PriorityFlag, StatusDot, formatDue, startOfDay } from './ui';
import { planningApi, type HomeCard, type HomeCardKey, type TimeBlock } from './planningApi';

export const CARD_LABELS: Record<HomeCardKey, { title: string; hint: string }> = {
  recents: { title: 'Recents', hint: 'Lists and tasks you opened lately' },
  agenda: { title: 'Agenda', hint: 'What is due on a day' },
  lineup: { title: 'LineUp', hint: 'Your own top tasks, in the order you choose' },
  priorities: { title: 'Priorities', hint: 'Urgent and high-priority tasks assigned to you' },
  planner: { title: "Today's plan", hint: 'Your time blocks for today from the Planner' },
  delegated: { title: 'Delegated', hint: 'Open tasks you gave to other people' },
  done: { title: 'Done', hint: 'Tasks you finished in the last 30 days' },
};

export const DEFAULT_LAYOUT: HomeCard[] = [
  { key: 'recents', hidden: false, size: 'half' },
  { key: 'agenda', hidden: false, size: 'half' },
  { key: 'lineup', hidden: false, size: 'half' },
  { key: 'priorities', hidden: false, size: 'half' },
  { key: 'planner', hidden: true, size: 'half' },
  { key: 'delegated', hidden: true, size: 'half' },
  { key: 'done', hidden: true, size: 'half' },
];

/** A saved layout, with any cards added since it was saved appended (hidden). */
export function completeLayout(saved: HomeCard[] | null): HomeCard[] {
  if (!saved) return DEFAULT_LAYOUT;
  const have = new Set(saved.map((c) => c.key));
  return [...saved, ...DEFAULT_LAYOUT.filter((c) => !have.has(c.key)).map((c) => ({ ...c, hidden: true }))];
}

export const HomeCardShell: React.FC<{ title: React.ReactNode; action?: React.ReactNode; className?: string; label?: string; children: React.ReactNode }> = ({ title, action, className = '', label, children }) => (
  <section aria-label={label} className={`flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white ${className}`}>
    <header className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
      <h2 className="text-[15px] font-semibold text-gray-800">{title}</h2>
      {action}
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">{children}</div>
  </section>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex h-full min-h-32 flex-col items-center justify-center px-4 text-center text-sm text-gray-400">{children}</div>
);

export const SimpleTaskRow: React.FC<{ task: Task; onOpen: (id: string) => void; extra?: React.ReactNode }> = ({ task, onOpen, extra }) => {
  const { listName } = useWork();
  return (
    <div role="button" tabIndex={0} onClick={() => onOpen(task.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(task.id); }}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50">
      <StatusDot status={task.status} />
      <span className="min-w-0 flex-1 truncate text-gray-800">{task.name}</span>
      <span className="hidden shrink-0 truncate text-xs text-gray-400 sm:inline">{listName(task.list_id)}</span>
      {extra}
    </div>
  );
};

// --- LineUp -------------------------------------------------------------------------------------------

export const LineupCard: React.FC<{ className?: string; onOpenTask: (id: string) => void }> = ({ className, onOpenTask }) => {
  const { workspace } = useWork();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { if (workspace) planningApi.lineup(workspace.id).then(setTasks).catch((e) => setError(e.message)); }, [workspace]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener('timetriq:lineup', load); return () => window.removeEventListener('timetriq:lineup', load); }, [load]);

  const act = async (fn: () => Promise<Task[]>) => { try { setError(null); setTasks(await fn()); } catch (e) { setError((e as Error).message); load(); } };
  const reorder = (ids: string[]) => {
    if (!workspace || !tasks) return;
    setTasks(ids.map((id) => tasks.find((t) => t.id === id)!));
    act(() => planningApi.orderLineup(workspace.id, ids));
  };
  const move = (id: string, by: number) => {
    if (!tasks) return;
    const ids = tasks.map((t) => t.id);
    const i = ids.indexOf(id), j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder(ids);
  };
  const dropOn = (targetId: string) => {
    if (!tasks || !dragging || dragging === targetId) return;
    const ids = tasks.map((t) => t.id).filter((x) => x !== dragging);
    ids.splice(ids.indexOf(targetId), 0, dragging);
    reorder(ids);
  };

  return (
    <HomeCardShell label="LineUp" className={className}
      title={<span className="flex items-center gap-1.5"><ListOrdered size={16} className="text-indigo-600" /> LineUp <span className="text-xs font-normal text-gray-400">your top tasks, in your order</span></span>}
      action={<button type="button" onClick={() => setAdding(!adding)} className="rounded-md px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50">{adding ? 'Done' : '+ Add task'}</button>}>
      {adding && (
        <div className="mb-2 px-2">
          <TaskPicker autoFocus placeholder="Find a task to add to your LineUp" exclude={(tasks ?? []).map((t) => t.id)}
            onPick={(t) => workspace && act(() => planningApi.addToLineup(workspace.id, t.id))} />
        </div>
      )}
      {error && <p className="px-2 text-xs text-red-600">{error}</p>}
      {tasks === null ? <p className="px-2 text-sm text-gray-400">Loading…</p> : tasks.length === 0 ? (
        <Empty><ListOrdered size={26} className="mb-2 text-gray-300" />Pick the few tasks that matter most right now and put them in order.</Empty>
      ) : (
        <ol aria-label="LineUp tasks">
          {tasks.map((t, i) => (
            <li key={t.id} draggable onDragStart={() => setDragging(t.id)} onDragEnd={() => setDragging(null)}
              onDragOver={(e) => { if (dragging) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); dropOn(t.id); setDragging(null); }}
              className={`group flex items-center gap-1 ${dragging === t.id ? 'opacity-40' : ''}`}>
              <GripVertical size={13} className="shrink-0 cursor-grab text-gray-300 group-hover:text-gray-500" />
              <span className="w-5 shrink-0 text-center text-xs font-semibold text-indigo-600">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <SimpleTaskRow task={t} onOpen={onOpenTask} extra={t.due_date ? <span className={`shrink-0 text-xs ${t.is_overdue ? 'text-red-600' : 'text-gray-500'}`}>{formatDue(t.due_date)}</span> : undefined} />
              </div>
              <span className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <button type="button" title={`Move ${t.name} up`} onClick={() => move(t.id, -1)} disabled={i === 0} className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowUp size={13} /></button>
                <button type="button" title={`Move ${t.name} down`} onClick={() => move(t.id, 1)} disabled={i === tasks.length - 1} className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowDown size={13} /></button>
                <button type="button" title={`Remove ${t.name} from LineUp`} onClick={() => workspace && act(() => planningApi.removeFromLineup(workspace.id, t.id))} className="rounded p-0.5 text-gray-400 hover:text-red-600"><X size={13} /></button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </HomeCardShell>
  );
};

// --- Today's plan, Delegated, Done ------------------------------------------------------------------------

export const TodaysPlanCard: React.FC<{ className?: string; onOpenTask: (id: string) => void }> = ({ className, onOpenTask }) => {
  const { workspace } = useWork();
  const [blocks, setBlocks] = useState<TimeBlock[] | null>(null);
  useEffect(() => {
    if (!workspace) return;
    const start = startOfDay(new Date());
    planningApi.planner(workspace.id, start, new Date(start.getTime() + 86_400_000)).then((p) => setBlocks(p.blocks)).catch(() => setBlocks([]));
  }, [workspace]);
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <HomeCardShell label="Today's plan" className={className}
      title={<span className="flex items-center gap-1.5"><CalendarDays size={16} className="text-indigo-600" /> Today's plan</span>}
      action={<Link to="/planner" className="text-xs font-medium text-indigo-700 no-underline hover:underline">Open Planner</Link>}>
      {blocks === null ? <p className="px-2 text-sm text-gray-400">Loading…</p> : blocks.length === 0 ? (
        <Empty>Nothing planned today. Drag tasks into time slots in the Planner.</Empty>
      ) : blocks.map((b) => (
        <div key={b.id} role="button" tabIndex={0} onClick={() => b.task_id && onOpenTask(b.task_id)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50">
          <span className="w-28 shrink-0 text-xs text-gray-500">{time(b.start_at)} – {time(b.end_at)}</span>
          {b.task && <StatusDot status={b.task.status} />}
          <span className="truncate text-gray-800">{b.task?.name ?? b.title}</span>
        </div>
      ))}
    </HomeCardShell>
  );
};

export function useMyWorkTab(kind: 'done' | 'delegated') {
  const { workspace } = useWork();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const load = useCallback(() => {
    if (!workspace) return;
    (kind === 'done' ? planningApi.done(workspace.id) : planningApi.delegated(workspace.id)).then(setTasks).catch(() => setTasks([]));
  }, [workspace, kind]);
  useEffect(() => { load(); }, [load]);
  return { tasks, reload: load };
}

export const DelegatedList: React.FC<{ tasks: Task[]; onOpenTask: (id: string) => void }> = ({ tasks, onOpenTask }) => {
  const { members } = useWork();
  const who = (t: Task) => t.assignees.map((a) => members.find((m) => m.user.id === a.id)?.user.display_name || a.display_name || a.email).join(', ');
  return (
    <>
      {tasks.map((t) => (
        <SimpleTaskRow key={t.id} task={t} onOpen={onOpenTask} extra={
          <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500">
            <span className="max-w-40 truncate">{who(t)}</span>
            {t.due_date && <span className={t.is_overdue ? 'text-red-600' : ''}>{formatDue(t.due_date)}</span>}
            <PriorityFlag priority={t.priority} withLabel={false} />
          </span>
        } />
      ))}
    </>
  );
};

export const DoneList: React.FC<{ tasks: Task[]; onOpenTask: (id: string) => void }> = ({ tasks, onOpenTask }) => (
  <>
    {tasks.map((t) => (
      <SimpleTaskRow key={t.id} task={t} onOpen={onOpenTask} extra={
        <span className="shrink-0 text-xs text-gray-500">{t.date_done ? new Date(t.date_done).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}</span>
      } />
    ))}
  </>
);

export const MyWorkCard: React.FC<{ kind: 'done' | 'delegated'; className?: string; onOpenTask: (id: string) => void }> = ({ kind, className, onOpenTask }) => {
  const { tasks } = useMyWorkTab(kind);
  const meta = CARD_LABELS[kind];
  return (
    <HomeCardShell label={meta.title} className={className}
      title={<span className="flex items-center gap-1.5">{kind === 'done' ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Send size={15} className="text-sky-600" />} {meta.title} <span className="text-xs font-normal text-gray-400">{meta.hint}</span></span>}>
      {tasks === null ? <p className="px-2 text-sm text-gray-400">Loading…</p> : tasks.length === 0 ? (
        <Empty>{kind === 'done' ? 'Nothing finished in the last 30 days yet.' : 'You have not handed any open tasks to others.'}</Empty>
      ) : kind === 'done' ? <DoneList tasks={tasks} onOpenTask={onOpenTask} /> : <DelegatedList tasks={tasks} onOpenTask={onOpenTask} />}
    </HomeCardShell>
  );
};

// --- Manage cards --------------------------------------------------------------------------------------------

export const ManageCardsDialog: React.FC<{ layout: HomeCard[]; onClose: () => void; onSave: (cards: HomeCard[] | null) => Promise<void> }> = ({ layout, onClose, onSave }) => {
  const [cards, setCards] = useState(layout);
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);
  const update = (key: HomeCardKey, patch: Partial<HomeCard>) => setCards((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const move = (i: number, by: number) => setCards((cs) => {
    const j = i + by;
    if (j < 0 || j >= cs.length) return cs;
    const next = [...cs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const save = async (value: HomeCard[] | null) => { setBusy(true); try { await onSave(value); onClose(); } finally { setBusy(false); } };
  return (
    <Modal label="Manage cards" title="Manage cards" onClose={onClose} width="w-[32rem]"
      footer={<>
        <button type="button" disabled={busy} onClick={() => save(null)} className="mr-auto rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Reset to standard</button>
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        <button type="button" disabled={busy} onClick={() => save(cards)} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">Save</button>
      </>}>
      <p className="mb-3 text-xs text-gray-500">Choose the cards on your My Tasks home, their order and their width. Only you see this layout.</p>
      <ul className="space-y-1.5">
        {cards.map((c, i) => (
          <li key={c.key} className="flex items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1.5">
            <input ref={i === 0 ? firstRef : undefined} type="checkbox" checked={!c.hidden} aria-label={`Show ${CARD_LABELS[c.key].title}`} onChange={(e) => update(c.key, { hidden: !e.target.checked })} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-800">{CARD_LABELS[c.key].title}</div>
              <div className="truncate text-xs text-gray-400">{CARD_LABELS[c.key].hint}</div>
            </div>
            <select value={c.size} aria-label={`Width of ${CARD_LABELS[c.key].title}`} onChange={(e) => update(c.key, { size: e.target.value as HomeCard['size'] })} className="rounded border border-gray-200 px-1.5 py-0.5 text-xs">
              <option value="half">Half width</option><option value="full">Full width</option>
            </select>
            <button type="button" title={`Move ${CARD_LABELS[c.key].title} up`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowUp size={14} /></button>
            <button type="button" title={`Move ${CARD_LABELS[c.key].title} down`} disabled={i === cards.length - 1} onClick={() => move(i, 1)} className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowDown size={14} /></button>
          </li>
        ))}
      </ul>
    </Modal>
  );
};
