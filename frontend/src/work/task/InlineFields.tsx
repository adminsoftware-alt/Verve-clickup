// A task's status, priority and due date, changed where the task is shown -- a Board card, a
// Dashboard list, the Planner tray, a Workload or Team row -- without opening it. The List and
// My Tasks rows have their own cells; these are the same choices in a smaller form.
import React, { useEffect, useState } from 'react';
import { Flag } from 'lucide-react';

import { workApi, type Status, type Task, type TaskInput } from '../api';
import { DateField } from '../DateField';
import { Menu, PRIORITIES, StatusDot } from '../ui';
import { notify } from '../../components/notify';

// Some places hold only a summary of a task (no priority or start date), so those are optional.
type Editable = Pick<Task, 'id' | 'name' | 'list_id' | 'status' | 'due_date'>
  & Partial<Pick<Task, 'priority' | 'start_date' | 'is_overdue'>> & { permission_level?: string };

export const canEditTask = (t: { permission_level?: string }) => t.permission_level === 'edit' || t.permission_level === 'full';

/**
 * One task with its edits applied at once. A save that fails puts the old value back and says
 * why; fresh data from the server replaces the edit when it arrives.
 */
export function useTaskDraft<T extends Editable>(task: T, onChanged?: () => void) {
  const [draft, setDraft] = useState<Partial<T>>({});
  useEffect(() => setDraft({}), [task]);
  const view = { ...task, ...draft } as T;
  const save = async (input: TaskInput, optimistic: Partial<Editable>) => {
    setDraft((d) => ({ ...d, ...(optimistic as Partial<T>) }));
    try {
      await workApi.updateTask(task.id, input);
      onChanged?.();
    } catch (e) {
      setDraft({});
      notify.error(e);
    }
  };
  return [view, save] as const;
}

// Status sets are per List and rarely change, so one fetch serves every row from that List.
const statusCache = new Map<string, Promise<Status[]>>();
const statusesOf = (listId: string) => {
  let hit = statusCache.get(listId);
  if (!hit) {
    hit = workApi.statuses('list', listId).then((set) => set.statuses);
    hit.catch(() => statusCache.delete(listId));
    statusCache.set(listId, hit);
  }
  return hit;
};

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** The status dot, which opens the List's own statuses. */
export const StatusPicker: React.FC<{
  task: Editable; size?: number; disabled?: boolean;
  onSave: (input: TaskInput, optimistic: Partial<Editable>) => void;
}> = ({ task, size = 11, disabled, onSave }) => {
  const [statuses, setStatuses] = useState<Status[] | null>(null);
  if (disabled) return <StatusDot status={task.status} size={size} />;
  return (
    <span onClick={stop} onMouseDown={stop} className="inline-flex shrink-0">
      <Menu
        label={`Status of ${task.name}`}
        triggerClassName="inline-flex"
        onOpenChange={(open) => { if (open && !statuses) statusesOf(task.list_id).then(setStatuses).catch(() => setStatuses([])); }}
        items={(statuses ?? [task.status]).map((st) => ({
          label: st.name,
          icon: <StatusDot status={st} size={11} />,
          onClick: () => { if (st.id !== task.status.id) onSave({ status_id: st.id }, { status: st }); },
        }))}
        trigger={<span aria-label={`Status: ${task.status.name}`} className="flex rounded p-0.5 hover:bg-gray-100"><StatusDot status={task.status} size={size} /></span>}
      />
    </span>
  );
};

/** The priority flag, with its name when there is one. */
export const PriorityPicker: React.FC<{
  task: Editable; disabled?: boolean; withLabel?: boolean;
  onSave: (input: TaskInput, optimistic: Partial<Editable>) => void;
}> = ({ task, disabled, withLabel = true, onSave }) => {
  const p = task.priority ? PRIORITIES[task.priority] : null;
  const face = (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: p ? p.color : '#9CA3AF' }}>
      <Flag size={12} />{withLabel && p ? p.label : null}
    </span>
  );
  if (disabled) return p ? face : null;
  return (
    <span onClick={stop} onMouseDown={stop} className="inline-flex shrink-0">
      <Menu
        label={`Priority of ${task.name}`}
        triggerClassName="inline-flex"
        items={[1, 2, 3, 4, null].map((value) => ({
          label: value ? PRIORITIES[value].label : 'No priority',
          icon: <span className="h-2 w-2 rounded-full" style={{ backgroundColor: value ? PRIORITIES[value].color : '#D1D5DB' }} />,
          onClick: () => { if ((task.priority ?? null) !== value) onSave({ priority: value }, { priority: value }); },
        }))}
        trigger={<span aria-label={`Priority: ${p ? p.label : 'none'}`} className="flex rounded px-1 py-0.5 hover:bg-gray-100">{face}</span>}
      />
    </span>
  );
};

/** The due date, as the short "28 Sept"; red when late. A due date before the start is refused. */
export const DuePicker: React.FC<{
  task: Editable; disabled?: boolean;
  onSave: (input: TaskInput, optimistic: Partial<Editable>) => void;
}> = ({ task, disabled, onSave }) => (
  <span onClick={stop} onMouseDown={stop} className="inline-flex shrink-0 text-xs">
    <DateField
      value={task.due_date}
      label={`Due date of ${task.name}`}
      overdue={task.is_overdue && task.status.group !== 'closed' && task.status.group !== 'done'}
      format="compact"
      placeholder="Due"
      disabled={disabled}
      onChange={(iso) => {
        if (iso && task.start_date && iso.slice(0, 10) < task.start_date.slice(0, 10)) {
          notify.error(new Error('The due date is before the start date'));
          return;
        }
        onSave({ due_date: iso }, { due_date: iso, is_overdue: false });
      }}
    />
  </span>
);
