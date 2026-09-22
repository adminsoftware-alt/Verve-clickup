import React, { useMemo, useRef, useState } from 'react';
import { CheckSquare, Clock, GitBranch, MessageSquare, Paperclip, Plus } from 'lucide-react';
import type { Status, Task } from '../api';
import { AvatarStack, PriorityFlag, StatusPill, formatDue, formatDuration } from '../ui';
import { keysOf, type GroupBy, type StatusGroupOfTasks } from './grouping';
import { useWork } from '../WorkContext';
import { TypeIcon } from '../LocationSettings';

/**
 * Kanban board: a column per status, a card per task. Dragging a card to another column
 * changes its status. That needs one set of statuses, so it works inside a single List;
 * above a List each List can have different statuses.
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
}> = ({ tasks, statuses, listName, groupBy, makeGroups, canAddIn, canDrag, onCreate, onMove, onOpenTask }) => {
  const { taskTypes } = useWork();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // The dragged card, kept here too: some browsers hide dataTransfer contents on drop.
  const dragging = useRef<string | null>(null);

  const visibleIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  // Cards are top-level tasks; subtasks show as a count on their parent, as in ClickUp.
  const roots = useMemo(() => tasks.filter((t) => !t.parent_id || !visibleIds.has(t.parent_id)), [tasks, visibleIds]);
  const columns = useMemo(() => makeGroups(roots), [roots, makeGroups]);
  // Where the drag started: a card with two assignees sits in two columns.
  const dragFrom = useRef<string | null>(null);

  const drop = async (e: React.DragEvent, key: string) => {
    e.preventDefault();
    setDragOver(null);
    const taskId = e.dataTransfer.getData('text/plain') || dragging.current;
    const from = dragFrom.current;
    dragging.current = null;
    dragFrom.current = null;
    const task = tasks.find((t) => t.id === taskId);
    if (!taskId || !task || !from || keysOf(groupBy, task).includes(key)) return;
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

  return (
    <div className="flex h-full flex-col">
      {!canDrag && groupBy === 'status' && !statuses && (
        <p className="px-6 pt-3 text-xs text-gray-400">Open a single List to move cards between statuses — each List can have its own statuses.</p>
      )}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 py-4" role="list" aria-label="Board">
        {columns.map((column) => (
          <section
            key={column.key}
            aria-label={`${column.status.name} column`}
            onDragOver={(e) => { if (canDrag) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(column.key); } }}
            onDragLeave={() => setDragOver((k) => (k === column.key ? null : k))}
            onDrop={(e) => canDrag && drop(e, column.key)}
            className={`flex w-72 shrink-0 flex-col rounded-xl border-t-4 bg-gray-50 ${dragOver === column.key ? 'ring-2 ring-indigo-300' : ''}`}
            style={{ borderTopColor: column.status.color }}
          >
            <header className="flex items-center gap-2 px-3 py-2.5">
              <StatusPill status={column.status} />
              <span className="text-sm text-gray-400">{column.tasks.length}</span>
            </header>
            <div className="min-h-16 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {column.tasks.map((task) => {
                const draggable = canDrag && (task.permission_level === 'edit' || task.permission_level === 'full');
                return (
                  <article
                    key={task.id}
                    draggable={draggable}
                    onDragStart={(e) => {
                      dragging.current = task.id;
                      dragFrom.current = column.key;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', task.id);
                    }}
                    onDragEnd={() => { dragging.current = null; setDragOver(null); }}
                    onClick={() => onOpenTask(task.id)}
                    className={`cursor-pointer rounded-lg border border-gray-200 bg-white p-3 shadow-sm hover:border-gray-300 ${draggable ? 'active:cursor-grabbing' : ''}`}
                  >
                    {!statuses && <div className="mb-0.5 truncate text-[11px] text-gray-400">{listName(task.list_id)}</div>}
                    <div className={`flex items-center gap-1.5 text-sm font-medium ${task.status.group === 'closed' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                      {task.type_id && taskTypes.find((x) => x.id === task.type_id) && <TypeIcon type={taskTypes.find((x) => x.id === task.type_id)!} />}
                      <span className="min-w-0">{task.name}</span>
                    </div>
                    {task.custom_id && <div className="mt-0.5 font-mono text-[10px] text-gray-400">{task.custom_id}</div>}
                    {task.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {task.tags.map((tag) => (
                          <span key={tag.id} className="rounded px-1.5 py-px text-[11px] font-medium" style={{ backgroundColor: tag.bg_color, color: tag.fg_color }}>{tag.name}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2.5 flex items-center gap-3 text-xs text-gray-500">
                      {task.assignees.length > 0 && <AvatarStack users={task.assignees} />}
                      {task.due_date && <span className={task.is_overdue ? 'text-red-600' : ''}>{formatDue(task.due_date)}</span>}
                      {task.priority && <PriorityFlag priority={task.priority} withLabel={false} />}
                      {task.subtask_count > 0 && <span className="inline-flex items-center gap-0.5"><GitBranch size={12} />{task.subtask_count}</span>}
                      {!!task.checklist_total && <span title="Checklist" className="inline-flex items-center gap-0.5"><CheckSquare size={12} />{task.checklist_done}/{task.checklist_total}</span>}
                      {!!task.comment_count && <span title="Comments" className="inline-flex items-center gap-0.5"><MessageSquare size={12} />{task.comment_count}</span>}
                      {!!task.attachment_count && <span title="Attachments" className="inline-flex items-center gap-0.5"><Paperclip size={12} />{task.attachment_count}</span>}
                      {task.time_tracked_seconds > 0 && <span className="ml-auto inline-flex items-center gap-0.5"><Clock size={12} />{formatDuration(task.time_tracked_seconds)}</span>}
                    </div>
                  </article>
                );
              })}
              {canAddIn(column.key) && (adding === column.key ? (
                <form onSubmit={(e) => create(e, column.key)} className="rounded-lg border border-indigo-300 bg-white p-2">
                  <input
                    autoFocus
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
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-gray-400 hover:bg-white hover:text-gray-600"
                >
                  <Plus size={14} /> Add Task
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};
