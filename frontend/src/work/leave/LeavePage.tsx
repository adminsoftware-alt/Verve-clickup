import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarRange, Check, ChevronLeft, ChevronRight, Landmark, Plane, Plus, Settings, Trash2, Users, X } from 'lucide-react';
import { useMe, useWork } from '../WorkContext';
import { Avatar, PriorityFlag } from '../ui';
import {
  dayCount, fromIso, iso, leaveApi, shortDate, yearLabel,
  type Holiday, type LeaveBalance, type LeaveClashes, type LeavePart, type LeavePolicy, type LeaveRequest, type LeaveType,
} from './leaveApi';
import { LeaveAdmin } from './LeaveAdmin';
import { LeavePolicyForm } from './LeavePolicyForm';
import { ask } from '../../components/ask';

type Tab = 'mine' | 'approvals' | 'everyone' | 'calendar' | 'settings';
const STATUS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800', approved: 'bg-emerald-100 text-emerald-800', rejected: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500',
};
const PART: Record<LeavePart, string> = { full: '', first_half: ' (first half)', second_half: ' (second half)' };
const input = 'rounded-md border border-gray-300 px-2 py-1.5 text-sm';
const primary = 'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';

const range = (r: LeaveRequest) => (r.start_date === r.end_date ? shortDate(r.start_date) : `${shortDate(r.start_date)} – ${shortDate(r.end_date)}`);
const days = (n: number) => `${n % 1 ? n.toFixed(1) : n} day${n === 1 ? '' : 's'}`;

/** Leave: request time off, approve your team's, see who is away, and (admins) set leave types and holidays. */
export const LeavePage: React.FC = () => {
  const { workspace, hierarchy } = useWork();
  const [tab, setTab] = useState<Tab>('mine');
  const [pending, setPending] = useState(0);
  // HR is a team, not a role, so the only way to know is to ask whether they can see everything.
  const [seesEveryone, setSeesEveryone] = useState(false);
  const isAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
  const ws = workspace?.id ?? '';
  const refreshCount = useCallback(() => { if (ws) leaveApi.list(ws, 'approvals').then((r) => setPending(r.length)).catch(() => undefined); }, [ws]);
  useEffect(() => { refreshCount(); }, [refreshCount]);
  useEffect(() => {
    if (!ws) return;
    if (isAdmin) { setSeesEveryone(true); return; }
    leaveApi.list(ws, 'all', { status: 'pending' }).then(() => setSeesEveryone(true)).catch(() => setSeesEveryone(false));
  }, [ws, isAdmin]);
  if (!workspace) return null;
  const tabs: [Tab, string][] = [
    ['mine', 'My leave'],
    ['approvals', `Approvals${pending ? ` (${pending})` : ''}`],
    ...(seesEveryone ? [['everyone', 'Everyone'] as [Tab, string]] : []),
    ['calendar', 'Team calendar'],
    ...(isAdmin ? [['settings', 'Settings'] as [Tab, string]] : []),
  ];
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="border-b border-gray-200 px-6 pt-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><Plane size={18} className="text-brand-600" /> Leave</h1>
        <nav role="tablist" aria-label="Leave" className="mt-3 flex gap-5">
          {tabs.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`-mb-px border-b-2 pb-2 text-sm ${tab === k ? 'border-brand-600 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{l}</button>
          ))}
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-auto bg-gray-50/60 p-6">
        {tab === 'mine' && <MyLeave ws={ws} />}
        {tab === 'approvals' && <Approvals ws={ws} onChanged={refreshCount} />}
        {tab === 'everyone' && seesEveryone && <LeaveAdmin ws={ws} />}
        {tab === 'calendar' && <TeamCalendar ws={ws} />}
        {tab === 'settings' && isAdmin && <LeaveSettings ws={ws} />}
      </main>
    </div>
  );
};

// --- my leave -------------------------------------------------------------------------------------------------

const MyLeave: React.FC<{ ws: string }> = ({ ws }) => {
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // No year is passed: the firm's leave year may not be the calendar one, and only the server
  // knows when it starts.
  const load = useCallback(() => {
    leaveApi.balances(ws).then(setBalances).catch((e) => setError(e.message));
    leaveApi.list(ws, 'mine').then(setRequests).catch((e) => setError(e.message));
  }, [ws]);
  useEffect(() => { load(); }, [load]);
  const cancel = async (r: LeaveRequest) => {
    if (!(await ask.confirm({ danger: true, title: `Cancel your ${r.type?.name ?? ''} leave on ${range(r)}?` }))) return;
    try { await leaveApi.cancel(ws, r.id); load(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {balances[0] && <p className="text-xs text-gray-500">Leave year: {yearLabel(balances[0])}</p>}
      <section aria-label="Balances" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {balances.map((b) => (
          <div key={b.type.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm text-gray-600"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.type.color }} />{b.type.name}</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{b.allowance == null ? '—' : dayCount(b.remaining)}</div>
            <div className="text-xs text-gray-500">
              {b.allowance == null ? `${dayCount(b.used)} taken · no limit`
                : `left of ${dayCount(b.allowance)} · ${dayCount(b.used)} taken${b.pending ? ` · ${dayCount(b.pending)} pending` : ''}`}
            </div>
            {/* Where the allowance came from, so nobody has to ask why it is not the round number. */}
            {b.allowance != null && (b.carried_forward > 0 || b.adjusted !== 0) && (
              <div className="mt-1 text-[11px] text-gray-400">
                {dayCount(b.earned ?? 0)} earned
                {b.carried_forward > 0 && ` + ${dayCount(b.carried_forward)} carried over`}
                {b.adjusted !== 0 && ` ${b.adjusted > 0 ? '+' : '−'} ${dayCount(Math.abs(b.adjusted))} adjusted`}
              </div>
            )}
          </div>
        ))}
      </section>
      <div className="flex items-center">
        <h2 className="text-sm font-semibold text-gray-800">My requests</h2>
        <button type="button" onClick={() => setAsking(true)} className={`ml-auto flex items-center gap-1.5 ${primary}`}><Plus size={14} /> Request leave</button>
      </div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {requests === null ? <p className="text-sm text-gray-400">Loading…</p> : requests.length === 0 ? <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">No leave yet.</p> : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white" aria-label="My requests">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="h-8 w-1 rounded-full" style={{ backgroundColor: r.type?.color ?? '#9ca3af' }} />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900">{r.type?.name ?? 'Leave'} · {range(r)}{PART[r.part]} <span className="font-normal text-gray-500">· {days(r.days)}</span></div>
                <div className="text-xs text-gray-500">
                  {r.status === 'pending'
                    ? `Waiting for ${r.approver ? r.approver.display_name || r.approver.email : 'approval'}${r.waiting_days ? ` · ${r.waiting_days} day${r.waiting_days === 1 ? '' : 's'} so far` : ''}`
                    : r.decided_by ? `${r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Declined' : 'Cancelled'} by ${r.decided_by.display_name || r.decided_by.email}` : ''}
                  {r.cover ? ` · covered by ${r.cover.display_name || r.cover.email}` : ''}
                  {r.decision_note ? ` · “${r.decision_note}”` : ''}{r.reason ? ` · ${r.reason}` : ''}
                </div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS[r.status]}`}>{r.status}</span>
              {(r.status === 'pending' || (r.status === 'approved' && r.end_date >= iso(new Date()))) && (
                <button type="button" onClick={() => cancel(r)} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">Cancel</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {asking && <RequestDialog ws={ws} onClose={() => setAsking(false)} onDone={() => { setAsking(false); load(); }} />}
    </div>
  );
};

const RequestDialog: React.FC<{ ws: string; onClose: () => void; onDone: () => void }> = ({ ws, onClose, onDone }) => {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [policy, setPolicy] = useState<LeavePolicy | null>(null);
  const me = useMe();
  const today = iso(new Date());
  const [form, setForm] = useState({ type_id: '', start_date: today, end_date: today, part: 'full' as LeavePart, reason: '' });
  const [clashes, setClashes] = useState<LeaveClashes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { leaveApi.types(ws).then((t) => { setTypes(t); setForm((f) => ({ ...f, type_id: f.type_id || t[0]?.id || '' })); }).catch(() => undefined); }, [ws]);
  useEffect(() => { leaveApi.policy(ws).then(setPolicy).catch(() => undefined); }, [ws]);
  const single = form.start_date === form.end_date;

  // Telling someone what they will be leaving behind is the point of this, so it loads as they
  // pick the dates rather than after the request has gone.
  useEffect(() => {
    if (!me || form.end_date < form.start_date) { setClashes(null); return; }
    let live = true;
    leaveApi.clashes(ws, me, form.start_date, form.end_date)
      .then((c) => { if (live) setClashes(c); })
      .catch(() => { if (live) setClashes(null); });
    return () => { live = false; };
  }, [ws, me, form.start_date, form.end_date]);

  const earliest = useMemo(() => {
    if (!policy) return undefined;
    const from = new Date();
    if (policy.min_notice_days > 0) from.setDate(from.getDate() + policy.min_notice_days);
    else if (!policy.allow_backdated) return today;
    return policy.min_notice_days > 0 ? iso(from) : undefined;
  }, [policy, today]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await leaveApi.request(ws, { ...form, part: single ? form.part : 'full', reason: form.reason.trim() || undefined });
      onDone();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <form role="dialog" aria-label="Request leave" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()} className="w-[28rem] max-w-[calc(100vw-2rem)] space-y-3 rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-center"><h3 className="font-semibold text-gray-900">Request leave</h3><button type="button" title="Close" onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button></div>
        <label className="block text-xs font-medium text-gray-600">Type
          <select aria-label="Leave type" value={form.type_id} onChange={(e) => setForm({ ...form, type_id: e.target.value })} className={`mt-1 block w-full ${input}`}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.yearly_days != null ? ` (${t.yearly_days} a year)` : ''}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-gray-600">From<input type="date" aria-label="From" min={earliest} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value, end_date: e.target.value > form.end_date ? e.target.value : form.end_date })} className={`mt-1 block w-full ${input}`} /></label>
          <label className="block text-xs font-medium text-gray-600">To<input type="date" aria-label="To" min={form.start_date} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className={`mt-1 block w-full ${input}`} /></label>
        </div>
        {single && (
          <div className="flex gap-4 text-sm text-gray-700" role="radiogroup" aria-label="How much of the day">
            {([['full', 'Full day'], ['first_half', 'First half'], ['second_half', 'Second half']] as [LeavePart, string][]).map(([v, l]) => (
              <label key={v} className="flex items-center gap-1.5"><input type="radio" name="part" checked={form.part === v} onChange={() => setForm({ ...form, part: v })} /> {l}</label>
            ))}
          </div>
        )}
        <label className="block text-xs font-medium text-gray-600">Reason (seen by your manager and HR)<textarea aria-label="Reason" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={`mt-1 block w-full ${input}`} /></label>

        {/* The rules, before someone writes a request that breaks one. */}
        <ul className="space-y-0.5 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <li>
            {policy?.count_days_off_inside
              ? 'Weekends and holidays in the middle of your leave are counted; ones at either end are not.'
              : "Weekends and company holidays aren't counted."}
          </li>
          <li>The request goes to your reporting manager, or to HR if they are away.</li>
          {policy && policy.min_notice_days > 0 && <li>{policy.min_notice_days} days' notice is needed.</li>}
          {policy && !policy.allow_backdated && <li>Leave already taken has to be recorded by an admin.</li>}
          {policy?.blackout.map((b) => (
            <li key={`${b.from}-${b.to}`} className="text-amber-700">Closed: {b.from} to {b.to}{b.reason ? ` (${b.reason})` : ''}.</li>
          ))}
        </ul>

        {/* What they are leaving behind. A warning, never a block: it is their leave to ask for. */}
        {clashes && clashes.tasks.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
              <AlertTriangle size={13} /> You have {clashes.tasks.length} thing{clashes.tasks.length === 1 ? '' : 's'} due in those days
            </p>
            <ul className="mt-1 space-y-0.5">
              {clashes.tasks.slice(0, 5).map((t) => (
                <li key={t.id} className="flex items-center gap-1.5 text-xs text-amber-900">
                  {t.compliance && <Landmark size={11} className="shrink-0" />}
                  <span className="min-w-0 truncate">{t.name}</span>
                  <span className="shrink-0 text-amber-700">{shortDate(t.due_date.slice(0, 10))}</span>
                </li>
              ))}
              {clashes.tasks.length > 5 && <li className="text-xs text-amber-700">and {clashes.tasks.length - 5} more</li>}
            </ul>
            <p className="mt-1 text-[11px] text-amber-700">Worth moving them or saying so below. You can still ask.</p>
          </div>
        )}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button><button type="submit" disabled={busy || !form.type_id} className={primary}>Send request</button></div>
      </form>
    </div>
  );
};

// --- approvals --------------------------------------------------------------------------------------------------

const Approvals: React.FC<{ ws: string; onChanged: () => void }> = ({ ws, onChanged }) => {
  const [rows, setRows] = useState<LeaveRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => leaveApi.list(ws, 'approvals').then(setRows).catch((e) => setError(e.message)), [ws]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="mx-auto max-w-4xl">
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {rows === null ? <p className="text-sm text-gray-400">Loading…</p> : rows.length === 0 ? <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">Nothing waiting for you.</p> : (
        <ul className="space-y-2" aria-label="Leave to approve">
          {rows.map((r) => (
            <ApprovalCard key={r.id} ws={ws} request={r} onDone={() => { load(); onChanged(); }} onError={setError} />
          ))}
        </ul>
      )}
    </div>
  );
};

/**
 * One request, with the two things a manager needs and never had: what the person has due in
 * those days, and somewhere to name who holds it while they are gone.
 */
const ApprovalCard: React.FC<{
  ws: string; request: LeaveRequest; onDone: () => void; onError: (m: string) => void;
}> = ({ ws, request: r, onDone, onError }) => {
  const { members } = useWork();
  const [note, setNote] = useState('');
  const [cover, setCover] = useState('');
  const [clashes, setClashes] = useState<LeaveClashes | null>(null);
  const [busy, setBusy] = useState(false);
  const who = r.user ? r.user.display_name || r.user.email : 'them';

  useEffect(() => {
    if (!r.user) return;
    let live = true;
    leaveApi.clashes(ws, r.user.id, r.start_date, r.end_date)
      .then((c) => { if (live) setClashes(c); })
      .catch(() => { if (live) setClashes(null); });
    return () => { live = false; };
  }, [ws, r.user, r.start_date, r.end_date]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await leaveApi.decide(ws, r.id, approve, note.trim() || undefined, approve ? cover || null : null);
      onDone();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const covers = members.filter((m) => !m.deactivated && m.role !== 'guest' && m.user.id !== r.user?.id);
  const filings = (clashes?.tasks ?? []).filter((t) => t.compliance);

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        {r.user && <Avatar user={r.user} size={28} />}
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium text-gray-900">{who} · {r.type?.name} · {range(r)}{PART[r.part]}</div>
          <div className="text-xs text-gray-500">
            {days(r.days)}{r.reason ? ` · ${r.reason}` : ''}
            {r.waiting_days ? ` · waiting ${r.waiting_days} day${r.waiting_days === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        {r.escalated_at && (
          <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">HR has been told</span>
        )}
      </div>

      {/* The one fact that stops a wrong approval: a statutory filing in the very days asked for. */}
      {clashes && clashes.tasks.length > 0 && (
        <div className={`mt-3 rounded-lg border px-3 py-2 ${filings.length ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
          <p className={`flex items-center gap-1.5 text-xs font-medium ${filings.length ? 'text-red-800' : 'text-amber-900'}`}>
            <AlertTriangle size={13} />
            {filings.length
              ? `${filings.length} statutory filing${filings.length === 1 ? '' : 's'} due while ${who} is away`
              : `${clashes.tasks.length} thing${clashes.tasks.length === 1 ? '' : 's'} due while ${who} is away`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {clashes.tasks.slice(0, 6).map((t) => (
              <li key={t.id} className="flex items-center gap-1.5 text-xs">
                {t.compliance && <Landmark size={11} className="shrink-0 text-red-700" />}
                <Link to={`/l/${t.list_id}?task=${t.id}`} className="min-w-0 truncate text-gray-800 no-underline hover:underline">{t.name}</Link>
                {t.priority ? <PriorityFlag priority={t.priority} withLabel={false} /> : null}
                <span className="shrink-0 text-gray-500">{shortDate(t.due_date.slice(0, 10))}</span>
              </li>
            ))}
            {clashes.tasks.length > 6 && <li className="text-xs text-gray-500">and {clashes.tasks.length - 6} more</li>}
          </ul>
        </div>
      )}

      {clashes && clashes.also_away.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-600">
          <Users size={12} className="mt-0.5 shrink-0 text-gray-400" />
          <span>
            Also away then: {clashes.also_away.slice(0, 6).map((a) => `${a.user.display_name || a.user.email}${a.status === 'pending' ? ' (asked)' : ''}`).join(', ')}
            {clashes.also_away.length > 6 && `, and ${clashes.also_away.length - 6} more`}
          </span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-gray-600">Who covers the work
          <select aria-label={`Who covers for ${who}`} value={cover} onChange={(e) => setCover(e.target.value)} className={`mt-1 block ${input}`}>
            <option value="">Nobody named</option>
            {covers.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.display_name || m.user.email}</option>)}
          </select>
        </label>
        <label className="min-w-0 flex-1 text-xs font-medium text-gray-600">Note
          <input aria-label={`Note for ${who}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, and they will see it" className={`mt-1 block w-full ${input}`} />
        </label>
        <button type="button" disabled={busy} onClick={() => decide(false)} className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"><X size={14} /> Decline</button>
        <button type="button" disabled={busy} onClick={() => decide(true)} className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"><Check size={14} /> Approve</button>
      </div>
      {cover && <p className="mt-1 text-[11px] text-gray-500">They will be told they are covering.</p>}
    </li>
  );
};

// --- team calendar ----------------------------------------------------------------------------------------------

const TeamCalendar: React.FC<{ ws: string }> = ({ ws }) => {
  const { members } = useWork();
  const me = useMe();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [data, setData] = useState<{ leave: LeaveRequest[]; holidays: Holiday[] } | null>(null);
  const dayList = useMemo(() => Array.from({ length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)), [month]);
  useEffect(() => {
    setData(null);
    leaveApi.calendar(ws, iso(dayList[0]), iso(dayList[dayList.length - 1])).then(setData).catch(() => setData({ leave: [], holidays: [] }));
  }, [ws, dayList]);
  const holidays = new Map((data?.holidays ?? []).map((h) => [h.day, h.name]));
  const people = members.filter((m) => m.role !== 'guest').map((m) => m.user).sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : (a.display_name || a.email).localeCompare(b.display_name || b.email)));
  const cell = (uid: string, d: Date) => (data?.leave ?? []).find((r) => r.user?.id === uid && r.start_date <= iso(d) && r.end_date >= iso(d));
  const away = (data?.leave ?? []).filter((r) => r.start_date <= iso(new Date()) && r.end_date >= iso(new Date()) && r.status === 'approved');
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" title="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronLeft size={16} /></button>
        <button type="button" title="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronRight size={16} /></button>
        <h2 className="text-sm font-semibold text-gray-800">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <span className="ml-3 text-xs text-gray-500">{away.length ? `Away today: ${away.map((r) => r.user?.display_name || r.user?.email).join(', ')}` : 'Nobody is away today.'}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="text-xs" aria-label="Team leave calendar">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-40 bg-white px-3 py-2 text-left font-medium text-gray-500">Person</th>
              {dayList.map((d) => {
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                const hol = holidays.get(iso(d));
                return <th key={d.getDate()} title={hol} className={`w-7 px-0.5 py-2 text-center font-medium ${hol ? 'bg-violet-50 text-violet-700' : weekend ? 'bg-gray-50 text-gray-400' : 'text-gray-500'}`}>{d.getDate()}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {people.map((u) => (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="sticky left-0 z-10 bg-white px-3 py-1.5"><span className="flex items-center gap-2"><Avatar user={u} size={20} /><span className="max-w-32 truncate text-gray-800">{u.display_name || u.email}</span></span></td>
                {dayList.map((d) => {
                  const r = cell(u.id, d);
                  const weekend = d.getDay() === 0 || d.getDay() === 6;
                  const hol = holidays.get(iso(d));
                  return (
                    <td key={d.getDate()} className={`h-7 px-0.5 ${hol ? 'bg-violet-50' : weekend ? 'bg-gray-50' : ''}`}>
                      {r && !weekend && !hol && (
                        <span title={`${r.type?.name ?? 'Leave'}${PART[r.part]} · ${r.status}`} aria-label={`${u.display_name || u.email} on leave ${iso(d)}`}
                          className={`block h-5 rounded ${r.status === 'pending' ? 'opacity-40' : ''} ${r.part !== 'full' ? 'mx-1.5' : ''}`}
                          style={{ backgroundColor: r.type?.color ?? '#94a3b8' }} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex flex-wrap gap-4 text-xs text-gray-500"><span>Faded: waiting for approval</span><span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-violet-100" /> Company holiday</span></p>
    </div>
  );
};

// --- settings (admins) ---------------------------------------------------------------------------------------------

const LeaveSettings: React.FC<{ ws: string }> = ({ ws }) => {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [newHol, setNewHol] = useState({ day: '', name: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => {
    leaveApi.types(ws, true).then(setTypes).catch(() => undefined);
    leaveApi.holidays(ws, year).then(setHolidays).catch(() => undefined);
  }, [ws, year]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }); load(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const saveType = (t: LeaveType) => act(() => leaveApi.updateType(ws, t.id, { ...t }), 'Saved.');
  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="lg:col-span-2"><LeavePolicyForm ws={ws} /></div>
      <section aria-label="Leave types" className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900"><Settings size={16} className="text-brand-600" /> Leave types</h3>
        <p className="mb-3 text-xs text-gray-500">Yearly allowance per person; leave it empty for no limit.</p>
        <ul className="space-y-2">
          {types.map((t) => (
            <li key={t.id} className={`flex flex-wrap items-center gap-2 text-sm ${t.archived ? 'opacity-50' : ''}`}>
              <input type="color" aria-label={`Colour of ${t.name}`} value={t.color} onChange={(e) => setTypes(types.map((x) => (x.id === t.id ? { ...x, color: e.target.value } : x)))} className="h-7 w-7 rounded border border-gray-200" />
              <input aria-label={`Name of ${t.name}`} value={t.name} onChange={(e) => setTypes(types.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)))} className={`w-28 ${input}`} />
              <input aria-label={`Days a year for ${t.name}`} type="number" min={0} value={t.yearly_days ?? ''} placeholder="∞" onChange={(e) => setTypes(types.map((x) => (x.id === t.id ? { ...x, yearly_days: e.target.value === '' ? null : Number(e.target.value) } : x)))} className={`w-16 ${input}`} />
              <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={t.needs_approval} onChange={(e) => setTypes(types.map((x) => (x.id === t.id ? { ...x, needs_approval: e.target.checked } : x)))} /> Needs approval</label>
              <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={t.paid} onChange={(e) => setTypes(types.map((x) => (x.id === t.id ? { ...x, paid: e.target.checked } : x)))} /> Paid</label>
              <button type="button" onClick={() => saveType(t)} className="rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">Save</button>
              <button type="button" onClick={() => saveType({ ...t, archived: !t.archived })} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">{t.archived ? 'Restore' : 'Retire'}</button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => act(() => leaveApi.addType(ws, { name: `New type ${types.length + 1}`, color: '#8b5cf6', yearly_days: null, paid: true, needs_approval: true, archived: false }))} className="mt-3 flex items-center gap-1 text-sm text-brand-700 hover:underline"><Plus size={14} /> Add a leave type</button>
      </section>
      <section aria-label="Company holidays" className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900"><CalendarRange size={16} className="text-brand-600" /> Company holidays
          <span className="ml-auto flex items-center gap-1 text-sm font-normal">
            <button type="button" title="Previous year" onClick={() => setYear(year - 1)} className="rounded p-0.5 text-gray-500 hover:bg-gray-100"><ChevronLeft size={14} /></button>{year}
            <button type="button" title="Next year" onClick={() => setYear(year + 1)} className="rounded p-0.5 text-gray-500 hover:bg-gray-100"><ChevronRight size={14} /></button>
          </span>
        </h3>
        <p className="mb-3 text-xs text-gray-500">Nobody is expected to work: no capacity in Workload and timesheets, and leave isn't counted.</p>
        <ul className="mb-3 divide-y divide-gray-100 text-sm" aria-label="Holidays">
          {holidays.length === 0 && <li className="py-2 text-gray-400">No holidays in {year}.</li>}
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-3 py-1.5">
              <span className="w-28 text-gray-500">{fromIso(h.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <span className="flex-1 text-gray-800">{h.name}</span>
              <button type="button" title={`Remove ${h.name}`} onClick={() => act(() => leaveApi.removeHoliday(ws, h.id))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newHol.day && newHol.name.trim()) act(() => leaveApi.addHoliday(ws, newHol.day, newHol.name.trim()).then(() => setNewHol({ day: '', name: '' }))); }}>
          <input type="date" aria-label="Holiday date" value={newHol.day} onChange={(e) => setNewHol({ ...newHol, day: e.target.value })} className={input} />
          <input aria-label="Holiday name" value={newHol.name} onChange={(e) => setNewHol({ ...newHol, name: e.target.value })} placeholder="e.g. Diwali" className={`min-w-0 flex-1 ${input}`} />
          <button type="submit" className={primary}>Add</button>
        </form>
      </section>
      {msg && <p className={`lg:col-span-2 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`} role="status">{msg.text}</p>}
    </div>
  );
};
