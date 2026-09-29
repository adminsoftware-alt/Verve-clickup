// The "Advanced" part of the Filter panel: rules joined by AND / OR, and groups of rules.
import React from 'react';
import { Plus, X } from 'lucide-react';
import type { Status, TaskGroupRef, UserRef } from '../api';
import { PRIORITIES } from '../ui';
import { emptyGroup, needsValue, newRule, opsFor, type FilterGroup, type FilterRule, type RuleField } from './filterGroups';
import { DUE_FILTERS } from './viewSettings';

interface Options { statuses: Status[]; tags: string[]; groups: TaskGroupRef[]; people: UserRef[]; fields: { id: string; name: string }[] }

const FIELD_LABELS: { field: RuleField; label: string }[] = [
  { field: 'status', label: 'Status' }, { field: 'assignee', label: 'Assignee' }, { field: 'priority', label: 'Priority' },
  { field: 'tag', label: 'Tag' }, { field: 'due', label: 'Due date' }, { field: 'name', label: 'Task name' },
  { field: 'group', label: 'Task group' }, { field: 'points', label: 'Sprint points' },
];
const sel = 'rounded border border-gray-200 px-1 py-0.5 text-xs';

const ValueInput: React.FC<{ rule: FilterRule; o: Options; onChange: (v: string | number | null) => void }> = ({ rule, o, onChange }) => {
  const v = rule.value ?? '';
  const choose = (items: { value: string; label: string }[]) => (
    <select aria-label="Value" value={String(v)} onChange={(e) => onChange(e.target.value || null)} className={`${sel} min-w-0 flex-1`}>
      <option value="">Choose…</option>
      {items.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
    </select>
  );
  switch (rule.field) {
    case 'status': return choose(o.statuses.map((s) => ({ value: s.name.toLowerCase(), label: s.name })));
    case 'assignee': return choose([{ value: 'me', label: 'Me' }, ...o.people.map((p) => ({ value: p.id, label: p.display_name || p.email }))]);
    case 'priority': return choose([...[1, 2, 3, 4].map((p) => ({ value: String(p), label: PRIORITIES[p].label })), { value: '0', label: 'No priority' }]);
    case 'tag': return choose(o.tags.map((t) => ({ value: t.toLowerCase(), label: t })));
    case 'due': return choose(DUE_FILTERS.map((d) => ({ value: d.key, label: d.label })));
    case 'group': return choose([...o.groups.map((g) => ({ value: g.id, label: g.name })), { value: 'none', label: 'No group' }]);
    case 'points': return <input aria-label="Value" type="number" value={String(v)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className={`${sel} w-20`} />;
    default: return <input aria-label="Value" value={String(v)} onChange={(e) => onChange(e.target.value)} className={`${sel} min-w-0 flex-1`} placeholder="text" />;
  }
};

const Group: React.FC<{ group: FilterGroup; o: Options; depth: number; onChange: (g: FilterGroup) => void; onRemove?: () => void }> = ({ group, o, depth, onChange, onRemove }) => {
  const setRule = (id: string, patch: Partial<FilterRule>) => onChange({ ...group, rules: group.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const allFields = [...FIELD_LABELS, ...o.fields.map((f) => ({ field: `cf:${f.id}` as RuleField, label: f.name }))];
  const joiner = group.match === 'all' ? 'AND' : 'OR';
  return (
    <div role="group" aria-label={depth ? 'Filter group' : 'Advanced filters'} className={depth ? 'rounded-md border border-dashed border-brand-200 bg-brand-50/40 p-2' : ''}>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
        Match
        <select aria-label="Match" value={group.match} onChange={(e) => onChange({ ...group, match: e.target.value as 'all' | 'any' })} className={sel}>
          <option value="all">all of these (AND)</option>
          <option value="any">any of these (OR)</option>
        </select>
        {onRemove && <button type="button" aria-label="Remove group" onClick={onRemove} className="ml-auto rounded p-0.5 text-gray-400 hover:text-red-600"><X size={12} /></button>}
      </div>
      <ul className="space-y-1">
        {group.rules.map((r, i) => (
          <li key={r.id} className="flex items-center gap-1" aria-label="Filter rule">
            <span className="w-8 shrink-0 text-right text-[10px] font-semibold text-brand-500">{i === 0 ? 'Where' : joiner}</span>
            <select aria-label="Field" value={r.field} onChange={(e) => { const f = e.target.value as RuleField; setRule(r.id, { field: f, op: newRule(f).op, value: null }); }} className={sel}>
              {allFields.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
            </select>
            <select aria-label="Condition" value={r.op} onChange={(e) => setRule(r.id, { op: e.target.value as FilterRule['op'] })} className={sel}>
              {opsFor(r.field).map((x) => <option key={x.op} value={x.op}>{x.label}</option>)}
            </select>
            {needsValue(r.op) && <ValueInput rule={r} o={o} onChange={(value) => setRule(r.id, { value: r.field === 'priority' && value !== null ? Number(value) : value })} />}
            <button type="button" aria-label="Remove rule" onClick={() => onChange({ ...group, rules: group.rules.filter((x) => x.id !== r.id) })} className="rounded p-0.5 text-gray-400 hover:text-red-600"><X size={12} /></button>
          </li>
        ))}
        {group.groups.map((g, i) => (
          <li key={g.id} className="flex gap-1">
            <span className="w-8 shrink-0 pt-2 text-right text-[10px] font-semibold text-brand-500">{group.rules.length + i === 0 ? 'Where' : joiner}</span>
            <div className="min-w-0 flex-1">
              <Group group={g} o={o} depth={depth + 1} onChange={(next) => onChange({ ...group, groups: group.groups.map((x) => (x.id === g.id ? next : x)) })}
                onRemove={() => onChange({ ...group, groups: group.groups.filter((x) => x.id !== g.id) })} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex gap-2 pl-9 text-xs">
        <button type="button" onClick={() => onChange({ ...group, rules: [...group.rules, newRule()] })} className="flex items-center gap-0.5 text-brand-600 hover:underline"><Plus size={11} /> Add rule</button>
        {depth < 2 && (
          <button type="button" onClick={() => onChange({ ...group, groups: [...group.groups, { ...emptyGroup(), match: group.match === 'all' ? 'any' : 'all', rules: [newRule()] }] })}
            className="flex items-center gap-0.5 text-brand-600 hover:underline"><Plus size={11} /> Add group</button>
        )}
      </div>
    </div>
  );
};

export const AdvancedFilters: React.FC<Options & { value: FilterGroup | undefined; onChange: (g: FilterGroup | undefined) => void }> = ({ value, onChange, ...o }) => (
  <section className="mb-2 border-t border-gray-100 pt-2">
    <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Advanced (AND / OR)</h4>
    {value ? (
      <>
        <Group group={value} o={o} depth={0} onChange={(g) => onChange(g.rules.length || g.groups.length ? g : undefined)} />
      </>
    ) : (
      <button type="button" onClick={() => onChange({ ...emptyGroup(), rules: [newRule()] })} className="flex items-center gap-1 text-xs text-brand-600 hover:underline">
        <Plus size={11} /> Add an advanced filter
      </button>
    )}
  </section>
);
