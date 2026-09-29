// Spaces, tasks and views beyond the basics: All Spaces and join requests, sidebar sections, duplicating
// Spaces, ClickApps, public links, tasks in several Lists, time in status, sprints, Email-to-List, and the
// content of the Doc, Whiteboard, Mind map, Chat and Embed views.
import { API_V2, ApiError, request, type Level, type ListNode, type SidebarSection, type TaskDetail, type UserRef, type View } from './api';

export interface BrowseSpace {
  id: string; name: string; color: string | null; icon: string | null; description: string | null; is_private: boolean;
  permission_level: Level | null; joined: boolean; requested: boolean; list_count: number; owner: UserRef | null; can_approve: boolean;
}
export interface JoinRequest { id: string; space_id: string; space_name: string; user: UserRef; message: string | null; created_at: string }
export interface ClickAppInfo { name: string; label: string; default: boolean }
export interface PublicLink {
  id: string; token: string; kind: 'task' | 'list' | 'view'; target_id: string; target_name: string;
  show_description: boolean; show_assignees: boolean; expires_at: string | null; created_at: string; created_by: string | null; views_count: number;
}
export interface PublicTask {
  id: string; name: string; status: string; status_color: string; status_group: string; priority: number | null;
  start_date: string | null; due_date: string | null; description: string | null; assignees: string[]; parent_id: string | null;
  checklist_done: number; checklist_total: number;
}
export interface PublicPage {
  kind: 'task' | 'list' | 'view'; title: string; workspace: string; view_type: string | null;
  task: PublicTask | null; subtasks: PublicTask[]; tasks: PublicTask[]; doc: Record<string, unknown> | null;
}
export interface TaskListRef { id: string; name: string; path: string; home: boolean }
/** Where a task shows, and whose desks it is on. A Personal List stays invisible to everyone
 *  else, so `people` is how the person sharing it can see what they have done. */
export interface TaskShared { lists: TaskListRef[]; people: string[] }
export interface TimeInStatus {
  current: string;
  spells: { status: string; color: string | null; since: string; until: string | null; seconds: number }[];
  totals: { status: string; color: string | null; seconds: number; times: number }[];
}
export interface SprintSettings { weeks: number; start_weekday: number; rollover: boolean; auto_complete: boolean; first_start?: string | null }
export interface Sprint {
  id: string; name: string; start_date: string | null; due_date: string | null; completed_at: string | null; current: boolean;
  total_points: number; done_points: number; task_count: number; done_count: number;
}
export interface SprintReport {
  sprint: Sprint; folder_id: string; unit: 'points' | 'tasks';
  burndown: { day: string; remaining: number | null; ideal: number }[];
  velocity: { id: string; name: string; done_points: number; total_points: number }[]; average_velocity: number;
}
export interface ListEmail { address: string | null; configured: boolean; enabled: boolean }
export interface ViewContent<T = Record<string, unknown>> { content: T; version: number; updated_by: UserRef | null; updated_at: string | null }
export interface ChatMessage { id: string; user: UserRef | null; body: string; task_id: string | null; created_at: string; edited_at: string | null; mine: boolean }

const w = (ws: string) => `/workspaces/${ws}`;

export const spacesApi = {
  clickapps: () => request<ClickAppInfo[]>('GET', '/clickapps'),
  allSpaces: (ws: string) => request<BrowseSpace[]>('GET', `${w(ws)}/all-spaces`),
  setJoined: (ws: string, spaceId: string, joined: boolean) => request('PUT', `${w(ws)}/all-spaces/${spaceId}/joined`, undefined, { joined }),
  requestJoin: (ws: string, spaceId: string, message: string) => request('POST', `${w(ws)}/all-spaces/${spaceId}/request`, { message }),
  joinRequests: (ws: string) => request<JoinRequest[]>('GET', `${w(ws)}/join-requests`),
  decideJoin: (ws: string, id: string, approve: boolean, level: Level = 'edit') => request('POST', `${w(ws)}/join-requests/${id}`, { approve, level }),
  duplicateSpace: (spaceId: string, body: Record<string, unknown>) =>
    request<{ id: string }>('POST', `/spaces/${spaceId}/duplicate`, body),

  addSection: (ws: string, name: string, spaceIds: string[] = []) => request<SidebarSection>('POST', `${w(ws)}/sidebar-sections`, { name, space_ids: spaceIds }),
  updateSection: (ws: string, id: string, body: Partial<Pick<SidebarSection, 'name' | 'orderindex' | 'collapsed' | 'space_ids'>>) =>
    request<SidebarSection>('PATCH', `${w(ws)}/sidebar-sections/${id}`, body),
  deleteSection: (ws: string, id: string) => request('DELETE', `${w(ws)}/sidebar-sections/${id}`),

  publicLinks: (kind: PublicLink['kind'], targetId: string) => request<PublicLink[]>('GET', '/public-links', undefined, { kind, target_id: targetId }),
  workspaceLinks: (ws: string) => request<PublicLink[]>('GET', `${w(ws)}/public-links`),
  createLink: (body: { kind: PublicLink['kind']; target_id: string; show_description?: boolean; show_assignees?: boolean; expires_on?: string | null }) =>
    request<PublicLink>('POST', '/public-links', body),
  revokeLink: (id: string) => request('DELETE', `/public-links/${id}`),

  /** Who the task sits with personally -- the same task, in their own Lists. */
  sharedWith: (taskId: string) => request<TaskShared>('GET', `/tasks/${taskId}/shared-with`),
  shareWith: (taskId: string, user_ids: string[], assign = true) =>
    request<TaskShared>('POST', `/tasks/${taskId}/shared-with`, { user_ids, assign }),
  unshareWith: (taskId: string, userId: string) =>
    request<TaskShared>('DELETE', `/tasks/${taskId}/shared-with/${encodeURIComponent(userId)}`),
  taskLists: (taskId: string) => request<TaskListRef[]>('GET', `/tasks/${taskId}/lists`),
  addToList: (taskId: string, listId: string) => request<TaskListRef[]>('PUT', `/tasks/${taskId}/lists/${listId}`),
  removeFromList: (taskId: string, listId: string) => request<TaskListRef[]>('DELETE', `/tasks/${taskId}/lists/${listId}`),
  timeInStatus: (taskId: string) => request<TimeInStatus>('GET', `/tasks/${taskId}/time-in-status`),

  enableSprints: (folderId: string, body: SprintSettings) => request('PUT', `/folders/${folderId}/sprints`, body),
  sprints: (folderId: string) => request<Sprint[]>('GET', `/folders/${folderId}/sprints`),
  nextSprint: (folderId: string) => request<ListNode>('POST', `/folders/${folderId}/sprints/next`),
  completeSprint: (listId: string) => request<{ completed: Sprint; moved: number; next_list_id: string | null }>('POST', `/lists/${listId}/sprint/complete`),
  sprintReport: (listId: string) => request<SprintReport>('GET', `/lists/${listId}/sprint`),

  listEmail: (listId: string) => request<ListEmail>('GET', `/lists/${listId}/email`),
  makeListEmail: (listId: string, rotate = false) => request<ListEmail>('POST', `/lists/${listId}/email`, undefined, { rotate }),
  removeListEmail: (listId: string) => request('DELETE', `/lists/${listId}/email`),

  content: <T,>(viewId: string) => request<ViewContent<T>>('GET', `/views/${viewId}/content`),
  saveContent: <T,>(viewId: string, content: T, version: number) => request<ViewContent<T>>('PUT', `/views/${viewId}/content`, { content, version }),
  setEmbed: (viewId: string, url: string) => request<View>('PUT', `/views/${viewId}/embed`, { url }),
  chat: (viewId: string, after?: string) => request<ChatMessage[]>('GET', `/views/${viewId}/chat`, undefined, after ? { after } : undefined),
  postChat: (viewId: string, body: string, mentions: string[]) => request<ChatMessage>('POST', `/views/${viewId}/chat`, { body, mention_user_ids: mentions }),
  editChat: (id: string, body: string) => request<ChatMessage>('PATCH', `/chat/${id}`, { body }),
  deleteChat: (id: string) => request('DELETE', `/chat/${id}`),
  chatToTask: (id: string, listId?: string) => request<TaskDetail>('POST', `/chat/${id}/task`, { list_id: listId ?? null }),
};

/** The public page needs no sign-in, so it doesn't go through `request`. */
export async function fetchPublicPage(token: string): Promise<PublicPage> {
  const res = await fetch(`${API_V2}/public/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.detail || 'This link does not exist or has expired');
  }
  return res.json();
}

export const publicUrl = (token: string) => `${window.location.origin}/p/${token}`;
