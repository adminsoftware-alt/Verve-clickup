// Client for leave (types, holidays, requests, approvals, balances, calendar) and billing (/api/v2).
import { request, type UserRef } from '../api';

export interface LeaveType { id: string; name: string; color: string; yearly_days: number | null; paid: boolean; needs_approval: boolean; archived: boolean }
export interface Holiday { id: string; day: string; name: string }
export type LeavePart = 'full' | 'first_half' | 'second_half';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export interface LeaveRequest {
  id: string; user: UserRef | null; type: LeaveType | null; start_date: string; end_date: string; part: LeavePart; days: number;
  reason: string | null; status: LeaveStatus; approver: UserRef | null; decided_by: UserRef | null; decided_at: string | null;
  decision_note: string | null; created_at: string; can_decide: boolean;
}
export interface LeaveBalance { type: LeaveType; allowance: number | null; used: number; pending: number; remaining: number }

export interface BillingRate { id: string; user: UserRef | null; location_kind: string | null; location_id: string | null; location_name: string | null; hourly_rate: number; currency: string }
export interface ClientFee { amount: number; period: 'monthly' | 'one_off'; currency: string; client_name: string | null; location_kind: string; location_id: string; location_name: string }
export interface ProfitPerson { user: UserRef | null; billable_seconds: number; non_billable_seconds: number; rate: number | null; value: number }
export interface ProfitRow {
  location_kind: string; location_id: string; name: string; client_name: string | null; currency: string; fee: number | null;
  billable_seconds: number; non_billable_seconds: number; value: number; unpriced_seconds: number; realisation: number | null; margin: number | null;
  people: ProfitPerson[];
}
export interface InvoiceLine { task_id: string; task_name: string; custom_id: string | null; user: UserRef | null; seconds: number; rate: number | null; amount: number }
export interface Invoice {
  location_kind: string; location_id: string; name: string; client_name: string | null; currency: string; start: string; end: string;
  lines: InvoiceLine[]; total_seconds: number; total: number; fee: number | null;
}

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const w = (ws: string) => `/workspaces/${ws}`;

export const leaveApi = {
  types: (ws: string, includeArchived = false) => request<LeaveType[]>('GET', `${w(ws)}/leave/types`, undefined, { include_archived: includeArchived }),
  addType: (ws: string, body: Omit<LeaveType, 'id'>) => request<LeaveType>('POST', `${w(ws)}/leave/types`, body),
  updateType: (ws: string, id: string, body: Omit<LeaveType, 'id'>) => request<LeaveType>('PUT', `${w(ws)}/leave/types/${id}`, body),
  holidays: (ws: string, year?: number) => request<Holiday[]>('GET', `${w(ws)}/holidays`, undefined, { year }),
  addHoliday: (ws: string, day: string, name: string) => request<Holiday>('POST', `${w(ws)}/holidays`, { day, name }),
  removeHoliday: (ws: string, id: string) => request('DELETE', `${w(ws)}/holidays/${id}`),
  list: (ws: string, scope: 'mine' | 'approvals' | 'all', year?: number) => request<LeaveRequest[]>('GET', `${w(ws)}/leave`, undefined, { scope, year }),
  request: (ws: string, body: { type_id: string; start_date: string; end_date: string; part: LeavePart; reason?: string; user_id?: string }) =>
    request<LeaveRequest>('POST', `${w(ws)}/leave`, body),
  decide: (ws: string, id: string, approve: boolean, note?: string) => request<LeaveRequest>('POST', `${w(ws)}/leave/${id}/decision`, { approve, note }),
  cancel: (ws: string, id: string) => request<LeaveRequest>('POST', `${w(ws)}/leave/${id}/cancel`),
  calendar: (ws: string, start: string, end: string) => request<{ leave: LeaveRequest[]; holidays: Holiday[] }>('GET', `${w(ws)}/leave/calendar`, undefined, { start, end }),
  balances: (ws: string, year: number, userId?: string) => request<LeaveBalance[]>('GET', `${w(ws)}/leave/balances`, undefined, { year, user_id: userId }),

  rates: (ws: string) => request<BillingRate[]>('GET', `${w(ws)}/billing/rates`),
  setRate: (ws: string, body: { user_id?: string | null; location_kind?: string | null; location_id?: string | null; hourly_rate: number; currency: string }) =>
    request<BillingRate>('POST', `${w(ws)}/billing/rates`, body),
  removeRate: (ws: string, id: string) => request('DELETE', `${w(ws)}/billing/rates/${id}`),
  fees: (ws: string) => request<ClientFee[]>('GET', `${w(ws)}/billing/fees`),
  setFee: (ws: string, kind: string, id: string, fee: { amount: number; period: string; currency: string; client_name?: string | null } | null) =>
    request<ClientFee | null>('PUT', `${w(ws)}/billing/fees/${kind}/${id}`, { fee }),
  profitability: (ws: string, start: string, end: string) => request<{ start: string; end: string; rows: ProfitRow[] }>('GET', `${w(ws)}/billing/profitability`, undefined, { start, end, tz: tz() }),
  invoice: (ws: string, kind: string, id: string, start: string, end: string) =>
    request<Invoice>('GET', `${w(ws)}/billing/invoice`, undefined, { kind, location_id: id, start, end, tz: tz() }),
};

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const shortDate = (s: string) => fromIso(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const money = (n: number | null | undefined, currency = 'INR') =>
  n == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
export const hrs = (seconds: number) => `${Math.round((seconds / 3600) * 10) / 10}h`;
