import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive, CalendarDays, Check, ChevronDown, ChevronRight, CircleDot, Flag, Hourglass, Lock, Repeat, Share2,
  Play, Shapes, Tag as TagIcon, Timer, Users, X,
} from 'lucide-react';
import { useWork, useMe } from './WorkContext';
import { useAuth } from '../components/AuthContext';
import { workApi, type Status, type Task, type TaskDetail, type TaskGroup, type TaskInput, type UserRef } from './api';
import { Menu, PRIORITIES, Portal, StatusDot, formatDuration, useEscapeToClose } from './ui';
import { ShareDialog } from './ShareDialog';
import { AssigneePicker } from './task/AssigneePicker';
import { rememberTask } from './recent';
import { RecurrenceEditor } from './RecurrenceEditor';
import { TaskFeed } from './task/TaskFeed';
import { Attachments, Checklists } from './task/TaskSections';
import { FieldEditor, fieldIcon } from './fields/FieldValue';
import { FieldsDialog } from './fields/FieldsDialog';
import { RichTextEditor } from './task/RichText';
import { TaskRelations } from './task/TaskLinks';
import { Select } from './Select';
import { TrackTime } from './task/TrackTime';
import { Subtasks } from './task/Subtasks';
import { LayoutSwitch, SHELL, usePanelLayout } from './task/LayoutSwitch';
import { Popover } from './timesheets/pieces';
import { DurationInput } from './DurationInput';
import { FEATURES } from '../config/features';
import { TaskTypesDialog, TypeIcon } from './LocationSettings';
import { TaskActions } from './task/TaskActions';
import { LeaveWarning } from './leave/LeaveWarning';
import { DateRange } from './DateField';
import { TaskLists, TimeInStatusSection } from './task/TaskMore';
import { Bar } from './Skeleton';
import { ask } from '../components/ask';

/**
 * One labelled field.
 *
 * Ten of these in a single column pushed the description off the screen, and folding the empty
 * ones away only traded one problem for another: a field you cannot see is a field nobody fills
 * in. So they go two to a line instead. `wide` is for the ones whose value is a row of chips and
 * needs the full width -- people and tags.
 */
const Field: React.FC<{ label: string; icon?: React.ReactNode; wide?: boolean; children: React.ReactNode }> = ({ label, icon, wide, children }) => (
  // The whole row lights up, not just the control: the label is part of what you are aiming at,
  // and a hover that stops halfway across reads as two things rather than one field.
  <div className={`group/field grid min-h-9 grid-cols-[104px_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 transition-colors hover:bg-gray-50 ${wide ? 'md:col-span-2' : ''}`}>
    <span className="flex items-center gap-1.5 text-[12px] font-medium text-gray-500 transition-colors group-hover/field:text-gray-700">
      {icon && <span className="shrink-0 text-gray-400">{icon}</span>}
      <span className="truncate">{label}</span>
    </span>
    <div className="min-w-0">{children}</div>
  </div>
);

/**
 * A dropdown drawn by us rather than by the operating system.
 *
 * A native <select> renders its open list in the OS, so the status colours and priority flags --
 * the whole reason these fields are quick to read -- disappear at the moment you are choosing
 * between them. This keeps them.
 */
const Picker: React.FC<{
  label: string;
  current: React.ReactNode;
  disabled?: boolean;
  items: { key: string; label: string; icon?: React.ReactNode; on: boolean; onPick: () => void }[];
}> = ({ label, current, disabled, items }) => {
  if (disabled) return <span className="flex h-7 items-center gap-2 px-2 text-sm">{current}</span>;
  return (
    <Menu
      align="left"
      label={label}
      width={230}
      triggerClassName="flex w-full min-w-0"
      items={items.map((i) => ({
        label: i.label,
        icon: (
          <span className="flex items-center gap-1.5">
            {i.on ? <Check size={12} className="text-brand-600" /> : <span className="w-3" />}
            {i.icon}
          </span>
        ),
        onClick: i.onPick,
      }))}
      trigger={
        <span className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 text-sm text-gray-800 hover:border-gray-200 hover:bg-white">
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{current}</span>
          <ChevronDown size={13} className="shrink-0 text-gray-300 group-hover/field:text-gray-500" />
        </span>
      }
    />
  );
};

/** Every control in the panel is the same height and shows its edges only under the pointer. */
const inputClass =
  'h-7 w-full rounded-md border border-transparent bg-transparent px-2 text-sm text-gray-800 hover:border-gray-200 hover:bg-gray-50 focus:border-brand-400 focus:bg-white focus:outline-none';

export const TaskPanel: React.FC<{ taskId: string; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }> = ({
  taskId,
  onClose,
  onChanged,
  onOpen,
}) => {
  const { members, hierarchy, taskTypes, refresh: refreshWork } = useWork();
  const isWorkspaceAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
  const { user } = useAuth();
  const meId = useMe();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [sharing, setSharing] = useState(false);
  const [layout, setLayout] = usePanelLayout();
  // Only the full-screen shape is wide enough to carry a second column.
  const sideBySide = layout === 'full';
  const [feedKey, setFeedKey] = useState(0);
  const [managingFields, setManagingFields] = useState(false);
  const [managingTypes, setManagingTypes] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // As in ClickUp, only people who can open the List can be given the task.
  const [assignable, setAssignable] = useState<UserRef[] | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await workApi.task(taskId);
      setTask(t);
      rememberTask(t.id, t.name, t.list_id);
      const [set, siblings, usable] = await Promise.all([
        workApi.statuses('list', t.list_id),
        workApi.tasks('list', t.list_id, { include_closed: true }),
        workApi.groups('list', t.list_id).catch(() => [] as TaskGroup[]),
      ]);
      setStatuses(set.statuses);
      setGroups(usable);
      setSubtasks(siblings.tasks.filter((x) => x.parent_id === t.id));
      workApi.assignable('list', t.list_id).then(setAssignable).catch(() => setAssignable(null));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [taskId]);

  const panelRef = useRef<HTMLElement>(null);
  useEscapeToClose(panelRef, onClose);

  useEffect(() => { load(); }, [load]);

  const save = async (input: TaskInput) => {
    try {
      setError(null);
      setTask(await workApi.updateTask(taskId, input));
      setFeedKey((k) => k + 1);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async () => {
    if (!task || !await ask.confirm({ danger: true, title: `Delete "${task.name}" and its subtasks?` })) return;
    await workApi.deleteTask(task.id);
    onChanged();
    onClose();
  };

  const editable = task?.permission_level === 'edit' || task?.permission_level === 'full';
  const assigneeIds = new Set(task?.assignees.map((a) => a.id));
  // As in ClickUp, an assignee with comment access can still change the status.
  const canChangeStatus = editable || (task?.permission_level === 'comment' && !!user && assigneeIds.has(meId));
  // The Space's ClickApps decide which fields show (missing = the ClickUp default).
  const apps = hierarchy?.spaces.find((sp) => sp.id === task?.location.space.id)?.clickapps ?? {};
  const on = (name: keyof typeof apps, fallback = true) => apps[name] ?? fallback;

  return (
    <Portal>
    <div className={`fixed inset-0 z-[90] flex bg-black/20 ${SHELL[layout].backdrop}`} onMouseDown={onClose}>
      <aside
        ref={panelRef}
        role="dialog"
        aria-label="Task details"
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex flex-col overflow-hidden bg-white ${SHELL[layout].panel}`}
      >
        {!task ? (
          error
            ? <div className="p-6 text-sm text-red-700">{error}</div>
            : (
              <div className="space-y-3 p-6" role="status" aria-label="Loading task">
                <Bar className="h-6 w-2/3" />
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-[104px_1fr] items-center gap-2 py-1">
                    <Bar className="h-3 w-20" /><Bar className="h-4 w-52" />
                  </div>
                ))}
                <Bar className="h-24 w-full" />
              </div>
            )
        ) : (
          <>
            <header className="flex items-center justify-between border-b border-gray-100 px-6 py-3">
              <nav className="flex min-w-0 items-center gap-1 text-xs text-gray-500">
                {hierarchy?.personal_list?.id !== task.list_id && (
                  <>
                    <span className="truncate">{task.location.space.name}</span>
                    {task.location.folder && (<><ChevronRight size={12} /><span className="truncate">{task.location.folder.name}</span></>)}
                    <ChevronRight size={12} />
                  </>
                )}
                <span className="truncate">{task.location.list.name}</span>
                {task.is_private && <Lock size={12} className="ml-1" />}
              </nav>
              <div className="flex items-center gap-1">
                <button type="button" title="Share task" onClick={() => setSharing(true)} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                  <Share2 size={16} />
                </button>
                <LayoutSwitch value={layout} onChange={setLayout} />
                <TaskActions task={task} onChanged={onChanged} onReload={() => { load(); setFeedKey((k) => k + 1); }} onOpen={onOpen} onDeleted={remove} />
                <button type="button" title="Close" onClick={onClose} className="rounded p-1.5 text-gray-400 hover:bg-gray-100">
                  <X size={18} />
                </button>
              </div>
            </header>

            {task.archived && (
              <div className="flex items-center gap-2 bg-amber-50 px-6 py-1.5 text-xs text-amber-800"><Archive size={13} /> This task is archived.</div>
            )}
            <div className="flex min-h-0 flex-1">
            {/* Full screen caps each section at a readable column rather than stretching the
                fields across a 27-inch monitor. */}
            <div className={`min-w-0 flex-1 overflow-y-auto px-6 py-4 ${layout === 'full' ? '[&>*]:mx-auto [&>*]:w-full [&>*]:max-w-5xl' : ''}`}>
              <div className="mb-1 flex items-center gap-2">
                {task.custom_id && on('custom_task_ids') && (
                  <button type="button" title="Copy task ID" onClick={() => navigator.clipboard?.writeText(task.custom_id!)}
                    className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600 hover:bg-gray-200">{task.custom_id}</button>
                )}
                {task.parent_id && (
                  <button type="button" onClick={() => onOpen(task.parent_id!)} className="text-xs text-brand-600 hover:underline">
                    ← Back to parent task
                  </button>
                )}
              </div>
              <input
                key={task.id + task.name}
                defaultValue={task.name}
                disabled={!editable}
                onBlur={(e) => e.target.value.trim() && e.target.value !== task.name && save({ name: e.target.value.trim() })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className="w-full rounded-md border border-transparent px-1 py-1 text-2xl font-semibold text-gray-900 hover:border-gray-200 focus:border-brand-400 focus:outline-none"
              />
              {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

              <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-0.5 md:grid-cols-2">
                <Field label="Status" icon={<CircleDot size={14} />}>
                  <Picker
                    label="Status"
                    disabled={!canChangeStatus}
                    current={
                      <>
                        <StatusDot status={task.status} />
                        <span className="truncate text-sm font-medium uppercase tracking-wide text-gray-800">{task.status.name}</span>
                      </>
                    }
                    items={statuses.map((st) => ({
                      key: st.id,
                      label: st.name,
                      icon: <StatusDot status={st} size={11} />,
                      on: st.id === task.status.id,
                      onPick: async () => {
                        // Like ClickUp: finishing a task that still waits on others needs a second thought.
                        if ((st.group === 'done' || st.group === 'closed') && (task.waiting_on_open ?? 0) > 0
                          && !await ask.confirm(`This task is waiting on ${task.waiting_on_open} unfinished task${task.waiting_on_open === 1 ? '' : 's'}. Mark it ${st.name} anyway?`)) return;
                        save({ status_id: st.id });
                      },
                    }))}
                  />
                </Field>
                {on('priorities') && <Field label="Priority" icon={<Flag size={14} />}>
                  <Picker
                    label="Priority"
                    disabled={!editable}
                    current={
                      <>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: task.priority ? PRIORITIES[task.priority].color : '#D1D5DB' }} />
                        <span className="truncate text-sm" style={{ color: task.priority ? PRIORITIES[task.priority].color : '#9CA3AF' }}>
                          {task.priority ? PRIORITIES[task.priority].label : 'No priority'}
                        </span>
                      </>
                    }
                    items={[...Object.entries(PRIORITIES).map(([value, p]) => ({
                      key: value,
                      label: p.label,
                      icon: <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />,
                      on: String(task.priority ?? '') === value,
                      onPick: () => save({ priority: Number(value) }),
                    })), {
                      key: 'none',
                      label: 'No priority',
                      icon: <span className="h-2 w-2 rounded-full bg-gray-300" />,
                      on: task.priority == null,
                      onPick: () => save({ priority: null }),
                    }]}
                  />
                </Field>}
                <Field label="Assignees" icon={<Users size={14} />} wide>
                  <AssigneePicker
                    listId={task.list_id}
                    assignees={task.assignees}
                    assignable={assignable}
                    editable={editable}
                    canShare={task.permission_level === 'full'}
                    multiple={on('multiple_assignees')}
                    onChange={(ids) => save({ assignees: ids })}
                    onShared={() => workApi.assignable('list', task.list_id).then(setAssignable).catch(() => undefined)}
                  />
                  <LeaveWarning dueDate={task.due_date} assignees={task.assignees} />
                </Field>
                <Field label="Dates" icon={<CalendarDays size={14} />}>
                  <DateRange
                    start={task.start_date} due={task.due_date} disabled={!editable} overdue={task.is_overdue}
                    onChange={(patch) => save(patch)}
                    recurrence={task.recurrence}
                    statuses={statuses}
                    onRecurrence={editable ? async (value) => {
                      setError(null);
                      setTask(await workApi.updateTask(taskId, { recurrence: value }));
                      onChanged();
                    } : undefined}
                  />
                </Field>

                {on('time_estimates') && <Field label="Time estimate" icon={<Hourglass size={14} />}>
                  <DurationInput
                    key={task.id + String(task.time_estimate_seconds)}
                    label="Time estimate"
                    value={task.time_estimate_seconds}
                    disabled={!editable}
                    placeholder="3, 2.30, 45m"
                    onChange={(seconds) => { if (seconds !== task.time_estimate_seconds) save({ time_estimate_seconds: seconds }); }}
                  />
                </Field>}
                {on('time_tracking') && <Field label="Track time" icon={<Timer size={14} />}>
                  {/* Beside the estimate on purpose: how long you thought it would take and how
                      long it did are the same question asked twice. */}
                  <Popover
                    width={432}
                    align="left"
                    trigger={(open) => (
                      // Just the button. The running total was on the row whether or not anyone
                      // was asking; the hours, the entries and the timer are all one click away,
                      // and the estimate beside it is the figure that is worth reading at a glance.
                      <button
                        type="button"
                        onClick={open}
                        title={task.time_tracked_seconds ? `${formatDuration(task.time_tracked_seconds)} tracked — open the timer and entries` : 'Start the timer, or add time'}
                        aria-label="Track time"
                        className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-left text-sm transition-colors ${
                          task.time_tracked_seconds
                            ? 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100'
                            : 'border-transparent text-gray-500 hover:border-gray-200 hover:bg-white'}`}
                      >
                        <Play size={13} className="shrink-0" fill={task.time_tracked_seconds ? 'currentColor' : 'none'} />
                        {!task.time_tracked_seconds && <span className="text-gray-400">Start</span>}
                      </button>
                    )}
                  >
                    {(close) => (
                      <TrackTime
                        taskId={task.id}
                        canTrack={editable}
                        onClose={close}
                        onChanged={() => { load(); onChanged(); }}
                      />
                    )}
                  </Popover>
                </Field>}
                <Field label="Type" icon={<Shapes size={14} />}>
                  <Select
                    label="Task type"
                    variant="bare"
                    disabled={!editable}
                    value={task.type_id ?? ''}
                    onChange={(v) => { if (v === '__manage') { setManagingTypes(true); return; } save({ type_id: v || null }); }}
                    choices={[
                      { value: '', label: 'Task', icon: <span className="inline-block h-2.5 w-2.5 rounded-full border border-gray-300" /> },
                      ...taskTypes.map((t) => ({ value: t.id, label: t.name, icon: <TypeIcon type={t} /> })),
                      ...(isWorkspaceAdmin ? [{ value: '__manage', label: 'Manage task types…' }] : []),
                    ]}
                  />
                </Field>
                {FEATURES.taskGroupField && <Field label="Group" icon={<Users size={14} />}>
                  <Select
                    label="Group"
                    variant="bare"
                    disabled={!editable}
                    value={task.group?.id ?? ''}
                    onChange={(v) => save({ group_id: v || null })}
                    choices={[{ value: '', label: 'No group' }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
                  />
                </Field>}
                {FEATURES.taskRepeatField && <Field label="Repeat" icon={<Repeat size={14} />}>
                  <RecurrenceEditor
                    value={task.recurrence}
                    dueDate={task.due_date}
                    statuses={statuses}
                    disabled={!editable}
                    onSave={async (value) => {
                      setError(null);
                      setTask(await workApi.updateTask(taskId, { recurrence: value }));
                      onChanged();
                    }}
                  />
                </Field>}
                {on('sprint_points', false) && (
                  <Field label="Sprint points">
                    <input
                      key={task.id + String(task.points)}
                      type="number" min={0} step={0.5} aria-label="Sprint points" disabled={!editable} placeholder="—"
                      defaultValue={task.points ?? ''}
                      onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (task.points ?? null)) save({ points: v }); }}
                      className={inputClass}
                    />
                  </Field>
                )}
                {FEATURES.taskTagsField && on('tags') && <Field label="Tags" icon={<TagIcon size={14} />} wide>
                  <div className="flex flex-wrap items-center gap-1.5 px-2">
                    {task.tags.map((tag) => (
                      <span key={tag.id} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: tag.bg_color, color: tag.fg_color }}>
                        {tag.name}
                        {editable && (
                          <button type="button" onClick={() => save({ tags: task.tags.filter((t) => t.id !== tag.id).map((t) => t.name) })}>
                            <X size={11} />
                          </button>
                        )}
                      </span>
                    ))}
                    {editable && (
                      <form onSubmit={(e) => { e.preventDefault(); if (tagDraft.trim()) { save({ tags: [...task.tags.map((t) => t.name), tagDraft.trim()] }); setTagDraft(''); } }}>
                        <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="Add tag" className="w-24 rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-xs focus:outline-none" />
                      </form>
                    )}
                  </div>
                </Field>}
              </div>

              <TaskLists taskId={task.id} isSubtask={!!task.parent_id} editable={editable} enabled={on('multiple_lists')} onChanged={() => { load(); onChanged(); }} />

              {FEATURES.taskCustomFields && ((task.fields?.length ?? 0) > 0 || editable) && (
                <section className="mt-4 border-t border-gray-100 pt-3" aria-label="Custom fields">
                  <div className="mb-1 flex items-center gap-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Custom fields</h4>
                    {editable && (
                      <button type="button" onClick={() => setManagingFields(true)} className="ml-auto rounded px-1.5 py-0.5 text-xs font-medium text-brand-600 hover:bg-brand-50">
                        {task.fields?.length ? 'Manage' : '+ Add a field'}
                      </button>
                    )}
                  </div>
                  {fieldError && <p className="mb-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{fieldError}</p>}
                  <div className="grid grid-cols-1 gap-x-8 gap-y-0.5 md:grid-cols-2">
                    {(task.fields ?? []).map((f) => (
                      <div key={f.id} className="grid min-h-[34px] grid-cols-[104px_minmax(0,1fr)] items-center gap-2 rounded-lg px-1.5 transition-colors hover:bg-gray-50">
                        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-gray-500"><span className="text-gray-400">{fieldIcon(f.type)}</span><span className="truncate">{f.name}</span></span>
                        <FieldEditor field={f} value={task.custom_fields?.[f.id]} people={members.map((m) => m.user)} disabled={!editable}
                          onChange={async (value) => {
                            setFieldError(null);
                            setTask((t) => t && { ...t, custom_fields: { ...(t.custom_fields ?? {}), [f.id]: value } });
                            try {
                              await workApi.setFieldValue(task.id, f.id, value);
                              load(); setFeedKey((k) => k + 1); onChanged();
                            } catch (e) { setFieldError((e as Error).message); load(); }
                          }} />
                      </div>
                    ))}
                    {(task.fields?.length ?? 0) === 0 && <p className="px-1.5 py-1 text-xs text-gray-400">Extra details this Space files work by, like client tier or fee.</p>}
                  </div>
                </section>
              )}

              <div className="mt-4 border-t border-gray-100 pt-3">
                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Description</h4>
                <RichTextEditor key={task.id} value={task.description ?? ''} disabled={!editable} onSave={(text) => save({ description: text || null })} />
              </div>

              {/* Time tracked was a whole section down here as well as the Track time field
                  beside the estimate. The field carries the timer, the entries and the totals,
                  so the section was the same thing said twice, further from the estimate it
                  wants comparing against. TaskTimeSection still exists and still works. */}
              {FEATURES.taskTimeInStatus && <TimeInStatusSection taskId={task.id} refreshKey={feedKey} />}

              <Subtasks
                listId={task.list_id}
                parentId={task.id}
                subtasks={subtasks}
                statuses={statuses}
                people={assignable}
                editable={editable}
                canAdd={task.permission_level === 'full'}
                onOpen={onOpen}
                onChanged={() => { load(); onChanged(); }}
                onError={setError}
              />

              {/* Dependencies and links still work and still block a status change; they are
                  just not a section on the panel. */}
              {FEATURES.taskRelationships && (
                <TaskRelations task={task} editable={editable} onChanged={() => { load(); setFeedKey((k) => k + 1); onChanged(); }} />
              )}
              <Checklists taskId={task.id} editable={editable} me={meId} onChanged={() => { load(); setFeedKey((k) => k + 1); onChanged(); }} />
              <Attachments taskId={task.id} canAttach={task.permission_level !== 'view'} isFull={task.permission_level === 'full'} me={meId}
                onChanged={() => { setFeedKey((k) => k + 1); onChanged(); }} />
              {/* On a narrow panel the activity follows the task, because there is nowhere
                  else for it to go. Given the width, it belongs beside it: the history is read
                  while the task is being read, not after scrolling past everything else. */}
              {!sideBySide && (
                <div className="mt-5 h-[26rem] overflow-hidden rounded-lg border border-gray-200">
                  <TaskFeed taskId={task.id} canComment={task.permission_level !== 'view'} refreshKey={feedKey} onChanged={onChanged} />
                </div>
              )}
            </div>
            {sideBySide && (
              <aside aria-label="Activity" className="hidden w-[24rem] shrink-0 border-l border-gray-200 lg:block xl:w-[26rem]">
                <TaskFeed taskId={task.id} canComment={task.permission_level !== 'view'} refreshKey={feedKey} onChanged={onChanged} />
              </aside>
            )}
            </div>
          </>
        )}
      </aside>
      {sharing && task && (
        <ShareDialog kind="task" id={task.id} name={task.name} onClose={() => setSharing(false)} onChanged={() => { load(); onChanged(); }} />
      )}
      {managingTypes && <TaskTypesDialog onClose={() => setManagingTypes(false)} onChanged={() => refreshWork()} />}
      {managingFields && task && (
        <FieldsDialog kind="list" id={task.list_id} name={task.location.list.name} canEdit={editable} startCreating={!task.fields?.length}
          onClose={() => setManagingFields(false)} onChanged={() => { load(); onChanged(); }} />
      )}
    </div>
    </Portal>
  );
};
