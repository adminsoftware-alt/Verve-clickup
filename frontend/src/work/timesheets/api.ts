// Client for Timesheets, time tags, working hours and approvals (/api/v2).
import { request, type Status, type UserRef } from '../api';

export interface TimeTag { id: string; name: string; bg_color: string; fg_color: string }
export type SubmissionStatus = 'pending' | 'approved' | 'changes_needed' | 'withdrawn';

export interface SheetEntry {
  id: string; task_id: string; started_at: string; ended_at: string | null; duration_seconds: number | null;
  running: boolean; description: string | null; billable: boolean; tags: TimeTag[]; day: number; created_by: string | null;
}
export interface SheetTask {
  id: string; name: string; status: Status | null; location: string; list_id: string | null;
  archived: boolean; can_open: boolean;
  /** Left empty on a task the viewer cannot open, like its name and its status. */
  priority: number | null; assignees: UserRef[]; tags: string[];
  start_date: string | null; due_date: string | null; date_done: string | null;
  time_estimate_seconds: number | null;
}

export interface SheetRow {
  task: SheetTask;
  seconds_per_day: number[]; total_seconds: number; added_at: string; running: boolean; entries: SheetEntry[];
}
export interface Submission {
  id: string; user: UserRef; period_start: string; period_end: string; status: SubmissionStatus; submitted_at: string;
  decided_by: UserRef | null; decided_at: string | null; tracked_seconds: number; billable_seconds: number;
  capacity_seconds: number; can_review: boolean; approvers: UserRef[];
}
export interface Timesheet {
  user: UserRef; period_start: string; period_end: string; days: string[]; capacity_per_day: number[];
  tracked_per_day: number[]; billable_per_day: number[]; rows: SheetRow[]; total_seconds: number; week_start: number;
  approvals_enabled: boolean; submission: Submission | null; locked: boolean; can_edit: boolean;
}
export interface SheetQuery {
  userId?: string; billable?: 'all' | 'billable' | 'non_billable'; tagIds?: string[]; includeArchived?: boolean;
  /** How a row's week total is compared with `trackedSeconds`. */
  trackedOp?: TrackedOp | null; trackedSeconds?: number | null; sort?: 'date_added' | 'name'; descending?: boolean;
  // Everything below is applied in the browser. The timesheet is one person's week and it is
  // already in hand, so narrowing it here is one pass over a few dozen rows -- against a round
  // trip and a full re-render for every tick of a checkbox.
  /** Which of the three states -- todo, doing, done -- a row's task is in. */
  statuses?: string[];
  lists?: string[];
  /** "1".."4", or "0" for no priority. */
  priorities?: string[];
  /** User ids the task is assigned to, or "none" for nobody. */
  assignees?: string[];
  /** Task tag names, lower-case. Not the same thing as a time tag on an entry. */
  taskTags?: string[];
  due?: 'overdue' | 'today' | 'this_week' | 'next_7_days' | 'set' | 'none' | null;
  estimate?: 'set' | 'missing' | null;
  scheduled?: 'yes' | 'no' | null;
}

const DAY_MS = 86_400_000;

/** Does a row's task pass the filters that are applied in the browser? */
export function matchesSheetFilters(task: SheetTask, q: SheetQuery, stateOf: (t: SheetTask) => string): boolean {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  const due = task.due_date ? new Date(task.due_date).getTime() : null;

  if (q.statuses?.length && !q.statuses.includes(stateOf(task))) return false;
  if (q.lists?.length && !(task.list_id && q.lists.includes(task.list_id))) return false;
  if (q.priorities?.length && !q.priorities.includes(String(task.priority ?? 0))) return false;
  if (q.assignees?.length) {
    const ids = task.assignees.map((u) => u.id);
    if (!q.assignees.some((a) => (a === 'none' ? ids.length === 0 : ids.includes(a)))) return false;
  }
  if (q.taskTags?.length && !task.tags.some((t) => q.taskTags!.includes(t.toLowerCase()))) return false;
  if (q.estimate === 'set' && !task.time_estimate_seconds) return false;
  if (q.estimate === 'missing' && task.time_estimate_seconds) return false;
  if (q.scheduled === 'yes' && !task.start_date && !task.due_date) return false;
  if (q.scheduled === 'no' && (task.start_date || task.due_date)) return false;
  switch (q.due) {
    case 'overdue': return due !== null && due < today;
    case 'today': return due !== null && due >= today && due < today + DAY_MS;
    case 'this_week':
    case 'next_7_days': return due !== null && due >= today && due < today + 7 * DAY_MS;
    case 'set': return due !== null;
    case 'none': return due === null;
    default: return true;
  }
}

export type TrackedOp = 'gte' | 'lte' | 'gt' | 'lt' | 'eq';
export const TRACKED_OPS: { value: TrackedOp; label: string; short: string }[] = [
  { value: 'gte', label: 'Greater than or equal to', short: '\u2265' },
  { value: 'gt', label: 'Greater than', short: '>' },
  { value: 'lte', label: 'Less than or equal to', short: '\u2264' },
  { value: 'lt', label: 'Less than', short: '<' },
  { value: 'eq', label: 'Equal to', short: '=' },
];

/** Does a row's week total pass the tracked-time filter? */
export function matchesTracked(seconds: number, op: TrackedOp | null | undefined, against: number | null | undefined): boolean {
  if (!op || against == null) return true;
  switch (op) {
    case 'gte': return seconds >= against;
    case 'gt': return seconds > against;
    case 'lte': return seconds <= against;
    case 'lt': return seconds < against;
    case 'eq': return seconds === against;
  }
}
export interface PickTask { id: string; name: string; status: Status; location: string }
export interface PersonWeek {
  user: UserRef; capacity_per_day: number[]; tracked_per_day: number[]; billable_per_day: number[];
  total_seconds: number; capacity_seconds: number; submission_status: SubmissionStatus | null;
}
export interface AllTimesheets { period_start: string; period_end: string; days: string[]; people: PersonWeek[]; approvals_enabled: boolean }
export interface SheetSettings {
  week_start: number; approvals_enabled: boolean; capacity_seconds: number[]; can_manage: boolean;
  reminders_enabled: boolean; reminder_weekday: number; reminder_hour: number; reminder_timezone: string;
}
export interface Comment { id: string; user: UserRef | null; event: string | null; body: string | null; created_at: string }
export interface ApproverRow { submitter: UserRef; approvers: UserRef[]; is_custom: boolean }

export type EntryUpdate = Partial<{
  duration_seconds: number; started_at: string; ended_at: string; description: string | null;
  billable: boolean; task_id: string; tag_ids: string[];
}>;

export const viewerTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** yyyy-mm-dd of a local date. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

export const sheetApi = {
  get: (ws: string, start: string, q: SheetQuery = {}) => {
    const params = new URLSearchParams({ start, tz: viewerTz() });
    if (q.userId) params.set('user_id', q.userId);
    if (q.billable && q.billable !== 'all') params.set('billable', q.billable);
    q.tagIds?.forEach((id) => params.append('tag_ids', id));
    if (q.includeArchived) params.set('include_archived', 'true');
    if (q.trackedOp && q.trackedSeconds != null) { params.set('tracked_op', q.trackedOp); params.set('tracked_seconds', String(q.trackedSeconds)); }
    if (q.sort) params.set('sort', q.sort);
    if (q.descending) params.set('descending', 'true');
    // request() builds simple params; repeated tag_ids need a hand-built query.
    return request<Timesheet>('GET', `/workspaces/${ws}/timesheet?${params.toString()}`);
  },
  setCell: (ws: string, body: { user_id?: string; task_id: string; day: string; seconds: number }) =>
    request('PUT', `/workspaces/${ws}/timesheet/cell`, { ...body, tz: viewerTz() }),
  addRow: (ws: string, body: { user_id?: string; task_id: string; start: string }) =>
    request('POST', `/workspaces/${ws}/timesheet/rows`, { ...body, tz: viewerTz() }),
  deleteRow: (ws: string, body: { user_id?: string; task_id: string; start: string }) =>
    request('POST', `/workspaces/${ws}/timesheet/rows/delete`, { ...body, tz: viewerTz() }),
  pickTasks: (ws: string, q: string) => request<PickTask[]>('GET', `/workspaces/${ws}/timesheet/tasks`, undefined, { q }),
  all: (ws: string, start: string, teamId?: string) =>
    request<AllTimesheets>('GET', `/workspaces/${ws}/timesheets`, undefined, { start, tz: viewerTz(), team_id: teamId }),

  settings: (ws: string) => request<SheetSettings>('GET', `/workspaces/${ws}/timesheet-settings`),
  prefill: (ws: string, day: string, userId?: string) =>
    request<{ entries: number; seconds: number }>('POST', `/workspaces/${ws}/timesheet/prefill`, undefined, { day, tz: viewerTz(), user_id: userId }),
  updateSettings: (ws: string, body: Partial<Pick<SheetSettings, 'week_start' | 'approvals_enabled' | 'capacity_seconds' | 'reminders_enabled' | 'reminder_weekday' | 'reminder_hour' | 'reminder_timezone'>>) =>
    request<SheetSettings>('PATCH', `/workspaces/${ws}/timesheet-settings`, body),
  capacity: (ws: string, userId: string) => request<{ capacity_seconds: number[]; is_custom: boolean }>('GET', `/workspaces/${ws}/members/${encodeURIComponent(userId)}/capacity`),
  setCapacity: (ws: string, userId: string, seconds: number[] | null) =>
    request<{ capacity_seconds: number[]; is_custom: boolean }>('PUT', `/workspaces/${ws}/members/${encodeURIComponent(userId)}/capacity`, { capacity_seconds: seconds }),

  tags: (ws: string) => request<TimeTag[]>('GET', `/workspaces/${ws}/time-tags`),
  createTag: (ws: string, name: string) => request<TimeTag>('POST', `/workspaces/${ws}/time-tags`, { name }),

  updateEntry: (entryId: string, body: EntryUpdate) =>
    request('PATCH', `/time/${entryId}`, body),
  deleteEntry: (entryId: string) => request('DELETE', `/time/${entryId}`),

  submit: (ws: string, start: string, comment?: string) =>
    request<Submission>('POST', `/workspaces/${ws}/timesheet/submit`, { start, tz: viewerTz(), comment: comment || null }),
  submissions: (ws: string, scope: 'to_review' | 'changes_requested' | 'approved' | 'all' | 'mine') =>
    request<Submission[]>('GET', `/workspaces/${ws}/timesheet-submissions`, undefined, { scope }),
  decide: (id: string, action: 'approve' | 'request-changes' | 'reopen' | 'withdraw', comment?: string) =>
    request<Submission>('POST', `/timesheet-submissions/${id}/${action}`, action === 'withdraw' ? {} : { comment: comment || null }),
  comments: (id: string) => request<Comment[]>('GET', `/timesheet-submissions/${id}/comments`),
  comment: (id: string, body: string) => request<Comment[]>('POST', `/timesheet-submissions/${id}/comments`, { body }),
  approvers: (ws: string) => request<ApproverRow[]>('GET', `/workspaces/${ws}/timesheet-approvers`),
  setApprovers: (ws: string, submitterId: string, approverIds: string[]) =>
    request('PUT', `/workspaces/${ws}/timesheet-approvers/${encodeURIComponent(submitterId)}`, { approver_ids: approverIds }),
};

export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending: 'Pending approval', approved: 'Approved', changes_needed: 'Changes needed', withdrawn: 'Withdrawn',
};
export const STATUS_CLASS: Record<SubmissionStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  changes_needed: 'bg-red-50 text-red-700 border-red-200',
  withdrawn: 'bg-gray-50 text-gray-600 border-gray-200',
};
