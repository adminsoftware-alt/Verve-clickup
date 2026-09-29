import type { Status, StatusGroup, Task, TaskGroupRef, TaskType, UserRef } from '../api';
import { PRIORITIES } from '../ui';
import { FEATURES } from '../../config/features';
import { dueBucket, type DueBucket } from './viewSettings';

export type GroupBy = 'status' | 'progress' | 'group' | 'type' | 'assignee' | 'priority' | 'due' | 'tags' | 'none';
export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  status: 'Status', progress: 'Progress', group: 'Task group', type: 'Task type', assignee: 'Assignee',
  priority: 'Priority', due: 'Due date', tags: 'Tags', none: 'None',
};

/**
 * To do, In progress, Completed -- the three states every status belongs to.
 *
 * Above a List this is the only grouping that can hold still: one List's "In review" is a
 * different record from another's, so grouping by status across Lists makes a column per name.
 * Grouping by progress gives the same three columns wherever you are, which is what makes a
 * Board usable outside a single List.
 */
export const PROGRESS_COLUMNS: { key: string; name: string; color: string; groups: StatusGroup[] }[] = [
  { key: 'todo', name: 'To do', color: '#94a3b8', groups: ['not_started'] },
  { key: 'doing', name: 'In progress', color: '#3b82f6', groups: ['active'] },
  { key: 'done', name: 'Completed', color: '#10b981', groups: ['done', 'closed'] },
];

export const progressOf = (task: Task) =>
  PROGRESS_COLUMNS.find((c) => c.groups.includes(task.status.group))?.key ?? 'todo';
export const NO_GROUP = '__none';

export interface StatusGroupOfTasks { key: string; status: Status; tasks: Task[] }

const GROUP_ORDER = ['not_started', 'active', 'done', 'closed'];

/**
 * Group tasks by status. Inside one List every status is shown, even when empty, in the
 * List's own order. Above a List, statuses can differ per List, so tasks are grouped by
 * status name and only statuses in use are shown.
 */
export function groupTasks(tasks: Task[], statuses: Status[] | null): StatusGroupOfTasks[] {
  const groups = new Map<string, StatusGroupOfTasks>();
  const keyOf = (st: Status) => (statuses ? st.id : `${st.name.toLowerCase()}|${st.group}`);
  (statuses ?? []).forEach((st) => groups.set(keyOf(st), { key: keyOf(st), status: st, tasks: [] }));
  tasks.forEach((t) => {
    const key = keyOf(t.status);
    if (!groups.has(key)) groups.set(key, { key, status: t.status, tasks: [] });
    groups.get(key)!.tasks.push(t);
  });
  const all = [...groups.values()];
  return statuses
    ? all
    : all.sort((a, b) => GROUP_ORDER.indexOf(a.status.group) - GROUP_ORDER.indexOf(b.status.group));
}

/**
 * Group tasks by their task group ("Meetings", "Client calls"). Every group available here
 * is shown, even when empty, followed by "No group". The header reuses the status pill,
 * so each group is given a status-like shape.
 */
export function groupTasksByGroup(tasks: Task[], groups: TaskGroupRef[]): StatusGroupOfTasks[] {
  const pseudo = (g: TaskGroupRef, i: number): Status => ({ id: g.id, name: g.name, color: g.color, group: 'active', orderindex: i });
  const out = new Map<string, StatusGroupOfTasks>();
  groups.forEach((g, i) => out.set(g.id, { key: g.id, status: pseudo(g, i), tasks: [] }));
  const none: StatusGroupOfTasks = {
    key: NO_GROUP, status: { id: NO_GROUP, name: 'No group', color: '#9ca3af', group: 'not_started', orderindex: 9999 }, tasks: [],
  };
  tasks.forEach((t) => {
    if (!t.group) { none.tasks.push(t); return; }
    if (!out.has(t.group.id)) out.set(t.group.id, { key: t.group.id, status: pseudo(t.group, out.size), tasks: [] });
    out.get(t.group.id)!.tasks.push(t);
  });
  return [...out.values(), none];
}

// A group header reuses the status pill, so every group is given a status-like shape.
const pseudo = (id: string, name: string, color: string, i: number): Status => ({ id, name, color, group: 'active', orderindex: i });
const PALETTE = ['#7c3aed', '#0ea5e9', '#16a34a', '#ea580c', '#db2777', '#4f46e5', '#0d9488', '#b45309'];
const colorFor = (id: string) => PALETTE[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];

/**
 * Overdue is the only distinction that changes what anyone does next: it is late, or it is not.
 * Splitting the rest into Tomorrow / This week / Next week / Later made five headings out of one
 * idea, and a task moved between them without anything about it having changed.
 */
const COARSE_DUE: { keys: DueBucket[]; key: string; name: string; color: string }[] = [
  { keys: ['overdue'], key: 'overdue', name: 'Overdue', color: '#dc2626' },
  { keys: ['today', 'tomorrow', 'this_week', 'next_week', 'later'], key: 'upcoming', name: 'Upcoming', color: '#0ea5e9' },
  { keys: ['none'], key: 'none', name: 'No due date', color: '#9ca3af' },
];

const DUE_BUCKETS: { key: DueBucket; name: string; color: string }[] = [
  { key: 'overdue', name: 'Overdue', color: '#dc2626' },
  { key: 'today', name: 'Today', color: '#ea580c' },
  { key: 'tomorrow', name: 'Tomorrow', color: '#f59e0b' },
  { key: 'this_week', name: 'This week', color: '#0ea5e9' },
  { key: 'next_week', name: 'Next week', color: '#4f46e5' },
  { key: 'later', name: 'Later', color: '#6b7280' },
  { key: 'none', name: 'No due date', color: '#9ca3af' },
];

/**
 * Group the rows of a List or Board. A task with several assignees or tags shows in each of
 * their groups, as in ClickUp.
 */
export function buildGroups(
  by: GroupBy, tasks: Task[], statuses: Status[] | null, groups: TaskGroupRef[], people: UserRef[], types: TaskType[] = [],
): StatusGroupOfTasks[] {
  switch (by) {
    case 'status': return groupTasks(tasks, statuses);
    case 'progress': {
      const out = PROGRESS_COLUMNS.map((c, i) => ({ key: c.key, status: pseudo(c.key, c.name, c.color, i), tasks: [] as Task[] }));
      tasks.forEach((t) => out.find((g) => g.key === progressOf(t))!.tasks.push(t));
      return out;  // every column is kept, even empty: a board needs its shape to stay put
    }
    case 'group': return groupTasksByGroup(tasks, groups);
    case 'type': {
      // Every type the workspace has, in its own order, then whatever is left as plain tasks.
      const out = new Map<string, StatusGroupOfTasks>();
      types.forEach((t, i) => out.set(t.id, { key: t.id, status: pseudo(t.id, t.name, t.color, i), tasks: [] }));
      const plain: StatusGroupOfTasks = { key: NO_GROUP, status: pseudo(NO_GROUP, 'Task', '#6b7280', 9999), tasks: [] };
      tasks.forEach((t) => {
        if (!t.type_id) { plain.tasks.push(t); return; }
        if (!out.has(t.type_id)) out.set(t.type_id, { key: t.type_id, status: pseudo(t.type_id, 'Task type', colorFor(t.type_id), out.size), tasks: [] });
        out.get(t.type_id)!.tasks.push(t);
      });
      return [...out.values(), plain];
    }
    case 'none': return [{ key: 'all', status: pseudo('all', 'Tasks', '#6b7280', 0), tasks }];
    case 'priority': {
      const out = [1, 2, 3, 4].map((p, i) => ({ key: `p${p}`, status: pseudo(`p${p}`, PRIORITIES[p].label, PRIORITIES[p].color, i), tasks: [] as Task[] }));
      const none = { key: NO_GROUP, status: pseudo(NO_GROUP, 'No priority', '#9ca3af', 9), tasks: [] as Task[] };
      tasks.forEach((t) => (t.priority ? out[t.priority - 1] : none).tasks.push(t));
      return [...out, none];
    }
    case 'due': {
      const buckets = FEATURES.taskDueBucketsDetailed
        ? DUE_BUCKETS.map((b) => ({ keys: [b.key], key: b.key as string, name: b.name, color: b.color }))
        : COARSE_DUE;
      const out = buckets.map((b, i) => ({ key: b.key, status: pseudo(b.key, b.name, b.color, i), tasks: [] as Task[] }));
      tasks.forEach((t) => {
        const bucket = dueBucket(t);
        out[buckets.findIndex((b) => b.keys.includes(bucket))]?.tasks.push(t);
      });
      return out.filter((g) => g.tasks.length > 0);
    }
    case 'assignee': {
      const out = new Map<string, StatusGroupOfTasks>();
      const none: StatusGroupOfTasks = { key: NO_GROUP, status: pseudo(NO_GROUP, 'Unassigned', '#9ca3af', 9999), tasks: [] };
      tasks.forEach((t) => {
        if (t.assignees.length === 0) { none.tasks.push(t); return; }
        t.assignees.forEach((u) => {
          const who = people.find((p) => p.id === u.id) ?? u;
          if (!out.has(u.id)) out.set(u.id, { key: u.id, status: pseudo(u.id, who.display_name || who.email, colorFor(u.id), 0), tasks: [] });
          out.get(u.id)!.tasks.push(t);
        });
      });
      return [...[...out.values()].sort((a, b) => a.status.name.localeCompare(b.status.name)), none];
    }
    case 'tags': {
      const out = new Map<string, StatusGroupOfTasks>();
      const none: StatusGroupOfTasks = { key: NO_GROUP, status: pseudo(NO_GROUP, 'No tags', '#9ca3af', 9999), tasks: [] };
      tasks.forEach((t) => {
        if (t.tags.length === 0) { none.tasks.push(t); return; }
        t.tags.forEach((tag) => {
          const key = tag.name.toLowerCase();
          if (!out.has(key)) out.set(key, { key, status: pseudo(key, tag.name, tag.bg_color, 0), tasks: [] });
          out.get(key)!.tasks.push(t);
        });
      });
      return [...[...out.values()].sort((a, b) => a.status.name.localeCompare(b.status.name)), none];
    }
  }
}

/** Which group key(s) a task is in, for drag and drop. */
export function keysOf(by: GroupBy, t: Task): string[] {
  switch (by) {
    case 'status': return [t.status.id];
    case 'progress': return [progressOf(t)];
    case 'group': return [t.group?.id ?? NO_GROUP];
    case 'type': return [t.type_id ?? NO_GROUP];
    case 'priority': return [t.priority ? `p${t.priority}` : NO_GROUP];
    case 'assignee': return t.assignees.length ? t.assignees.map((u) => u.id) : [NO_GROUP];
    case 'tags': return t.tags.length ? t.tags.map((x) => x.name.toLowerCase()) : [NO_GROUP];
    case 'due': return [dueBucket(t)];
    case 'none': return ['all'];
  }
}
