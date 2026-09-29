// Advanced filters, as in ClickUp: rules joined by AND or OR, and groups of rules inside that.
// Stored with the view's filters as `advanced`.
import type { Task } from '../api';

export type RuleField = 'status' | 'assignee' | 'priority' | 'tag' | 'due' | 'name' | 'group' | 'points' | `cf:${string}`;
export type RuleOp = 'is' | 'is_not' | 'contains' | 'not_contains' | 'is_set' | 'is_not_set' | 'gt' | 'lt';
export interface FilterRule { id: string; field: RuleField; op: RuleOp; value: string | number | null }
export interface FilterGroup { id: string; match: 'all' | 'any'; rules: FilterRule[]; groups: FilterGroup[] }

export const emptyGroup = (): FilterGroup => ({ id: Math.random().toString(36).slice(2, 9), match: 'all', rules: [], groups: [] });
export const newRule = (field: RuleField = 'status'): FilterRule => ({ id: Math.random().toString(36).slice(2, 9), field, op: defaultOp(field), value: null });

export function defaultOp(field: RuleField): RuleOp {
  if (field === 'name' || field.startsWith('cf:')) return field === 'name' ? 'contains' : 'is_set';
  if (field === 'points') return 'gt';
  return 'is';
}

export const OPS: Record<string, { op: RuleOp; label: string }[]> = {
  choice: [{ op: 'is', label: 'is' }, { op: 'is_not', label: 'is not' }, { op: 'is_set', label: 'is set' }, { op: 'is_not_set', label: 'is not set' }],
  text: [{ op: 'contains', label: 'contains' }, { op: 'not_contains', label: "doesn't contain" }, { op: 'is_set', label: 'is set' }, { op: 'is_not_set', label: 'is not set' }],
  number: [{ op: 'gt', label: 'more than' }, { op: 'lt', label: 'less than' }, { op: 'is', label: 'equals' }, { op: 'is_set', label: 'is set' }, { op: 'is_not_set', label: 'is not set' }],
};
export const opsFor = (field: RuleField) =>
  field === 'name' ? OPS.text : field === 'points' ? OPS.number : field.startsWith('cf:') ? OPS.text : OPS.choice;
export const needsValue = (op: RuleOp) => op !== 'is_set' && op !== 'is_not_set';

export function countRules(g: FilterGroup | undefined): number {
  return g ? g.rules.length + g.groups.reduce((n, x) => n + countRules(x), 0) : 0;
}

function readGroup(raw: unknown, depth = 0): FilterGroup | undefined {
  if (!raw || typeof raw !== 'object' || depth > 3) return undefined;
  const r = raw as Partial<FilterGroup>;
  return {
    id: typeof r.id === 'string' ? r.id : emptyGroup().id,
    match: r.match === 'any' ? 'any' : 'all',
    rules: Array.isArray(r.rules) ? r.rules.filter((x): x is FilterRule => !!x && typeof x === 'object' && typeof x.field === 'string' && typeof x.op === 'string') : [],
    groups: Array.isArray(r.groups) ? r.groups.map((x) => readGroup(x, depth + 1)).filter((x): x is FilterGroup => !!x) : [],
  };
}
export const readAdvanced = readGroup;

type DueTest = (task: Task, key: string) => boolean;

function testRule(t: Task, r: FilterRule, me: string | undefined, due: DueTest): boolean {
  const v = r.value;
  const setOp = r.op === 'is_set' || r.op === 'is_not_set';
  const want = r.op !== 'is_not' && r.op !== 'not_contains' && r.op !== 'is_not_set';
  let hit: boolean;
  switch (r.field) {
    case 'status': hit = setOp ? true : t.status.name.toLowerCase() === String(v ?? '').toLowerCase(); break;
    case 'assignee': hit = setOp ? t.assignees.length > 0 : t.assignees.some((u) => u.id === (v === 'me' ? me : v)); break;
    case 'priority': hit = setOp ? t.priority != null : (t.priority ?? 0) === Number(v); break;
    case 'tag': hit = setOp ? t.tags.length > 0 : t.tags.some((x) => x.name.toLowerCase() === String(v ?? '').toLowerCase()); break;
    case 'due': hit = setOp ? !!t.due_date : due(t, String(v)); break;
    case 'group': hit = setOp ? !!t.group : (t.group?.id ?? 'none') === v; break;
    case 'name': hit = setOp ? !!t.name : t.name.toLowerCase().includes(String(v ?? '').toLowerCase()); break;
    case 'points': {
      const p = t.points;
      if (setOp) { hit = p != null; break; }
      if (p == null || v === null || v === '') return false;
      return r.op === 'gt' ? p > Number(v) : r.op === 'lt' ? p < Number(v) : p === Number(v);
    }
    default: {
      const raw = t.custom_fields?.[r.field.slice(3)];
      const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
      if (setOp) { hit = !empty; break; }
      const text = (typeof raw === 'object' && raw ? JSON.stringify(raw) : String(raw ?? '')).toLowerCase();
      hit = !empty && text.includes(String(v ?? '').toLowerCase());
    }
  }
  return want ? hit : !hit;
}

/** Does the task pass this group? Empty groups pass everything. */
export function matchesGroup(t: Task, g: FilterGroup, me: string | undefined, due: DueTest): boolean {
  const results = [
    ...g.rules.filter((r) => !needsValue(r.op) || (r.value !== null && r.value !== '')).map((r) => testRule(t, r, me, due)),
    ...g.groups.filter((x) => countRules(x) > 0).map((x) => matchesGroup(t, x, me, due)),
  ];
  if (results.length === 0) return true;
  return g.match === 'all' ? results.every(Boolean) : results.some(Boolean);
}
