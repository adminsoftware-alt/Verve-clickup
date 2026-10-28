import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, CalendarClock, Check, CheckSquare, ChevronsDownUp, ChevronsUpDown, OctagonAlert, ChevronDown, ChevronRight, GitBranch, Hourglass, Layers3, MessageSquare, Paperclip, Play, Plus, Repeat, Square } from 'lucide-react';
import { workApi, type CustomField, type Status, type Task, type TaskInput, type UserRef } from '../api';
import { AvatarStack, Menu, PRIORITIES, PriorityFlag, StatusDot, StatusPill, formatDue, formatDuration, fromDateInput, parseDuration } from '../ui';
import { DateField } from '../DateField';
import { ASSIGNEES, PickCell } from './TableView';
import { formatClock, useNow, useRunningTimer } from '../RunningTimer';
import { NO_GROUP, type GroupBy, type StatusGroupOfTasks } from './grouping';
import { COLUMNS, type ColumnKey } from './viewSettings';
import { usePhone } from '../useBreakpoint';
import { FieldEditor, fieldApplies } from '../fields/FieldValue';
import { useWork } from '../WorkContext';
import { TypeIcon } from '../LocationSettings';
import { notify } from '../../components/notify';
import { ask } from '../../components/ask';
import { RowMenu } from './RowMenu';
import { parseQuickAdd } from './quickAdd';
import { useUnreadTasks } from './useUnreadTasks';

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
  /** Why there is nothing to show, so the empty state can say something true. */
  /** Given, a row's fields edit in place -- status, assignees, dates, priority, estimate -- and
   *  this is called once a change is saved. Clicking the name still opens the whole task. */
  onChanged?: () => void;
  emptyBecause?: 'filters' | 'none-assigned' | 'nothing-here';
  /** `extra` is what quick add understood from the words typed: a date, @someone, !high, 2h. */
  onCreate: (name: string, key: string, extra?: TaskInput) => Promise<void>;
  onOpenTask: (id: string) => void;
  columns: ColumnKey[];
  fields: CustomField[]; // custom field columns to show
  people: UserRef[];
  onSetField: (taskId: string, fieldId: string, value: unknown) => void;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
  /** The "+" at the end of the column headers: add a column (a custom field). */
  onAddColumn?: () => void;
  /** Given, rows can be dragged: to a new place in their group, or into another group. */
  onMoveRow?: (taskId: string, orderindex: number, toGroupKey: string | null) => Promise<void>;
}> = ({ tasks: incoming, statuses, listName, groupBy, makeGroups, canAddIn, onCreate, onManageGroups, onOpenTask, columns, fields, people, onSetField, selected, onSelect, onAddColumn, onChanged, emptyBecause, onMoveRow }) => {
  // An edit shows at once -- the list can take a while to come back -- and fresh data from the
  // server replaces it. A failed save puts the old value back and says why.
  const [local, setLocal] = useState<Record<string, Partial<Task>>>({});
  const tasks = useMemo(() => incoming.map((t) => ({ ...t, ...(local[t.id] ?? {}) })), [incoming, local]);
  useEffect(() => setLocal({}), [incoming]);
  const [listStatuses, setListStatuses] = useState<Record<string, Status[]>>({});
  const editable = (t: Task) => !!onChanged && (t.permission_level === 'edit' || t.permission_level === 'full');
  // A problem with one cell is said under that cell, not in a banner at the top of the page.
  const [cellNote, setCellNote] = useState<{ id: string; key: string; text: string; bad: boolean } | null>(null);
  const noteTimer = useRef<number | undefined>(undefined);
  const flagCell = (id: string, key: string, text: string, bad: boolean) => {
    setCellNote({ id, key, text, bad });
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setCellNote(null), 4000);
  };
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);
  const noteFor = (id: string, key: string) => (cellNote?.id === id && cellNote.key === key ? (
    <p role="alert" className={`absolute left-0 top-full z-10 mt-0.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium shadow-sm ring-1 ${
      cellNote.bad ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-amber-50 text-amber-800 ring-amber-200'}`}>{cellNote.text}</p>
  ) : null);
  const save = async (t: Task, input: TaskInput, optimistic: Partial<Task>, cellKey?: string) => {
    setLocal((l) => ({ ...l, [t.id]: { ...(l[t.id] ?? {}), ...optimistic } }));
    try {
      await workApi.updateTask(t.id, input);
      onChanged?.();
    } catch (e) {
      setLocal((l) => { const next = { ...l }; delete next[t.id]; return next; });
      if (cellKey) flagCell(t.id, cellKey, (e as Error).message, true); else notify.error(e);
    }
  };
  const statusesFor = (t: Task) => statuses ?? listStatuses[t.list_id] ?? [t.status];
  const loadStatuses = (t: Task) => {
    if (statuses || listStatuses[t.list_id]) return;
    workApi.statuses('list', t.list_id).then((set) => setListStatuses((m) => ({ ...m, [t.list_id]: set.statuses }))).catch(() => undefined);
  };
  /** This task's List's statuses, fetched the first time they are needed. */
  const statusSet = async (t: Task): Promise<Status[]> => {
    const known = statuses ?? listStatuses[t.list_id];
    if (known) return known;
    const set = (await workApi.statuses('list', t.list_id)).statuses;
    setListStatuses((m) => ({ ...m, [t.list_id]: set }));
    return set;
  };
  // The circle offers the three steps every List has -- To do, In progress, Complete -- whatever
  // its own status names are. Complete gets a green tick that pops once.
  const [justDone, setJustDone] = useState<string | null>(null);
  const setProgress = async (t: Task, step: 'todo' | 'doing' | 'done') => {
    try {
      const set = [...(await statusSet(t))].sort((a, b) => a.orderindex - b.orderindex);
      const target = step === 'todo' ? set.find((st) => st.group === 'not_started')
        : step === 'doing' ? set.find((st) => st.group === 'active')
        : set.find((st) => st.group === 'closed') ?? set.find((st) => st.group === 'done');
      if (!target || target.id === t.status.id) return;
      if (step === 'done') setJustDone(t.id);
      save(t, { status_id: target.id }, { status: target });
    } catch (e) { notify.error(e); }
  };
  /** A start or due date changed in place, checked against the other one first. */
  const changeDate = (task: Task, key: 'start_date' | 'due_date', iso: string | null) => {
    const start = (key === 'start_date' ? iso : task.start_date)?.slice(0, 10);
    const due = (key === 'due_date' ? iso : task.due_date)?.slice(0, 10);
    if (start && due && due < start) {
      flagCell(task.id, key, key === 'due_date' ? 'Due date is before the start date' : 'Start date is after the due date', true);
      return;
    }
    // Back-dating is allowed (work already under way), so this one is said, not refused.
    if (key === 'start_date' && iso && iso.slice(0, 10) < todayIso()) flagCell(task.id, key, 'Start date is in the past', false);
    else if (cellNote?.id === task.id) setCellNote(null);
    save(task, { [key]: iso }, { [key]: iso }, key);
  };
  const [rowMenu, setRowMenu] = useState<{ task: Task; at: { x: number; y: number } } | null>(null);
  const unread = useUnreadTasks();
  // Dragging a row: which one, and which row (or group header) it would land above.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);
  /** A cell that edits in place: a click inside it does not open the task. */
  const stay = (e: React.SyntheticEvent) => e.stopPropagation();
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
  // Below `md` the grid is 1,058px of sideways dragging, so the rows become cards instead.
  const phone = usePhone();
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
    const q = parseQuickAdd(draft, people);
    await onCreate(q.name, key, q.input);
    setDraft('');
  };
  /** Several lines pasted at once -- from Excel, an email -- become one task each. */
  const pasteMany = async (e: React.ClipboardEvent<HTMLInputElement>, key: string) => {
    const lines = e.clipboardData.getData('text').split(/\r?\n/).map((l) => l.split('\t')[0].trim()).filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    if (!(await ask.confirm({ title: `Add ${lines.length} tasks?`, body: lines.slice(0, 5).join('\n') + (lines.length > 5 ? `\n…and ${lines.length - 5} more` : '') }))) return;
    for (const line of lines) {
      const q = parseQuickAdd(line, people);
      await onCreate(q.name, key, q.input);
    }
    setDraft('');
    notify.ok(`Added ${lines.length} tasks`);
  };

  const cell = (key: ColumnKey, task: Task): React.ReactNode => {
    // A task typed in as a name alone is a real task; it just is not finished being described.
    // The columns it still needs say so here, in place, rather than a dialog having refused to
    // make it in the first place.
    const needed = NEEDS.includes(key) && missing(task).includes(key);
    const Wanted = () => (
      <span
        data-wanted
        className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-amber-300 bg-amber-50/70 px-1.5 py-0.5 text-[11px] font-medium text-amber-700"
        title="Open the task to fill this in"
      >
        <Plus size={11} /> Add
      </span>
    );
    if (editable(task)) {
      const flag = (p: number | null) => <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p ? PRIORITIES[p].color : '#D1D5DB' }} />;
      switch (key) {
        case 'assignee': return (
          <div key={key} className="min-w-0 pr-2" onClick={stay}>
            <FieldEditor compact field={{ ...ASSIGNEES, name: `Assignees of ${task.name}` }} value={task.assignees.map((u) => u.id)} people={people}
              onChange={(v) => {
                const ids = (v as string[] | null) ?? [];
                save(task, { assignees: ids }, { assignees: people.filter((u) => ids.includes(u.id)) });
              }} />
          </div>
        );
        case 'start_date':
        case 'due_date': return (
          <div key={key} className="relative flex min-w-0 items-center gap-0.5 pr-2" onClick={stay} data-late={key === 'due_date' && task.is_overdue ? '' : undefined}>
            <DateField
              value={key === 'start_date' ? task.start_date : task.due_date}
              label={`${key === 'start_date' ? 'Start' : 'Due'} date of ${task.name}`}
              overdue={key === 'due_date' && task.is_overdue}
              format="compact"
              placeholder="—"
              onChange={(iso) => changeDate(task, key, iso)}
            />
            {/* Late: move it on in one click rather than through the calendar. */}
            {key === 'due_date' && task.is_overdue && (
              <Menu
                label={`Reschedule ${task.name}`}
                triggerClassName="inline-flex shrink-0"
                items={[
                  { label: 'Today', icon: <CalendarClock size={14} />, onClick: () => changeDate(task, key, fromDateInput(shiftIso(0))) },
                  { label: 'Tomorrow', icon: <CalendarClock size={14} />, onClick: () => changeDate(task, key, fromDateInput(shiftIso(1))) },
                  { label: 'Next Monday', icon: <CalendarClock size={14} />, onClick: () => changeDate(task, key, fromDateInput(shiftIso(((8 - new Date().getDay()) % 7) || 7))) },
                ]}
                trigger={<span aria-label="Reschedule" className="vf-resched flex rounded-md p-1 text-red-500 hover:bg-red-50"><CalendarClock size={13} /></span>}
              />
            )}
            {noteFor(task.id, key)}
          </div>
        );
        case 'priority': return (
          <div key={key} className="min-w-0 pr-2" onClick={stay} data-priority={task.priority ?? 0}>
            <PickCell
              label={`Priority of ${task.name}`}
              current={<>{flag(task.priority)}<span className="truncate text-[13px]" style={{ color: task.priority ? PRIORITIES[task.priority].color : '#9CA3AF' }}>{task.priority ? PRIORITIES[task.priority].label : 'None'}</span></>}
              items={[1, 2, 3, 4, null].map((p) => ({
                key: String(p ?? 'none'), label: p ? PRIORITIES[p].label : 'No priority', icon: flag(p),
                on: (task.priority ?? null) === p, onPick: () => save(task, { priority: p }, { priority: p }),
              }))}
            />
          </div>
        );
        case 'time_estimate': return (
          <div key={key} className="relative min-w-0 pr-2" onClick={stay}>
            <EstimateInput
              key={task.time_estimate_seconds ?? ''}
              task={task}
              onBad={() => flagCell(task.id, key, 'Write estimates like 1h 30m', true)}
              onSave={(secs) => save(task, { time_estimate_seconds: secs }, { time_estimate_seconds: secs }, key)}
            />
            {noteFor(task.id, key)}
          </div>
        );
      }
    }
    switch (key) {
      case 'custom_id': return <div key={key} className="font-mono text-xs text-gray-500">{task.custom_id ?? ''}</div>;
      case 'assignee': return <div key={key}>{needed ? <Wanted /> : <AvatarStack users={task.assignees} />}</div>;
      case 'start_date': return <div key={key} className="text-gray-600">{needed ? <Wanted /> : formatDue(task.start_date)}</div>;
      case 'due_date': return <div key={key} className={task.is_overdue ? 'text-red-600' : 'text-gray-600'} data-late={task.is_overdue ? '' : undefined}>{needed ? <Wanted /> : formatDue(task.due_date)}</div>;
      case 'priority': return <div key={key} data-priority={task.priority ?? 0}>{needed ? <Wanted /> : <PriorityFlag priority={task.priority} />}</div>;
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
          {task.tags.map((tag) => <span key={tag.id} data-tag className="rounded px-1.5 py-px text-[11px] font-medium" style={{ backgroundColor: tag.bg_color, color: tag.fg_color, '--tag': tag.bg_color } as React.CSSProperties}>{tag.name}</span>)}
        </div>
      );
      case 'created_at': return <div key={key} className="text-gray-600">{formatDue(task.created_at)}</div>;
    }
  };

  /**
   * One task as two lines. Only the facts worth a glance: a phone is for deciding what to do
   * next, not for auditing a time estimate.
   */
  const renderCard = (task: Task, depth: number): React.ReactNode => {
    const kids = children.get(task.id) ?? [];
    const open = expandedTasks.has(task.id);
    const isSelected = selected.has(task.id);
    const closed = task.status.group === 'closed';
    const due = task.due_date ? new Date(task.due_date) : null;
    const late = !!due && !closed && due < new Date();
    // The full breadcrumb is three folders deep -- "VAPL Common Operation Tasks / Monthly Review
    // / PMS - Dev" truncates to the first folder, which every task shares. The List is the part
    // that tells them apart.
    const full = statuses ? null : listName(task.list_id);
    const where = full ? full.split(' / ').pop() : null;
    return (
      <React.Fragment key={task.id}>
        <div
          onClick={() => onOpenTask(task.id)}
          className={`tap-row flex cursor-pointer items-start gap-2.5 border-b border-gray-100 py-2.5 pr-1 text-sm ${isSelected ? 'bg-brand-50/60' : 'active:bg-gray-50'}`}
          style={{ paddingLeft: depth * 16 }}
        >
          {selecting && (
            <span className="flex pt-1" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" aria-label={`Select ${task.name}`} checked={isSelected}
                onChange={(e) => onSelect([task.id], e.target.checked)} />
            </span>
          )}
          <span className="flex shrink-0 pt-1"><StatusDot status={task.status} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5">
              <span className={`min-w-0 flex-1 break-words ${closed ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{task.name}</span>
              {task.priority ? <span className="shrink-0 pt-0.5"><PriorityFlag priority={task.priority} withLabel={false} /></span> : null}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
              {where && <span className="max-w-[55%] truncate">{where}</span>}
              {due && (
                <span className={late ? 'font-medium text-red-600' : ''}>{formatDue(task.due_date)}</span>
              )}
              {task.assignees.length > 0 && <AvatarStack users={task.assignees} max={3} />}
              {task.subtask_count > 0 && <span className="inline-flex items-center gap-0.5"><GitBranch size={11} />{task.subtask_count}</span>}
              {!!task.checklist_total && (
                <span className={`inline-flex items-center gap-0.5 ${task.checklist_done === task.checklist_total ? 'text-emerald-600' : ''}`}>
                  <CheckSquare size={11} />{task.checklist_done}/{task.checklist_total}
                </span>
              )}
              {!!task.comment_count && <span className="inline-flex items-center gap-0.5"><MessageSquare size={11} />{task.comment_count}</span>}
              {!!task.attachment_count && <span className="inline-flex items-center gap-0.5"><Paperclip size={11} />{task.attachment_count}</span>}
              {!!task.waiting_on_open && <span title="Waiting on unfinished work" className="text-red-500"><Ban size={11} /></span>}
              {task.recurrence && <span title="Repeats" className="text-brand-500"><Repeat size={11} /></span>}
              {task.tags.map((tag) => (
                <span key={tag.id} className="rounded px-1.5 py-px font-medium" style={{ backgroundColor: tag.bg_color, color: tag.fg_color }}>{tag.name}</span>
              ))}
            </div>
          </div>
          {kids.length > 0 && (
            <button
              type="button" aria-label={open ? `Hide the subtasks of ${task.name}` : `Show the subtasks of ${task.name}`}
              onClick={(e) => { e.stopPropagation(); toggle(expandedTasks, task.id, setExpandedTasks); }}
              className="tap -mr-1 shrink-0 self-center rounded-lg text-gray-400"
            >
              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          )}
        </div>
        {open && kids.map((kid) => renderCard(kid, depth + 1))}
      </React.Fragment>
    );
  };

  const renderRow = (task: Task, depth: number): React.ReactNode => {
    const kids = children.get(task.id) ?? [];
    const open = expandedTasks.has(task.id);
    // Above a single List every row shares the same three-folder path, so only the List -- the part
    // that tells two rows apart -- is shown, beside the name rather than on a line of its own.
    const location = statuses ? null : listName(task.list_id)?.split(' / ').pop();
    const isSelected = selected.has(task.id);
    return (
      <React.Fragment key={task.id}>
        <div
          onClick={() => onOpenTask(task.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setRowMenu({ task, at: { x: e.clientX, y: e.clientY } });
            if (editable(task)) loadStatuses(task);
          }}
          draggable={!!onMoveRow && depth === 0 && editable(task)}
          onDragStart={(e) => { setDragId(task.id); e.dataTransfer.effectAllowed = 'move'; }}
          onDragEnd={() => { setDragId(null); setDropAt(null); }}
          onDragOver={(e) => { if (dragId && dragId !== task.id) { e.preventDefault(); setDropAt(task.id); } }}
          onDrop={(e) => { e.preventDefault(); dropOn(task.id); }}
          data-task-row
          data-drop={dropAt === task.id ? '' : undefined}
          data-dragging={dragId === task.id ? '' : undefined}
          className={`group/row grid cursor-pointer items-center border-b border-gray-100 py-2 pr-4 text-sm ${isSelected ? 'bg-brand-50/60' : 'hover:bg-gray-50'}`}
          style={{ gridTemplateColumns: template }}
        >
          <span className="flex justify-center" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              aria-label={`Select ${task.name}`}
              checked={isSelected}
              onChange={(e) => onSelect([task.id], e.target.checked)}
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
            {editable(task) ? (
              // To do / In progress / Complete; any other status is a right-click away (Status ›).
              <span onClick={stay} onMouseEnter={() => loadStatuses(task)} className="relative flex">
                <Menu
                  label={`Progress of ${task.name}`}
                  width={170}
                  items={[
                    { label: 'To do', icon: <span className="h-3 w-3 rounded-full border-2 border-dashed border-gray-400" />, onClick: () => setProgress(task, 'todo') },
                    { label: 'In progress', icon: <span className="h-3 w-3 rounded-full border-2 border-blue-500 bg-blue-100" />, onClick: () => setProgress(task, 'doing') },
                    { label: 'Complete', icon: <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#16A34A] text-white"><Check size={9} strokeWidth={3.5} /></span>, onClick: () => setProgress(task, 'done') },
                  ]}
                  trigger={(
                    <span className="relative flex rounded-full p-0.5 hover:bg-gray-200">
                      <StatusDot status={task.status} />
                      {(task.status.group === 'closed' || task.status.group === 'done') && (
                        <Check size={10} strokeWidth={3.5} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white" />
                      )}
                    </span>
                  )}
                />
                {/* The green tick: pops in over the circle, rings out once, and fades. */}
                {justDone === task.id && (
                  <span className="vf-done-burst pointer-events-none absolute left-1/2 top-1/2 flex h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#16A34A] text-white"
                    onAnimationEnd={() => setJustDone(null)}>
                    <Check size={11} strokeWidth={3.5} />
                  </span>
                )}
              </span>
            ) : <StatusDot status={task.status} />}
            {taskTypeOf(task) && <TypeIcon type={taskTypeOf(task)!} />}
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                {unread.has(task.id) && <span role="img" aria-label="Unread comments" className="h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
                <span className={`truncate ${task.status.group === 'closed' ? 'text-gray-400 line-through' : unread.has(task.id) ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{task.name}</span>
                {location && <span data-list-chip className="max-w-[12rem] shrink-0 truncate rounded bg-gray-100 px-1.5 py-px text-[11px] text-gray-500">{location}</span>}
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
                  <span key={tag.id} data-tag className="shrink-0 rounded px-1.5 py-px text-[11px] font-medium" style={{ backgroundColor: tag.bg_color, color: tag.fg_color, '--tag': tag.bg_color } as React.CSSProperties}>
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

  /** Puts the dragged row above `targetId` -- a row, or a group's header for the end of it. */
  const dropOn = (targetId: string) => {
    const from = dragId;
    setDragId(null);
    setDropAt(null);
    if (!from || !onMoveRow || from === targetId) return;
    const fromGroup = groups.find((g) => g.tasks.some((t) => t.id === from));
    const header = groups.find((g) => `head:${g.key}` === targetId);
    const toGroup = header ?? groups.find((g) => g.tasks.some((t) => t.id === targetId));
    if (!toGroup) return;
    const others = toGroup.tasks.filter((t) => t.id !== from);
    let orderindex: number;
    if (header) {
      orderindex = others.length ? Math.max(...others.map((t) => t.orderindex)) + 1 : 1;
    } else {
      const i = others.findIndex((t) => t.id === targetId);
      const before = others[i - 1];
      orderindex = before ? (before.orderindex + others[i].orderindex) / 2 : others[i].orderindex - 1;
    }
    onMoveRow(from, orderindex, fromGroup?.key === toGroup.key ? null : toGroup.key).catch((e) => notify.error(e));
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
    // Three different nothings, and they want three different answers. "Open a List to add one"
    // was the old catch-all, and a member cannot act on it -- making Spaces and Lists is a
    // manager's job, so it read as an instruction they were failing to follow.
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm text-gray-500">
          {statuses ? 'No tasks match what you are filtering by.'
            : emptyBecause === 'filters' ? 'No tasks match what you are filtering by.'
            : emptyBecause === 'none-assigned' ? 'Nothing is assigned to you right now.'
            : 'No tasks here yet.'}
        </p>
        {!statuses && emptyBecause === 'none-assigned' && (
          <p className="mt-1 text-xs text-gray-400">
            Work turns up here when someone puts your name on it.
          </p>
        )}
        {!statuses && emptyBecause === 'filters' && (
          <p className="mt-1 text-xs text-gray-400">Clear a filter to widen it.</p>
        )}
      </div>
    );
  }

  return (
    <div className={phone ? 'px-3 pb-24' : 'scroll-x px-6 pb-24'} data-group-by={groupBy}>
      <div style={phone ? undefined : { minWidth: 440 + shown.reduce((n, c) => n + parseInt(c.width, 10), 0) + fields.length * 160 + (onAddColumn ? 36 : 0) }}>
      {(groups.length > 1 || (emptyCount > 0 && allGroups.some((g) => g.tasks.length > 0))) && (
        <div className="mt-3 flex items-center justify-end gap-3">
          {emptyCount > 0 && allGroups.some((g) => g.tasks.length > 0) && (
            <button type="button" onClick={() => setShowEmpty(!showEmpty)} className="text-xs text-gray-400 hover:text-gray-700">
              {showEmpty ? 'Hide empty groups' : `Show ${emptyCount} empty group${emptyCount === 1 ? '' : 's'}`}
            </button>
          )}
          {groups.length > 1 && (
            collapsed.size >= groups.length ? (
              <button type="button" onClick={() => setCollapsed(new Set())} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
                <ChevronsUpDown size={13} /> Expand all
              </button>
            ) : (
              <button type="button" onClick={() => setCollapsed(new Set(groups.map((g) => g.key)))} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
                <ChevronsDownUp size={13} /> Collapse all
              </button>
            )
          )}
        </div>
      )}
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key);
        const ids = group.tasks.map((t) => t.id);
        const allOn = ids.length > 0 && ids.every((x) => selected.has(x));
        return (
          <section key={group.key} className="mt-5" aria-label={`${group.status.name} group`}>
            <div
              className="group/head mb-1 flex items-center gap-2"
              data-drop={dropAt === `head:${group.key}` ? '' : undefined}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropAt(`head:${group.key}`); } }}
              onDrop={(e) => { e.preventDefault(); dropOn(`head:${group.key}`); }}
            >
              <button type="button" onClick={() => toggle(collapsed, group.key, setCollapsed)} className="text-gray-400 hover:text-gray-700">
                {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>
              <StatusPill status={group.status} />
              <span className="text-sm text-gray-400">{group.tasks.length}</span>
              {/* On a phone there is no header row to hold it, so it stays beside the group's name. */}
              {phone && ids.length > 0 && (
                <label className="ml-1 flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" aria-label={`Select all in ${group.status.name}`} checked={allOn} onChange={(e) => onSelect(ids, e.target.checked)} /> Select all
                </label>
              )}
            </div>
            {!isCollapsed && (
              <div className={phone ? '' : 'ml-6'}>
                {!phone && (
                  <div className="grid items-center border-b border-gray-200 py-1.5 pr-4 text-xs font-medium text-gray-400" style={{ gridTemplateColumns: template }}>
                    {/* Select all sits in the checkbox column, straight above the rows' own boxes. */}
                    <span className="flex justify-center">
                      {ids.length > 0 && (
                        <input
                          type="checkbox"
                          aria-label={`Select all in ${group.status.name}`}
                          checked={allOn}
                          ref={(el) => { if (el) el.indeterminate = !allOn && ids.some((x) => selected.has(x)); }}
                          onChange={(e) => onSelect(ids, e.target.checked)}
                        />
                      )}
                    </span>
                    <span className="pl-12">Name</span>{shown.map((c) => <span key={c.key}>{c.label}</span>)}{fields.map((f) => <span key={f.id} className="truncate pr-2">{f.name}</span>)}
                    {onAddColumn && (
                      <button type="button" title="Add a column" aria-label="Add a column" onClick={onAddColumn}
                        className="flex h-5 w-5 items-center justify-center rounded-full text-brand-600 hover:bg-brand-50"><Plus size={14} /></button>
                    )}
                  </div>
                )}
                {group.tasks.map((t) => (phone ? renderCard(t, 0) : renderRow(t, 0)))}
                {canAddIn(group.key) && (
                  adding === group.key ? (
                    <form onSubmit={(e) => submit(e, group.key)} className="border-b border-gray-100 py-2 pl-9 pr-4">
                      <div className="flex items-center gap-2">
                        <StatusDot status={group.status} />
                        <input
                          autoFocus
                          aria-label="New task name"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onPaste={(e) => pasteMany(e, group.key)}
                          onBlur={() => !draft && setAdding(null)}
                          onKeyDown={(e) => e.key === 'Escape' && setAdding(null)}
                          placeholder="Task name — try “tomorrow !high @name 2h”, or paste several lines"
                          className="flex-1 bg-transparent text-sm focus:outline-none"
                        />
                      </div>
                      {/* What was understood so far, so a date or a person is not a surprise. */}
                      {(() => {
                        const q = draft.trim() ? parseQuickAdd(draft, people) : null;
                        return q && q.chips.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-6">
                            {q.chips.map((c) => <span key={c} className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-brand-100">{c}</span>)}
                            <span className="text-[11px] text-gray-400">→ “{q.name}”</span>
                          </div>
                        ) : null;
                      })()}
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
      {rowMenu && (
        <RowMenu
          task={rowMenu.task}
          at={rowMenu.at}
          statuses={statusesFor(rowMenu.task)}
          canEdit={editable(rowMenu.task)}
          onOpen={() => onOpenTask(rowMenu.task.id)}
          onStatus={(st) => save(rowMenu.task, { status_id: st.id }, { status: st })}
          onChanged={() => onChanged?.()}
          onClose={() => setRowMenu(null)}
        />
      )}
    </div>
  );
};

/** Today plus `days`, as YYYY-MM-DD in this browser's own time zone. */
function shiftIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today as YYYY-MM-DD in this browser's own time zone. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The estimate typed in place. A bare number could be any unit, so while one is typed the three
 * are offered under it -- 2h, 2m, 2s -- and Enter takes hours, as it always did.
 */
const EstimateInput: React.FC<{ task: Task; onSave: (secs: number | null) => void; onBad: () => void }> = ({ task, onSave, onBad }) => {
  const [text, setText] = useState(formatDuration(task.time_estimate_seconds));
  const [focused, setFocused] = useState(false);
  const bare = /^\d+(\.\d+)?$/.test(text.trim());
  const commit = (value: string) => {
    const t = value.trim();
    const secs = t ? parseDuration(t) : null;
    if (t && secs === null) { onBad(); setText(formatDuration(task.time_estimate_seconds)); return; }
    setText(formatDuration(secs));
    if (secs !== (task.time_estimate_seconds ?? null)) onSave(secs);
  };
  const box = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={box}
        aria-label={`Time estimate of ${task.name}`}
        value={text}
        placeholder="—"
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(text); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') box.current?.blur();
          if (e.key === 'Escape') { setText(formatDuration(task.time_estimate_seconds)); setFocused(false); }
        }}
        className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-gray-600 placeholder:text-gray-300 hover:border-gray-200 focus:border-brand-400 focus:bg-white focus:outline-none"
      />
      {focused && bare && (
        <div role="group" aria-label="Unit" className="absolute left-0 top-full z-10 mt-1 flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-md">
          {(['h', 'm', 's'] as const).map((u) => (
            <button
              key={u}
              type="button"
              // On mouse-down, before the box loses focus, so the blur does not save it as hours first.
              onMouseDown={(e) => { e.preventDefault(); setText(`${text.trim()}${u}`); setTimeout(() => box.current?.blur()); }}
              className="rounded-md px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-brand-50 hover:text-brand-700"
            >
              {text.trim()}{u}
            </button>
          ))}
        </div>
      )}
    </>
  );
};

/** ClickUp's "Time tracked" cell: the task's total, with a play/stop timer button. */
export const TimeTrackedCell: React.FC<{ task: Task }> = ({ task }) => {
  const { timer, start, stop } = useRunningTimer();
  const mine = timer?.entry.task_id === task.id;
  const now = useNow(mine);
  const canTrack = task.permission_level === 'edit' || task.permission_level === 'full';
  const over = !!task.time_estimate_seconds && task.time_tracked_seconds > task.time_estimate_seconds;
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
      {/* Past its estimate, the number says so. */}
      <span className={over ? 'font-medium text-red-600' : task.time_tracked_seconds ? 'text-gray-700' : 'text-gray-400'}>
        {formatDuration(task.time_tracked_seconds) || 'Add time'}
      </span>
    </button>
  );
};
