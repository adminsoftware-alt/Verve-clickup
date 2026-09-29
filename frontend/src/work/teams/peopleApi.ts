// Client for People (profiles, adding, inviting) and the Teams Hub (/api/v2).
import { request, upload, type Role, type Status, type Task, type Team, type UserRef } from '../api';

export interface Person {
  user: UserRef; role: Role; joined_at: string; pending: boolean;
  designation: string | null; department: string | null; manager_id: string | null; phone: string | null;
  employee_code: string | null; date_of_joining: string | null; location: string | null;
  date_of_birth: string | null; marriage_anniversary: string | null; takes_interviews: boolean;
  team_ids: string[]; direct_reports: number; invite_sent_at: string | null; deactivated_at: string | null; joiner_tasks: number;
}
export interface PersonInput {
  email?: string; name?: string; role?: Role; designation?: string | null; department?: string | null;
  manager_id?: string | null; phone?: string | null; employee_code?: string | null; date_of_joining?: string | null;
  location?: string | null; team_ids?: string[]; send_invite?: boolean;
  date_of_birth?: string | null; marriage_anniversary?: string | null; takes_interviews?: boolean; start_joiner_checklist?: boolean;
}
export interface ImportRow {
  email: string; name?: string; role?: string; designation?: string; department?: string; manager_email?: string; teams?: string;
  phone?: string; employee_code?: string; date_of_joining?: string; date_of_birth?: string; marriage_anniversary?: string; location?: string;
}
export interface ImportResult {
  dry_run: boolean; added: number; updated: number; errors: number; email_problem: string | null;
  rows: { row: number; email: string; outcome: 'added' | 'updated' | 'unchanged' | 'error'; problems: string[] }[];
}
export interface OffboardPreview {
  person: UserRef; hand_over_to: UserRef | null; open_tasks: number; direct_reports: number; teams: number;
  joiner_tasks_kept: string[]; joiner_tasks_deleted: string[];
}
export interface OffboardResult { tasks_handed_over: number; joiner_tasks_kept: number; joiner_tasks_deleted: number; direct_reports_moved: number }
export interface JoinerStep {
  key: string; name: string; outcome: 'created' | 'exists' | 'would_create' | 'skipped' | 'problem';
  reason: string | null; task_id: string | null; list_name: string | null; due_date: string | null;
}
export interface JoinerRule {
  key: string; enabled: boolean; name: string; where: { folder?: string; list?: string }; when: string; assignees: string[];
  schedule: string; estimate_minutes: number | null; checklist: string[]; private: boolean; leaver: string;
}
export interface JoinerPlan {
  space_name: string; hr_team_name: string; hr_user_ids: string[]; timezone: string; due_hour: number;
  reviewer_designations: string[]; rules: JoinerRule[];
}
export interface SignInRules { allowed_email_domains: string[]; allow_outside_guests: boolean; require_google_sign_in: boolean; require_two_step: boolean }
export interface AuditEvent {
  id: string; action: string; verb: string; actor: UserRef | null; target_kind: string | null; target_id: string | null;
  target_label: string | null; data: Record<string, unknown>; created_at: string;
}
export interface TeamLocation { kind: 'space' | 'folder' | 'list'; id: string }
export interface TeamFull extends Team {
  description: string | null; handle: string | null; icon: string | null; locations: TeamLocation[];
  /** The Team this one sits inside, if it's a sub-team. */
  parent_team_id?: string | null;
  /** Members, plus everyone in its sub-teams. */
  all_member_ids?: string[];
}
export interface FeedItem {
  id: string; user: UserRef | null; kind: string; data: Record<string, unknown>; created_at: string;
  task: { id: string; name: string; list_id: string; status: Status | null };
}
export interface TeamOverview { team: TeamFull; tasks: Task[]; feed: FeedItem[] }

const clean = (body: PersonInput) => Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === '' ? null : v]));

export const peopleApi = {
  list: (ws: string) => request<Person[]>('GET', `/workspaces/${ws}/people`),
  get: (ws: string, userId: string) => request<Person>('GET', `/workspaces/${ws}/people/${encodeURIComponent(userId)}`),
  add: (ws: string, body: PersonInput) =>
    request<{ person: Person; emailed: boolean; email_problem: string | null; link: string }>('POST', `/workspaces/${ws}/people`, clean(body)),
  update: (ws: string, userId: string, body: PersonInput) => request<Person>('PATCH', `/workspaces/${ws}/people/${encodeURIComponent(userId)}`, clean(body)),
  invite: (ws: string, body: { emails: string[]; role: Role; team_ids: string[]; message?: string }) =>
    request<{ people: Person[]; emailed: boolean; email_problem: string | null; problems: string[]; link: string }>('POST', `/workspaces/${ws}/invites`, body),
  resend: (ws: string, userId: string, message?: string) =>
    request<{ emailed: boolean; email_problem: string | null; link: string }>('POST', `/workspaces/${ws}/people/${encodeURIComponent(userId)}/invite`, { message }),
  remove: (ws: string, userId: string) => request('DELETE', `/workspaces/${ws}/members/${encodeURIComponent(userId)}`),
  tasks: (ws: string, userId: string, includeClosed = false) =>
    request<Task[]>('GET', `/workspaces/${ws}/people/${encodeURIComponent(userId)}/tasks`, undefined, { include_closed: includeClosed }),
  teams: (ws: string) => request<TeamFull[]>('GET', `/workspaces/${ws}/teams`),
  createTeam: (ws: string, body: { name: string; description?: string | null; color?: string | null; icon?: string | null; member_ids?: string[]; lead_ids?: string[]; parent_team_id?: string | null }) =>
    request<TeamFull>('POST', `/workspaces/${ws}/teams`, body),
  updateTeam: (id: string, body: { name?: string; description?: string | null; color?: string | null; icon?: string | null; locations?: TeamLocation[]; parent_team_id?: string | null }) =>
    request<TeamFull>('PATCH', `/teams/${id}`, body),
  setMembers: (id: string, userIds: string[], leadIds?: string[]) => request<TeamFull>('PUT', `/teams/${id}/members`, { user_ids: userIds, lead_ids: leadIds }),
  deleteTeam: (id: string) => request('DELETE', `/teams/${id}`),
  overview: (id: string) => request<TeamOverview>('GET', `/teams/${id}/overview`),

  importPeople: (ws: string, body: { rows: ImportRow[]; dry_run: boolean; send_invites?: boolean; start_joiner_checklist?: boolean; update_existing?: boolean }) =>
    request<ImportResult>('POST', `/workspaces/${ws}/people/import`, body),
  offboardPreview: (ws: string, userId: string) => request<OffboardPreview>('GET', `/workspaces/${ws}/people/${encodeURIComponent(userId)}/offboard`),
  offboard: (ws: string, userId: string, body: { hand_over_to?: string | null; keep_tasks?: boolean; apply_leaver_rules?: boolean }) =>
    request<OffboardResult>('POST', `/workspaces/${ws}/people/${encodeURIComponent(userId)}/offboard`, body),
  setActive: (ws: string, userId: string, active: boolean) =>
    request<Person>('POST', `/workspaces/${ws}/people/${encodeURIComponent(userId)}/${active ? 'reactivate' : 'deactivate'}`),
  transferOwnership: (ws: string, userId: string) => request('POST', `/workspaces/${ws}/transfer-ownership`, { user_id: userId }),
  joinerPreview: (ws: string, userId: string) => request<JoinerStep[]>('GET', `/workspaces/${ws}/people/${encodeURIComponent(userId)}/joiner`),
  runJoiner: (ws: string, userId: string) => request<JoinerStep[]>('POST', `/workspaces/${ws}/people/${encodeURIComponent(userId)}/joiner`),
  joinerPlan: (ws: string) => request<{ plan: JoinerPlan; is_default: boolean }>('GET', `/workspaces/${ws}/joiner-plan`),
  saveJoinerPlan: (ws: string, plan: JoinerPlan | null) => request<{ plan: JoinerPlan; is_default: boolean }>('PUT', `/workspaces/${ws}/joiner-plan`, { plan }),
  signInRules: (ws: string) => request<{ rules: SignInRules; locked_out: string[] }>('GET', `/workspaces/${ws}/sign-in-rules`),
  saveSignInRules: (ws: string, rules: SignInRules) => request<{ rules: SignInRules; locked_out: string[] }>('PUT', `/workspaces/${ws}/sign-in-rules`, rules),
  emailStatus: (ws: string) => request<{ configured: boolean; host: string | null; sender: string | null }>('GET', `/workspaces/${ws}/email-status`),
  emailTest: (ws: string) => request('POST', `/workspaces/${ws}/email-test`),
  audit: (ws: string, params: { before?: string; action?: string; actor_id?: string; limit?: number } = {}) =>
    request<AuditEvent[]>('GET', `/workspaces/${ws}/audit`, undefined, params),
  setAvatar: async (ws: string, userId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return upload<UserRef>('PUT', `/workspaces/${ws}/people/${encodeURIComponent(userId)}/avatar`, form);
  },
  inductionQuiz: (ws: string) => request<{ view_id: string | null }>('GET', `/workspaces/${ws}/induction-quiz`),
  createInductionQuiz: (ws: string) => request<{ view_id: string }>('POST', `/workspaces/${ws}/induction-quiz`),
  removeAvatar: (ws: string, userId: string) => request('DELETE', `/workspaces/${ws}/people/${encodeURIComponent(userId)}/avatar`),
};

export const personName = (p: { user: UserRef } | UserRef | null | undefined): string => {
  if (!p) return '';
  const u = 'user' in p ? p.user : p;
  return u.display_name || u.email;
};
