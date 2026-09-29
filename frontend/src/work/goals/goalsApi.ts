// Goals and Team goals (/api/v2).
import { request, type TeamRef, type UserRef } from '../api';

export type TargetKind = 'number' | 'currency' | 'true_false' | 'tasks';
export interface GoalTarget {
  id: string; name: string; kind: TargetKind; start_value: number; target_value: number; current_value: number; unit: string | null;
  task_ids: string[]; list_ids: string[]; owner: UserRef | null; progress: number; done_tasks: number; total_tasks: number;
}
export interface Goal {
  id: string; name: string; description: string | null; color: string; folder: string | null; team: TeamRef | null; owners: UserRef[];
  start_date: string | null; due_date: string | null; is_private: boolean; archived: boolean; progress: number; on_track: boolean | null;
  targets: GoalTarget[]; can_edit: boolean; created_by: string | null; updated_at: string;
}
export interface TargetInput {
  name: string; kind: TargetKind; start_value?: number; target_value?: number; unit?: string | null;
  task_ids?: string[]; list_ids?: string[]; owner_id?: string | null;
}
export interface GoalInput {
  name: string; description?: string | null; color?: string; folder?: string | null; team_id?: string | null; owner_ids?: string[];
  start_date?: string | null; due_date?: string | null; is_private?: boolean; targets?: TargetInput[];
}
export interface CheckIn { id: string; user: UserRef | null; value: number; note: string | null; created_at: string }

export const goalsApi = {
  list: (ws: string, params: { team_id?: string; include_archived?: boolean } = {}) => request<Goal[]>('GET', `/workspaces/${ws}/goals`, undefined, params),
  create: (ws: string, body: GoalInput) => request<Goal>('POST', `/workspaces/${ws}/goals`, body),
  get: (id: string) => request<Goal>('GET', `/goals/${id}`),
  update: (id: string, body: Partial<GoalInput> & { archived?: boolean }) => request<Goal>('PATCH', `/goals/${id}`, body),
  remove: (id: string) => request('DELETE', `/goals/${id}`),
  addTarget: (id: string, body: TargetInput) => request<Goal>('POST', `/goals/${id}/targets`, body),
  updateTarget: (id: string, body: Partial<TargetInput>) => request<Goal>('PATCH', `/goal-targets/${id}`, body),
  removeTarget: (id: string) => request<Goal>('DELETE', `/goal-targets/${id}`),
  checkIn: (id: string, value: number, note?: string) => request<Goal>('POST', `/goal-targets/${id}/check-ins`, { value, note: note || null }),
  checkIns: (id: string) => request<CheckIn[]>('GET', `/goal-targets/${id}/check-ins`),
};
