// Subtasks, carrying the same fields the parent does.
//
// A subtask used to be a name and a status dot, which meant the moment a piece of work needed an
// owner or a date it had to be promoted to a task of its own. They are the same thing with a
// parent, so the row shows -- and sets -- who has it, when it is due and how urgent it is, and
// the "add" row asks for those before it is saved rather than after.
import { CalendarDays, Flag, Plus, UserPlus } from 'lucide-react';
import React, { useState } from 'react';

import { workApi, type Status, type Task, type UserRef } from '../api';
import { DateField } from '../DateField';
import { Avatar, Menu, PRIORITIES, StatusDot, formatDue, type MenuItem } from '../ui';

const NO_PRIORITY = '#D1D5DB';

/** The menu of statuses for one subtask. */
function statusItems(statuses: Status[], onPick: (id: string) => void): MenuItem[] {
  return statuses.map((st) => ({
    label: st.name,
    icon: <StatusDot status={st} size={11} />,
    onClick: () => onPick(st.id),
  }));
}

function priorityItems(onPick: (value: number | null) => void): MenuItem[] {
  return [
    ...Object.entries(PRIORITIES).map(([value, p]) => ({
      label: p.label,
      icon: <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />,
      onClick: () => onPick(Number(value)),
    })),
    { label: 'No priority', icon: <span className="h-2 w-2 rounded-full bg-gray-300" />, onClick: () => onPick(null) },
  ];
}

function peopleItems(people: UserRef[], chosen: Set<string>, onToggle: (id: string) => void): MenuItem[] {
  if (!people.length) return [{ label: 'Nobody can open this List yet', onClick: () => undefined }];
  return people.map((u) => ({
    label: `${chosen.has(u.id) ? '✓ ' : ''}${u.display_name || u.email}`,
    icon: <Avatar user={u} size={18} />,
    onClick: () => onToggle(u.id),
  }));
}

const Chip: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <span title={title} className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-gray-500 hover:bg-gray-100">{children}</span>
);

/** One subtask: everything on it can be set without opening it. */
const Row: React.FC<{
  sub: Task; statuses: Status[]; people: UserRef[]; editable: boolean;
  onOpen: () => void; onSave: (patch: Parameters<typeof workApi.updateTask>[1]) => void;
}> = ({ sub, statuses, people, editable, onOpen, onSave }) => {
  const chosen = new Set(sub.assignees.map((a) => a.id));
  const closed = sub.status.group === 'closed';
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50">
      {editable && statuses.length ? (
        <Menu label={`Status of ${sub.name}`} items={statusItems(statuses, (id) => onSave({ status_id: id }))}
          trigger={<span className="rounded p-0.5 hover:bg-gray-200" title={sub.status.name}><StatusDot status={sub.status} size={12} /></span>} />
      ) : <StatusDot status={sub.status} size={12} />}

      <button type="button" onClick={onOpen} className={`min-w-0 flex-1 truncate text-left ${closed ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
        {sub.name}
      </button>

      {editable ? (
        <Menu align="right" label={`Priority of ${sub.name}`} items={priorityItems((value) => onSave({ priority: value }))}
          trigger={<Chip title={sub.priority ? PRIORITIES[sub.priority].label : 'No priority'}>
            <Flag size={12} style={{ color: sub.priority ? PRIORITIES[sub.priority].color : NO_PRIORITY }} />
          </Chip>} />
      ) : sub.priority ? <Flag size={12} style={{ color: PRIORITIES[sub.priority].color }} /> : null}

      <span className="w-24 shrink-0 text-right">
        <DateField label={`Due date of ${sub.name}`} placeholder="Due" disabled={!editable} value={sub.due_date}
          overdue={sub.is_overdue} onChange={(iso) => onSave({ due_date: iso })} />
      </span>

      {editable ? (
        <Menu align="right" label={`Assignees of ${sub.name}`} width={220}
          items={peopleItems(people, chosen, (id) => onSave({ assignees: chosen.has(id) ? [...chosen].filter((x) => x !== id) : [...chosen, id] }))}
          trigger={<span className="flex items-center rounded p-0.5 hover:bg-gray-200" title="Assignees">
            {sub.assignees.length
              ? <span className="flex -space-x-1">{sub.assignees.slice(0, 3).map((a) => <Avatar key={a.id} user={a} size={20} />)}</span>
              : <UserPlus size={14} className="text-gray-400" />}
          </span>} />
      ) : sub.assignees.length ? (
        <span className="flex -space-x-1">{sub.assignees.slice(0, 3).map((a) => <Avatar key={a.id} user={a} size={20} />)}</span>
      ) : null}
    </div>
  );
};

/** The add row: name, and the same four fields, before it is saved. */
const AddRow: React.FC<{
  statuses: Status[]; people: UserRef[];
  onAdd: (fields: { name: string; status_id?: string; priority?: number | null; due_date?: string | null; assignees?: string[] }) => Promise<void>;
}> = ({ statuses, people, onAdd }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [statusId, setStatusId] = useState<string | null>(null);
  const [priority, setPriority] = useState<number | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reset = () => { setName(''); setStatusId(null); setPriority(null); setDue(null); setAssignees([]); };
  const status = statuses.find((st) => st.id === statusId) ?? statuses[0];
  const chosen = new Set(assignees);

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd({
        name: name.trim(),
        ...(statusId ? { status_id: statusId } : {}),
        ...(priority != null ? { priority } : {}),
        ...(due ? { due_date: due } : {}),
        ...(assignees.length ? { assignees } : {}),
      });
      reset();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50">
        <Plus size={14} className="text-gray-400" /> Add subtask
      </button>
    );
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        {status && (
          <Menu label="Status of the new subtask" items={statusItems(statuses, setStatusId)}
            trigger={<span className="rounded p-0.5 hover:bg-gray-200" title={status.name}><StatusDot status={status} size={12} /></span>} />
        )}
        <input
          autoFocus aria-label="Subtask name" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { reset(); setOpen(false); }
          }}
          placeholder="Task name" className="min-w-0 flex-1 text-sm focus:outline-none"
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Menu label="Assign the new subtask" width={220}
          items={peopleItems(people, chosen, (id) => setAssignees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id])))}
          trigger={<Chip title="Assignees">
            {assignees.length
              ? <span className="flex -space-x-1">{people.filter((u) => chosen.has(u.id)).slice(0, 3).map((u) => <Avatar key={u.id} user={u} size={18} />)}</span>
              : <><UserPlus size={13} /> Assignee</>}
          </Chip>} />

        <span className="flex items-center gap-1 rounded px-1 text-xs text-gray-500">
          <CalendarDays size={13} className="text-gray-400" />
          <span className="w-32"><DateField label="Due date of the new subtask" placeholder="Due" value={due} onChange={setDue} /></span>
        </span>

        <Menu label="Priority of the new subtask" items={priorityItems(setPriority)}
          trigger={<Chip title="Priority">
            <Flag size={13} style={{ color: priority ? PRIORITIES[priority].color : NO_PRIORITY }} />
            {priority ? PRIORITIES[priority].label : 'Priority'}
          </Chip>} />

        <span className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => { reset(); setOpen(false); }} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">Cancel</button>
          <button type="button" onClick={save} disabled={!name.trim() || busy}
            className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </span>
      </div>
      {due && formatDue(due) && <p className="mt-1 text-[11px] text-gray-400">Due {formatDue(due)}</p>}
    </div>
  );
};

export const Subtasks: React.FC<{
  listId: string;
  parentId: string;
  subtasks: Task[];
  statuses: Status[];
  people: UserRef[] | null;
  editable: boolean;
  canAdd: boolean;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}> = ({ listId, parentId, subtasks, statuses, people, editable, canAdd, onOpen, onChanged, onError }) => {
  const who = people ?? [];
  const save = async (id: string, patch: Parameters<typeof workApi.updateTask>[1]) => {
    try { await workApi.updateTask(id, patch); onChanged(); }
    catch (e) { onError((e as Error).message); }
  };
  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        Subtasks {subtasks.length > 0 && <span className="text-gray-400">{subtasks.length}</span>}
      </h4>
      <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
        {subtasks.map((sub) => (
          <Row key={sub.id} sub={sub} statuses={statuses} people={who} editable={editable}
            onOpen={() => onOpen(sub.id)} onSave={(patch) => save(sub.id, patch)} />
        ))}
        {canAdd && (
          <AddRow statuses={statuses} people={who} onAdd={async (fields) => {
            try { await workApi.createTask(listId, { ...fields, parent_id: parentId }); onChanged(); }
            catch (e) { onError((e as Error).message); }
          }} />
        )}
      </div>
    </div>
  );
};
