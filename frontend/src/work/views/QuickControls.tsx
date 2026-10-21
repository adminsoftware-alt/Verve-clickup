// The controls kept on the toolbar itself rather than inside the Filter dropdown: what is shown
// (main tasks, subtasks, closed tasks) and which fields. Whose tasks is asked in Filter → Assignee.
import React from 'react';
import { CheckCircle2, Columns3 } from 'lucide-react';
import { Popover } from './ViewControls';
import { COLUMNS } from './viewSettings';

/** A labelled on/off switch, as in ClickUp's Fields and Show panels. */
export const Switch: React.FC<{
  label: React.ReactNode; on: boolean; onChange: (on: boolean) => void; icon?: React.ReactNode;
  hint?: string; locked?: boolean;
}> = ({ label, on, onChange, icon, hint, locked }) => (
  <label className={`flex items-center gap-2.5 rounded-md px-1.5 py-1.5 ${locked ? 'cursor-default' : 'cursor-pointer hover:bg-gray-50'}`}>
    {icon && <span className="text-gray-400">{icon}</span>}
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm text-gray-800">{label}</span>
      {hint && <span className="block truncate text-[11px] text-gray-400">{hint}</span>}
    </span>
    <button type="button" role="switch" aria-checked={on} aria-disabled={locked} aria-label={typeof label === 'string' ? label : undefined}
      onClick={(e) => { e.preventDefault(); if (!locked) onChange(!on); }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? (locked ? 'bg-brand-300' : 'bg-brand-600') : 'bg-gray-400'} ${locked ? 'cursor-not-allowed' : ''}`}>
      {/* left-0: without it the knob starts from the centred text position and slid off the end. */}
      <span className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  </label>
);

const icon = (active: boolean) => `${active ? 'text-brand-700' : ''}`;

/** ✓ — which tasks are on the list: main tasks always, subtasks and closed ones by choice. */
export const ShowButton: React.FC<{
  closed: boolean; onClosed: (on: boolean) => void; subtasks: boolean; onSubtasks: (on: boolean) => void;
}> = ({ closed, onClosed, subtasks, onSubtasks }) => (
  <Popover label="Show tasks" icon={<CheckCircle2 size={15} className={icon(closed || !subtasks)} />} text="" active={closed || !subtasks} width={250}>
    {() => (
      <>
        <p className="mb-1 px-1.5 text-xs font-medium text-gray-400">Show</p>
        <Switch label="Main tasks" hint="Always shown" on locked onChange={() => undefined} />
        <Switch label="Subtasks" hint={subtasks ? 'Shown under their main task' : 'Hidden'} on={subtasks} onChange={onSubtasks} />
        <Switch label="Closed tasks" hint={closed ? 'Done and closed tasks are shown' : 'Done and closed tasks are hidden'} on={closed} onChange={onClosed} />
      </>
    )}
  </Popover>
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
