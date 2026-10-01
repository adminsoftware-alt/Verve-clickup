// Client for comments, activity, watchers, checklists, attachments, the Inbox, reminders,
// and moving/duplicating/archiving locations and tasks (/api/v2).
import { auth } from '../core/firebase';
import type { CopyParts } from './task/CopyParts';
import { API_V2, ApiError, request, type LocationKind, type Status, type StatusGroup, type TaskDetail, type TeamRef, type UserRef, type ListNode, type Hierarchy } from './api';

export interface Reaction { emoji: string; count: number; mine: boolean; users: string[] }
export interface Comment {
  id: string; task_id: string; parent_id: string | null; user: UserRef | null; body: string;
  mentions: UserRef[]; mention_teams: TeamRef[]; assignee: UserRef | null; resolved_at: string | null;
  resolved_by: string | null; created_at: string; edited_at: string | null; reactions: Reaction[]; can_edit: boolean;
}
export interface TaskRef { id: string; name: string; list_id: string; status: Status | null }
export interface CommentWithTask extends Comment { task: TaskRef }
export interface Activity { id: string; user: UserRef | null; kind: string; data: Record<string, unknown>; created_at: string }
export interface ChecklistItem { id: string; name: string; resolved: boolean; orderindex: number; assignee: UserRef | null }
export interface Checklist { id: string; name: string; orderindex: number; items: ChecklistItem[] }
/** A checklist saved for reuse: just the wording and the order, with nothing ticked. */
export interface ChecklistTemplate { id: string; name: string; items: string[]; item_count: number; created_at: string }
export interface Attachment { id: string; filename: string; content_type: string; size: number; user: UserRef | null; created_at: string }

export type InboxTab = 'primary' | 'other' | 'later' | 'cleared' | 'all';
export interface InboxItem {
  id: string; kind: string; category: 'primary' | 'other'; actor: UserRef | null; task: TaskRef | null;
  comment: { id: string; body: string } | null; reminder: { id: string; title: string; remind_at: string } | null;
  data: Record<string, unknown>; read: boolean; cleared: boolean; saved: boolean; snoozed_until: string | null; created_at: string;
}
export interface InboxCounts { primary: number; other: number; later: number }
export interface NotificationSetting { kind: string; label: string; enabled: boolean }
export interface Reminder { id: string; title: string; task: TaskRef | null; remind_at: string; done: boolean; notified: boolean; user: UserRef; created_by: string | null }

const seg = (kind: LocationKind) => (kind === 'space' ? 'spaces' : kind === 'folder' ? 'folders' : 'lists');

async function upload<T>(path: string, file: File): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, 'Not signed in');
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_V2}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}` }, body: form });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (typeof data.detail === 'string' && data.detail) || `Upload failed (${res.status})`);
  }
  return res.json();
}

/** Download an attachment with the user's token, then open or save it. */
export async function openAttachment(a: Attachment, save = false): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, 'Not signed in');
  const res = await fetch(`${API_V2}/attachments/${a.id}/download`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  if (!res.ok) throw new ApiError(res.status, 'Could not download the file');
  const url = URL.createObjectURL(await res.blob());
  if (save) {
    const link = document.createElement('a');
    link.href = url;
    link.download = a.filename;
    link.click();
  } else {
    window.open(url, '_blank', 'noopener');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const collabApi = {
  // comments
  comments: (taskId: string) => request<Comment[]>('GET', `/tasks/${taskId}/comments`),
  addComment: (taskId: string, body: { body: string; parent_id?: string | null; mention_user_ids?: string[]; mention_team_ids?: string[]; assignee_id?: string | null }) =>
    request<Comment>('POST', `/tasks/${taskId}/comments`, body),
  updateComment: (id: string, body: Partial<{ body: string; assignee_id: string | null; resolved: boolean }>) => request<Comment>('PATCH', `/comments/${id}`, body),
  deleteComment: (id: string) => request('DELETE', `/comments/${id}`),
  react: (id: string, emoji: string) => request<Comment>('POST', `/comments/${id}/reactions`, { emoji }),
  assignedComments: (ws: string, includeResolved = false) =>
    request<CommentWithTask[]>('GET', `/workspaces/${ws}/assigned-comments`, undefined, { include_resolved: includeResolved }),
  replies: (ws: string) => request<CommentWithTask[]>('GET', `/workspaces/${ws}/replies`),

  // history and watchers
  activity: (taskId: string) => request<Activity[]>('GET', `/tasks/${taskId}/activity`),
  watchers: (taskId: string) => request<{ watchers: UserRef[]; watching: boolean }>('GET', `/tasks/${taskId}/watchers`),
  watch: (taskId: string, userId?: string) => request<{ watchers: UserRef[]; watching: boolean }>('POST', `/tasks/${taskId}/watchers`, { user_id: userId ?? null }),
  unwatch: (taskId: string, userId: string) => request<{ watchers: UserRef[]; watching: boolean }>('DELETE', `/tasks/${taskId}/watchers/${encodeURIComponent(userId)}`),

  // checklists
  checklists: (taskId: string) => request<Checklist[]>('GET', `/tasks/${taskId}/checklists`),
  addChecklist: (taskId: string, name: string, items: string[] = []) => request<Checklist[]>('POST', `/tasks/${taskId}/checklists`, { name, items }),
  updateChecklist: (id: string, body: { name?: string; orderindex?: number }) => request<Checklist[]>('PATCH', `/checklists/${id}`, body),
  deleteChecklist: (id: string) => request('DELETE', `/checklists/${id}`),
  checklistTemplates: (ws: string) => request<ChecklistTemplate[]>('GET', `/workspaces/${ws}/checklist-templates`),
  saveChecklistTemplate: (ws: string, name: string, items: string[]) =>
    request<ChecklistTemplate>('POST', `/workspaces/${ws}/checklist-templates`, { name, items }),
  updateChecklistTemplate: (ws: string, id: string, name: string, items: string[]) =>
    request<ChecklistTemplate>('PATCH', `/workspaces/${ws}/checklist-templates/${id}`, { name, items }),
  deleteChecklistTemplate: (ws: string, id: string) => request('DELETE', `/workspaces/${ws}/checklist-templates/${id}`),
  addItem: (checklistId: string, name: string, assigneeId?: string | null) => request<Checklist[]>('POST', `/checklists/${checklistId}/items`, { name, assignee_id: assigneeId ?? null }),
  updateItem: (id: string, body: Partial<{ name: string; resolved: boolean; assignee_id: string | null; orderindex: number }>) =>
    request<Checklist[]>('PATCH', `/checklist-items/${id}`, body),
  deleteItem: (id: string) => request('DELETE', `/checklist-items/${id}`),

  // attachments
  attachments: (taskId: string) => request<Attachment[]>('GET', `/tasks/${taskId}/attachments`),
  upload: (taskId: string, file: File) => upload<Attachment>(`/tasks/${taskId}/attachments`, file),
  deleteAttachment: (id: string) => request('DELETE', `/attachments/${id}`),

  // Inbox
  inbox: (ws: string, tab: InboxTab) => request<InboxItem[]>('GET', `/workspaces/${ws}/inbox`, undefined, { tab }),
  counts: (ws: string) => request<InboxCounts>('GET', `/workspaces/${ws}/inbox/counts`),
  updateNotification: (id: string, body: Partial<{ read: boolean; cleared: boolean; saved: boolean; snoozed_until: string; unsnooze: boolean }>) =>
    request('PATCH', `/notifications/${id}`, body),
  readAll: (ws: string, tab: InboxTab) => request('POST', `/workspaces/${ws}/inbox/read-all`, { tab }),
  clearAll: (ws: string, tab: InboxTab) => request('POST', `/workspaces/${ws}/inbox/clear-all`, { tab }),
  settings: (ws: string) => request<NotificationSetting[]>('GET', `/workspaces/${ws}/notification-settings`),
  saveSettings: (ws: string, enabled: Record<string, boolean>) => request<NotificationSetting[]>('PUT', `/workspaces/${ws}/notification-settings`, { enabled }),

  // reminders
  reminders: (ws: string, state: 'upcoming' | 'done' | 'all' = 'upcoming') => request<Reminder[]>('GET', `/workspaces/${ws}/reminders`, undefined, { state }),
  addReminder: (ws: string, body: { title?: string; task_id?: string; remind_at: string; user_id?: string }) => request<Reminder>('POST', `/workspaces/${ws}/reminders`, body),
  updateReminder: (ws: string, id: string, body: Partial<{ title: string; remind_at: string; done: boolean }>) => request<Reminder>('PATCH', `/workspaces/${ws}/reminders/${id}`, body),
  deleteReminder: (ws: string, id: string) => request('DELETE', `/workspaces/${ws}/reminders/${id}`),

  // moving, duplicating, archiving, statuses
  moveTask: (taskId: string, listId: string) => request<TaskDetail>('POST', `/tasks/${taskId}/move`, { list_id: listId }),
  duplicateTask: (taskId: string, body: { name?: string; include_subtasks?: boolean; list_id?: string; parts?: CopyParts }) => request<TaskDetail>('POST', `/tasks/${taskId}/duplicate`, body),
  /** A copy each, on their own Personal Lists. Separate tasks from here on. */
  duplicateToPeople: (taskId: string, body: { user_ids: string[]; name?: string; include_subtasks?: boolean; parts?: CopyParts }) =>
    request<{ people: string[] }>('POST', `/tasks/${taskId}/duplicate-to-people`, body),
  moveLocation: (kind: 'folder' | 'list', id: string, target: { space_id?: string; folder_id?: string }) => request('POST', `/${seg(kind)}/${id}/move`, target),
  duplicateLocation: (kind: 'folder' | 'list', id: string, body: Record<string, unknown>) =>
    request<ListNode>('POST', `/${seg(kind)}/${id}/duplicate`, body),
  hierarchyWithArchived: (ws: string) => request<Hierarchy>('GET', `/workspaces/${ws}/hierarchy`, undefined, { include_archived: 'true' }),
  setArchived: (kind: LocationKind, id: string, archived: boolean) => request('PATCH', `/${seg(kind)}/${id}`, { archived }),
  saveStatuses: (kind: LocationKind, id: string, body: { inherit?: boolean; statuses?: { id?: string; name: string; color: string; group: StatusGroup }[] }) =>
    request('PUT', `/${seg(kind)}/${id}/statuses`, body),
};
