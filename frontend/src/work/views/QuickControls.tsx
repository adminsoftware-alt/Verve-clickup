// The controls ClickUp keeps on the toolbar itself rather than inside the Filter dropdown: what
// is shown (closed tasks, subtasks), whose tasks (assignees, "me"), and which fields. Each is one
// click from the list instead of two, and each says at a glance whether it is on.
import React from 'react';
import { CheckCircle2, Columns3, Users } from 'lucide-react';
import type { UserRef } from '../api';
import { Avatar } from '../ui';
import { Popover } from './ViewControls';
import { COLUMNS } from './viewSettings';

/** A labelled on/off switch, as in ClickUp's Fields and Show panels. */
export const Switch: React.FC<{ label: React.ReactNode; on: boolean; onChange: (on: boolean) => void; icon?: React.ReactNode }> = ({ label, on, onChange, icon }) => (
  <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-gray-50">
    {icon && <span className="text-gray-400">{icon}</span>}
    <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{label}</span>
    <button type="button" role="switch" aria-checked={on} onClick={(e) => { e.preventDefault(); onChange(!on); }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-brand-600' : 'bg-gray-300'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  </label>
);

const icon = (active: boolean) => `${active ? 'text-brand-700' : ''}`;

/** ✓ — whether closed tasks and subtasks are on the list. */
export const ShowButton: React.FC<{
  closed: boolean; onClosed: (on: boolean) => void; subtasks: boolean; onSubtasks: (on: boolean) => void;
}> = ({ closed, onClosed, subtasks, onSubtasks }) => (
  <Popover label="Show closed tasks and subtasks" icon={<CheckCircle2 size={15} className={icon(closed || !subtasks)} />} text="" active={closed || !subtasks} width={220}>
    {() => (
      <>
        <Switch label="Closed tasks" on={closed} onChange={onClosed} />
        <Switch label="Subtasks" on={subtasks} onChange={onSubtasks} />
      </>
    )}
  </Popover>
);

/** The people on the list, ticked to see only their tasks. Sets the same assignee filter. */
export const AssigneeButton: React.FC<{ people: UserRef[]; value: string[]; onChange: (ids: string[]) => void }> = ({ people, value, onChange }) => {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const picked = value.filter((v) => v !== 'me' && v !== 'none').length;
  return (
    <Popover label="Assignees" icon={<Users size={15} className={icon(picked > 0)} />} text={picked ? String(picked) : ''} active={picked > 0} width={260}>
      {() => (
        <>
          <p className="mb-1 px-1.5 text-xs font-medium text-gray-400">Assignees</p>
          <ul className="max-h-72 overflow-y-auto">
            {people.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-gray-50">
                  <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
                  <Avatar user={p} size={22} />
                  <span className="truncate text-sm text-gray-800">{p.display_name || p.email}</span>
                </label>
              </li>
            ))}
            <li>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-gray-50">
                <input type="checkbox" checked={value.includes('none')} onChange={() => toggle('none')} />
                <span className="text-sm text-gray-500">Unassigned</span>
              </label>
            </li>
          </ul>
          {value.length > 0 && <button type="button" onClick={() => onChange([])} className="mt-1 px-1.5 text-xs text-gray-500 hover:text-red-600">Clear</button>}
        </>
      )}
    </Popover>
  );
};

/** Your own avatar: on, the list shows only tasks assigned to you ("Me mode"). */
export const MeAvatar: React.FC<{ me: UserRef | undefined; on: boolean; onChange: (on: boolean) => void }> = ({ me, on, onChange }) => (
  <button type="button" aria-pressed={on} title={on ? 'Showing only your tasks' : 'Show only my tasks'} onClick={() => onChange(!on)}
    className={`rounded-full p-0.5 transition-shadow ${on ? 'ring-2 ring-brand-500 ring-offset-1' : 'opacity-80 hover:opacity-100'}`}>
    {me ? <Avatar user={me} size={22} /> : null}
  </button>
);

/** Fields: which columns each row shows, as switches in a panel. */
export const FieldsButton: React.FC<{
  hidden: string[]; onChange: (hidden: string[]) => void; fields?: { id: string; name: string }[];
}> = ({ hidden, onChange, fields = [] }) => {
  const toggle = (key: string) => onChange(hidden.includes(key) ? hidden.filter((x) => x !== key) : [...hidden, key]);
  return (
    <Popover label="Fields" icon={<Columns3 size={15} />} text="" width={260}>
      {() => (
        <>
          <p className="mb-1 px-1.5 text-xs font-medium text-gray-400">Fields</p>
          {COLUMNS.map((c) => <Switch key={c.key} label={c.label} on={!hidden.includes(c.key)} onChange={() => toggle(c.key)} />)}
          {fields.length > 0 && <p className="mb-1 mt-2 px-1.5 text-xs font-medium text-gray-400">Custom fields</p>}
          {fields.map((f) => <Switch key={f.id} label={f.name} on={!hidden.includes(`cf:${f.id}`)} onChange={() => toggle(`cf:${f.id}`)} />)}
        </>
      )}
    </Popover>
  );
};
