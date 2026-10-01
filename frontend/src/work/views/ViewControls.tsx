import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownUp, Check, Columns3, Filter, Layers3, Plus, UserRound, X } from 'lucide-react';
import type { Status, Task, TaskGroupRef, UserRef } from '../api';
import { PRIORITIES, Portal } from '../ui';
import { GROUP_BY_LABELS, type GroupBy } from './grouping';
import { AdvancedFilters } from './AdvancedFilters';
import {
  COLUMNS, DUE_FILTERS, EMPTY_FILTERS, SORT_FIELDS, filterCount,
  type ViewFilters, type ViewSettings,
} from './viewSettings';

/** A button that opens a panel below it (kept in a portal so nothing clips it). */
export const Popover: React.FC<{
  label: string; icon: React.ReactNode; text: string; active?: boolean; width?: number; up?: boolean; dark?: boolean;
  children: (close: () => void) => React.ReactNode;
}> = ({ label, icon, text, active, width = 260, up, dark, children }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos(up ? { bottom: window.innerHeight - r.top + 6, left } : { top: r.bottom + 6, left });
  }, [open, width, up]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } };
    document.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={dark
          ? 'flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-sm text-gray-100 hover:bg-white/10'
          : `flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-sm ${active ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'}`}
      >
        {icon} {text}
      </button>
      {open && pos && (
        <Portal>
          <div ref={panel} role="dialog" aria-label={label} style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width }}
            className="z-[150] max-h-[70vh] overflow-auto rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-lg">
            {children(() => setOpen(false))}
          </div>
        </Portal>
      )}
    </>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mb-3 last:mb-0">
    <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</h4>
    <div className="flex flex-wrap gap-1">{children}</div>
  </section>
);

const Chip: React.FC<{ on: boolean; onClick: () => void; color?: string; children: React.ReactNode }> = ({ on, onClick, color, children }) => (
  <button type="button" role="checkbox" aria-checked={on} onClick={onClick}
    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${on ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
    {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
    {children}
  </button>
);

function toggled<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

/** ClickUp's Filter panel: pick values per field; a task must match every field used. */
export const FilterButton: React.FC<{
  filters: ViewFilters; onChange: (f: ViewFilters) => void;
  tasks: Task[]; statuses: Status[] | null; groups: TaskGroupRef[]; people: UserRef[]; fields?: { id: string; name: string }[];
}> = ({ filters, onChange, tasks, statuses, groups, people, fields = [] }) => {
  const n = filterCount(filters);
  // Offer the statuses of this List, or every status name in use above a List.
  const statusOptions = new Map<string, Status>();
  (statuses ?? []).forEach((st) => statusOptions.set(st.name.toLowerCase(), st));
  tasks.forEach((t) => { const k = t.status.name.toLowerCase(); if (!statusOptions.has(k)) statusOptions.set(k, t.status); });
  const tagOptions = new Map<string, { name: string; color: string }>();
  tasks.forEach((t) => t.tags.forEach((tag) => tagOptions.set(tag.name.toLowerCase(), { name: tag.name, color: tag.bg_color })));
  const set = <K extends keyof ViewFilters>(key: K, value: ViewFilters[K]) => onChange({ ...filters, [key]: value });
  return (
    <Popover label="Filter" icon={<Filter size={14} />} text={n ? `Filter · ${n}` : 'Filter'} active={n > 0} width={filters.advanced ? 520 : 340}>
      {() => (
        <>
          <Section title="Status">
            {[...statusOptions.entries()].map(([key, st]) => (
              <Chip key={key} on={filters.statuses.includes(key)} color={st.color} onClick={() => set('statuses', toggled(filters.statuses, key))}>{st.name}</Chip>
            ))}
          </Section>
          <Section title="Assignee">
            <Chip on={filters.assignees.includes('me')} onClick={() => set('assignees', toggled(filters.assignees, 'me'))}>Me</Chip>
            <Chip on={filters.assignees.includes('none')} onClick={() => set('assignees', toggled(filters.assignees, 'none'))}>Unassigned</Chip>
            {people.map((p) => (
              <Chip key={p.id} on={filters.assignees.includes(p.id)} onClick={() => set('assignees', toggled(filters.assignees, p.id))}>{p.display_name || p.email}</Chip>
            ))}
          </Section>
          <Section title="Priority">
            {[1, 2, 3, 4].map((p) => (
              <Chip key={p} on={filters.priorities.includes(p)} color={PRIORITIES[p].color} onClick={() => set('priorities', toggled(filters.priorities, p))}>{PRIORITIES[p].label}</Chip>
            ))}
            <Chip on={filters.priorities.includes(0)} onClick={() => set('priorities', toggled(filters.priorities, 0))}>No priority</Chip>
          </Section>
          <Section title="Due date">
            {DUE_FILTERS.map((d) => <Chip key={d.key} on={filters.due.includes(d.key)} onClick={() => set('due', toggled(filters.due, d.key))}>{d.label}</Chip>)}
          </Section>
          {tagOptions.size > 0 && (
            <Section title="Tags">
              {[...tagOptions.entries()].map(([key, tag]) => (
                <Chip key={key} on={filters.tags.includes(key)} color={tag.color} onClick={() => set('tags', toggled(filters.tags, key))}>{tag.name}</Chip>
              ))}
            </Section>
          )}
          {groups.length > 0 && (
            <Section title="Task group">
              {groups.map((g) => <Chip key={g.id} on={filters.groups.includes(g.id)} color={g.color} onClick={() => set('groups', toggled(filters.groups, g.id))}>{g.name}</Chip>)}
              <Chip on={filters.groups.includes('none')} onClick={() => set('groups', toggled(filters.groups, 'none'))}>No group</Chip>
            </Section>
          )}
          <AdvancedFilters value={filters.advanced} onChange={(advanced) => onChange({ ...filters, advanced })}
            statuses={[...statusOptions.values()]} tags={[...tagOptions.values()].map((t) => t.name)} groups={groups} people={people} fields={fields} />
          {n > 0 && (
            <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="mt-1 flex items-center gap-1 text-xs text-gray-500 hover:text-red-600"><X size={12} /> Clear all filters</button>
          )}
        </>
      )}
    </Popover>
  );
};

export const SortButton: React.FC<{ sort: ViewSettings['sort']; onChange: (s: ViewSettings['sort']) => void }> = ({ sort, onChange }) => {
  const label = SORT_FIELDS.find((f) => f.key === sort.field)?.label ?? 'Manual';
  return (
    <Popover label="Sort" icon={<ArrowDownUp size={14} />} text={sort.field === 'manual' ? 'Sort' : `Sort: ${label}`} active={sort.field !== 'manual'} width={220}>
      {(close) => (
        <>
          <ul role="listbox" aria-label="Sort by">
            {SORT_FIELDS.map((f) => (
              <li key={f.key}>
                <button type="button" role="option" aria-selected={sort.field === f.key}
                  onClick={() => { onChange({ field: f.key, dir: f.key === sort.field ? sort.dir : 'asc' }); if (f.key === 'manual') close(); }}
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-gray-50">
                  {f.label} {sort.field === f.key && <Check size={13} className="text-brand-600" />}
                </button>
              </li>
            ))}
          </ul>
          {sort.field !== 'manual' && (
            <div className="mt-2 flex gap-1 border-t border-gray-100 pt-2">
              {(['asc', 'desc'] as const).map((d) => (
                <button key={d} type="button" onClick={() => onChange({ ...sort, dir: d })}
                  className={`flex-1 rounded-md px-2 py-1 text-xs ${sort.dir === d ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-500 hover:bg-gray-50'}`}>
                  {d === 'asc' ? 'Ascending' : 'Descending'}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Popover>
  );
};

export const GroupByButton: React.FC<{
  value: GroupBy; onChange: (g: GroupBy) => void; options: GroupBy[];
  /** Opens the Task groups editor, offered right where someone goes looking for groups. */
  onManageGroups?: () => void;
}> = ({ value, onChange, options, onManageGroups }) => (
  <Popover label="Group by" icon={<Layers3 size={14} />} text={`Group: ${GROUP_BY_LABELS[value]}`} width={220}>
    {(close) => (
      <>
        <ul role="listbox" aria-label="Group by options">
          {options.map((g) => (
            <li key={g}>
              <button type="button" role="option" aria-selected={value === g} onClick={() => { onChange(g); close(); }}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-gray-50">
                {GROUP_BY_LABELS[g]} {value === g && <Check size={13} className="text-brand-600" />}
              </button>
            </li>
          ))}
        </ul>
        {onManageGroups && (
          <div className="mt-1 border-t border-gray-100 pt-1">
            <button type="button" onClick={() => { close(); onManageGroups(); }}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-brand-600 hover:bg-brand-50">
              <Plus size={13} /> New task group…
            </button>
          </div>
        )}
      </>
    )}
  </Popover>
);

export const ColumnsButton: React.FC<{
  hidden: string[]; onChange: (hidden: string[]) => void;
  columns?: { key: string; label: string }[]; fields?: { id: string; name: string }[];
  /** "Columns" inside a Table, but on a grouped list they are the details on each row. */
  label?: string;
}> = ({ hidden, onChange, columns = COLUMNS, fields = [], label = 'Columns' }) => (
  <Popover label={label} icon={<Columns3 size={14} />} text={label} width={220}>
    {() => (
      <>
        <p className="mb-1 text-xs text-gray-400">Show these</p>
        {columns.map((c) => (
          <label key={c.key} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-gray-50">
            <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => onChange(toggled(hidden, c.key))} /> {c.label}
          </label>
        ))}
        {fields.length > 0 && <p className="mb-1 mt-2 text-xs text-gray-400">Custom fields</p>}
        {fields.map((f) => (
          <label key={f.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-gray-50">
            <input type="checkbox" checked={!hidden.includes(`cf:${f.id}`)} onChange={() => onChange(toggled(hidden, `cf:${f.id}`))} /> {f.name}
          </label>
        ))}
      </>
    )}
  </Popover>
);

/** "Me mode": only tasks assigned to you. Personal, so it isn't saved into the view. */
export const MeButton: React.FC<{ on: boolean; onChange: (on: boolean) => void }> = ({ on, onChange }) => (
  <button type="button" aria-pressed={on} title="Me mode: show only tasks assigned to me" onClick={() => onChange(!on)}
    className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-sm ${on ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'}`}>
    <UserRound size={14} /> Me
  </button>
);
