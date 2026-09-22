// Client for the Planner, calendar sync, LineUp, the My Tasks home layout, My Work tabs and Automations (/api/v2).
import { request, type LocationKind, type Task, type UserRef } from './api';

export interface TimeBlock { id: string; task_id: string | null; title: string | null; start_at: string; end_at: string; task: Task | null }
export interface CalendarEvent { feed_id: string; title: string; start: string; end: string; all_day: boolean; location: string | null; color: string }
export interface Planner { blocks: TimeBlock[]; events: CalendarEvent[]; feed_errors: Record<string, string> }
export interface CalendarFeed { id: string; name: string; color: string; host: string; event_count: number; fetched_at: string | null; error: string | null }

export type HomeCardKey = 'recents' | 'agenda' | 'lineup' | 'priorities' | 'planner' | 'delegated' | 'done';
export interface HomeCard { key: HomeCardKey; hidden: boolean; size: 'half' | 'full' }

export type AutomationTrigger = 'task_created' | 'status_changed';
export type AutomationAction = 'assign' | 'notify' | 'set_priority' | 'set_status';
export interface Automation {
  id: string; location_kind: 'space' | 'folder' | 'list'; location_id: string;
  trigger: AutomationTrigger; trigger_config: { status?: string };
  action: AutomationAction; action_config: { user_ids?: string[]; priority?: number; status_name?: string };
  active: boolean; created_by: UserRef | null; created_at: string; last_run_at: string | null; run_count: number; inherited: boolean;
}
export type AutomationIn = Pick<Automation, 'trigger' | 'trigger_config' | 'action' | 'action_config'> & { active?: boolean };

const ws = (id: string) => `/workspaces/${id}`;
const plural = (kind: LocationKind) => (kind === 'space' ? 'spaces' : kind === 'folder' ? 'folders' : 'lists');

export const planningApi = {
  planner: (workspaceId: string, start: Date, end: Date) =>
    request<Planner>('GET', `${ws(workspaceId)}/planner`, undefined, { start: start.toISOString(), end: end.toISOString() }),
  addBlock: (workspaceId: string, body: { task_id?: string | null; title?: string | null; start_at: string; end_at: string }) =>
    request<TimeBlock>('POST', `${ws(workspaceId)}/time-blocks`, body),
  updateBlock: (workspaceId: string, id: string, body: Partial<{ title: string | null; start_at: string; end_at: string }>) =>
    request<TimeBlock>('PATCH', `${ws(workspaceId)}/time-blocks/${id}`, body),
  removeBlock: (workspaceId: string, id: string) => request('DELETE', `${ws(workspaceId)}/time-blocks/${id}`),

  calendars: (workspaceId: string) => request<CalendarFeed[]>('GET', `${ws(workspaceId)}/calendars`),
  addCalendar: (workspaceId: string, body: { name: string; url: string; color: string }) => request<CalendarFeed>('POST', `${ws(workspaceId)}/calendars`, body),
  syncCalendar: (workspaceId: string, id: string) => request<CalendarFeed>('POST', `${ws(workspaceId)}/calendars/${id}/sync`),
  removeCalendar: (workspaceId: string, id: string) => request('DELETE', `${ws(workspaceId)}/calendars/${id}`),
  calendarLink: (workspaceId: string) => request<{ url: string | null }>('GET', `${ws(workspaceId)}/calendar-link`),
  makeCalendarLink: (workspaceId: string, reset = false) => request<{ url: string }>('POST', `${ws(workspaceId)}/calendar-link`, undefined, reset ? { reset: true } : undefined),
  stopCalendarLink: (workspaceId: string) => request('DELETE', `${ws(workspaceId)}/calendar-link`),

  lineup: (workspaceId: string) => request<Task[]>('GET', `${ws(workspaceId)}/lineup`),
  addToLineup: (workspaceId: string, taskId: string) => request<Task[]>('POST', `${ws(workspaceId)}/lineup`, { task_id: taskId }),
  removeFromLineup: (workspaceId: string, taskId: string) => request<Task[]>('DELETE', `${ws(workspaceId)}/lineup/${taskId}`),
  orderLineup: (workspaceId: string, taskIds: string[]) => request<Task[]>('PUT', `${ws(workspaceId)}/lineup/order`, { task_ids: taskIds }),

  homeLayout: (workspaceId: string) => request<{ cards: HomeCard[] | null }>('GET', `${ws(workspaceId)}/home-layout`),
  saveHomeLayout: (workspaceId: string, cards: HomeCard[] | null) => request<{ cards: HomeCard[] | null }>('PUT', `${ws(workspaceId)}/home-layout`, { cards }),

  done: (workspaceId: string, days = 30) => request<Task[]>('GET', `${ws(workspaceId)}/my-work/done`, undefined, { days }),
  delegated: (workspaceId: string) => request<Task[]>('GET', `${ws(workspaceId)}/my-work/delegated`),

  automations: (kind: LocationKind, id: string) => request<Automation[]>('GET', `/${plural(kind)}/${id}/automations`),
  addAutomation: (kind: LocationKind, id: string, body: AutomationIn) => request<Automation>('POST', `/${plural(kind)}/${id}/automations`, body),
  updateAutomation: (id: string, body: Partial<Pick<Automation, 'trigger_config' | 'action_config' | 'active'>>) => request<Automation>('PATCH', `/automations/${id}`, body),
  removeAutomation: (id: string) => request('DELETE', `/automations/${id}`),
};
