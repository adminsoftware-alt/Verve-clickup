// Client for Dashboards, cards, sharing and email reports (/api/v2).
import { request, type Level, type Share, type StatusGroup, type TaskPage, type TeamRef, type UserRef } from '../api';

export type CardType = 'calculation' | 'pie' | 'bar' | 'task_list' | 'time_report' | 'timesheet' | 'portfolio' | 'behind' | 'completed' | 'notes' | 'line' | 'discussion' | 'embed'
  | 'worked_on' | 'battery' | 'goal' | 'sprint' | 'capacity' | 'variance' | 'plan';
export interface BehindRow { key: string; user: import('../api').UserRef | null; overdue: number; oldest_days: number; tasks: { id: string; name: string; days: number }[] }
export interface CompletedRow { key: string; user: import('../api').UserRef | null; done: number; late: number }
export type DashLevel = Exclude<Level, 'comment'>;
export type Relation = 'mine' | 'team' | 'shared' | 'my_team' | 'everyone' | 'location';
export type Template = 'blank' | 'simple' | 'vapl_review' | 'time_tracking' | 'monthly_review';

export interface Source { kind: 'space' | 'folder' | 'list'; id: string }
export type PeriodPreset =
  | 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month'
  | 'last_7_days' | 'last_30_days' | 'this_quarter' | 'last_quarter' | 'this_year' | 'custom';
export interface Period { preset: PeriodPreset; start?: string | null; end?: string | null }

export interface Filters {
  /** User ids, or "me", "team:<id>", and (for assignees) "none". */
  assignees?: string[] | null;
  status_groups?: StatusGroup[] | null;
  priorities?: number[] | null; // 0 = no priority
  tags?: string[] | null;
  /** "period" means "inside the card's own period", so one control can re-scope the card. */
  due?: 'overdue' | 'today' | 'this_week' | 'next_7_days' | 'none' | 'set' | 'period' | null;
  estimate?: 'set' | 'missing' | null;
  scheduled?: 'yes' | 'no' | null;
  done?: 'today' | 'this_week' | 'this_month' | 'last_7_days' | 'last_30_days' | 'period' | null;
}

/** A built-in, or `custom:<field id>` for one of the Space's own fields. */
export type Measure = 'tasks' | 'time_estimate' | 'time_tracked' | `custom:${string}`;
export type GroupBy = 'status' | 'status_group' | 'assignee' | 'priority' | 'tag' | 'list' | 'done_date' | 'created_date' | 'due_date' | `custom:${string}`;

export interface CardConfig {
  sources: Source[];
  include_subtasks: boolean;
  include_closed: boolean;
  filters: Filters;
  measure: Measure;
  fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
  unit: string | null;
  group_by: GroupBy;
  interval: 'day' | 'week' | 'month';
  donut: boolean;
  period: Period;
  time_group_by: 'user' | 'list' | 'task';
  then_by: 'task' | 'list' | 'none';
  billable: 'all' | 'billable' | 'non_billable';
  show_estimates: boolean;
  sort: 'due' | 'priority' | 'updated' | 'name';
  limit: number;
  text: string | null;
  url?: string | null;
  goal_ids?: string[];
  folder_id?: string | null;
}

export interface DiscussionMessage { id: string; body: string; created_at: string; user: UserRef | null }

export interface Card { id: string; type: CardType; title: string; config: CardConfig; position: number; width: number; height: number }

export interface DashboardSummary {
  id: string; name: string; owner: UserRef | null; team: TeamRef | null; your_level: DashLevel;
  relation: Relation; is_shared: boolean; card_count: number; created_at: string; updated_at: string;
  /** Set on the Dashboards made for you: your own work, a Team you lead, or the whole company. */
  standard?: 'my_work' | 'team' | 'company' | null;
}
export interface Dashboard extends DashboardSummary { filters: Filters; auto_refresh: boolean; cards: Card[] }

export interface Segment { key: string; label: string; color: string; value: number }
export interface CardData {
  card_id: string; type: CardType; computed_at: string; no_access: boolean; hidden_sources: number;
  error: string | null;
  // The shape depends on the card type; see the card renderers.
  data: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
export interface TimeRow {
  key: string; label: string; seconds: number; estimate_seconds?: number;
  /** That person's working hours over the period. Only when the card groups by person. */
  capacity_seconds?: number;
  children: { key: string; label: string; seconds: number }[];
}
export interface PortfolioRow {
  list_id: string; name: string; path: string; total: number; open: number; done: number; overdue: number;
  progress: number; estimate_seconds: number; tracked_seconds: number;
}

export interface DashboardSharing { your_level: DashLevel; shares: Share[] }

export type Frequency = 'daily' | 'weekdays' | 'weekly' | 'monthly';
export interface ScheduleIn {
  recipient_ids: string[]; subject?: string | null; frequency: Frequency; weekday?: number | null;
  day_of_month?: number | null; send_time: string; timezone: string; active: boolean;
}
export interface Schedule extends Omit<ScheduleIn, 'recipient_ids'> {
  id: string; dashboard_id: string; created_by: UserRef | null; recipients: UserRef[];
  next_run_at: string | null; last_run_at: string | null;
}
export interface ReportRun {
  id: string; schedule_id: string | null; status: 'sent' | 'not_sent' | 'failed'; recipients: string[];
  subject: string; error: string | null; created_at: string;
}

export const viewerTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const tz = () => ({ tz: viewerTimezone() });

export const dashApi = {
  list: (workspaceId: string) => request<DashboardSummary[]>('GET', `/workspaces/${workspaceId}/dashboards`),
  /** The Dashboard the app opens on: your own "My work". */
  home: (workspaceId: string) => request<Dashboard>('GET', `/workspaces/${workspaceId}/dashboards/home`),
  create: (workspaceId: string, body: { name: string; team_id?: string | null; template: Template; sources: Source[] }) =>
    request<Dashboard>('POST', `/workspaces/${workspaceId}/dashboards`, body),
  get: (id: string) => request<Dashboard>('GET', `/dashboards/${id}`),
  update: (id: string, body: Partial<{ name: string; filters: Filters; auto_refresh: boolean }>) =>
    request<Dashboard>('PATCH', `/dashboards/${id}`, body),
  remove: (id: string) => request('DELETE', `/dashboards/${id}`),
  duplicate: (id: string, body: { name?: string; team_id?: string | null }) =>
    request<Dashboard>('POST', `/dashboards/${id}/duplicate`, body),
  repoint: (id: string, sources: Source[]) => request<Dashboard>('POST', `/dashboards/${id}/repoint`, { sources }),
  layout: (id: string, cards: { id: string; width: number; height: number }[]) =>
    request<Dashboard>('PUT', `/dashboards/${id}/layout`, { cards }),
  data: (id: string) => request<CardData[]>('GET', `/dashboards/${id}/data`, undefined, tz()),

  addCard: (id: string, body: { type: CardType; title?: string; config: Partial<CardConfig>; width?: number; height?: number }) =>
    request<Card>('POST', `/dashboards/${id}/cards`, body),
  updateCard: (id: string, cardId: string, body: Partial<{ title: string; config: CardConfig; width: number; height: number }>) =>
    request<Card>('PATCH', `/dashboards/${id}/cards/${cardId}`, body),
  removeCard: (id: string, cardId: string) => request('DELETE', `/dashboards/${id}/cards/${cardId}`),
  duplicateCard: (id: string, cardId: string) => request<Card>('POST', `/dashboards/${id}/cards/${cardId}/duplicate`),
  cardData: (id: string, cardId: string) => request<CardData>('GET', `/dashboards/${id}/cards/${cardId}/data`, undefined, tz()),
  cardTasks: (id: string, cardId: string, segment?: string) =>
    request<TaskPage>('GET', `/dashboards/${id}/cards/${cardId}/tasks`, undefined, { ...tz(), segment }),

  sharing: (id: string) => request<DashboardSharing>('GET', `/dashboards/${id}/sharing`),
  share: (id: string, grantee: { user_id?: string; team_id?: string }, level: DashLevel) =>
    request<Share>('POST', `/dashboards/${id}/shares`, { ...grantee, level }),
  unshare: (id: string, shareId: string) => request('DELETE', `/dashboards/${id}/shares/${shareId}`),

  reports: (id: string) => request<{ email_configured: boolean; schedules: Schedule[] }>('GET', `/dashboards/${id}/reports`),
  createReport: (id: string, body: ScheduleIn) => request<Schedule>('POST', `/dashboards/${id}/reports`, body),
  updateReport: (scheduleId: string, body: ScheduleIn) => request<Schedule>('PUT', `/reports/${scheduleId}`, body),
  removeReport: (scheduleId: string) => request('DELETE', `/reports/${scheduleId}`),
  sendNow: (scheduleId: string) => request<ReportRun>('POST', `/reports/${scheduleId}/send`),
  runs: (id: string) => request<ReportRun[]>('GET', `/dashboards/${id}/report-runs`),
  run: (runId: string) => request<ReportRun & { html: string }>('GET', `/report-runs/${runId}`),
  forView: (viewId: string) => request<Dashboard | null>('GET', `/views/${viewId}/dashboard`),
  customiseView: (viewId: string) => request<Dashboard>('POST', `/views/${viewId}/dashboard`),
  messages: (id: string, cardId: string) => request<DiscussionMessage[]>('GET', `/dashboards/${id}/cards/${cardId}/messages`),
  postMessage: (id: string, cardId: string, body: string) => request<DiscussionMessage[]>('POST', `/dashboards/${id}/cards/${cardId}/messages`, { body }),
  deleteMessage: (messageId: string) => request('DELETE', `/dashboard-messages/${messageId}`),
  preview: (id: string) => request<{ html: string }>('GET', `/dashboards/${id}/report-preview`, undefined, tz()),
};


