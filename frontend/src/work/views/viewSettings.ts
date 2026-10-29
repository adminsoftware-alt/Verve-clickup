// A view's saved setup, as in ClickUp: filters, sort, group by, visible columns, show closed.
// Stored in the view's `settings`, so everyone opening the view sees the same thing.
import type { Task } from '../api';
import { progressOf, type GroupBy } from './grouping';
import { countRules, matchesGroup, readAdvanced, type FilterGroup } from './filterGroups';

export type DueFilter = 'overdue' | 'today' | 'this_week' | 'next_week' | 'no_date' | 'has_date';
export type StartFilter = 'started' | 'today' | 'this_week' | 'next_week' | 'no_date';
export type DoneFilter = 'today' | 'this_week' | 'last_week' | 'this_month';
export type CreatedFilter = 'today' | 'this_week' | 'this_month';
export type EstimateFilter = 'none' | 'under_1h' | '1_to_4h' | 'over_4h';
export type TrackedFilter = 'none' | 'some' | 'over_estimate';
export type SortField = 'manual' | 'name' | 'status' | 'due_date' | 'start_date' | 'priority' | 'created_at' | 'updated_at' | 'time_estimate' | 'time_tracked';
export type ColumnKey = 'custom_id' | 'assignee' | 'start_date' | 'due_date' | 'priority' | 'time_tracked' | 'time_estimate' | 'tags' | 'created_at';

export interface ViewFilters {
  statuses: string[]; // status names, lower-case (Lists can have different sets)
  assignees: string[]; // user ids, 'me', or 'none'
  priorities: number[]; // 1-4, 0 = no priority
  tags: string[]; // lower-case names
  due: DueFilter[];
  groups: string[]; // task group ids, or 'none'
  // The rest of what the Dashboard's card filter asks. Optional, so views saved before they
  // existed -- and every caller that builds a filter by hand -- read as "not filtered".
  start?: StartFilter[];
  done?: DoneFilter[];
  created?: CreatedFilter[];
  estimate?: EstimateFilter[];
  tracked?: TrackedFilter[];
  /** Rules joined by AND / OR, with nested groups (ClickUp's advanced filters). */
  advanced?: FilterGroup;
}

export interface ViewSettings {
  filters: ViewFilters;
  sort: { field: SortField; dir: 'asc' | 'desc' };
  groupBy: GroupBy;
  /** The Board's own grouping. A List is read as "what is left"; a Board is read as the flow
   *  across To do, In progress and Completed, so the two want different defaults. */
  boardGroupBy: GroupBy;
  hidden: string[]; // column keys, or "cf:<field id>" for custom fields
  showClosed: boolean;
  totals: Record<string, string>; // Table column calculations
}

const GROUPINGS = ['status', 'progress', 'group', 'assignee', 'priority', 'due', 'tags', 'none'];

export const COLUMNS: { key: ColumnKey; label: string; width: string }[] = [
  { key: 'custom_id', label: 'Task ID', width: '84px' },
  { key: 'assignee', label: 'Assignee', width: '110px' },
  { key: 'start_date', label: 'Start date', width: '96px' },
  { key: 'due_date', label: 'Due date', width: '124px' }, // room for the date and a late task's reschedule button
  { key: 'priority', label: 'Priority', width: '100px' },
  { key: 'time_tracked', label: 'Time tracked', width: '120px' },
  { key: 'time_estimate', label: 'Time estimate', width: '96px' },
  { key: 'tags', label: 'Tags', width: '150px' },
  { key: 'created_at', label: 'Date created', width: '104px' },
];

export const SORT_FIELDS: { key: SortField; label: string }[] = [
  { key: 'manual', label: 'Manual' },
  { key: 'name', label: 'Task name' },
  { key: 'status', label: 'Status' },
  { key: 'due_date', label: 'Due date' },
  { key: 'start_date', label: 'Start date' },
  { key: 'priority', label: 'Priority' },
  { key: 'created_at', label: 'Date created' },
  { key: 'updated_at', label: 'Date updated' },
  { key: 'time_estimate', label: 'Time estimate' },
  { key: 'time_tracked', label: 'Time tracked' },
];

export const DUE_FILTERS: { key: DueFilter; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This week' },
  { key: 'next_week', label: 'Next week' },
  { key: 'no_date', label: 'No due date' },
  { key: 'has_date', label: 'Has a due date' },
];

export const START_FILTERS: { key: StartFilter; label: string }[] = [
  { key: 'started', label: 'Already started' },
  { key: 'today', label: 'Starts today' },
  { key: 'this_week', label: 'Starts this week' },
  { key: 'next_week', label: 'Starts next week' },
  { key: 'no_date', label: 'No start date' },
];
export const DONE_FILTERS: { key: DoneFilter; label: string }[] = [
  { key: 'today', label: 'Done today' },
  { key: 'this_week', label: 'Done this week' },
  { key: 'last_week', label: 'Done last week' },
  { key: 'this_month', label: 'Done this month' },
];
export const CREATED_FILTERS: { key: CreatedFilter; label: string }[] = [
  { key: 'today', label: 'Created today' },
  { key: 'this_week', label: 'Created this week' },
  { key: 'this_month', label: 'Created this month' },
];
export const ESTIMATE_FILTERS: { key: EstimateFilter; label: string }[] = [
  { key: 'none', label: 'No estimate' },
  { key: 'under_1h', label: 'Under 1 hour' },
  { key: '1_to_4h', label: '1 to 4 hours' },
  { key: 'over_4h', label: 'Over 4 hours' },
];
export const TRACKED_FILTERS: { key: TrackedFilter; label: string }[] = [
  { key: 'none', label: 'No time tracked' },
  { key: 'some', label: 'Some time tracked' },
  { key: 'over_estimate', label: 'Over its estimate' },
];

export const EMPTY_FILTERS: ViewFilters = { statuses: [], assignees: [], priorities: [], tags: [], due: [], groups: [] };
export const DEFAULT_SETTINGS: ViewSettings = {
  filters: EMPTY_FILTERS,
  sort: { field: 'manual', dir: 'asc' },
  groupBy: 'status',
  boardGroupBy: 'progress',
  hidden: ['custom_id', 'tags', 'created_at'],
  showClosed: false,
  totals: {},
};

const arr = <T,>(v: unknown, ok: (x: unknown) => boolean): T[] => (Array.isArray(v) ? (v.filter(ok) as T[]) : []);
const isStr = (x: unknown) => typeof x === 'string';

/** Read whatever is stored, tolerating older or partial settings. */
export function readSettings(raw: Record<string, unknown> | undefined, viewType?: string): ViewSettings {
  const r = (raw ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const f = (r.filters ?? {}) as Record<string, unknown>;
  const sortField = SORT_FIELDS.some((x) => x.key === r.sort?.field) ? r.sort.field : 'manual';
  return {
    filters: {
      statuses: arr<string>(f.statuses, isStr),
      assignees: arr<string>(f.assignees, isStr),
      priorities: arr<number>(f.priorities, (x) => typeof x === 'number'),
      tags: arr<string>(f.tags, isStr),
      due: arr<DueFilter>(f.due, (x) => DUE_FILTERS.some((d) => d.key === x)),
      groups: arr<string>(f.groups, isStr),
      start: arr<StartFilter>(f.start, (x) => START_FILTERS.some((d) => d.key === x)),
      done: arr<DoneFilter>(f.done, (x) => DONE_FILTERS.some((d) => d.key === x)),
      created: arr<CreatedFilter>(f.created, (x) => CREATED_FILTERS.some((d) => d.key === x)),
      estimate: arr<EstimateFilter>(f.estimate, (x) => ESTIMATE_FILTERS.some((d) => d.key === x)),
      tracked: arr<TrackedFilter>(f.tracked, (x) => TRACKED_FILTERS.some((d) => d.key === x)),
      ...(readAdvanced(f.advanced) && countRules(readAdvanced(f.advanced)) > 0 ? { advanced: readAdvanced(f.advanced) } : {}),
    },
    sort: { field: sortField, dir: r.sort?.dir === 'desc' ? 'desc' : 'asc' },
    groupBy: GROUPINGS.includes(r.groupBy) ? r.groupBy : 'status',
    boardGroupBy: GROUPINGS.includes(r.boardGroupBy) ? r.boardGroupBy : 'progress',
    hidden: Array.isArray(r.hidden) ? arr<string>(r.hidden, (x) => typeof x === 'string' && x.length <= 64) : viewType === 'table' ? [] : DEFAULT_SETTINGS.hidden,
    showClosed: r.showClosed === true,
    totals: r.totals && typeof r.totals === 'object' ? Object.fromEntries(Object.entries(r.totals as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {},
  };
}

export const sameSettings = (a: ViewSettings, b: ViewSettings) => JSON.stringify(a) === JSON.stringify(b);

export function filterCount(f: ViewFilters): number {
  return f.statuses.length + f.assignees.length + f.priorities.length + f.tags.length + f.due.length + f.groups.length
    + (f.start?.length ?? 0) + (f.done?.length ?? 0) + (f.created?.length ?? 0) + (f.estimate?.length ?? 0) + (f.tracked?.length ?? 0)
    + countRules(f.advanced);
}

// --- dates ---------------------------------------------------------------------------------------

const DAY = 86_400_000;
export const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Start of this week (Sunday, matching the timesheet default). */
const startOfWeek = () => { const t = startOfToday(); return t - new Date(t).getDay() * DAY; };

export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'later' | 'none';
export function dueBucket(task: Task): DueBucket {
  if (!task.due_date) return 'none';
  const due = new Date(task.due_date).getTime();
  const today = startOfToday();
  const week = startOfWeek();
  if (due < today) return task.status.group === 'closed' || task.status.group === 'done' ? 'this_week' : 'overdue';
  if (due < today + DAY) return 'today';
  if (due < today + 2 * DAY) return 'tomorrow';
  if (due < week + 7 * DAY) return 'this_week';
  if (due < week + 14 * DAY) return 'next_week';
  return 'later';
}

function matchesDue(task: Task, f: DueFilter): boolean {
  const b = dueBucket(task);
  switch (f) {
    case 'overdue': return task.is_overdue;
    case 'today': return b === 'today';
    case 'this_week': return !!task.due_date && (b === 'today' || b === 'tomorrow' || b === 'this_week');
    case 'next_week': return b === 'next_week';
    case 'no_date': return !task.due_date;
    case 'has_date': return !!task.due_date;
  }
}

/** Where a moment falls against today: this day, this week (Sunday first), next or last week, this month. */
function within(iso: string, span: 'today' | 'this_week' | 'next_week' | 'last_week' | 'this_month'): boolean {
  const t = new Date(iso).getTime();
  const today = startOfToday();
  const week = startOfWeek();
  switch (span) {
    case 'today': return t >= today && t < today + DAY;
    case 'this_week': return t >= week && t < week + 7 * DAY;
    case 'next_week': return t >= week + 7 * DAY && t < week + 14 * DAY;
    case 'last_week': return t >= week - 7 * DAY && t < week;
    case 'this_month': {
      const d = new Date(today);
      return t >= new Date(d.getFullYear(), d.getMonth(), 1).getTime() && t < new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    }
  }
}

function matchesStart(t: Task, f: StartFilter): boolean {
  if (f === 'no_date') return !t.start_date;
  if (!t.start_date) return false;
  return f === 'started' ? new Date(t.start_date).getTime() < startOfToday() + DAY : within(t.start_date, f);
}

function matchesEstimate(t: Task, f: EstimateFilter): boolean {
  const s = t.time_estimate_seconds;
  if (f === 'none') return !s;
  if (!s) return false;
  return f === 'under_1h' ? s < 3600 : f === '1_to_4h' ? s <= 4 * 3600 : s > 4 * 3600;
}

function matchesTracked(t: Task, f: TrackedFilter): boolean {
  if (f === 'none') return !t.time_tracked_seconds;
  if (f === 'some') return t.time_tracked_seconds > 0;
  return !!t.time_estimate_seconds && t.time_tracked_seconds > t.time_estimate_seconds;
}

// --- filtering and sorting -----------------------------------------------------------------------

/** ClickUp's filters: any of the chosen values within a field, and every field must match. */
export function applyFilters(tasks: Task[], f: ViewFilters, me: string | undefined, meMode: boolean): Task[] {
  const wantAssignees = f.assignees.map((a) => (a === 'me' ? me : a));
  return tasks.filter((t) => {
    if (meMode && !t.assignees.some((u) => u.id === me)) return false;
    // Two panels write into this one field. The older one stores a status name, lower-cased --
    // "in review" -- because inside a List that is the useful distinction. The newer one stores
    // one of the three states, "todo" / "doing" / "done", because above a List twenty near
    // duplicate status names is not a filter anybody can use. A task matches either way, so
    // whichever panel set it, the filter means what the person picked.
    if (f.statuses.length
      && !f.statuses.includes(t.status.name.toLowerCase())
      && !f.statuses.includes(progressOf(t))) return false;
    if (wantAssignees.length) {
      const ok = wantAssignees.some((a) => (a === 'none' ? t.assignees.length === 0 : t.assignees.some((u) => u.id === a)));
      if (!ok) return false;
    }
    if (f.priorities.length && !f.priorities.includes(t.priority ?? 0)) return false;
    if (f.tags.length && !t.tags.some((tag) => f.tags.includes(tag.name.toLowerCase()))) return false;
    if (f.due.length && !f.due.some((d) => matchesDue(t, d))) return false;
    if (f.groups.length && !f.groups.includes(t.group?.id ?? 'none')) return false;
    if (f.start?.length && !f.start.some((x) => matchesStart(t, x))) return false;
    if (f.done?.length && !(t.date_done && f.done.some((x) => within(t.date_done!, x)))) return false;
    if (f.created?.length && !f.created.some((x) => within(t.created_at, x))) return false;
    if (f.estimate?.length && !f.estimate.some((x) => matchesEstimate(t, x))) return false;
    if (f.tracked?.length && !f.tracked.some((x) => matchesTracked(t, x))) return false;
    if (f.advanced && !matchesGroup(t, f.advanced, me, (task, key) => matchesDue(task, key as DueFilter))) return false;
    return true;
  });
}

const STATUS_ORDER = ['not_started', 'active', 'done', 'closed'];

/** Sort; empty values always go last, whichever the direction. */
export function sortTasks(tasks: Task[], sort: ViewSettings['sort']): Task[] {
  if (sort.field === 'manual') return tasks;
  const value = (t: Task): string | number | null => {
    switch (sort.field) {
      case 'name': return t.name.toLowerCase();
      case 'status': return STATUS_ORDER.indexOf(t.status.group) * 1000 + t.status.orderindex;
      case 'due_date': return t.due_date ? new Date(t.due_date).getTime() : null;
      case 'start_date': return t.start_date ? new Date(t.start_date).getTime() : null;
      case 'priority': return t.priority;
      case 'created_at': return new Date(t.created_at).getTime();
      case 'updated_at': return new Date(t.updated_at).getTime();
      case 'time_estimate': return t.time_estimate_seconds;
      case 'time_tracked': return t.time_tracked_seconds || null;
      default: return null;
    }
  };
  const dir = sort.dir === 'desc' ? -1 : 1;
  return [...tasks].sort((a, b) => {
    const x = value(a), y = value(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}
