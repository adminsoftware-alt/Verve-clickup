// Notification delivery (email, push, WhatsApp), the weekly team digest, review packs and the compliance calendar.
import { request, type UserRef } from './api';

export interface Delivery {
  email_notifications: 'off' | 'instant' | 'daily'; digest_hour: number; timezone: string; weekly_team_digest: boolean;
  whatsapp_opt_in: boolean; phone: string | null; devices: number; channels: { email: boolean; push: boolean; whatsapp: boolean };
}
export interface DigestPerson {
  user: UserRef; overdue: number; overdue_tasks: { id: string; name: string; list_id: string; due_date: string | null }[];
  done_last_week: number; tracked_seconds: number; capacity_seconds: number; timesheet_status: string | null;
  leave: { start_date: string; end_date: string; type: string; status: string }[];
}
export interface TeamDigest { week_start: string; week_end: string; people: DigestPerson[] }
export interface Obligation {
  id: string; code: string; name: string; authority: string | null; frequency: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';
  due_day: number; due_months: number[]; lead_days: number; notes: string | null; archived: boolean;
}
export interface ClientCompliance { id: string; obligation: Obligation; list_id: string; list_name: string; client_name: string; assignees: UserRef[]; active: boolean }
export interface ComplianceItem {
  client_compliance_id: string; client_name: string; obligation: string; authority: string | null; period_label: string; due_date: string;
  task_id: string | null; list_id: string; status: string | null; status_group: string | null; done: boolean; overdue: boolean;
}

const w = (ws: string) => `/workspaces/${ws}`;

export const outboundApi = {
  delivery: (ws: string) => request<Delivery>('GET', `${w(ws)}/delivery`),
  saveDelivery: (ws: string, body: Partial<Pick<Delivery, 'email_notifications' | 'digest_hour' | 'timezone' | 'weekly_team_digest' | 'whatsapp_opt_in'>>) =>
    request<Delivery>('PUT', `${w(ws)}/delivery`, body),
  pushKey: () => request<{ key: string }>('GET', '/push/public-key'),
  subscribe: (ws: string, body: { endpoint: string; keys: { p256dh: string; auth: string }; device?: string }) => request('POST', `${w(ws)}/push-subscriptions`, body),
  unsubscribe: (ws: string, endpoint: string) => request('DELETE', `${w(ws)}/push-subscriptions`, undefined, { endpoint }),
  pushTest: (ws: string) => request('POST', `${w(ws)}/push-test`),
  teamDigest: (ws: string) => request<TeamDigest>('GET', `${w(ws)}/team-digest`),
  reviewPacks: (ws: string, body: { user_ids?: string[] | null; email_monthly: boolean }) =>
    request<{ created: number; existing: number; dashboards: string[] }>('POST', `${w(ws)}/review-packs`, body),

  obligations: (ws: string, includeArchived = false) => request<Obligation[]>('GET', `${w(ws)}/compliance/obligations`, undefined, { include_archived: includeArchived }),
  addObligation: (ws: string, body: Omit<Obligation, 'id'>) => request<Obligation>('POST', `${w(ws)}/compliance/obligations`, body),
  updateObligation: (ws: string, id: string, body: Omit<Obligation, 'id'>) => request<Obligation>('PUT', `${w(ws)}/compliance/obligations/${id}`, body),
  clients: (ws: string) => request<ClientCompliance[]>('GET', `${w(ws)}/compliance/clients`),
  addClient: (ws: string, body: { obligation_ids: string[]; list_id: string; client_name: string; assignee_ids: string[] }) =>
    request<ClientCompliance[]>('POST', `${w(ws)}/compliance/clients`, body),
  removeClient: (ws: string, id: string) => request('DELETE', `${w(ws)}/compliance/clients/${id}`),
  calendar: (ws: string, start: string, end: string) => request<ComplianceItem[]>('GET', `${w(ws)}/compliance/calendar`, undefined, { start, end }),
};

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Ask the browser for permission and subscribe this device to push notifications. */
export async function enablePush(ws: string): Promise<'on' | 'denied' | 'unsupported'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const { key } = await outboundApi.pushKey();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await outboundApi.subscribe(ws, { endpoint: json.endpoint, keys: json.keys, device: navigator.userAgent.slice(0, 190) });
  return 'on';
}

export async function disablePush(ws: string): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await outboundApi.unsubscribe(ws, sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  }
}
