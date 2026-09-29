import React, { useEffect, useMemo, useState } from 'react';
import { Ban, CheckSquare, OctagonAlert, ChevronDown, ChevronRight, GitBranch, Hourglass, Layers3, MessageSquare, Paperclip, Play, Plus, Repeat, Square } from 'lucide-react';
import type { CustomField, Status, Task, UserRef } from '../api';
import { AvatarStack, PriorityFlag, StatusDot, StatusPill, formatDue, formatDuration } from '../ui';
import { formatClock, useNow, useRunningTimer } from '../RunningTimer';
import { NO_GROUP, type GroupBy, type StatusGroupOfTasks } from './grouping';
import { COLUMNS, type ColumnKey } from './viewSettings';
import { FieldEditor, fieldApplies } from '../fields/FieldValue';
import { useWork } from '../WorkContext';
import { TypeIcon } from '../LocationSettings';
import { notify } from '../../components/notify';

/**
 * The columns a task is expected to carry, and which of them it has not got.
 *
 * These are the five the Dashboard is built on: without them the workload card cannot place the
 * task in a day, the priority chart fills with "No priority", and nobody knows whose it is.
 */
const NEEDS: ColumnKey[] = ['assignee', 'start_date', 'due_date', 'priority', 'time_estimate'];

function missing(task: Task): ColumnKey[] {
  const out: ColumnKey[] = [];
  if (!task.assignees.length) out.push('assignee');
  if (!task.start_date) out.push('start_date');
  if (!task.due_date) out.push('due_date');
  if (!task.priority) out.push('priority');
  if (!task.time_estimate_seconds) out.push('time_estimate');
  return out;
}

export const ListView: React.FC<{
  tasks: Task[]; // already filtered and sorted
  statuses: Status[] | null; // present when viewing a single List
  listName: (listId: string) => string | null;
  groupBy: GroupBy;
  makeGroups: (roots: Task[]) => StatusGroupOfTasks[];
  /** Opens the Task groups editor, when this person may make one. */
  onManageGroups?: () => void;
  /** Whether "+ Add Task" is offered in a group; onCreate gets that group's key. */
  canAddIn: (groupKey: string) => boolean;
  onCreate: (name: string, key: string) => Promise<void>;
  onOpenTask: (id: string) => void;
  columns: ColumnKey[];
  fields: CustomField[]; // custom field columns to show
  people: UserRef[];
  onSetField: (taskId: string, fieldId: string, value: unknown) => void;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
  /** The "+" at the end of the column headers: add a column (a custom field). */
  onAddColumn?: () => void;
}> = ({ tasks, statuses, listName, groupBy, makeGroups, canAddIn, onCreate, onManageGroups, onOpenTask, columns, fields, people, onSetField, selected, onSelect, onAddColumn }) => {
  const { locate, taskTypes } = useWork();
  const taskTypeOf = (t: Task) => (t.type_id ? taskTypes.find((x) => x.id === t.type_id) : undefined);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // Grouping by task group or task type is about the groups themselves, so an empty one still
  // shows -- otherwise a group you just made disappears and there is nowhere to add into it.
  const groupsMatter = groupBy === 'group' || groupBy === 'type';
  const [showEmpty, setShowEmpty] = useState(groupsMatter);
  useEffect(() => { setShowEmpty(groupsMatter); }, [groupsMatter]);

  const visibleIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  const children = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks.forEach((t) => {
      if (t.parent_id && visibleIds.has(t.parent_id)) {
        map.set(t.parent_id, [...(map.get(t.parent_id) ?? []), t]);
      }
    });
    return map;
  }, [tasks, visibleIds]);
  // A task is a root row unless its parent is also on screen.
  const roots = useMemo(() => tasks.filter((t) => !t.parent_id || !visibleIds.has(t.parent_id)), [tasks, visibleIds]);
  const allGroups = useMemo(() => makeGroups(roots), [roots, makeGroups]);
  // As in ClickUp, statuses with no tasks stay out of the way (the first one stays, to add into).
  const emptyCount = allGroups.filter((g) => g.tasks.length === 0).length;
  const groups = useMemo(() => {
    if (showEmpty) return allGroups;
    const full = allGroups.filter((g) => g.tasks.length > 0);
    return full.length ? full : allGroups.slice(0, 1);
  }, [allGroups, showEmpty]);
  const shown = COLUMNS.filter((c) => columns.includes(c.key));
  const template = `28px minmax(380px,1fr) ${shown.map((c) => c.width).join(' ')}${fields.map(() => ' 160px').join('')}${onAddColumn ? ' 36px' : ''}`;
  const selecting = selected.size > 0;

  const toggle = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    update(next);
  };

  const submit = async (e: React.FormEvent, key: string) => {
    e.preventDefault();
    if (!draft.trim()) return;
    await onCreate(draft.trim(), key);
    setDraft('');
  };

  const cell = (key: ColumnKey, task: Task): React.ReactNode => {
    // A task typed in as a name alone is a real task; it just is not finished being described.
    // The columns it still needs say so here, in place, rather than a dialog having refused to
    // make it in the first place.
    const needed = NEEDS.includes(key) && missing(task).includes(key);
    const Wanted = () => (
      <span
        className="inline-flex items-center gap-1 rounded border border-dashed border-red-300 bg-red-50/60 px-1.5 py-0.5 text-[11px] font-medium text-red-600"
        title="Open the task to fill this in"
      >
        Add
      </span>
    );
    switch (key) {
      case 'custom_id': return <div key={key} className="font-mono text-xs text-gray-500">{task.custom_id ?? ''}</div>;
      case 'assignee': return <div key={key}>{needed ? <Wanted /> : <AvatarStack users={task.assignees} />}</div>;
      case 'start_date': return <div key={key} className="text-gray-600">{needed ? <Wanted /> : formatDue(task.start_date)}</div>;
      case 'due_date': return <div key={key} className={task.is_overdue ? 'text-red-600' : 'text-gray-600'}>{needed ? <Wanted /> : formatDue(task.due_date)}</div>;
      case 'priority': return <div key={key}>{needed ? <Wanted /> : <PriorityFlag priority={task.priority} />}</div>;
      case 'time_tracked': return <TimeTrackedCell key={key} task={task} />;
      case 'time_estimate': return (
        <div key={key} className="flex items-center gap-1 text-gray-600">
          {needed ? <Wanted />
            : task.time_estimate_seconds ? <><Hourglass size={13} className="text-gray-400" />{formatDuration(task.time_estimate_seconds)}</>
            : <span className="text-gray-300">—</span>}
        </div>
      );
      case 'tags': return (
        <div key={key} className="flex min-w-0 flex-wrap gap-1">
          {task.tags.map((tag) => <span key={tag.id} className="rounded px-1.5 py-px text-[11px] font-medium" style={{ backgroundColor: tag.bg_color, color: tag.fg_color }}>{tag.name}</span>)}
        </div>
      );
      case 'created_at': return <div key={key} className="text-gray-600">{formatDue(task.created_at)}</div>;
    }
  };

  const renderRow = (task: Task, depth: number): React.ReactNode => {
    const kids = children.get(task.id) ?? [];
    const open = expandedTasks.has(task.id);
    const location = statuses ? null : listName(task.list_id);
    const isSelected = selected.has(task.id);
    return (
      <React.Fragment key={task.id}>
        <div
          onClick={() => onOpenTask(task.id)}
          className={`group/row grid cursor-pointer items-center border-b border-gray-100 py-2 pr-4 text-sm ${isSelected ? 'bg-brand-50/60' : 'hover:bg-gray-50'}`}
          style={{ gridTemplateColumns: template }}
        >
          <span className="flex justify-center" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              aria-label={`Select ${task.name}`}
              checked={isSelected}
              onChange={(e) => onSelect([task.id], e.target.checked)}
              className={`${selecting || isSelected ? '' : 'opacity-0 group-hover/row:opacity-100'} focus:opacity-100`}
            />
          </span>
          <div className="flex min-w-0 items-center gap-2 overflow-hidden pr-3" style={{ paddingLeft: depth * 24 }}>
            <span className="flex w-4 justify-center">
              {kids.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggle(expandedTasks, task.id, setExpandedTasks); }}
                  className="text-gray-400 hover:text-gray-700"
                >
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              )}
            </span>
            <StatusDot status={task.status} />
            {taskTypeOf(task) && <TypeIcon type={taskTypeOf(task)!} />}
            <div className="min-w-0">
              {location && <div className="truncate text-[11px] leading-tight text-gray-400">{location}</div>}
              <div className="flex min-w-0 items-center gap-2">
                <span className={`truncate ${task.status.group === 'closed' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{task.name}</span>
                {task.subtask_count > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-gray-400"><GitBranch size={12} />{task.subtask_count}</span>
                )}
                {task.recurrence && <span title="Repeats" className="shrink-0 text-brand-500"><Repeat size={12} /></span>}
                {!!task.waiting_on_open && <span title={`Waiting on ${task.waiting_on_open} unfinished task${task.waiting_on_open === 1 ? '' : 's'}`} className="shrink-0 text-red-500"><Ban size={12} /></span>}
                {!!task.blocking_count && <span title={`Blocking ${task.blocking_count} task${task.blocking_count === 1 ? '' : 's'}`} className="inline-flex shrink-0 items-center gap-0.5 text-xs text-amber-600"><OctagonAlert size={12} />{task.blocking_count}</span>}
                {!!task.checklist_total && (
                  <span title="Checklist items done" className={`inline-flex shrink-0 items-center gap-0.5 text-xs ${task.checklist_done === task.checklist_total ? 'text-emerald-600' : 'text-gray-400'}`}><CheckSquare size={12} />{task.checklist_done}/{task.checklist_total}</span>
                )}
                {!!task.comment_count && <span title="Comments" className="inline-flex shrink-0 items-center gap-0.5 text-xs text-gray-400"><MessageSquare size={12} />{task.comment_count}</span>}
                {!!task.attachment_count && <span title="Attachments" className="inline-flex shrink-0 items-center gap-0.5 text-xs text-gray-400"><Paperclip size={12} />{task.attachment_count}</span>}
                {groupBy !== 'group' && task.group && (
                  <span className="shrink-0 rounded-full border px-1.5 py-px text-[11px]" style={{ borderColor: task.group.color, color: task.group.color }}>{task.group.name}</span>
                )}
                {!columns.includes('tags') && groupBy !== 'tags' && task.tags.map((tag) => (
                  <span key={tag.id} className="shrink-0 rounded px-1.5 py-px text-[11px] font-medium" style={{ backgroundColor: tag.bg_color, color: tag.fg_color }}>
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {shown.map((c) => cell(c.key, task))}
          {fields.map((f) => (
            <div key={f.id} className="min-w-0 pr-2">
              {fieldApplies(f, task, locate)
                ? <FieldEditor compact field={{ ...f, name: `${f.name} of ${task.name}` }} value={task.custom_fields?.[f.id]} people={people}
                    disabled={task.permission_level !== 'edit' && task.permission_level !== 'full'} onChange={(v) => onSetField(task.id, f.id, v)} />
                : <span className="text-xs text-gray-300">—</span>}
            </div>
          ))}
        </div>
        {open && kids.map((kid) => renderRow(kid, depth + 1))}
      </React.Fragment>
    );
  };

  // Grouping by Task group with none made yet: say what a group is and offer to make one.
  const onlyUngrouped = groupBy === 'group' && allGroups.length <= 1;
  if (onlyUngrouped && onManageGroups) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <Layers3 size={28} className="mx-auto text-gray-300" />
        <h3 className="mt-3 text-base font-semibold text-gray-800">No task groups yet</h3>
        <p className="mt-1 text-sm text-gray-500">
          A group gathers similar work under one name — “Meetings”, “Client calls”, “Adhoc”. Make one,
          then add tasks straight into it with the “+ Add &lt;group&gt;” row underneath it.
        </p>
        <button type="button" onClick={onManageGroups} className="btn-accent mt-4 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold">
          <Plus size={14} /> New task group
        </button>
      </div>
    );
  }
  if (groups.length === 0 || groups.every((g) => g.tasks.length === 0 && !canAddIn(g.key))) {
    return <div className="px-6 py-16 text-center text-sm text-gray-400">{statuses ? 'No tasks match.' : 'No tasks here yet. Open a List to add one.'}</div>;
  }

  return (
    <div className="overflow-x-auto px-6 pb-24">
      <div style={{ minWidth: 440 + shown.reduce((n, c) => n + parseInt(c.width, 10), 0) + fields.length * 160 + (onAddColumn ? 36 : 0) }}>
      {emptyCount > 0 && allGroups.some((g) => g.tasks.length > 0) && (
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={() => setShowEmpty(!showEmpty)} className="text-xs text-gray-400 hover:text-gray-700">
            {showEmpty ? 'Hide empty groups' : `Show ${emptyCount} empty group${emptyCount === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key);
        const ids = group.tasks.map((t) => t.id);
        const allOn = ids.length > 0 && ids.every((x) => selected.has(x));
        return (
          <section key={group.key} className="mt-5" aria-label={`${group.status.name} group`}>
            <div className="group/head mb-1 flex items-center gap-2">
              <button type="button" onClick={() => toggle(collapsed, group.key, setCollapsed)} className="text-gray-400 hover:text-gray-700">
                {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>
              <StatusPill status={group.status} />
              <span className="text-sm text-gray-400">{group.tasks.length}</span>
              {ids.length > 0 && (
                <label className={`ml-1 flex items-center gap-1 text-xs text-gray-400 ${selecting ? '' : 'opacity-0 group-hover/head:opacity-100 focus-within:opacity-100'}`}>
                  <input type="checkbox" aria-label={`Select all in ${group.status.name}`} checked={allOn} onChange={(e) => onSelect(ids, e.target.checked)} /> Select all
                </label>
              )}
            </div>
            {!isCollapsed && (
              <div className="ml-6">
                <div className="grid border-b border-gray-200 py-1.5 pr-4 text-xs font-medium text-gray-400" style={{ gridTemplateColumns: template }}>
                  <span /><span className="pl-12">Name</span>{shown.map((c) => <span key={c.key}>{c.label}</span>)}{fields.map((f) => <span key={f.id} className="truncate pr-2">{f.name}</span>)}
                  {onAddColumn && (
                    <button type="button" title="Add a column" aria-label="Add a column" onClick={onAddColumn}
                      className="flex h-5 w-5 items-center justify-center rounded-full text-brand-600 hover:bg-brand-50"><Plus size={14} /></button>
                  )}
                </div>
                {group.tasks.map((t) => renderRow(t, 0))}
                {(() => {
                  // ClickUp's "Calculate" row: totals for the time columns.
                  const est = group.tasks.reduce((n, t) => n + (t.time_estimate_seconds ?? 0), 0);
                  const tracked = group.tasks.reduce((n, t) => n + (t.time_tracked_seconds ?? 0), 0);
                  if (!est && !tracked) return null;
                  return (
                    <div className="grid py-1.5 pr-4 text-xs text-gray-500" style={{ gridTemplateColumns: template }} aria-label={`Totals for ${group.status.name}`}>
                      <span /><span />
                      {shown.map((c) => (
                        <span key={c.key}>
                          {c.key === 'time_estimate' && est ? formatDuration(est) : c.key === 'time_tracked' && tracked ? formatDuration(tracked) : ''}
                        </span>
                      ))}
                    </div>
                  );
                })()}
                {canAddIn(group.key) && (
                  adding === group.key ? (
                    <form onSubmit={(e) => submit(e, group.key)} className="flex items-center gap-2 border-b border-gray-100 py-2 pl-9 pr-4">
                      <StatusDot status={group.status} />
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => !draft && setAdding(null)}
                        onKeyDown={(e) => e.key === 'Escape' && setAdding(null)}
                        placeholder="Task name — press Enter to save"
                        className="flex-1 text-sm focus:outline-none"
                      />
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setAdding(group.key); setDraft(''); }}
                      className="flex w-full items-center gap-2 py-2 pl-9 text-sm text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                    >
                      {/* Named after the group, as in ClickUp: "Add Adhoc Task", "Add Meeting". */}
                      <Plus size={14} /> Add {groupsMatter && group.key !== NO_GROUP ? group.status.name : 'Task'}
                    </button>
                  )
                )}
              </div>
            )}
          </section>
        );
      })}
      </div>
    </div>
  );
};

/** ClickUp's "Time tracked" cell: the task's total, with a play/stop timer button. */
export const TimeTrackedCell: React.FC<{ task: Task }> = ({ task }) => {
  const { timer, start, stop } = useRunningTimer();
  const mine = timer?.entry.task_id === task.id;
  const now = useNow(mine);
  const canTrack = task.permission_level === 'edit' || task.permission_level === 'full';
  const run = (e: React.MouseEvent, action: () => Promise<void>) => {
    e.stopPropagation();
    action().catch((err) => notify.error(err));
  };
  if (mine && timer) {
    const elapsed = (now - new Date(timer.entry.started_at).getTime()) / 1000;
    return (
      <button type="button" title="Stop timer" onClick={(e) => run(e, stop)} className="flex items-center gap-1.5 text-red-600">
        <span className="rounded-full bg-red-500 p-1 text-white"><Square size={8} fill="currentColor" /></span>
        <span className="font-mono text-xs tabular-nums">{formatClock(elapsed)}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      title={canTrack ? 'Start timer' : 'You need edit access to track time'}
      disabled={!canTrack}
      onClick={(e) => run(e, () => start(task.id))}
      className="group/time flex items-center gap-1.5 text-gray-500 disabled:cursor-default"
    >
      <span className="rounded-full border border-gray-300 p-1 text-gray-400 group-hover/time:border-brand-400 group-hover/time:text-brand-600">
        <Play size={8} fill="currentColor" />
      </span>
      <span className={task.time_tracked_seconds ? 'text-gray-700' : 'text-gray-400'}>
        {formatDuration(task.time_tracked_seconds) || 'Add time'}
      </span>
    </button>
  );
};
