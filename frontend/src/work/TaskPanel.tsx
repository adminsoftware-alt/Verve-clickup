import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ChevronRight, Lock, Plus, Share2, X } from 'lucide-react';
import { useWork, useMe } from './WorkContext';
import { useAuth } from '../components/AuthContext';
import { workApi, type Status, type Task, type TaskDetail, type TaskGroup, type TaskInput } from './api';
import { Avatar, PRIORITIES, Portal, StatusDot, fromDateInput, toDateInput, useEscapeToClose } from './ui';
import { ShareDialog } from './ShareDialog';
import { TaskTimeSection } from './TaskTimeSection';
import { rememberTask } from './recent';
import { RecurrenceEditor } from './RecurrenceEditor';
import { TaskFeed } from './task/TaskFeed';
import { Attachments, Checklists } from './task/TaskSections';
import { FieldEditor, fieldIcon } from './fields/FieldValue';
import { FieldsDialog } from './fields/FieldsDialog';
import { RichTextEditor } from './task/RichText';
import { TaskRelations } from './task/TaskLinks';
import { TaskTypesDialog, TypeIcon } from './LocationSettings';
import { TaskActions } from './task/TaskActions';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[110px_1fr] items-center gap-2 py-1.5">
    <span className="text-sm text-gray-500">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
);

const inputClass =
  'w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-gray-800 hover:border-gray-200 focus:border-indigo-400 focus:outline-none';

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
  const [newSubtask, setNewSubtask] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [sharing, setSharing] = useState(false);
  const [feedKey, setFeedKey] = useState(0);
  const [managingFields, setManagingFields] = useState(false);
  const [managingTypes, setManagingTypes] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

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

  const addSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task || !newSubtask.trim()) return;
    try {
      await workApi.createTask(task.list_id, { name: newSubtask.trim(), parent_id: task.id });
      setNewSubtask('');
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async () => {
    if (!task || !window.confirm(`Delete "${task.name}" and its subtasks?`)) return;
    await workApi.deleteTask(task.id);
    onChanged();
    onClose();
  };

  const editable = task?.permission_level === 'edit' || task?.permission_level === 'full';
  const taskType = taskTypes.find((t) => t.id === task?.type_id);
  const assigneeIds = new Set(task?.assignees.map((a) => a.id));
  // As in ClickUp, an assignee with comment access can still change the status.
  const canChangeStatus = editable || (task?.permission_level === 'comment' && !!user && assigneeIds.has(meId));

  return (
    <Portal>
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/20" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        role="dialog"
        aria-label="Task details"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[78rem] flex-col bg-white shadow-2xl"
      >
        {!task ? (
          <div className="p-6 text-sm text-gray-500">{error ?? 'Loading…'}</div>
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
            <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="mb-1 flex items-center gap-2">
                {task.custom_id && (
                  <button type="button" title="Copy task ID" onClick={() => navigator.clipboard?.writeText(task.custom_id!)}
                    className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600 hover:bg-gray-200">{task.custom_id}</button>
                )}
                {task.parent_id && (
                  <button type="button" onClick={() => onOpen(task.parent_id!)} className="text-xs text-indigo-600 hover:underline">
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
                className="w-full rounded-md border border-transparent px-1 py-1 text-2xl font-semibold text-gray-900 hover:border-gray-200 focus:border-indigo-400 focus:outline-none"
              />
              {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

              <div className="mt-4 grid grid-cols-1 gap-x-8 md:grid-cols-2">
                <Field label="Status">
                  <div className="flex items-center gap-2 px-2">
                    <StatusDot status={task.status} />
                    <select
                      value={task.status.id}
                      disabled={!canChangeStatus}
                      aria-label="Status"
                      onChange={(e) => {
                        const next = statuses.find((st) => st.id === e.target.value);
                        // Like ClickUp: finishing a task that still waits on others needs a second thought.
                        if (next && (next.group === 'done' || next.group === 'closed') && (task.waiting_on_open ?? 0) > 0
                          && !window.confirm(`This task is waiting on ${task.waiting_on_open} unfinished task${task.waiting_on_open === 1 ? '' : 's'}. Mark it ${next.name} anyway?`)) {
                          e.target.value = task.status.id;
                          return;
                        }
                        save({ status_id: e.target.value });
                      }}
                      className="flex-1 bg-transparent text-sm font-medium uppercase text-gray-800 focus:outline-none"
                    >
                      {statuses.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                    </select>
                  </div>
                </Field>
                <Field label="Priority">
                  <select
                    value={task.priority ?? ''}
                    disabled={!editable}
                    onChange={(e) => save({ priority: e.target.value ? Number(e.target.value) : null })}
                    className={inputClass}
                  >
                    <option value="">No priority</option>
                    {Object.entries(PRIORITIES).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}
                  </select>
                </Field>
                <Field label="Start date">
                  <input type="date" disabled={!editable} value={toDateInput(task.start_date)} onChange={(e) => save({ start_date: fromDateInput(e.target.value) })} className={inputClass} />
                </Field>
                <Field label="Due date">
                  <input
                    type="date"
                    disabled={!editable}
                    value={toDateInput(task.due_date)}
                    onChange={(e) => save({ due_date: fromDateInput(e.target.value) })}
                    className={`${inputClass} ${task.is_overdue ? 'text-red-600' : ''}`}
                  />
                </Field>
                <Field label="Type">
                  <span className="flex items-center gap-1.5">
                    {taskType ? <TypeIcon type={taskType} /> : <span className="inline-block h-2.5 w-2.5 rounded-full border border-gray-300" />}
                    <select
                      aria-label="Task type"
                      value={task.type_id ?? ''}
                      disabled={!editable}
                      onChange={(e) => { if (e.target.value === '__manage') { setManagingTypes(true); return; } save({ type_id: e.target.value || null }); }}
                      className={inputClass}
                    >
                      <option value="">Task</option>
                      {taskTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      {isWorkspaceAdmin && <option value="__manage">Manage task types…</option>}
                    </select>
                  </span>
                </Field>
                <Field label="Group">
                  <select
                    aria-label="Group"
                    value={task.group?.id ?? ''}
                    disabled={!editable}
                    onChange={(e) => save({ group_id: e.target.value || null })}
                    className={inputClass}
                  >
                    <option value="">No group</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </Field>
                <Field label="Repeat">
                  <RecurrenceEditor
                    value={task.recurrence}
                    dueDate={task.due_date}
                    disabled={!editable}
                    onSave={async (value) => {
                      setError(null);
                      setTask(await workApi.updateTask(taskId, { recurrence: value }));
                      onChanged();
                    }}
                  />
                </Field>
                <Field label="Time estimate">
                  <div className="flex items-center gap-1">
                    <input
                      key={task.id + String(task.time_estimate_seconds)}
                      type="number"
                      min={0}
                      step={0.25}
                      disabled={!editable}
                      placeholder="—"
                      defaultValue={task.time_estimate_seconds != null ? task.time_estimate_seconds / 3600 : ''}
                      onBlur={(e) => {
                        const hours = e.target.value === '' ? null : Math.round(Number(e.target.value) * 3600);
                        if (hours !== task.time_estimate_seconds) save({ time_estimate_seconds: hours });
                      }}
                      className={inputClass}
                    />
                    <span className="text-sm text-gray-400">h</span>
                  </div>
                </Field>
              </div>

              <Field label="Assignees">
                <div className="flex flex-wrap gap-1.5 px-2">
                  {members.map((m) => {
                    const on = assigneeIds.has(m.user.id);
                    return (
                      <button
                        key={m.user.id}
                        type="button"
                        disabled={!editable}
                        onClick={() => save({ assignees: on ? task.assignees.filter((a) => a.id !== m.user.id).map((a) => a.id) : [...assigneeIds, m.user.id] })}
                        className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-xs ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
                      >
                        <Avatar user={m.user} size={20} />
                        {m.user.display_name || m.user.email}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Tags">
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
              </Field>

              {((task.fields?.length ?? 0) > 0 || editable) && (
                <section className="mt-5" aria-label="Custom fields">
                  <div className="mb-1 flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-gray-700">Custom fields</h4>
                    {editable && (
                      <button type="button" onClick={() => setManagingFields(true)} className="ml-auto rounded px-1.5 py-0.5 text-xs text-indigo-600 hover:bg-indigo-50">
                        {task.fields?.length ? 'Manage fields' : '+ Add a field'}
                      </button>
                    )}
                  </div>
                  {fieldError && <p className="mb-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{fieldError}</p>}
                  <div className="rounded-lg border border-gray-200">
                    {(task.fields ?? []).map((f) => (
                      <div key={f.id} className="grid grid-cols-[150px_1fr] items-center gap-2 border-b border-gray-100 px-3 py-1 last:border-b-0">
                        <span className="flex min-w-0 items-center gap-1.5 text-sm text-gray-500"><span className="text-gray-400">{fieldIcon(f.type)}</span><span className="truncate">{f.name}</span></span>
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
                    {(task.fields?.length ?? 0) === 0 && <p className="px-3 py-2 text-xs text-gray-400">Track extra details on tasks here, like client tier or fee.</p>}
                  </div>
                </section>
              )}

              <div className="mt-5">
                <h4 className="mb-1.5 text-sm font-semibold text-gray-700">Description</h4>
                <RichTextEditor key={task.id} value={task.description ?? ''} disabled={!editable} onSave={(text) => save({ description: text || null })} />
              </div>

              <TaskTimeSection taskId={task.id} canTrack={editable} onChanged={onChanged} />

              <div className="mt-5">
                <h4 className="mb-1.5 text-sm font-semibold text-gray-700">Subtasks {subtasks.length > 0 && <span className="font-normal text-gray-400">{subtasks.length}</span>}</h4>
                <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
                  {subtasks.map((sub) => (
                    <button key={sub.id} type="button" onClick={() => onOpen(sub.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50">
                      <StatusDot status={sub.status} size={12} />
                      <span className={`flex-1 ${sub.status.group === 'closed' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{sub.name}</span>
                    </button>
                  ))}
                  {task.permission_level === 'full' && (
                    <form onSubmit={addSubtask} className="flex items-center gap-2 px-3 py-2">
                      <Plus size={14} className="text-gray-400" />
                      <input value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)} placeholder="Add subtask" className="flex-1 text-sm focus:outline-none" />
                    </form>
                  )}
                </div>
              </div>

              <TaskRelations task={task} editable={editable} onChanged={() => { load(); setFeedKey((k) => k + 1); onChanged(); }} />
              <Checklists taskId={task.id} editable={editable} me={meId} onChanged={() => { load(); setFeedKey((k) => k + 1); onChanged(); }} />
              <Attachments taskId={task.id} canAttach={task.permission_level !== 'view'} isFull={task.permission_level === 'full'} me={meId}
                onChanged={() => { setFeedKey((k) => k + 1); onChanged(); }} />
              <div className="mt-5 h-[28rem] overflow-hidden rounded-lg border border-gray-200 lg:hidden">
                <TaskFeed taskId={task.id} canComment={task.permission_level !== 'view'} refreshKey={feedKey} onChanged={onChanged} />
              </div>
            </div>
            <div className="hidden w-[24rem] shrink-0 border-l border-gray-200 lg:block">
              <TaskFeed taskId={task.id} canComment={task.permission_level !== 'view'} refreshKey={feedKey} onChanged={onChanged} />
            </div>
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
