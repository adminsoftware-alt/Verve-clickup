// Client for Timesheets, time tags, working hours and approvals (/api/v2).
import { request, type Status, type UserRef } from '../api';

export interface TimeTag { id: string; name: string; bg_color: string; fg_color: string }
export type SubmissionStatus = 'pending' | 'approved' | 'changes_needed' | 'withdrawn';

export interface SheetEntry {
  id: string; task_id: string; started_at: string; ended_at: string | null; duration_seconds: number | null;
  running: boolean; description: string | null; billable: boolean; tags: TimeTag[]; day: number; created_by: string | null;
}
export interface SheetRow {
  task: { id: string; name: string; status: Status | null; location: string; list_id: string | null; archived: boolean; can_open: boolean };
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
  trackedOp?: 'gt' | 'lt' | null; trackedSeconds?: number | null; sort?: 'date_added' | 'name'; descending?: boolean;
}
export interface PickTask { id: string; name: string; status: Status; location: string }
export interface PersonWeek {
  user: UserRef; capacity_per_day: number[]; tracked_per_day: number[]; billable_per_day: number[];
  total_seconds: number; capacity_seconds: number; submission_status: SubmissionStatus | null;
}
export interface AllTimesheets { period_start: string; period_end: string; days: string[]; people: PersonWeek[]; approvals_enabled: boolean }
export interface SheetSettings { week_start: number; approvals_enabled: boolean; capacity_seconds: number[]; can_manage: boolean }
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
  updateSettings: (ws: string, body: Partial<Pick<SheetSettings, 'week_start' | 'approvals_enabled' | 'capacity_seconds'>>) =>
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
