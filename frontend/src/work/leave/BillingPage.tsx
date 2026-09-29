import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { ChevronDown, ChevronRight, FileSpreadsheet, Printer, Receipt, Trash2, Wallet } from 'lucide-react';
import { useWork } from '../WorkContext';
import type { FolderNode, SpaceNode } from '../api';
import { hrs, iso, leaveApi, money, type BillingRate, type ClientFee, type Invoice, type ProfitRow } from './leaveApi';

type Tab = 'profit' | 'invoice' | 'fees' | 'rates';
const input = 'rounded-md border border-gray-300 px-2 py-1.5 text-sm';
const primary = 'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';

interface Loc { kind: 'space' | 'folder' | 'list'; id: string; label: string }

/** Every Space, Folder and List as "Space / Folder / List", for pickers. */
function useLocations(): Loc[] {
  const { hierarchy } = useWork();
  return useMemo(() => {
    const out: Loc[] = [];
    const walkFolder = (f: FolderNode, path: string) => {
      const here = `${path} / ${f.name}`;
      out.push({ kind: 'folder', id: f.id, label: here });
      f.folders?.forEach((sub) => walkFolder(sub, here));
      f.lists.forEach((l) => out.push({ kind: 'list', id: l.id, label: `${here} / ${l.name}` }));
    };
    (hierarchy?.spaces ?? []).forEach((sp: SpaceNode) => {
      out.push({ kind: 'space', id: sp.id, label: sp.name });
      sp.folders.forEach((f) => walkFolder(f, sp.name));
      sp.lists.forEach((l) => out.push({ kind: 'list', id: l.id, label: `${sp.name} / ${l.name}` }));
    });
    return out;
  }, [hierarchy]);
}

const monthRange = (d: Date) => [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))] as const;

/** Client billing for owners and admins: what time is worth against what clients pay. */
export const BillingPage: React.FC = () => {
  const { workspace, hierarchy } = useWork();
  const [tab, setTab] = useState<Tab>('profit');
  if (!workspace) return null;
  if (hierarchy && hierarchy.role !== 'owner' && hierarchy.role !== 'admin') return <p className="p-10 text-center text-sm text-gray-500">Only owners and admins can see billing.</p>;
  const tabs: [Tab, string][] = [['profit', 'Client profitability'], ['invoice', 'Invoice'], ['fees', 'Client fees'], ['rates', 'Billing rates']];
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="border-b border-gray-200 px-6 pt-4 print:hidden">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><Wallet size={18} className="text-brand-600" /> Billing</h1>
        <nav role="tablist" aria-label="Billing" className="mt-3 flex gap-5">
          {tabs.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`-mb-px border-b-2 pb-2 text-sm ${tab === k ? 'border-brand-600 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{l}</button>
          ))}
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-auto bg-gray-50/60 p-6">
        {tab === 'profit' && <Profitability ws={workspace.id} />}
        {tab === 'invoice' && <InvoiceTab ws={workspace.id} />}
        {tab === 'fees' && <Fees ws={workspace.id} />}
        {tab === 'rates' && <Rates ws={workspace.id} />}
      </main>
    </div>
  );
};

const MonthPicker: React.FC<{ value: Date; onChange: (d: Date) => void }> = ({ value, onChange }) => (
  <input type="month" aria-label="Month" value={`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`}
    onChange={(e) => { const [y, m] = e.target.value.split('-').map(Number); if (y && m) onChange(new Date(y, m - 1, 1)); }} className={input} />
);

// --- profitability ------------------------------------------------------------------------------------------------

const Profitability: React.FC<{ ws: string }> = ({ ws }) => {
  const [month, setMonth] = useState(() => new Date());
  const [rows, setRows] = useState<ProfitRow[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const [start, end] = monthRange(month);
    setRows(null);
    leaveApi.profitability(ws, start, end).then((r) => setRows(r.rows)).catch((e) => setError(e.message));
  }, [ws, month]);
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <MonthPicker value={month} onChange={setMonth} />
        <p className="text-xs text-gray-500">Billable hours are priced at billing rates and compared with each client's fee. Realisation above 100% means the fee covers the time.</p>
      </div>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {rows === null ? <p className="text-sm text-gray-400">Working it out…</p> : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">No clients yet. Add a fee under “Client fees” to a Space, Folder or List.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[820px] text-sm" aria-label="Client profitability">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500">
              <tr><th className="px-3 py-2">Client</th><th className="px-3 py-2 text-right">Fee</th><th className="px-3 py-2 text-right">Billable</th><th className="px-3 py-2 text-right">Non-billable</th><th className="px-3 py-2 text-right">Time value</th><th className="px-3 py-2 text-right">Margin</th><th className="px-3 py-2 text-right">Realisation</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const expanded = open.has(r.location_id);
                return (
                  <React.Fragment key={r.location_id}>
                    <tr className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(r.location_id)) n.delete(r.location_id); else n.add(r.location_id); return n; })} className="flex items-center gap-1.5 text-left font-medium text-gray-900">
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{r.client_name || r.name}
                        </button>
                        {r.client_name && <span className="ml-5 text-xs text-gray-400">{r.name}</span>}
                        {r.unpriced_seconds > 0 && <span className="ml-5 block text-xs text-amber-700">{hrs(r.unpriced_seconds)} billable with no rate set</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.fee, r.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{hrs(r.billable_seconds)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{hrs(r.non_billable_seconds)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.value, r.currency)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.margin == null ? '' : r.margin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{money(r.margin, r.currency)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.realisation == null ? 'text-gray-400' : r.realisation >= 100 ? 'text-emerald-700' : 'text-red-700'}`}>{r.realisation == null ? '—' : `${r.realisation}%`}</td>
                    </tr>
                    {expanded && r.people.map((p, i) => (
                      <tr key={i} className="bg-gray-50/60 text-xs text-gray-600">
                        <td className="py-1.5 pl-9 pr-3">{p.user ? p.user.display_name || p.user.email : 'Someone'}{p.rate != null ? ` · ${money(p.rate, r.currency)}/h` : ''}</td>
                        <td /><td className="px-3 text-right tabular-nums">{hrs(p.billable_seconds)}</td><td className="px-3 text-right tabular-nums">{hrs(p.non_billable_seconds)}</td>
                        <td className="px-3 text-right tabular-nums">{money(p.value, r.currency)}</td><td /><td />
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// --- invoice -----------------------------------------------------------------------------------------------------

const InvoiceTab: React.FC<{ ws: string }> = ({ ws }) => {
  const locations = useLocations();
  const [fees, setFees] = useState<ClientFee[]>([]);
  const [target, setTarget] = useState('');
  const [month, setMonth] = useState(() => new Date());
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { leaveApi.fees(ws).then((f) => { setFees(f); if (f[0]) setTarget(`${f[0].location_kind}:${f[0].location_id}`); }).catch(() => undefined); }, [ws]);
  const make = async () => {
    const [kind, id] = target.split(':');
    const [start, end] = monthRange(month);
    setError(null);
    try { setInv(await leaveApi.invoice(ws, kind, id, start, end)); } catch (e) { setError((e as Error).message); }
  };
  const excel = () => {
    if (!inv) return;
    const sheet = XLSX.utils.json_to_sheet(inv.lines.map((l) => ({
      'Task ID': l.custom_id ?? '', Task: l.task_name, Person: l.user ? l.user.display_name || l.user.email : '', Hours: Math.round((l.seconds / 3600) * 100) / 100,
      Rate: l.rate ?? '', Amount: l.amount,
    })));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Invoice');
    XLSX.writeFile(book, `invoice-${(inv.client_name || inv.name).replace(/[^\w]+/g, '-')}-${inv.start.slice(0, 7)}.xlsx`);
  };
  const ordered = [...fees.map((f) => ({ kind: f.location_kind, id: f.location_id, label: `${f.client_name || f.location_name} (client)` })), ...locations];
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <select aria-label="Client or location" value={target} onChange={(e) => setTarget(e.target.value)} className={`min-w-72 ${input}`}>
          <option value="">Choose a client, Space, Folder or List</option>
          {ordered.map((l, i) => <option key={`${i}-${l.id}`} value={`${l.kind}:${l.id}`}>{l.label}</option>)}
        </select>
        <MonthPicker value={month} onChange={setMonth} />
        <button type="button" disabled={!target} onClick={make} className={`flex items-center gap-1.5 ${primary}`}><Receipt size={14} /> Draft invoice</button>
        {inv && <><button type="button" onClick={() => window.print()} className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><Printer size={14} /> Print / PDF</button>
          <button type="button" onClick={excel} className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><FileSpreadsheet size={14} /> Excel</button></>}
      </div>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {inv && (
        <article aria-label="Invoice draft" className="rounded-xl border border-gray-200 bg-white p-8 print:border-0 print:p-0">
          <header className="mb-6 flex items-start justify-between">
            <div><p className="text-xs uppercase tracking-widest text-gray-400">Invoice draft</p><h2 className="mt-1 text-xl font-semibold text-gray-900">{inv.client_name || inv.name}</h2>
              <p className="text-sm text-gray-500">Work from {new Date(inv.start).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })} to {new Date(inv.end).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
            <div className="text-right text-sm text-gray-500">Verve Advisory</div>
          </header>
          {inv.lines.length === 0 ? <p className="text-sm text-gray-400">No billable time in this period.</p> : (
            <table className="w-full text-sm" aria-label="Invoice lines">
              <thead className="border-b border-gray-200 text-left text-xs text-gray-500"><tr><th className="py-2">Task</th><th className="py-2">Person</th><th className="py-2 text-right">Hours</th><th className="py-2 text-right">Rate</th><th className="py-2 text-right">Amount</th></tr></thead>
              <tbody>
                {inv.lines.map((l, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2">{l.custom_id && <span className="mr-2 font-mono text-xs text-gray-400">{l.custom_id}</span>}{l.task_name}</td>
                    <td className="py-2 text-gray-600">{l.user ? l.user.display_name || l.user.email : ''}</td>
                    <td className="py-2 text-right tabular-nums">{(l.seconds / 3600).toFixed(2)}</td>
                    <td className="py-2 text-right tabular-nums">{l.rate == null ? <span className="text-amber-700">no rate</span> : money(l.rate, inv.currency)}</td>
                    <td className="py-2 text-right tabular-nums">{money(l.amount, inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td className="pt-3 font-semibold" colSpan={2}>Total</td><td className="pt-3 text-right tabular-nums font-semibold">{(inv.total_seconds / 3600).toFixed(2)}</td><td /><td className="pt-3 text-right tabular-nums font-semibold">{money(inv.total, inv.currency)}</td></tr></tfoot>
            </table>
          )}
          {inv.fee != null && <p className="mt-4 text-xs text-gray-500">Agreed fee for the period: {money(inv.fee, inv.currency)}.</p>}
        </article>
      )}
    </div>
  );
};

// --- client fees -------------------------------------------------------------------------------------------------

const Fees: React.FC<{ ws: string }> = ({ ws }) => {
  const locations = useLocations();
  const [fees, setFees] = useState<ClientFee[]>([]);
  const [form, setForm] = useState({ target: '', client_name: '', amount: '', period: 'monthly', currency: 'INR' });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => leaveApi.fees(ws).then(setFees).catch((e) => setError(e.message)), [ws]);
  useEffect(() => { load(); }, [load]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const [kind, id] = form.target.split(':');
    setError(null);
    try {
      await leaveApi.setFee(ws, kind, id, { amount: Number(form.amount), period: form.period, currency: form.currency, client_name: form.client_name.trim() || null });
      setForm({ ...form, target: '', client_name: '', amount: '' });
      load();
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <p className="text-sm text-gray-600">A client is any Space, Folder or List with a fee: a monthly retainer, or a one-off fee for the whole engagement.</p>
      <form onSubmit={save} aria-label="Set a client fee" className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-4">
        <label className="text-xs font-medium text-gray-600">Where the work lives<select aria-label="Client location" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} className={`mt-1 block min-w-64 ${input}`}>
          <option value="">Choose…</option>{locations.map((l) => <option key={`${l.kind}:${l.id}`} value={`${l.kind}:${l.id}`}>{l.label}</option>)}
        </select></label>
        <label className="text-xs font-medium text-gray-600">Client name<input aria-label="Client name" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} className={`mt-1 block w-44 ${input}`} /></label>
        <label className="text-xs font-medium text-gray-600">Fee<input aria-label="Fee amount" type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={`mt-1 block w-32 ${input}`} /></label>
        <label className="text-xs font-medium text-gray-600">Per<select aria-label="Fee period" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} className={`mt-1 block ${input}`}><option value="monthly">month</option><option value="one_off">engagement (one-off)</option></select></label>
        <label className="text-xs font-medium text-gray-600">Currency<input aria-label="Currency" value={form.currency} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} className={`mt-1 block w-16 ${input}`} /></label>
        <button type="submit" disabled={!form.target || form.amount === ''} className={primary}>Save fee</button>
      </form>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white" aria-label="Client fees">
        {fees.length === 0 && <li className="p-6 text-center text-sm text-gray-400">No client fees yet.</li>}
        {fees.map((f) => (
          <li key={f.location_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0 flex-1"><div className="font-medium text-gray-900">{f.client_name || f.location_name}</div><div className="text-xs text-gray-500">{f.location_kind} · {f.location_name}</div></div>
            <span className="tabular-nums text-gray-800">{money(f.amount, f.currency)} {f.period === 'monthly' ? '/ month' : 'one-off'}</span>
            <button type="button" title={`Remove the fee for ${f.client_name || f.location_name}`} onClick={() => leaveApi.setFee(ws, f.location_kind, f.location_id, null).then(load)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
          </li>
        ))}
      </ul>
    </div>
  );
};

// --- rates ---------------------------------------------------------------------------------------------------------

const Rates: React.FC<{ ws: string }> = ({ ws }) => {
  const { members } = useWork();
  const locations = useLocations();
  const [rates, setRates] = useState<BillingRate[]>([]);
  const [form, setForm] = useState({ user_id: '', target: '', hourly_rate: '', currency: 'INR' });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => leaveApi.rates(ws).then(setRates).catch((e) => setError(e.message)), [ws]);
  useEffect(() => { load(); }, [load]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const [kind, id] = form.target ? form.target.split(':') : [null, null];
    setError(null);
    try {
      await leaveApi.setRate(ws, { user_id: form.user_id || null, location_kind: kind, location_id: id, hourly_rate: Number(form.hourly_rate), currency: form.currency });
      setForm({ ...form, hourly_rate: '' });
      load();
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <p className="text-sm text-gray-600">The most specific rate wins: a person's rate on a List, Folder or Space; then that location's rate for everyone; then the person's own rate.</p>
      <form onSubmit={save} aria-label="Set a billing rate" className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-4">
        <label className="text-xs font-medium text-gray-600">Person<select aria-label="Rate person" value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} className={`mt-1 block w-48 ${input}`}>
          <option value="">Everyone</option>{members.filter((m) => m.role !== 'guest').map((m) => <option key={m.user.id} value={m.user.id}>{m.user.display_name || m.user.email}</option>)}
        </select></label>
        <label className="text-xs font-medium text-gray-600">Where<select aria-label="Rate location" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} className={`mt-1 block min-w-56 ${input}`}>
          <option value="">Everywhere (their own rate)</option>{locations.map((l) => <option key={`${l.kind}:${l.id}`} value={`${l.kind}:${l.id}`}>{l.label}</option>)}
        </select></label>
        <label className="text-xs font-medium text-gray-600">Per hour<input aria-label="Hourly rate" type="number" min={0} value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} className={`mt-1 block w-28 ${input}`} /></label>
        <label className="text-xs font-medium text-gray-600">Currency<input aria-label="Rate currency" value={form.currency} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} className={`mt-1 block w-16 ${input}`} /></label>
        <button type="submit" disabled={form.hourly_rate === '' || (!form.user_id && !form.target)} className={primary}>Save rate</button>
      </form>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <table className="w-full rounded-xl border border-gray-200 bg-white text-sm" aria-label="Billing rates">
        <thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-3 py-2">Person</th><th className="px-3 py-2">Where</th><th className="px-3 py-2 text-right">Rate</th><th /></tr></thead>
        <tbody>
          {rates.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-gray-400">No rates yet.</td></tr>}
          {rates.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-3 py-2">{r.user ? r.user.display_name || r.user.email : 'Everyone'}</td>
              <td className="px-3 py-2 text-gray-600">{r.location_name ? `${r.location_kind}: ${r.location_name}` : 'Everywhere'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(r.hourly_rate, r.currency)}/h</td>
              <td className="px-3 py-2 text-right"><button type="button" title="Remove rate" onClick={() => leaveApi.removeRate(ws, r.id).then(load)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
