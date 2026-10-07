// Everyone's leave, for HR and admins.
//
// The three questions this screen exists to answer: what is outstanding across the firm, where
// does one person stand, and how do I correct a balance that the rules got wrong (a comp-off for
// a weekend worked, days carried over from the old system). Without the last one, HR has to fake
// a leave request to fix a number, and the history then lies.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Scale, Search } from 'lucide-react';

import { useWork } from '../WorkContext';
import { Avatar } from '../ui';
import {
  dayCount, leaveApi, shortDate, yearLabel,
  type LeaveAdjustment, type LeaveBalance, type LeaveRequest, type LeaveStatus, type LeaveType,
} from './leaveApi';

const input = 'rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15';
const primary = 'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';
const STATUS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800', approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500',
};
const name = (u: { display_name?: string | null; email: string } | null | undefined) => (u ? u.display_name || u.email : '—');
const span = (r: LeaveRequest) => (r.start_date === r.end_date ? shortDate(r.start_date) : `${shortDate(r.start_date)} – ${shortDate(r.end_date)}`);

/** The leave years worth offering: this one and the four before it. */
const useYears = (current: number | null) =>
  useMemo(() => {
    const now = current ?? new Date().getFullYear();
    return [now + 1, now, now - 1, now - 2, now - 3];
  }, [current]);

export const LeaveAdmin: React.FC<{ ws: string }> = ({ ws }) => {
  const [person, setPerson] = useState<string | null>(null);
  return person ? <OnePerson ws={ws} userId={person} onBack={() => setPerson(null)} /> : <Everyone ws={ws} onPick={setPerson} />;
};

// --- everyone -----------------------------------------------------------------------------------

const Everyone: React.FC<{ ws: string; onPick: (userId: string) => void }> = ({ ws, onPick }) => {
  const [rows, setRows] = useState<LeaveRequest[] | null>(null);
  const [status, setStatus] = useState<LeaveStatus | ''>('pending');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null);
    leaveApi.list(ws, 'all', status ? { status } : {})
      .then(setRows)
      .catch((e) => { setError((e as Error).message); setRows([]); });
  }, [ws, status]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows ?? [];
    return (rows ?? []).filter((r) => name(r.user).toLowerCase().includes(needle) || (r.type?.name ?? '').toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as LeaveStatus | '')} className={input}>
          <option value="pending">Waiting for a decision</option>
          <option value="approved">Approved</option>
          <option value="rejected">Declined</option>
          <option value="cancelled">Cancelled</option>
          <option value="">Every status</option>
        </select>
        <label className="relative flex items-center">
          <Search size={14} className="absolute left-2 text-gray-400" />
          <input aria-label="Search people or leave types" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a person or type" className={`w-56 pl-7 ${input}`} />
        </label>
        <span className="ml-auto text-xs text-gray-500">{shown.length} request{shown.length === 1 ? '' : 's'}</span>
      </div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {rows === null ? <p className="text-sm text-gray-400">Loading…</p> : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
          {status === 'pending' ? 'Nothing is waiting for a decision.' : 'Nothing matches.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white" aria-label="Everyone's leave">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: r.type?.color ?? '#9ca3af' }} />
              {r.user && <Avatar user={r.user} size={26} />}
              <button type="button" onClick={() => r.user && onPick(r.user.id)} className="min-w-0 max-w-44 truncate text-left font-medium text-gray-900 underline-offset-2 hover:text-brand-700 hover:underline">
                {name(r.user)}
              </button>
              <span className="min-w-0 flex-1 text-gray-600">
                {r.type?.name} · {span(r)} · {dayCount(r.days)} day{r.days === 1 ? '' : 's'}
                {r.cover && <span className="text-gray-500"> · covered by {name(r.cover)}</span>}
              </span>
              {r.status === 'pending' && r.waiting_days != null && r.waiting_days > 0 && (
                <span className={`shrink-0 text-xs ${r.escalated_at ? 'font-medium text-red-700' : 'text-gray-500'}`}>
                  waiting {r.waiting_days}d{r.escalated_at ? ' · chased' : ''}
                </span>
              )}
              {r.status === 'pending' && <span className="shrink-0 text-xs text-gray-500">with {name(r.approver)}</span>}
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS[r.status]}`}>{r.status}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-gray-500">Pick a name to see where they stand and to correct a balance.</p>
    </div>
  );
};

// --- one person ---------------------------------------------------------------------------------

const OnePerson: React.FC<{ ws: string; userId: string; onBack: () => void }> = ({ ws, userId, onBack }) => {
  const { members } = useWork();
  const who = members.find((m) => m.user.id === userId)?.user;
  const [balances, setBalances] = useState<LeaveBalance[] | null>(null);
  const [history, setHistory] = useState<LeaveRequest[] | null>(null);
  const [adjustments, setAdjustments] = useState<LeaveAdjustment[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The first load has no year: the server answers with the leave year we are in, which is the
  // only place that knows when the firm's year starts.
  const load = useCallback(() => {
    leaveApi.balances(ws, year ?? undefined, userId).then((bs) => {
      setBalances(bs);
      if (year === null && bs[0]?.year != null) setYear(bs[0].year);
    }).catch((e) => setError((e as Error).message));
    if (year !== null) {
      leaveApi.list(ws, 'all', { year, user_id: userId }).then(setHistory).catch(() => setHistory([]));
      leaveApi.adjustments(ws, userId, year).then(setAdjustments).catch(() => setAdjustments([]));
    }
  }, [ws, userId, year]);
  useEffect(() => { load(); }, [load]);

  const years = useYears(year);
  const types = (balances ?? []).map((b) => b.type);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><ArrowLeft size={14} /> Everyone</button>
        {who && <Avatar user={who} size={28} />}
        <h2 className="text-base font-semibold text-gray-900">{name(who)}</h2>
        <select aria-label="Leave year" value={year ?? ''} onChange={(e) => setYear(Number(e.target.value))} className={`ml-auto ${input}`}>
          {years.map((y) => <option key={y} value={y}>{y}–{String(y + 1).slice(2)}</option>)}
        </select>
      </div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {balances && balances[0] && <p className="text-xs text-gray-500">Leave year: {yearLabel(balances[0])}</p>}

      <section aria-label="Balances" className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50/70 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              {['Type', 'Earned', 'Carried over', 'Adjusted', 'Allowance', 'Taken', 'Pending', 'Left'].map((h) => (
                <th key={h} className={`px-3 py-2 font-medium ${h === 'Type' ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(balances ?? []).map((b) => (
              <tr key={b.type.id} className="border-t border-gray-100">
                <td className="px-3 py-2"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.type.color }} />{b.type.name}</span></td>
                <td className="px-3 py-2 text-right text-gray-600">{b.earned == null ? '—' : dayCount(b.earned)}</td>
                <td className="px-3 py-2 text-right text-gray-600">{b.carried_forward ? dayCount(b.carried_forward) : '—'}</td>
                <td className={`px-3 py-2 text-right ${b.adjusted ? 'font-medium text-brand-700' : 'text-gray-400'}`}>{b.adjusted ? `${b.adjusted > 0 ? '+' : ''}${dayCount(b.adjusted)}` : '—'}</td>
                <td className="px-3 py-2 text-right font-medium text-gray-900">{b.allowance == null ? 'No limit' : dayCount(b.allowance)}</td>
                <td className="px-3 py-2 text-right text-gray-600">{dayCount(b.used)}</td>
                <td className="px-3 py-2 text-right text-gray-600">{b.pending ? dayCount(b.pending) : '—'}</td>
                <td className="px-3 py-2 text-right font-semibold text-gray-900">{b.allowance == null ? '—' : dayCount(b.remaining)}</td>
              </tr>
            ))}
            {balances === null && <tr><td colSpan={8} className="px-3 py-4 text-sm text-gray-400">Loading…</td></tr>}
          </tbody>
        </table>
      </section>

      {year !== null && (
        <Adjust ws={ws} userId={userId} year={year} types={types} rows={adjustments} onChanged={load} />
      )}

      <section aria-label="Their leave this year">
        <h3 className="mb-2 text-sm font-semibold text-gray-800">Leave in this year</h3>
        {history === null ? <p className="text-sm text-gray-400">Loading…</p> : history.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-400">None in this leave year.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {history.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <span className="h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: r.type?.color ?? '#9ca3af' }} />
                <span className="min-w-0 flex-1 text-gray-800">
                  {r.type?.name} · {span(r)} · {dayCount(r.days)} day{r.days === 1 ? '' : 's'}
                  {r.reason && <span className="text-gray-500"> · {r.reason}</span>}
                </span>
                {r.decided_by && <span className="shrink-0 text-xs text-gray-500">by {name(r.decided_by)}</span>}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS[r.status]}`}>{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

// --- correcting a balance -----------------------------------------------------------------------

const Adjust: React.FC<{
  ws: string; userId: string; year: number; types: LeaveType[]; rows: LeaveAdjustment[]; onChanged: () => void;
}> = ({ ws, userId, year, types, rows, onChanged }) => {
  const [form, setForm] = useState({ type_id: '', days: '', reason: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm((f) => ({ ...f, type_id: f.type_id || types[0]?.id || '' })); }, [types]);

  const save = async (typeId: string, days: number, reason: string | null) => {
    setBusy(true);
    setMsg(null);
    try {
      await leaveApi.setAdjustment(ws, { user_id: userId, type_id: typeId, year, days, reason });
      setForm({ type_id: types[0]?.id ?? '', days: '', reason: '' });
      onChanged();
      setMsg({ ok: true, text: days === 0 ? 'Adjustment removed.' : 'Saved.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Adjust a balance" className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="flex items-center gap-2 font-semibold text-gray-900"><Scale size={16} className="text-brand-600" /> Correct a balance</h3>
      <p className="mb-3 text-xs text-gray-500">
        Days the rules would not have given them: a comp-off for a weekend worked, an opening balance from the old system.
        Plus adds, minus takes away. One adjustment per type per year -- saving again replaces it.
      </p>
      {rows.length > 0 && (
        <ul className="mb-3 divide-y divide-gray-100 text-sm">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="w-24 font-medium text-gray-800">{a.type?.name ?? 'Leave'}</span>
              <span className={`w-14 font-semibold ${a.days < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{a.days > 0 ? '+' : ''}{dayCount(a.days)}</span>
              <span className="min-w-0 flex-1 text-gray-600">{a.reason || <span className="text-gray-400">No reason given</span>}</span>
              <span className="text-xs text-gray-400">{name(a.created_by)}</span>
              <button type="button" onClick={() => a.type && save(a.type.id, 0, null)} className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100">Remove</button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const days = Number(form.days);
          if (!form.type_id || !form.days || Number.isNaN(days)) return;
          save(form.type_id, days, form.reason.trim() || null);
        }}
      >
        <label className="text-xs font-medium text-gray-600">Type
          <select aria-label="Leave type to adjust" value={form.type_id} onChange={(e) => setForm({ ...form, type_id: e.target.value })} className={`mt-1 block ${input}`}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">Days
          <input type="number" step={0.5} aria-label="Days to add or take away" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} placeholder="+1.5" className={`mt-1 block w-24 ${input}`} />
        </label>
        <label className="min-w-0 flex-1 text-xs font-medium text-gray-600">Why
          <input aria-label="Why this adjustment" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Comp-off for the audit weekend" className={`mt-1 block w-full ${input}`} />
        </label>
        <button type="submit" disabled={busy || !form.days} className={primary}>Save</button>
      </form>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`} role="status">{msg.text}</p>}
    </section>
  );
};
