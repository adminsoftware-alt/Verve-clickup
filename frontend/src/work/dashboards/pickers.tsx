import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, List as ListIcon, X } from 'lucide-react';
import { useWork, useMe } from '../WorkContext';
import type { FolderNode, ListNode, SpaceNode, StatusGroup } from '../api';
import type { Filters, Source } from './api';

// --- where a card's data comes from -------------------------------------------------

/** Pick Spaces, Folders and Lists. Nothing picked means "everything I can see". */
export const SourcePicker: React.FC<{ value: Source[]; onChange: (value: Source[]) => void }> = ({ value, onChange }) => {
  const { hierarchy } = useWork();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const picked = useMemo(() => new Set(value.map((s) => `${s.kind}:${s.id}`)), [value]);

  const toggle = (kind: Source['kind'], id: string) => {
    const key = `${kind}:${id}`;
    onChange(picked.has(key) ? value.filter((s) => `${s.kind}:${s.id}` !== key) : [...value, { kind, id }]);
  };
  const expand = (id: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const row = (kind: Source['kind'], node: { id: string; name: string }, depth: number, icon: React.ReactNode, children?: React.ReactNode, hasChildren = false) => (
    <div key={`${kind}:${node.id}`}>
      <div className="flex items-center gap-1.5 py-0.5 text-sm" style={{ paddingLeft: depth * 16 }}>
        <button type="button" onClick={() => hasChildren && expand(node.id)} className={`w-4 text-gray-400 ${hasChildren ? '' : 'invisible'}`}>
          {open.has(node.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <label className="flex min-w-0 cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={picked.has(`${kind}:${node.id}`)} onChange={() => toggle(kind, node.id)} />
          {icon}
          <span className="truncate text-gray-800">{node.name}</span>
        </label>
      </div>
      {open.has(node.id) && children}
    </div>
  );
  const renderList = (lst: ListNode, depth: number) => row('list', lst, depth, <ListIcon size={13} className="text-gray-400" />);
  const renderFolder = (f: FolderNode, depth: number): React.ReactNode =>
    row('folder', f, depth, <Folder size={13} className="text-gray-400" />,
      <>{f.folders.map((sub) => renderFolder(sub, depth + 1))}{f.lists.map((l) => renderList(l, depth + 1))}</>,
      f.folders.length + f.lists.length > 0);
  const renderSpace = (sp: SpaceNode) =>
    row('space', sp, 0, <span className="flex h-4 w-4 items-center justify-center rounded bg-brand-500 text-[9px] font-bold text-white">{sp.name[0]?.toUpperCase()}</span>,
      <>{sp.folders.map((f) => renderFolder(f, 1))}{sp.lists.map((l) => renderList(l, 1))}</>,
      sp.folders.length + sp.lists.length > 0);

  return (
    <div>
      <p className="mb-1 text-xs text-gray-500">
        {value.length === 0 ? 'Everything you can see (all Spaces).' : `${value.length} location${value.length === 1 ? '' : 's'} picked.`}
        {value.length > 0 && <button type="button" onClick={() => onChange([])} className="ml-2 text-brand-600 hover:underline">Use everything</button>}
      </p>
      <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200 px-2 py-1" aria-label="Locations">
        {hierarchy?.spaces.map(renderSpace)}
        {hierarchy?.shared_with_me.folders.map((f) => renderFolder(f, 0))}
        {hierarchy?.shared_with_me.lists.map((l) => renderList(l, 0))}
      </div>
    </div>
  );
};

// --- people ------------------------------------------------------------------------

export function usePeopleLabel() {
  const { members, teams } = useWork();
  const meId = useMe();
  return (token: string) => {
    if (token === 'me') return 'Me';
    if (token === 'none') return 'Unassigned';
    if (token.startsWith('team:')) return `Team: ${teams.find((t) => t.id === token.slice(5))?.name ?? 'removed Team'}`;
    const m = members.find((x) => x.user.id === token);
    return m ? m.user.display_name || m.user.email : token === meId ? 'Me' : 'Former member';
  };
}

const PeoplePicker: React.FC<{ value: string[] | null | undefined; onChange: (v: string[] | null) => void; allowNone: boolean; label: string }> = ({ value, onChange, allowNone, label }) => {
  const { members, teams } = useWork();
  const name = usePeopleLabel();
  const chosen = value ?? [];
  const add = (token: string) => token && !chosen.includes(token) && onChange([...chosen, token]);
  const remove = (token: string) => {
    const next = chosen.filter((t) => t !== token);
    onChange(next.length ? next : null);
  };
  return (
    <div>
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {chosen.map((token) => (
          <span key={token} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
            {name(token)}
            <button type="button" aria-label={`Remove ${name(token)}`} onClick={() => remove(token)}><X size={11} /></button>
          </span>
        ))}
        <select aria-label={label} value="" onChange={(e) => add(e.target.value)} className="rounded-md border border-gray-200 px-1.5 py-0.5 text-xs text-gray-600">
          <option value="">{chosen.length ? 'Add…' : 'Anyone'}</option>
          <option value="me">Me (whoever is viewing)</option>
          {allowNone && <option value="none">Unassigned</option>}
          {teams.length > 0 && <optgroup label="Teams">{teams.map((t) => <option key={t.id} value={`team:${t.id}`}>{t.name}</option>)}</optgroup>}
          <optgroup label="People">{members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.display_name || m.user.email}</option>)}</optgroup>
        </select>
      </div>
    </div>
  );
};

// --- filters -------------------------------------------------------------------------

const GROUPS: { value: StatusGroup; label: string }[] = [
  { value: 'not_started', label: 'Not started' },
  { value: 'active', label: 'Active' },
  { value: 'done', label: 'Done' },
  { value: 'closed', label: 'Closed' },
];
const PRIORITY_OPTIONS = [{ v: 1, l: 'Urgent' }, { v: 2, l: 'High' }, { v: 3, l: 'Normal' }, { v: 4, l: 'Low' }, { v: 0, l: 'None' }];

const Choice: React.FC<{ label: string; value: string | null | undefined; options: [string, string][]; onChange: (v: string | null) => void }> = ({ label, value, options, onChange }) => (
  <label className="block text-xs font-medium text-gray-600">
    {label}
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className="mt-1 block w-full rounded-md border border-gray-200 px-1.5 py-1 text-sm font-normal text-gray-800">
      <option value="">Any</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
);

/** Task filters. `peopleOnly` for time cards, which filter by who tracked the time. */
export const FiltersEditor: React.FC<{ value: Filters; onChange: (f: Filters) => void; peopleOnly?: boolean }> = ({ value, onChange, peopleOnly }) => {
  const set = <K extends keyof Filters>(key: K, v: Filters[K]) => onChange({ ...value, [key]: v });
  const toggleIn = <T,>(list: T[] | null | undefined, item: T): T[] | null => {
    const next = list?.includes(item) ? list.filter((x) => x !== item) : [...(list ?? []), item];
    return next.length ? next : null;
  };
  return (
    <div className="space-y-3">
      <PeoplePicker label={peopleOnly ? 'People (who tracked the time)' : 'Assignees'} value={value.assignees} allowNone={!peopleOnly} onChange={(v) => set('assignees', v)} />
      {!peopleOnly && (
        <>
          <div>
            <span className="text-xs font-medium text-gray-600">Status</span>
            <div className="mt-1 flex flex-wrap gap-3">
              {GROUPS.map((g) => (
                <label key={g.value} className="flex items-center gap-1 text-sm text-gray-700">
                  <input type="checkbox" checked={!!value.status_groups?.includes(g.value)} onChange={() => set('status_groups', toggleIn(value.status_groups, g.value))} />
                  {g.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="text-xs font-medium text-gray-600">Priority</span>
            <div className="mt-1 flex flex-wrap gap-3">
              {PRIORITY_OPTIONS.map((p) => (
                <label key={p.v} className="flex items-center gap-1 text-sm text-gray-700">
                  <input type="checkbox" checked={!!value.priorities?.includes(p.v)} onChange={() => set('priorities', toggleIn(value.priorities, p.v))} />
                  {p.l}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Choice label="Due date" value={value.due} onChange={(v) => set('due', v as Filters['due'])}
              options={[['overdue', 'Overdue'], ['today', 'Due today'], ['this_week', 'Due this week'], ['next_7_days', 'Due in the next 7 days'], ['set', 'Has a due date'], ['none', 'No due date']]} />
            <Choice label="Completed" value={value.done} onChange={(v) => set('done', v as Filters['done'])}
              options={[['today', 'Today'], ['this_week', 'This week'], ['last_7_days', 'Last 7 days'], ['this_month', 'This month'], ['last_30_days', 'Last 30 days']]} />
            <Choice label="Time estimate" value={value.estimate} onChange={(v) => set('estimate', v as Filters['estimate'])}
              options={[['set', 'Has an estimate'], ['missing', 'No estimate']]} />
            <Choice label="Scheduled" value={value.scheduled} onChange={(v) => set('scheduled', v as Filters['scheduled'])}
              options={[['yes', 'Has a start or due date'], ['no', 'Unscheduled']]} />
          </div>
          <label className="block text-xs font-medium text-gray-600">
            Tags <span className="font-normal text-gray-400">(any of, comma separated)</span>
            <input
              defaultValue={value.tags?.join(', ') ?? ''}
              onBlur={(e) => {
                const tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
                set('tags', tags.length ? tags : null);
              }}
              className="mt-1 block w-full rounded-md border border-gray-200 px-2 py-1 text-sm font-normal"
            />
          </label>
        </>
      )}
    </div>
  );
};

/** A one-line description of the filters that are set. */
export function useFilterSummary() {
  const name = usePeopleLabel();
  return (f: Filters): string[] => {
    const out: string[] = [];
    if (f.assignees?.length) out.push(f.assignees.map(name).join(', '));
    if (f.status_groups?.length) out.push(`Status: ${f.status_groups.map((g) => GROUPS.find((x) => x.value === g)?.label).join(', ')}`);
    if (f.priorities?.length) out.push(`Priority: ${f.priorities.map((p) => PRIORITY_OPTIONS.find((x) => x.v === p)?.l).join(', ')}`);
    if (f.due) out.push(`Due: ${f.due.replace(/_/g, ' ')}`);
    if (f.done) out.push(`Completed ${f.done.replace(/_/g, ' ')}`);
    if (f.estimate) out.push(f.estimate === 'set' ? 'Has estimate' : 'No estimate');
    if (f.scheduled) out.push(f.scheduled === 'yes' ? 'Scheduled' : 'Unscheduled');
    if (f.tags?.length) out.push(`Tags: ${f.tags.join(', ')}`);
    return out;
  };
}
