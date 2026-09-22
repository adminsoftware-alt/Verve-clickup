// Client for People (profiles, adding, inviting) and the Teams Hub (/api/v2).
import { request, type Role, type Status, type Task, type Team, type UserRef } from '../api';

export interface Person {
  user: UserRef; role: Role; joined_at: string; pending: boolean;
  designation: string | null; department: string | null; manager_id: string | null; phone: string | null;
  employee_code: string | null; date_of_joining: string | null; location: string | null;
  team_ids: string[]; direct_reports: number; invite_sent_at: string | null;
}
export interface PersonInput {
  email?: string; name?: string; role?: Role; designation?: string | null; department?: string | null;
  manager_id?: string | null; phone?: string | null; employee_code?: string | null; date_of_joining?: string | null;
  location?: string | null; team_ids?: string[]; send_invite?: boolean;
}
export interface TeamLocation { kind: 'space' | 'folder' | 'list'; id: string }
export interface TeamFull extends Team { description: string | null; handle: string | null; icon: string | null; locations: TeamLocation[] }
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
  createTeam: (ws: string, body: { name: string; description?: string | null; color?: string | null; icon?: string | null; member_ids?: string[]; lead_ids?: string[] }) =>
    request<TeamFull>('POST', `/workspaces/${ws}/teams`, body),
  updateTeam: (id: string, body: { name?: string; description?: string | null; color?: string | null; icon?: string | null; locations?: TeamLocation[] }) =>
    request<TeamFull>('PATCH', `/teams/${id}`, body),
  setMembers: (id: string, userIds: string[], leadIds?: string[]) => request<TeamFull>('PUT', `/teams/${id}/members`, { user_ids: userIds, lead_ids: leadIds }),
  deleteTeam: (id: string) => request('DELETE', `/teams/${id}`),
  overview: (id: string) => request<TeamOverview>('GET', `/teams/${id}/overview`),
};

export const personName = (p: { user: UserRef } | UserRef | null | undefined): string => {
  if (!p) return '';
  const u = 'user' in p ? p.user : p;
  return u.display_name || u.email;
};
