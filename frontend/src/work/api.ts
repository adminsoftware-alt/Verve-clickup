// Client for the v2 work hierarchy API (spaces, folders, lists, tasks, views).
import { auth } from '../core/firebase';
import { devUser } from '../core/devSession';

const V1 = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
export const API_V2 = V1.replace(/\/api\/v1\/?$/, '/api/v2');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The bearer token for this session: the signed-in person's, or a local testing one. */
async function bearer(): Promise<string> {
  const pretending = devUser();
  if (pretending) return `dev:${pretending.id}`;
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, 'Not signed in');
  return user.getIdToken();
}

export async function request<T>(method: string, path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const token = await bearer();
  const query = params
    ? '?' + Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
    : '';
  const res = await fetch(`${API_V2}${path}${query}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = Array.isArray(data.detail) ? data.detail.map((d: { msg: string }) => d.msg).join('; ') : data.detail;
    throw new ApiError(res.status, detail || `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Send a multipart form (file uploads) with the user's token. */
export async function upload<T>(method: string, path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_V2}${path}`, { method, headers: { Authorization: `Bearer ${await bearer()}` }, body: form });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (typeof data.detail === 'string' && data.detail) || `Upload failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

// --- types -------------------------------------------------------------------

export type Level = 'view' | 'comment' | 'edit' | 'full';
export type Role = 'owner' | 'admin' | 'member' | 'limited' | 'guest';
export type StatusGroup = 'not_started' | 'active' | 'done' | 'closed';
export type ViewType = 'list' | 'board' | 'calendar' | 'dashboard' | 'workload' | 'overview' | 'table' | 'team' | 'gantt' | 'timeline' | 'activity' | 'form'
  | 'doc' | 'whiteboard' | 'mind_map' | 'map' | 'chat' | 'embed';

export type FieldType =
  | 'text' | 'long_text' | 'number' | 'money' | 'dropdown' | 'labels' | 'date' | 'checkbox'
  | 'email' | 'phone' | 'url' | 'rating' | 'progress' | 'people' | 'location';
export interface FieldOption { id: string; name: string; color: string }
export interface FieldConfig { options?: FieldOption[]; currency?: string; precision?: number; max?: number; include_time?: boolean }
export interface CustomField {
  id: string; name: string; type: FieldType; config: FieldConfig; location: LocationKind; location_id: string; orderindex: number;
}
export type LocationKind = 'space' | 'folder' | 'list';

export interface Workspace { id: string; name: string; role: Role; access_problem?: string | null }
export interface UserRef { id: string; email: string; display_name: string | null; avatar?: string | null }
export interface TaskDefaults {
  time_estimate_seconds: number | null;
  estimate_basis: 'similar' | 'list' | null;
  estimate_from: number;
  priority: number | null;
  assignees: string[];
  days_to_due: number;
}

export interface PersonLoadRow {
  user_id: string;
  planned_per_day: number[];
  capacity_per_day: number[];
  planned_total: number;
  capacity_total: number;
}

export interface PeopleLoad { days: string[]; rows: PersonLoadRow[] }

export interface Member { user: UserRef; role: Role; joined_at: string; deactivated?: boolean }

export interface ListNode {
  id: string; name: string; color: string | null; is_private: boolean; archived: boolean;
  orderindex: number; permission_level: Level; open_task_count: number;
  /** The person this List was handed to. */
  assignee_id: string | null;
  /** The Team this List belongs to, when it was given to one. */
  team?: TeamRef | null;
  /** Everyone the List was handed to. */
  assignee_ids?: string[];
  start_date?: string | null; due_date?: string | null; description?: string | null;
  /** A sprint List that was completed. */
  sprint_completed_at?: string | null;
}
export interface FolderNode {
  id: string; name: string; color: string | null; is_private: boolean; archived: boolean;
  orderindex: number; permission_level: Level; folders: FolderNode[]; lists: ListNode[];
  /** A Sprint Folder: its Lists are sprints. */
  is_sprint?: boolean;
}
export type ClickApp = 'priorities' | 'tags' | 'time_tracking' | 'time_estimates' | 'custom_task_ids' | 'multiple_assignees'
  | 'sprint_points' | 'multiple_lists' | 'email_to_list' | 'custom_fields';
export interface SpaceNode {
  id: string; name: string; color: string | null; icon: string | null; is_private: boolean; archived: boolean;
  orderindex: number; permission_level: Level; folders: FolderNode[]; lists: ListNode[];
  /** Left by you: kept out of your sidebar (find it on the All Spaces page). */
  hidden?: boolean;
  clickapps?: Partial<Record<ClickApp, boolean>>;
}
export interface SidebarSection { id: string; name: string; orderindex: number; space_ids: string[]; collapsed: boolean }
export interface Hierarchy {
  workspace_id: string; role: Role; spaces: SpaceNode[];
  shared_with_me: { folders: FolderNode[]; lists: ListNode[]; tasks: { id: string; name: string; list_id: string; permission_level: Level }[] };
  /** The caller's own Personal List, once they have opened it. Never shown as a Space. */
  personal_list: ListNode | null;
  sections?: SidebarSection[];
}

export interface Status { id: string; name: string; color: string; group: StatusGroup; orderindex: number }
export interface StatusSet { source: { kind: LocationKind; id: string }; inherited: boolean; statuses: Status[] }
export interface Tag { id: string; name: string; fg_color: string; bg_color: string }

export interface Task {
  id: string; list_id: string; parent_id: string | null; top_level_parent_id: string | null;
  name: string; description: string | null; status: Status; priority: number | null;
  start_date: string | null; due_date: string | null; time_estimate_seconds: number | null;
  time_tracked_seconds: number; is_private: boolean; orderindex: number; created_by: string | null; created_at: string; updated_at: string;
  date_done: string | null; date_closed: string | null; archived: boolean; is_overdue: boolean;
  assignees: UserRef[]; tags: Tag[]; subtask_count: number; permission_level: Level;
  group: TaskGroupRef | null; recurrence: Recurrence | null; recurs_from_id: string | null;
  comment_count?: number; attachment_count?: number; checklist_done?: number; checklist_total?: number;
  custom_id?: string | null; type_id?: string | null;
  waiting_on_open?: number; blocking_count?: number; link_count?: number;
  custom_fields?: Record<string, unknown>;
  points?: number | null;
  /** Other Lists this task also shows in. */
  extra_list_ids?: string[];
}
export interface TaskGroupRef { id: string; name: string; color: string }
export interface TaskGroup extends TaskGroupRef { location: LocationKind; location_id: string; orderindex: number }
/** How a task repeats. weekdays: 0 = Monday. */
export interface Recurrence {
  /** days_after counts from the day the task was finished, not from its due date. */
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'days_after';
  interval: number;
  weekdays?: number[] | null;
  month_day?: number | null;
  trigger: 'on_done' | 'on_schedule';
  action: 'new_task' | 'reopen';
  /** Keep the series pinned to the original due dates; off measures from the day it was done. */
  sync_to_due?: boolean;
  /** The status the next one opens in. Null means the List's own first status. */
  reset_status_id?: string | null;
  until?: string | null;
  count?: number | null;
  tz: string;
}
export interface TaskDetail extends Task {
  fields?: CustomField[]; // the custom fields this task's List can use
  location: { space: { id: string; name: string }; folder: { id: string; name: string } | null; list: { id: string; name: string } };
}
export interface TaskPage { tasks: Task[]; total: number; limit: number; offset: number }

export interface BulkEdit {
  task_ids: string[]; status?: string; priority?: number | null; due_date?: string | null; start_date?: string | null;
  group_id?: string | null; archived?: boolean; add_assignees?: string[]; remove_assignees?: string[];
  add_tags?: string[]; remove_tags?: string[]; list_id?: string; delete?: boolean;
  time_estimate_seconds?: number | null;
  /** null puts them back to the plain built-in Task. */
  type_id?: string | null;
}
export interface BulkResult { updated: string[]; skipped: { id: string; name: string; reason: string }[] }
export type TemplateKind = 'task' | 'list' | 'folder' | 'space';
export interface Template {
  id: string; kind: TemplateKind; name: string; description: string | null; is_private: boolean; created_by: string | null;
  created_at: string; use_count: number; task_count: number; list_count: number; field_count: number;
}
export interface TemplateSave {
  name?: string; description?: string | null; is_private?: boolean; include_tasks?: boolean; include_subtasks?: boolean;
  include_checklists?: boolean; include_fields?: boolean; include_dates?: boolean; include_assignees?: boolean;
}
export interface ImportRow {
  name: string; description?: string; status?: string; priority?: string; assignees?: string; start_date?: string;
  due_date?: string; tags?: string; time_estimate?: string; fields?: Record<string, string>;
}
export interface ImportResult {
  created: number; task_ids: string[]; errors: { row: number; message: string }[]; warnings: { row: number; message: string }[];
}
export interface View {
  id: string; type: ViewType; name: string; orderindex: number; is_required: boolean; settings: Record<string, unknown>;
  private?: boolean; protected?: boolean; is_default?: boolean; created_by?: string | null;
}
export interface TaskType {
  id: string; name: string; name_plural: string | null; icon: string; color: string;
  is_milestone: boolean; orderindex: number;
  /** One line saying what the type is for. */
  description?: string | null;
  /** How many live tasks wear it: a type nobody uses is one to retire. */
  task_count?: number;
}
export interface LinkedTask { link_id: string; id: string; name: string; list_id: string; status: Status; due_date: string | null; finished: boolean }
export interface TaskLinks { waiting_on: LinkedTask[]; blocking: LinkedTask[]; linked: LinkedTask[] }
export type LinkKind = 'waiting_on' | 'blocking' | 'relates';
export interface Dependency { blocker_id: string; waiting_id: string }
export interface LocationActivity {
  id: string; kind: string; data: Record<string, unknown>; created_at: string; user: UserRef | null; comment: string | null;
  task_id: string; task_name: string; list_id: string;
}
export interface FormField { key: string; label: string; required: boolean; help: string | null; type: string; field: CustomField | null }
export interface FormDef { view_id: string; list_id: string; list_name: string; title: string; description: string | null; active: boolean; fields: FormField[]; success: string }
export type FavoriteKind = 'space' | 'folder' | 'list' | 'task' | 'dashboard' | 'view' | 'goal';
export interface Favorite {
  id: string; kind: FavoriteKind; target_id: string; name: string; orderindex: number;
  list_id: string | null; location_kind: LocationKind | null; location_id: string | null;
}
export interface TagUsage { id: string; name: string; bg_color: string; fg_color: string; task_count: number }

export interface TaskSummary { id: string; name: string; list_id: string; due_date: string | null; status: Status }
export interface Bucket { count: number; tasks: TaskSummary[] }
export interface Dashboard {
  total_open: number; done_today: Bucket; overdue: Bucket; unassigned: Bucket; no_estimate: Bucket; unscheduled: Bucket;
  by_status: { name: string; color: string; group: StatusGroup; count: number }[];
  by_assignee: { user: UserRef | null; count: number }[];
}

/** lead_ids: Team leads manage the Team's dashboards and see its people's dashboards and time. */
export interface Team { id: string; name: string; color: string | null; members: UserRef[]; lead_ids: string[] }
export interface TeamRef { id: string; name: string; color: string | null }
export interface Share {
  id: string; user: UserRef | null; team: TeamRef | null;
  level: Level; granted_by: string | null; created_at: string;
}
export interface Sharing { is_private: boolean; your_level: Level; shares: Share[] }
export type ShareKind = LocationKind | 'task';

export interface WorkloadTask { id: string; name: string; list_id: string; status: Status; priority: number | null; seconds_per_day: number[] }
export interface WorkloadRow { user: UserRef | null; capacity_seconds: number[]; scheduled_seconds: number[]; tasks: WorkloadTask[] }
export interface Workload { days: string[]; rows: WorkloadRow[]; unscheduled: TaskSummary[]; no_estimate: TaskSummary[] }

export interface TimeEntry {
  id: string; task_id: string; user: UserRef; started_at: string; ended_at: string | null;
  duration_seconds: number | null; running: boolean; description: string | null; billable: boolean;
  tags?: { id: string; name: string }[];
}
export interface TaskTime {
  total_seconds: number;
  /** The same, plus every subtask underneath. */
  subtree_seconds: number;
  entries: TimeEntry[];
  shows_everyone: boolean;
}
export interface RunningTimer { entry: TimeEntry; task_name: string; list_id: string }

export type TaskInput = Partial<{
  name: string; description: string | null; status_id: string; priority: number | null;
  start_date: string | null; due_date: string | null; time_estimate_seconds: number | null;
  assignees: string[]; tags: string[]; parent_id: string | null; is_private: boolean; archived: boolean; orderindex: number;
  group_id: string | null; recurrence: Recurrence | null; type_id: string | null; points: number | null;
}>;

const seg = (kind: ShareKind) =>
  kind === 'space' ? 'spaces' : kind === 'folder' ? 'folders' : kind === 'list' ? 'lists' : 'tasks';

// --- calls -------------------------------------------------------------------

export const workApi = {
  workspaces: () => request<Workspace[]>('GET', '/workspaces'),
  createWorkspace: (name: string) => request<Workspace>('POST', '/workspaces', { name }),
  me: () => request<UserRef>('GET', '/me'),
  allTasks: (ws: string, includeClosed = false) => request<TaskPage>('GET', `/workspaces/${ws}/all-tasks`, undefined, { include_closed: includeClosed }),
  dependencies: (kind: LocationKind, id: string) => request<Dependency[]>('GET', `/${seg(kind)}/${id}/dependencies`),
  locationActivity: (kind: LocationKind, id: string, before?: string) =>
    request<LocationActivity[]>('GET', `/${seg(kind)}/${id}/activity`, undefined, before ? { before, limit: 100 } : { limit: 100 }),
  form: (viewId: string) => request<FormDef>('GET', `/forms/${viewId}`),
  submitForm: (viewId: string, answers: Record<string, unknown>) => request<{ task_id: string; message: string }>('POST', `/forms/${viewId}/submit`, { answers }),
  links: (taskId: string) => request<TaskLinks>('GET', `/tasks/${taskId}/links`),
  addLink: (taskId: string, otherId: string, kind: LinkKind) => request<TaskLinks>('POST', `/tasks/${taskId}/links`, { other_id: otherId, kind }),
  removeLink: (linkId: string) => request('DELETE', `/links/${linkId}`),
  mergeTasks: (taskId: string, sourceIds: string[]) => request<TaskDetail>('POST', `/tasks/${taskId}/merge`, { source_ids: sourceIds }),
  favorites: (ws: string) => request<Favorite[]>('GET', `/workspaces/${ws}/favorites`),
  addFavorite: (ws: string, kind: FavoriteKind, targetId: string) => request<Favorite[]>('POST', `/workspaces/${ws}/favorites`, { kind, target_id: targetId }),
  removeFavorite: (ws: string, kind: FavoriteKind, targetId: string) => request<Favorite[]>('DELETE', `/workspaces/${ws}/favorites/${kind}/${targetId}`),
  orderFavorites: (ws: string, ids: string[]) => request<Favorite[]>('PUT', `/workspaces/${ws}/favorites/order`, { ids }),
  taskTypes: (ws: string) => request<TaskType[]>('GET', `/workspaces/${ws}/task-types`),
  createTaskType: (ws: string, body: Partial<TaskType> & { name: string }) => request<TaskType>('POST', `/workspaces/${ws}/task-types`, body),
  updateTaskType: (ws: string, id: string, body: Partial<TaskType>) => request<TaskType>('PATCH', `/workspaces/${ws}/task-types/${id}`, body),
  deleteTaskType: (ws: string, id: string) => request('DELETE', `/workspaces/${ws}/task-types/${id}`),
  spaceTags: (spaceId: string) => request<TagUsage[]>('GET', `/spaces/${spaceId}/tags`),
  createTag: (spaceId: string, body: { name: string; bg_color?: string; fg_color?: string }) => request<Tag>('POST', `/spaces/${spaceId}/tags`, body),
  updateTag: (id: string, body: { name?: string; bg_color?: string; fg_color?: string }) => request<Tag>('PATCH', `/tags/${id}`, body),
  deleteTag: (id: string) => request('DELETE', `/tags/${id}`),
  updateLocation: (kind: LocationKind, id: string, body: Record<string, unknown>) => request<Record<string, unknown>>('PATCH', `/${seg(kind)}/${id}`, body),
  location: (kind: LocationKind, id: string) => request<Record<string, unknown>>('GET', `/${seg(kind)}/${id}`),
  hierarchy: (workspaceId: string) => request<Hierarchy>('GET', `/workspaces/${workspaceId}/hierarchy`),
  myTasks: (workspaceId: string, includeClosed = false) =>
    request<TaskPage>('GET', `/workspaces/${workspaceId}/my-tasks`, undefined, { include_closed: includeClosed }),
  openPersonalList: (workspaceId: string) => request<ListNode>('POST', `/workspaces/${workspaceId}/personal-list`),
  members: (workspaceId: string) => request<Member[]>('GET', `/workspaces/${workspaceId}/members`),
  /** Who can be given work here: the people who can open this Space, Folder or List. */
  assignable: (kind: LocationKind, id: string) => request<UserRef[]>('GET', `/${seg(kind)}/${id}/assignable`),

  createSpace: (workspaceId: string, name: string, is_private = false) =>
    request<{ id: string }>('POST', `/workspaces/${workspaceId}/spaces`, { name, is_private }),
  createFolder: (parent: { kind: 'space' | 'folder'; id: string }, name: string, is_private = false) =>
    request<{ id: string }>('POST', `/${seg(parent.kind)}/${parent.id}/folders`, { name, is_private }),
  /** `assignees` hands the List over as it is made: they get full access and it appears for them. */
  createList: (parent: { kind: 'space' | 'folder'; id: string }, name: string, is_private = false, assignees: string[] = []) =>
    request<{ id: string }>('POST', `/${seg(parent.kind)}/${parent.id}/lists`, { name, is_private, assignees, private: is_private }),
  renameLocation: (kind: LocationKind, id: string, name: string) => request('PATCH', `/${seg(kind)}/${id}`, { name }),
  deleteLocation: (kind: LocationKind, id: string) => request('DELETE', `/${seg(kind)}/${id}`),

  statuses: (kind: LocationKind, id: string) => request<StatusSet>('GET', `/${seg(kind)}/${id}/statuses`),

  tasks: (kind: LocationKind, id: string, params: { include_closed?: boolean; date_from?: string; date_to?: string } = {}) =>
    request<TaskPage>('GET', `/${seg(kind)}/${id}/tasks`, undefined, { limit: 1000, ...params }),
  dashboard: (kind: LocationKind, id: string, day_start: string) =>
    request<Dashboard>('GET', `/${seg(kind)}/${id}/dashboard`, undefined, { day_start }),

  task: (id: string) => request<TaskDetail>('GET', `/tasks/${id}`),
  createTask: (listId: string, input: TaskInput & { name: string }) => request<TaskDetail>('POST', `/lists/${listId}/tasks`, input),
  updateTask: (id: string, input: TaskInput) => request<TaskDetail>('PATCH', `/tasks/${id}`, input),
  deleteTask: (id: string) => request('DELETE', `/tasks/${id}`),

  views: (kind: LocationKind, id: string) => request<View[]>('GET', `/${seg(kind)}/${id}/views`),
  createView: (kind: LocationKind, id: string, type: ViewType, isPrivate = false) => request<View>('POST', `/${seg(kind)}/${id}/views`, { type, private: isPrivate }),
  deleteView: (id: string) => request('DELETE', `/views/${id}`),
  updateView: (id: string, body: { name?: string; settings?: Record<string, unknown>; orderindex?: number; private?: boolean; protected?: boolean; is_default?: boolean }) =>
    request<View>('PATCH', `/views/${id}`, body),
  fields: (kind: LocationKind, id: string, includeBelow = false) =>
    request<CustomField[]>('GET', `/${seg(kind)}/${id}/fields`, undefined, includeBelow ? { include_below: true } : undefined),
  createField: (kind: LocationKind, id: string, body: { name: string; type: FieldType; config?: FieldConfig }) =>
    request<CustomField>('POST', `/${seg(kind)}/${id}/fields`, body),
  updateField: (id: string, body: { name?: string; config?: FieldConfig }) => request<CustomField>('PATCH', `/fields/${id}`, body),
  deleteField: (id: string) => request('DELETE', `/fields/${id}`),
  setFieldValue: (taskId: string, fieldId: string, value: unknown) =>
    request<{ field_id: string; value: unknown }>('PUT', `/tasks/${taskId}/fields/${fieldId}`, { value }),
  searchTasks: (ws: string, q: string, limit = 20) => request<Task[]>('GET', `/workspaces/${ws}/search/tasks`, undefined, { q, limit }),
  templates: (ws: string, kind?: TemplateKind) => request<Template[]>('GET', `/workspaces/${ws}/templates`, undefined, kind ? { kind } : undefined),
  saveTemplate: (kind: TemplateKind, id: string, body: TemplateSave) =>
    request<Template>('POST', `/${kind === 'task' ? 'tasks' : kind === 'list' ? 'lists' : kind === 'space' ? 'spaces' : 'folders'}/${id}/save-template`, body),
  updateTemplate: (id: string, body: { name?: string; description?: string | null; is_private?: boolean }) => request<Template>('PATCH', `/templates/${id}`, body),
  deleteTemplate: (id: string) => request('DELETE', `/templates/${id}`),
  applyTemplate: (id: string, body: { name?: string; list_id?: string; space_id?: string; folder_id?: string }) =>
    request<{ kind: TemplateKind; id: string; list_id: string | null }>('POST', `/templates/${id}/apply`, body),
  importTasks: (listId: string, rows: ImportRow[]) =>
    request<ImportResult>('POST', `/lists/${listId}/import`, { rows, tz_offset: new Date().getTimezoneOffset() }),
  bulkEdit: (body: BulkEdit) => request<BulkResult>('POST', '/tasks/bulk', body),

  /** Your own week across every Space you can open, for the Workload view on My Tasks. */
  myWorkload: (workspaceId: string, start: string, days: number) =>
    request<Workload>('GET', `/workspaces/${workspaceId}/my-workload?start=${start}&days=${days}&tz_offset=${new Date().getTimezoneOffset()}`),
  workload: (kind: LocationKind, id: string, start: string, days: number, teamId?: string) =>
    request<Workload>('GET', `/${seg(kind)}/${id}/workload`, undefined, {
      start, days, tz_offset: new Date().getTimezoneOffset(), team_id: teamId,
    }),

  // Time tracking
  taskTime: (taskId: string) => request<TaskTime>('GET', `/tasks/${taskId}/time`),
  /** What a new task in this List should open pre-filled with, from what the List has done before. */
  taskDefaults: (listId: string, name?: string) =>
    request<TaskDefaults>('GET', `/lists/${listId}/task-defaults${name ? `?name=${encodeURIComponent(name)}` : ''}`),
  /** How full some people's days already are, for the moment before more work is handed over. */
  peopleLoad: (workspaceId: string, userIds: string[], start: string, days = 7) =>
    request<PeopleLoad>('GET', `/workspaces/${workspaceId}/people-load?${
      userIds.map((id) => `user_ids=${encodeURIComponent(id)}`).join('&')}&start=${start}&days=${days}`),
  logTime: (
    taskId: string, duration_seconds: number, description?: string,
    span?: { started_at: string; ended_at: string }, billable = false, tag_ids: string[] = [],
    /** Whose time it is. Admins log for other people from their timesheet. */
    user_id?: string,
  ) =>
    request<TimeEntry>('POST', `/tasks/${taskId}/time`, {
      ...(span ?? { duration_seconds }),
      description: description || null,
      billable,
      tag_ids,
      ...(user_id ? { user_id } : {}),
    }),
  deleteTime: (entryId: string) => request('DELETE', `/time/${entryId}`),
  startTimer: (taskId: string) => request<TimeEntry>('POST', `/tasks/${taskId}/timer`),
  stopTimer: () => request<TimeEntry>('POST', '/timer/stop'),
  runningTimer: () => request<RunningTimer | null>('GET', '/timer'),

  // People & Teams
  addMember: (workspaceId: string, email: string, role: Role) =>
    request<Member>('POST', `/workspaces/${workspaceId}/members`, { email, role }),
  setMemberRole: (workspaceId: string, userId: string, role: Role) =>
    request<Member>('PATCH', `/workspaces/${workspaceId}/members/${encodeURIComponent(userId)}`, { role }),
  removeMember: (workspaceId: string, userId: string) =>
    request('DELETE', `/workspaces/${workspaceId}/members/${encodeURIComponent(userId)}`),
  teams: (workspaceId: string) => request<Team[]>('GET', `/workspaces/${workspaceId}/teams`),
  createTeam: (workspaceId: string, name: string) => request<Team>('POST', `/workspaces/${workspaceId}/teams`, { name }),
  renameTeam: (teamId: string, name: string) => request<Team>('PATCH', `/teams/${teamId}`, { name }),
  setTeamMembers: (teamId: string, userIds: string[], leadIds?: string[]) =>
    request<Team>('PUT', `/teams/${teamId}/members`, { user_ids: userIds, lead_ids: leadIds }),
  deleteTeam: (teamId: string) => request('DELETE', `/teams/${teamId}`),

  // Sharing & privacy
  sharing: (kind: ShareKind, id: string) => request<Sharing>('GET', `/${seg(kind)}/${id}/sharing`),
  share: (kind: ShareKind, id: string, grantee: { user_id: string } | { team_id: string }, level: Level) =>
    request<Share>('POST', `/${seg(kind)}/${id}/shares`, { ...grantee, level }),
  unshare: (kind: ShareKind, id: string, grantee: { user_id: string } | { team_id: string }) =>
    request('DELETE', 'team_id' in grantee
      ? `/${seg(kind)}/${id}/shares/teams/${grantee.team_id}`
      : `/${seg(kind)}/${id}/shares/${encodeURIComponent(grantee.user_id)}`),
  groups: (kind: LocationKind, id: string) => request<TaskGroup[]>('GET', `/${seg(kind)}/${id}/groups`),
  createGroup: (kind: LocationKind, id: string, name: string, color?: string) =>
    request<TaskGroup>('POST', `/${seg(kind)}/${id}/groups`, { name, color }),
  updateGroup: (groupId: string, body: { name: string; color?: string }) => request<TaskGroup>('PATCH', `/groups/${groupId}`, body),
  deleteGroup: (groupId: string) => request('DELETE', `/groups/${groupId}`),
  /** Hand a Space, Folder or List to a Team; null gives it back to everyone. */
  giveToTeam: (kind: LocationKind, id: string, teamId: string | null) =>
    request('PUT', `/${seg(kind)}/${id}/team`, { team_id: teamId }),
  /** Hand a List to one or more people; an empty list takes it back. */
  assignListTo: (listId: string, userIds: string[], isPrivate = true) =>
    request<ListNode & { assignees: UserRef[] }>('PUT', `/lists/${listId}/assignee`, { user_ids: userIds, private: isPrivate }),
  assignList: (listId: string, userId: string | null, isPrivate = true) =>
    request('PUT', `/lists/${listId}/assignee`, { user_id: userId, private: isPrivate }),

  setPrivate: (kind: ShareKind, id: string, is_private: boolean) =>
    request('PATCH', `/${seg(kind)}/${id}`, { is_private }),
};
