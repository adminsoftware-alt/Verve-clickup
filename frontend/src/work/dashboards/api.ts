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
  /** What the card was built to filter by; "Clear all filters" puts `filters` back to this. */
  base_filters?: Filters | null;
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

/** A person whose own Dashboard the viewer may open, with the figures that say whom to look at. */
export interface PersonBoard {
  user: UserRef; designation: string | null; department: string | null; teams: string[]; pending: boolean;
  open: number; overdue: number; due_today: number; dashboard_id: string | null;
}

/** One task named in a highlight. */
export interface InsightTask {
  id: string; name: string; list_id: string; priority: number | null; due_date: string | null; assignees: UserRef[];
  days_late?: number; days_idle?: number; tracked?: number; estimate?: number; waiting_on?: string;
}
export interface InsightSection { count: number; tasks: InsightTask[] }
/**
 * What needs attention on a board, worked out from the same tasks as its cards. What a card
 * already says -- due today, overdue, hours this week, finished work -- is not repeated here.
 */
export interface Insights {
  /** Whose board: the viewer's own, one other person's, a Team's, or the whole company. */
  who: 'me' | 'person' | 'team' | 'everyone';
  who_name: string | null;
  open: number;
  // Your day.
  starts_today: InsightSection; late_start: InsightSection; over_estimate: InsightSection;
  recurring_this_week: InsightSection; stuck: InsightSection; urgent_soon: InsightSection;
  blocked_by_late: InsightSection;
  next_week: { count: number; estimate: number } | null;
  running_timers: { user: UserRef; task_id: string; task_name: string; list_id: string; since: string }[];
  mentions_unread: number;
  reminders_today: { title: string; at: string; task_id: string | null }[];
  no_due_date: number; no_estimate: number; unassigned: number;
  logged_yesterday: number;
  capacity_yesterday: number | null;
  // Your Team (empty on a board about one person).
  people_behind: { user: UserRef; overdue: number }[];
  overloaded: { user: UserRef; planned: number; capacity: number }[];
  no_time_yesterday: UserRef[]; no_time_yesterday_count?: number;
  timesheets_waiting: { user: UserRef; period_start: string; period_end: string }[];
  timesheets_missing: UserRef[]; timesheets_missing_count?: number;
  // The firm.
  birthdays: UserRef[];
  anniversaries: { user: UserRef; years: number }[];
  holidays_this_week: { name: string; day: string }[];
  goals_behind: { id: string; name: string; progress: number; expected: number }[];
}

export interface Segment {
  key: string; label: string; color: string; value: number;
  /** Priority cards only: how much is past due, tasks added in the last 7 days, open tasks with nobody on them. */
  new?: number; unowned?: number;
}
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
  /** Whose own Dashboards the viewer may open -- admins: everyone; Team leads: their people. */
  people: (workspaceId: string) => request<PersonBoard[]>('GET', `/workspaces/${workspaceId}/dashboards/people`, undefined, tz()),
  /** Someone's own Dashboard, read-only, exactly as they see it; made now if they have never opened it. */
  personBoard: (workspaceId: string, userId: string) =>
    request<Dashboard>('GET', `/workspaces/${workspaceId}/people/${encodeURIComponent(userId)}/dashboard`),
  /** Clear the board's filters and put every card back to the filters it was built with. */
  resetFilters: (id: string) => request<Dashboard>('POST', `/dashboards/${id}/reset-filters`),
  insights: (id: string) => request<Insights>('GET', `/dashboards/${id}/insights`, undefined, tz()),

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
  messages: (id: string, cardId: string) => request<DiscussionMessage[]>('GET', `/dashboards/${id}/cards/${cardId}/messages`),
  postMessage: (id: string, cardId: string, body: string) => request<DiscussionMessage[]>('POST', `/dashboards/${id}/cards/${cardId}/messages`, { body }),
  deleteMessage: (messageId: string) => request('DELETE', `/dashboard-messages/${messageId}`),
  preview: (id: string) => request<{ html: string }>('GET', `/dashboards/${id}/report-preview`, undefined, tz()),
};


