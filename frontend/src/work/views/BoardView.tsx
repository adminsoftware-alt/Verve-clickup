import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, CheckSquare, Clock, GitBranch, MessageSquare, Paperclip, Plus } from 'lucide-react';
import { workApi, type Status, type Task, type TaskInput } from '../api';
import { AvatarStack, Menu, PRIORITIES, PriorityFlag, StatusDot, formatDue, formatDuration, fromDateInput } from '../ui';
import { keysOf, type GroupBy, type StatusGroupOfTasks } from './grouping';
import { useWork } from '../WorkContext';
import { TypeIcon } from '../LocationSettings';
import { RowMenu } from './RowMenu';
import { useUnreadTasks } from './useUnreadTasks';
import { statusForStep, type Step } from './progress';
import { DuePicker, PriorityPicker } from '../task/InlineFields';
import { notify } from '../../components/notify';

/** Today plus `days`, as YYYY-MM-DD in this browser's own time zone. */
function shiftIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const finished = (t: Task) => t.status.group === 'done' || t.status.group === 'closed';

/**
 * Kanban board: a column per status (or progress, priority, person...), a card per task.
 *
 * Dragging a card to another column changes what the column stands for. Grouped by progress --
 * To do, In progress, Complete -- that works anywhere, My Tasks included: each card goes to its
 * own List's matching status. Within a column, cards can be dragged into order where order means
 * something (one List, in its own order).
 */
export const BoardView: React.FC<{
  tasks: Task[];
  statuses: Status[] | null;
  listName: (listId: string) => string | null;
  groupBy: GroupBy;
  makeGroups: (roots: Task[]) => StatusGroupOfTasks[];
  canAddIn: (groupKey: string) => boolean;
  /** Whether cards can be dragged between columns for this grouping. */
  canDrag: boolean;
  /** onCreate/onMove get the column's key: a status id, group id, "p1"…, user id… */
  onCreate: (name: string, key: string) => Promise<void>;
  onMove: (taskId: string, from: string, to: string) => Promise<void>;
  onOpenTask: (id: string) => void;
  /** Given, a card's status, due date and the right-click menu change it in place; called after. */
  onChanged?: () => void;
  /** Given, cards can be dragged into order within their column. */
  onReorder?: (taskId: string, orderindex: number) => Promise<void>;
}> = ({ tasks: incoming, statuses, listName, groupBy, makeGroups, canAddIn, canDrag, onCreate, onMove, onOpenTask, onChanged, onReorder }) => {
  const { taskTypes } = useWork();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // The dragged card, kept here too: some browsers hide dataTransfer contents on drop.
  const dragging = useRef<string | null>(null);
  // Where the drag started: a card with two assignees sits in two columns.
  const dragFrom = useRef<string | null>(null);

  // An edit shows at once; the reload from the server replaces it.
  const [local, setLocal] = useState<Record<string, Partial<Task>>>({});
  const tasks = useMemo(() => incoming.map((t) => ({ ...t, ...(local[t.id] ?? {}) })), [incoming, local]);
  useEffect(() => setLocal({}), [incoming]);
  const editable = (t: Task) => !!onChanged && (t.permission_level === 'edit' || t.permission_level === 'full');
  const save = async (t: Task, input: TaskInput, optimistic: Partial<Task>) => {
    setLocal((l) => ({ ...l, [t.id]: { ...(l[t.id] ?? {}), ...optimistic } }));
    try {
      await workApi.updateTask(t.id, input);
      onChanged?.();
    } catch (e) {
      setLocal((l) => { const next = { ...l }; delete next[t.id]; return next; });
      notify.error(e);
    }
  };
  const [listStatuses, setListStatuses] = useState<Record<string, Status[]>>({});
  const statusSet = async (t: Task): Promise<Status[]> => {
    const known = statuses ?? listStatuses[t.list_id];
    if (known) return known;
    const set = (await workApi.statuses('list', t.list_id)).statuses;
    setListStatuses((m) => ({ ...m, [t.list_id]: set }));
    return set;
  };
  const loadStatuses = (t: Task) => { statusSet(t).catch(() => undefined); };
  const [justDone, setJustDone] = useState<string | null>(null);
  const setProgress = async (t: Task, step: Step) => {
    try {
      const target = statusForStep(await statusSet(t), step);
      if (!target || target.id === t.status.id) return;
      if (step === 'done') setJustDone(t.id);
      save(t, { status_id: target.id }, { status: target });
    } catch (e) { notify.error(e); }
  };
  const reschedule = (t: Task, days: number) => {
    const iso = fromDateInput(shiftIso(days));
    if (iso && t.start_date && iso.slice(0, 10) < t.start_date.slice(0, 10)) {
      notify.error(new Error('That is before the start date'));
      return;
    }
    save(t, { due_date: iso }, { due_date: iso, is_overdue: false });
  };
  const [cardMenu, setCardMenu] = useState<{ task: Task; at: { x: number; y: number } } | null>(null);
  const unread = useUnreadTasks();

  const visibleIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  // Cards are top-level tasks; subtasks show as a count on their parent, as in ClickUp.
  const roots = useMemo(() => tasks.filter((t) => !t.parent_id || !visibleIds.has(t.parent_id)), [tasks, visibleIds]);
  const columns = useMemo(() => makeGroups(roots), [roots, makeGroups]);
  // Progress columns hold still everywhere, so a card can always be dragged between them.
  const byProgress = groupBy === 'progress' && !!onChanged;
  const dragOK = canDrag || byProgress;

  const end = () => { dragging.current = null; dragFrom.current = null; setDragOver(null); setDropBefore(null); };
  const drop = async (e: React.DragEvent, key: string, beforeId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const taskId = e.dataTransfer.getData('text/plain') || dragging.current;
    const from = dragFrom.current;
    end();
    const task = tasks.find((t) => t.id === taskId);
    if (!taskId || !task || !from) return;
    // Within its own column: a new place in the order.
    if (keysOf(groupBy, task).includes(key)) {
      if (!onReorder || !beforeId || beforeId === taskId) return;
      const col = columns.find((c) => c.key === key)?.tasks.filter((t) => t.id !== taskId) ?? [];
      const i = col.findIndex((t) => t.id === beforeId);
      if (i < 0) return;
      const orderindex = i > 0 ? (col[i - 1].orderindex + col[i].orderindex) / 2 : col[i].orderindex - 1;
      setLocal((l) => ({ ...l, [taskId]: { ...(l[taskId] ?? {}), orderindex } }));
      onReorder(taskId, orderindex).catch((err) => notify.error(err));
      return;
    }
    if (byProgress) { await setProgress(task, key as Step); return; }
    await onMove(taskId, from, key);
  };

  const create = async (e: React.FormEvent, statusId: string) => {
    e.preventDefault();
    if (!draft.trim()) return;
    await onCreate(draft.trim(), statusId);
    setDraft('');
  };

  if (columns.length === 0) {
    return <div className="px-6 py-16 text-center text-sm text-gray-400">No tasks here yet.</div>;
  }

  const renderCard = (task: Task, columnKey: string, ordered: boolean) => {
    const draggable = dragOK && (task.permission_level === 'edit' || task.permission_level === 'full');
    const type = task.type_id ? taskTypes.find((x) => x.id === task.type_id) : undefined;
    // Above a List, the List alone -- the three-folder path above it is the same on every card.
    const where = statuses ? null : listName(task.list_id)?.split(' / ').pop();
    const done = finished(task);
    return (
      <article
        key={task.id}
        draggable={draggable}
        onDragStart={(e) => {
          dragging.current = task.id;
          dragFrom.current = columnKey;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', task.id);
        }}
        onDragEnd={end}
        onDragOver={ordered ? (e) => { if (dragging.current && dragging.current !== task.id) { e.preventDefault(); setDropBefore(task.id); } } : undefined}
        onDrop={ordered ? (e) => drop(e, columnKey, task.id) : undefined}
        onClick={() => onOpenTask(task.id)}
        onContextMenu={(e) => { e.preventDefault(); setCardMenu({ task, at: { x: e.clientX, y: e.clientY } }); if (editable(task)) loadStatuses(task); }}
        data-board-card
        data-done={done ? '' : undefined}
        data-drop={dropBefore === task.id ? '' : undefined}
        className={`cursor-pointer rounded-[10px] border bg-white p-3 ${draggable ? 'active:cursor-grabbing' : ''}`}
      >
        <div className="flex items-start gap-2">
          {editable(task) ? (
            // To do / In progress / Complete; any other status is a right-click away.
            <span onClick={(e) => e.stopPropagation()} onMouseEnter={() => loadStatuses(task)} className="relative mt-px flex shrink-0">
              <Menu
                label={`Progress of ${task.name}`}
                width={170}
                items={[
                  { label: 'To do', icon: <span className="h-3 w-3 rounded-full border-2 border-dashed border-gray-400" />, onClick: () => setProgress(task, 'todo') },
                  { label: 'In progress', icon: <span className="h-3 w-3 rounded-full border-2 border-blue-500 bg-blue-100" />, onClick: () => setProgress(task, 'doing') },
                  { label: 'Complete', icon: <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#16A34A] text-white"><Check size={9} strokeWidth={3.5} /></span>, onClick: () => setProgress(task, 'done') },
                ]}
                trigger={(
                  <span className="relative flex rounded-full p-0.5 hover:bg-gray-100">
                    {done ? (
                      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#16A34A] text-white"><Check size={9} strokeWidth={3.5} /></span>
                    ) : <StatusDot status={task.status} />}
                  </span>
                )}
              />
              {justDone === task.id && (
                <span className="vf-done-burst pointer-events-none absolute left-1/2 top-1/2 flex h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#16A34A] text-white"
                  onAnimationEnd={() => setJustDone(null)}>
                  <Check size={11} strokeWidth={3.5} />
                </span>
              )}
            </span>
          ) : <span className="mt-0.5 flex shrink-0">{done
            ? <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#16A34A] text-white"><Check size={9} strokeWidth={3.5} /></span>
            : <StatusDot status={task.status} />}</span>}
          <div className="min-w-0 flex-1">
            <div className={`flex items-start gap-1.5 text-[13.5px] leading-snug ${done ? 'text-gray-500' : unread.has(task.id) ? 'font-semibold text-gray-900' : 'font-medium text-gray-800'}`}>
              {unread.has(task.id) && <span role="img" aria-label="Unread comments" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
              {type && <TypeIcon type={type} />}
              <span className="line-clamp-2 min-w-0">{task.name}</span>
            </div>
            {(where || task.custom_id) && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {where && <span className="max-w-full truncate rounded bg-[#F2F4F7] px-1.5 py-px text-[11px] text-[#667085]">{where}</span>}
                {task.custom_id && <span className="font-mono text-[10px] text-gray-400">{task.custom_id}</span>}
              </div>
            )}
          </div>
        </div>
        {task.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 pl-6">
            {task.tags.map((tag) => (
              <span key={tag.id} data-tag className="rounded px-1.5 py-px text-[11px] font-medium" style={{ backgroundColor: tag.bg_color, color: tag.fg_color, '--tag': tag.bg_color } as React.CSSProperties}>{tag.name}</span>
            ))}
          </div>
        )}
        {/* The same order on every card: people, when, how urgent, then the counts. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pl-6 text-xs text-gray-500">
          {task.assignees.length > 0 && <AvatarStack users={task.assignees} max={3} />}
          {editable(task) ? (
            // Due date and priority change right on the card; a late task keeps its one-click
            // reschedule beside the date.
            <>
              <DuePicker task={task} onSave={(input, opt) => save(task, input, opt as Partial<Task>)} />
              {task.is_overdue && !done && (
                <span onClick={(e) => e.stopPropagation()} className="-ml-2 inline-flex">
                  <Menu
                    label={`Reschedule ${task.name}`}
                    triggerClassName="inline-flex"
                    items={[
                      { label: 'Today', icon: <CalendarClock size={14} />, onClick: () => reschedule(task, 0) },
                      { label: 'Tomorrow', icon: <CalendarClock size={14} />, onClick: () => reschedule(task, 1) },
                      { label: 'Next Monday', icon: <CalendarClock size={14} />, onClick: () => reschedule(task, ((8 - new Date().getDay()) % 7) || 7) },
                    ]}
                    trigger={<span aria-label="Reschedule" className="flex rounded-md p-0.5 text-red-500 hover:bg-red-50"><CalendarClock size={13} /></span>}
                  />
                </span>
              )}
              <PriorityPicker task={task} withLabel={!!task.priority && task.priority <= 2} onSave={(input, opt) => save(task, input, opt as Partial<Task>)} />
            </>
          ) : (<>
          {task.due_date && (task.is_overdue && !done ? (
            <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
              <span className="rounded-full border border-[#FECDCA] bg-[#FEF3F2] px-2 py-px font-medium text-[#B42318]">{formatDue(task.due_date)}</span>
              {editable(task) && (
                <Menu
                  label={`Reschedule ${task.name}`}
                  triggerClassName="inline-flex"
                  items={[
                    { label: 'Today', icon: <CalendarClock size={14} />, onClick: () => reschedule(task, 0) },
                    { label: 'Tomorrow', icon: <CalendarClock size={14} />, onClick: () => reschedule(task, 1) },
                    { label: 'Next Monday', icon: <CalendarClock size={14} />, onClick: () => reschedule(task, ((8 - new Date().getDay()) % 7) || 7) },
                  ]}
                  trigger={<span aria-label="Reschedule" className="flex rounded-md p-0.5 text-red-500 hover:bg-red-50"><CalendarClock size={13} /></span>}
                />
              )}
            </span>
          ) : <span className="text-gray-600">{formatDue(task.due_date)}</span>)}
          {/* Only Urgent and High carry colour; Normal and Low say nothing on a card. */}
          {task.priority && task.priority <= 2 && (
            <span className="inline-flex items-center gap-1 font-medium" style={{ color: PRIORITIES[task.priority].color }}>
              <PriorityFlag priority={task.priority} withLabel={false} />{PRIORITIES[task.priority].label}
            </span>
          )}
          </>)}
          {task.subtask_count > 0 && <span className="inline-flex items-center gap-0.5"><GitBranch size={12} />{task.subtask_count}</span>}
          {!!task.checklist_total && <span className="inline-flex items-center gap-0.5"><CheckSquare size={12} />{task.checklist_done}/{task.checklist_total}</span>}
          {!!task.comment_count && <span className="inline-flex items-center gap-0.5"><MessageSquare size={12} />{task.comment_count}</span>}
          {!!task.attachment_count && <span className="inline-flex items-center gap-0.5"><Paperclip size={12} />{task.attachment_count}</span>}
          {task.time_tracked_seconds > 0 && (
            <span className={`ml-auto inline-flex items-center gap-0.5 ${task.time_estimate_seconds && task.time_tracked_seconds > task.time_estimate_seconds ? 'font-medium text-red-600' : ''}`}>
              <Clock size={12} />{formatDuration(task.time_tracked_seconds)}
            </span>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="vf-board flex h-full flex-col">
      {!dragOK && groupBy === 'status' && !statuses && (
        <p className="px-6 pt-3 text-xs text-gray-400">Group by Progress to move cards between To do, In progress and Complete.</p>
      )}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 py-4" role="list" aria-label="Board">
        {columns.map((column) => {
          const ordered = !!onReorder;
          const sorted = ordered ? [...column.tasks].sort((a, b) => a.orderindex - b.orderindex) : column.tasks;
          return (
            <section
              key={column.key}
              aria-label={`${column.status.name} column`}
              onDragOver={(e) => { if (dragOK) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(column.key); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver((k) => (k === column.key ? null : k)); }}
              onDrop={(e) => dragOK && drop(e, column.key)}
              data-board-column
              data-over={dragOver === column.key ? '' : undefined}
              className="flex w-72 shrink-0 flex-col rounded-xl border"
            >
              {/* The header stays put; only the cards under it scroll. */}
              <header className="flex items-center gap-2 px-3 pb-2 pt-3">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: column.status.color }} />
                <span className="truncate text-[13px] font-semibold text-[#1B2A4A]">{column.status.name}</span>
                <span className="rounded-full bg-white px-1.5 text-[11px] font-medium text-gray-500 ring-1 ring-[#E6E8EC]">{column.tasks.length}</span>
              </header>
              <div className="min-h-16 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {sorted.map((task) => renderCard(task, column.key, ordered))}
                {canAddIn(column.key) && (adding === column.key ? (
                  <form onSubmit={(e) => create(e, column.key)} className="rounded-[10px] border border-brand-300 bg-white p-2">
                    <input
                      autoFocus
                      aria-label="New task name"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => !draft && setAdding(null)}
                      onKeyDown={(e) => e.key === 'Escape' && setAdding(null)}
                      placeholder="Task name — Enter to save"
                      className="w-full text-sm focus:outline-none"
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setAdding(column.key); setDraft(''); }}
                    className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-gray-500 hover:bg-white hover:text-gray-700"
                  >
                    <Plus size={14} /> Add Task
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {cardMenu && (
        <RowMenu
          task={cardMenu.task}
          at={cardMenu.at}
          statuses={statuses ?? listStatuses[cardMenu.task.list_id] ?? [cardMenu.task.status]}
          canEdit={editable(cardMenu.task)}
          siblings={tasks}
          onOpen={() => onOpenTask(cardMenu.task.id)}
          onStatus={(st) => save(cardMenu.task, { status_id: st.id }, { status: st })}
          onChanged={() => onChanged?.()}
          onClose={() => setCardMenu(null)}
        />
      )}
    </div>
  );
};
