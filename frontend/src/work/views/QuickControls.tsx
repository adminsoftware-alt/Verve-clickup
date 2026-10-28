// The controls kept on the toolbar itself rather than inside the Filter dropdown: what is shown
// (main tasks, subtasks, closed tasks) and which fields. Whose tasks is asked in Filter → Assignee.
import React, { useState } from 'react';
import {
  CalendarDays, CalendarPlus, CalendarRange, CheckCircle2, Clock, Columns3, Flag, GitBranch, Hash, Hourglass, ListTodo,
  SlidersHorizontal, Tag as TagIcon, User,
} from 'lucide-react';
import { NoMatch, SearchBox, matchesSearch } from '../ui';
import { Popover } from './ViewControls';
import { IconTile } from './IconTile';
import { COLUMNS } from './viewSettings';

/** A labelled on/off switch, as in ClickUp's Fields and Show panels. */
export const Switch: React.FC<{
  label: React.ReactNode; on: boolean; onChange: (on: boolean) => void; icon?: React.ReactNode;
  hint?: string; locked?: boolean;
}> = ({ label, on, onChange, icon, hint, locked }) => (
  <label className={`vf-menu-row flex items-center gap-2 rounded-md px-1 py-[3px] ${locked ? 'cursor-default' : 'cursor-pointer'}`}>
    {icon}
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[13px] text-gray-800">{label}</span>
      {hint && <span className="block truncate text-[10.5px] leading-tight text-gray-400">{hint}</span>}
    </span>
    <button type="button" role="switch" aria-checked={on} aria-disabled={locked} aria-label={typeof label === 'string' ? label : undefined}
      onClick={(e) => { e.preventDefault(); if (!locked) onChange(!on); }}
      className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${on ? (locked ? 'bg-brand-300' : 'bg-brand-600') : 'bg-gray-400'} ${locked ? 'cursor-not-allowed' : ''}`}>
      {/* left-0: without it the knob starts from the centred text position and slid off the end. */}
      <span className={`absolute left-0 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
    </button>
  </label>
);

const icon = (active: boolean) => `${active ? 'text-brand-700' : ''}`;

/** ✓ — which tasks are on the list: main tasks always, subtasks and closed ones by choice. */
export const ShowButton: React.FC<{
  closed: boolean; onClosed: (on: boolean) => void; subtasks: boolean; onSubtasks: (on: boolean) => void;
}> = ({ closed, onClosed, subtasks, onSubtasks }) => (
  <Popover label="Show tasks" icon={<CheckCircle2 size={15} className={icon(closed || !subtasks)} />} text="" active={closed || !subtasks} width={210} tight>
    {() => (
      <>
        <p className="mb-0.5 px-1 text-[11px] font-medium text-gray-400">Show</p>
        <Switch icon={<IconTile Icon={ListTodo} label="Main tasks" />} label="Main tasks" hint="Always shown" on locked onChange={() => undefined} />
        <Switch icon={<IconTile Icon={GitBranch} label="Subtasks" />} label="Subtasks" hint={subtasks ? 'Shown under their main task' : 'Hidden'} on={subtasks} onChange={onSubtasks} />
        <Switch icon={<IconTile Icon={CheckCircle2} label="Closed tasks" />} label="Closed tasks" hint={closed ? 'Done and closed tasks are shown' : 'Done and closed tasks are hidden'} on={closed} onChange={onClosed} />
      </>
    )}
  </Popover>
);

/** Each field's mark, the same ones the Filter panel uses. */
const FIELD_ICONS: Record<string, React.ElementType> = {
  custom_id: Hash, assignee: User, start_date: CalendarRange, due_date: CalendarDays, priority: Flag,
  time_tracked: Clock, time_estimate: Hourglass, tags: TagIcon, created_at: CalendarPlus,
};

/** Fields: which columns each row shows, as switches in a panel. */
export const FieldsButton: React.FC<{
  hidden: string[]; onChange: (hidden: string[]) => void; fields?: { id: string; name: string }[];
  /** A word beside the icon; the List's toolbar goes without. */
  text?: string;
}> = ({ hidden, onChange, fields = [], text = '' }) => (
  <Popover label="Fields" icon={<Columns3 size={15} />} text={text} width={190} tight>
    {() => <FieldSwitches hidden={hidden} onChange={onChange} fields={fields} />}
  </Popover>
);

/** The panel's contents, its own component so the search starts empty each time it opens. */
const FieldSwitches: React.FC<{
  hidden: string[]; onChange: (hidden: string[]) => void; fields: { id: string; name: string }[];
}> = ({ hidden, onChange, fields }) => {
  const [q, setQ] = useState('');
  const toggle = (key: string) => onChange(hidden.includes(key) ? hidden.filter((x) => x !== key) : [...hidden, key]);
  const columns = COLUMNS.filter((c) => matchesSearch(q, c.label));
  const custom = fields.filter((f) => matchesSearch(q, f.name));
  return (
    <>
      <SearchBox value={q} onChange={setQ} label="Search fields" placeholder="Search fields…" inset="lg"
        onEnter={() => { const first = columns[0]?.key ?? (custom[0] && `cf:${custom[0].id}`); if (first) toggle(first); }} />
      {columns.length > 0 && <p className="mb-0.5 px-1 text-[11px] font-medium text-gray-400">Fields</p>}
      {columns.map((c) => { const Icon = FIELD_ICONS[c.key] ?? SlidersHorizontal; return <Switch key={c.key} icon={<IconTile Icon={Icon} label={c.label} />} label={c.label} on={!hidden.includes(c.key)} onChange={() => toggle(c.key)} />; })}
      {custom.length > 0 && <p className="mb-0.5 mt-1.5 px-1 text-[11px] font-medium text-gray-400">Custom fields</p>}
      {custom.map((f) => <Switch key={f.id} icon={<IconTile Icon={SlidersHorizontal} label={f.name} />} label={f.name} on={!hidden.includes(`cf:${f.id}`)} onChange={() => toggle(`cf:${f.id}`)} />)}
      {columns.length === 0 && custom.length === 0 && <NoMatch query={q} />}
    </>
  );
};
