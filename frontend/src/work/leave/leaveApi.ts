// Client for leave (types, holidays, requests, approvals, balances, calendar) and billing (/api/v2).
import { request, type UserRef } from '../api';

export interface LeaveType { id: string; name: string; color: string; yearly_days: number | null; paid: boolean; needs_approval: boolean; archived: boolean }
/** Days of the year nobody may book, written month-day so they come round again. */
export interface Blackout { from: string; to: string; reason?: string | null }
export interface LeavePolicy {
  /** 4 = April, the financial year most Indian firms run on. 1 is the calendar year. */
  year_start_month: number;
  /** null: nothing carries over. 0 is a different answer. */
  carry_forward_days: number | null;
  prorate_joiners: boolean;
  min_notice_days: number;
  allow_backdated: boolean;
  /** The sandwich rule: whether weekends and holidays inside a span are counted. */
  count_days_off_inside: boolean;
  escalate_after_days: number | null;
  hr_team_id: string | null;
  hr_team_name?: string | null;
  blackout: Blackout[];
}
export interface Holiday { id: string; day: string; name: string }
export type LeavePart = 'full' | 'first_half' | 'second_half';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export interface LeaveRequest {
  id: string; user: UserRef | null; type: LeaveType | null; start_date: string; end_date: string; part: LeavePart; days: number;
  reason: string | null; status: LeaveStatus; approver: UserRef | null; decided_by: UserRef | null; decided_at: string | null;
  decision_note: string | null; created_at: string; can_decide: boolean;
  /** Who holds the work while they are away. Named when the leave is approved. */
  cover: UserRef | null;
  /** When HR was told nobody had decided it, and how long it has been waiting. */
  escalated_at: string | null; waiting_days: number | null;
}
export interface LeaveBalance {
  type: LeaveType; allowance: number | null; used: number; pending: number; remaining: number;
  /** The three parts of the allowance, so the number can show its working. */
  earned: number | null; carried_forward: number; adjusted: number;
  year: number | null; year_start: string | null; year_end: string | null;
}
export interface LeaveAdjustment {
  id: string; type: LeaveType | null; year: number; days: number; reason: string | null;
  created_by: UserRef | null; created_at: string;
}
/** Something the person has due in the days they want off. */
export interface ClashTask { id: string; name: string; list_id: string; due_date: string; priority: number | null; compliance: boolean }
export interface ClashPerson { user: UserRef; start_date: string; end_date: string; status: LeaveStatus; days: number }
export interface LeaveClashes { tasks: ClashTask[]; also_away: ClashPerson[] }

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
  policy: (ws: string) => request<LeavePolicy>('GET', `${w(ws)}/leave/policy`),
  savePolicy: (ws: string, body: LeavePolicy) => request<LeavePolicy>('PUT', `${w(ws)}/leave/policy`, body),
  list: (ws: string, scope: 'mine' | 'approvals' | 'all', opts: { year?: number; status?: LeaveStatus; user_id?: string } = {}) =>
    request<LeaveRequest[]>('GET', `${w(ws)}/leave`, undefined, { scope, ...opts }),
  clashes: (ws: string, userId: string, start: string, end: string) =>
    request<LeaveClashes>('GET', `${w(ws)}/leave/clashes`, undefined, { user_id: userId, start, end }),
  adjustments: (ws: string, userId: string, year: number) =>
    request<LeaveAdjustment[]>('GET', `${w(ws)}/leave/adjustments`, undefined, { user_id: userId, year }),
  setAdjustment: (ws: string, body: { user_id: string; type_id: string; year: number; days: number; reason?: string | null }) =>
    request<LeaveAdjustment[]>('PUT', `${w(ws)}/leave/adjustments`, body),
  request: (ws: string, body: { type_id: string; start_date: string; end_date: string; part: LeavePart; reason?: string; user_id?: string }) =>
    request<LeaveRequest>('POST', `${w(ws)}/leave`, body),
  decide: (ws: string, id: string, approve: boolean, note?: string, coverId?: string | null) =>
    request<LeaveRequest>('POST', `${w(ws)}/leave/${id}/decision`, { approve, note, cover_id: coverId || null }),
  cancel: (ws: string, id: string) => request<LeaveRequest>('POST', `${w(ws)}/leave/${id}/cancel`),
  calendar: (ws: string, start: string, end: string) => request<{ leave: LeaveRequest[]; holidays: Holiday[] }>('GET', `${w(ws)}/leave/calendar`, undefined, { start, end }),
  /** Omit the year for the leave year we are in. */
  balances: (ws: string, year?: number, userId?: string) => request<LeaveBalance[]>('GET', `${w(ws)}/leave/balances`, undefined, { year, user_id: userId }),

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
/** "1 Apr 2026 – 31 Mar 2027", from a balance that knows its own leave year. */
export const yearLabel = (b: Pick<LeaveBalance, 'year_start' | 'year_end'> | null | undefined) => {
  if (!b?.year_start || !b?.year_end) return '';
  const f = (iso: string) => fromIso(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${f(b.year_start)} – ${f(b.year_end)}`;
};
/** A number of days, without a trailing ".0" on a whole one. */
export const dayCount = (n: number) => (n % 1 ? n.toFixed(1) : String(n));
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const money = (n: number | null | undefined, currency = 'INR') =>
  n == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
export const hrs = (seconds: number) => `${Math.round((seconds / 3600) * 10) / 10}h`;
