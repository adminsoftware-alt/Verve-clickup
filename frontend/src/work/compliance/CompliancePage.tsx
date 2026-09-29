import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Landmark, Plus, Trash2, X } from 'lucide-react';
import { useWork } from '../WorkContext';
import type { FolderNode, SpaceNode } from '../api';
import { outboundApi, type ClientCompliance, type ComplianceItem, type Obligation } from '../outboundApi';
import { ask } from '../../components/ask';

type Tab = 'calendar' | 'clients' | 'catalogue';
const input = 'rounded-md border border-gray-300 px-2 py-1.5 text-sm';
const primary = 'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FREQ: Record<Obligation['frequency'], string> = { monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Yearly' };

/** Every List in the workspace, as "Space / Folder / List", to choose a client's List. */
function useLists() {
  const { hierarchy } = useWork();
  return useMemo(() => {
    const out: { id: string; label: string; name: string }[] = [];
    const walk = (f: FolderNode, path: string) => {
      const here = `${path} / ${f.name}`;
      f.folders?.forEach((sub) => walk(sub, here));
      f.lists.forEach((l) => out.push({ id: l.id, label: `${here} / ${l.name}`, name: l.name }));
    };
    (hierarchy?.spaces ?? []).forEach((sp: SpaceNode) => {
      sp.folders.forEach((f) => walk(f, sp.name));
      sp.lists.forEach((l) => out.push({ id: l.id, label: `${sp.name} / ${l.name}`, name: l.name }));
    });
    return out;
  }, [hierarchy]);
}

/** The statutory compliance calendar: every client's filings and payments, and their tasks. */
export const CompliancePage: React.FC = () => {
  const { workspace, hierarchy } = useWork();
  const [tab, setTab] = useState<Tab>('calendar');
  if (!workspace) return null;
  const isAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
  const tabs: [Tab, string][] = [['calendar', 'Calendar'], ['clients', 'Clients'], ['catalogue', 'Filings catalogue']];
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="border-b border-gray-200 px-6 pt-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><Landmark size={18} className="text-brand-600" /> Compliance</h1>
        <p className="text-xs text-gray-500">Statutory filings and payments for each client, as tasks created ahead of the due date. Due dates change by notification: check the catalogue against the latest circulars.</p>
        <nav role="tablist" aria-label="Compliance" className="mt-3 flex gap-5">
          {tabs.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`-mb-px border-b-2 pb-2 text-sm ${tab === k ? 'border-brand-600 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{l}</button>
          ))}
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-auto bg-gray-50/60 p-6">
        {tab === 'calendar' && <Calendar ws={workspace.id} />}
        {tab === 'clients' && <Clients ws={workspace.id} />}
        {tab === 'catalogue' && <Catalogue ws={workspace.id} canEdit={isAdmin} />}
      </main>
    </div>
  );
};

// --- calendar ---------------------------------------------------------------------------------------------------

const Calendar: React.FC<{ ws: string }> = ({ ws }) => {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [items, setItems] = useState<ComplianceItem[] | null>(null);
  const [client, setClient] = useState('');
  const [authority, setAuthority] = useState('');
  useEffect(() => {
    setItems(null);
    let current = true; // switching months quickly: only the month on screen may land
    outboundApi.calendar(ws, iso(month), iso(new Date(month.getFullYear(), month.getMonth() + 1, 0)))
      .then((got) => { if (current) setItems(got); })
      .catch(() => { if (current) setItems([]); });
    return () => { current = false; };
  }, [ws, month]);
  const shown = (items ?? []).filter((i) => (!client || i.client_name === client) && (!authority || i.authority === authority));
  const clients = [...new Set((items ?? []).map((i) => i.client_name))].sort();
  const authorities = [...new Set((items ?? []).map((i) => i.authority).filter(Boolean) as string[])].sort();
  const byDay = shown.reduce<Record<string, ComplianceItem[]>>((acc, i) => { (acc[i.due_date] ??= []).push(i); return acc; }, {});
  const done = shown.filter((i) => i.done).length;
  const overdue = shown.filter((i) => i.overdue).length;
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" title="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronLeft size={16} /></button>
        <button type="button" title="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronRight size={16} /></button>
        <h2 className="mr-2 text-sm font-semibold text-gray-800">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <select aria-label="Filter by client" value={client} onChange={(e) => setClient(e.target.value)} className={input}><option value="">All clients</option>{clients.map((c) => <option key={c}>{c}</option>)}</select>
        <select aria-label="Filter by authority" value={authority} onChange={(e) => setAuthority(e.target.value)} className={input}><option value="">All authorities</option>{authorities.map((a) => <option key={a}>{a}</option>)}</select>
        {items && <span className="ml-auto text-xs text-gray-500">{shown.length} due · {done} done{overdue ? <b className="text-red-700"> · {overdue} overdue</b> : ''}</span>}
      </div>
      {items === null ? <p className="text-sm text-gray-400">Loading…</p> : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">Nothing due this month. Add clients' obligations under “Clients”.</p>
      ) : (
        <ol className="space-y-3" aria-label="Filings due">
          {Object.entries(byDay).map(([dueDay, rows]) => (
            <li key={dueDay} className="rounded-xl border border-gray-200 bg-white">
              <h3 className="border-b border-gray-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{new Date(`${dueDay}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long' })}</h3>
              <ul className="divide-y divide-gray-100">
                {rows.map((i, k) => (
                  <li key={k} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${i.done ? 'bg-emerald-500' : i.overdue ? 'bg-red-500' : 'bg-amber-400'}`} />
                    <span className="min-w-0 flex-1"><b className="font-medium text-gray-900">{i.obligation}</b> <span className="text-gray-500">· {i.period_label} · {i.client_name}</span></span>
                    {i.authority && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{i.authority}</span>}
                    <span className={`w-28 text-right text-xs ${i.done ? 'text-emerald-700' : i.overdue ? 'text-red-700' : 'text-gray-500'}`}>{i.done ? 'Done' : i.overdue ? 'Overdue' : i.status ?? 'Task not made yet'}</span>
                    {i.task_id && <Link to={`/l/${i.list_id}?task=${i.task_id}`} className="text-xs font-medium text-brand-700">Open</Link>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

// --- clients ---------------------------------------------------------------------------------------------------

const Clients: React.FC<{ ws: string }> = ({ ws }) => {
  const { members } = useWork();
  const lists = useLists();
  const [rows, setRows] = useState<ClientCompliance[] | null>(null);
  const [catalogue, setCatalogue] = useState<Obligation[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ list_id: '', client_name: '', obligation_ids: [] as string[], assignee_ids: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => outboundApi.clients(ws).then(setRows).catch((e) => setError(e.message)), [ws]);
  useEffect(() => { load(); outboundApi.obligations(ws).then(setCatalogue).catch(() => undefined); }, [load, ws]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await outboundApi.addClient(ws, form);
      setAdding(false);
      setForm({ list_id: '', client_name: '', obligation_ids: [], assignee_ids: [] });
      load();
    } catch (err) { setError((err as Error).message); }
  };
  const grouped = (rows ?? []).reduce<Record<string, ClientCompliance[]>>((acc, r) => { (acc[r.client_name] ??= []).push(r); return acc; }, {});
  const byAuthority = catalogue.reduce<Record<string, Obligation[]>>((acc, o) => { (acc[o.authority ?? 'Other'] ??= []).push(o); return acc; }, {});
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center"><p className="text-sm text-gray-600">A client is a List. Tick what applies to them; tasks are made in that List ahead of each due date.</p>
        <button type="button" onClick={() => setAdding(true)} className={`ml-auto flex items-center gap-1.5 ${primary}`}><Plus size={14} /> Add a client's obligations</button></div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {rows === null ? <p className="text-sm text-gray-400">Loading…</p> : Object.keys(grouped).length === 0 ? <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">No clients yet.</p> : (
        <ul className="space-y-3" aria-label="Clients">
          {Object.entries(grouped).map(([name, items]) => (
            <li key={name} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2"><b className="text-gray-900">{name}</b><span className="text-xs text-gray-400">in {items[0].list_name}</span>
                <span className="ml-auto text-xs text-gray-500">{items[0].assignees.map((a) => a.display_name || a.email).join(', ')}</span></div>
              <ul className="flex flex-wrap gap-1.5">
                {items.map((r) => (
                  <li key={r.id} className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-0.5 pl-2.5 pr-1 text-xs text-gray-700">
                    {r.obligation.name}
                    <button type="button" title={`Stop ${r.obligation.name} for ${name}`} onClick={async () => await ask.confirm({ danger: true, title: `Stop making ${r.obligation.name} tasks for ${name}? Tasks already made stay.` }) && outboundApi.removeClient(ws, r.id).then(load)} className="rounded-full p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={11} /></button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={() => setAdding(false)}>
          <form role="dialog" aria-label="Client obligations" onSubmit={save} onMouseDown={(e) => e.stopPropagation()} className="max-h-[90vh] w-[40rem] max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-center"><h3 className="font-semibold text-gray-900">A client's obligations</h3><button type="button" title="Close" onClick={() => setAdding(false)} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button></div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-gray-600">Client's List<select aria-label="Client List" value={form.list_id} onChange={(e) => { const l = lists.find((x) => x.id === e.target.value); setForm({ ...form, list_id: e.target.value, client_name: form.client_name || l?.name || '' }); }} className={`mt-1 block w-full ${input}`}>
                <option value="">Choose…</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
              <label className="text-xs font-medium text-gray-600">Client name<input aria-label="Client name" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} className={`mt-1 block w-full ${input}`} /></label>
            </div>
            <fieldset><legend className="mb-1 text-xs font-medium text-gray-600">Who does them</legend>
              <div className="flex flex-wrap gap-1.5">{members.filter((m) => m.role !== 'guest').map((m) => {
                const on = form.assignee_ids.includes(m.user.id);
                return <label key={m.user.id} className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs ${on ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600'}`}>
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => setForm({ ...form, assignee_ids: on ? form.assignee_ids.filter((x) => x !== m.user.id) : [...form.assignee_ids, m.user.id] })} />{m.user.display_name || m.user.email}</label>;
              })}</div>
            </fieldset>
            <fieldset><legend className="mb-1 text-xs font-medium text-gray-600">What applies</legend>
              {Object.entries(byAuthority).map(([auth, obs]) => (
                <div key={auth} className="mb-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{auth}</p>
                  <div className="grid grid-cols-2 gap-1">{obs.map((o) => (
                    <label key={o.id} className="flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={form.obligation_ids.includes(o.id)} onChange={(e) => setForm({ ...form, obligation_ids: e.target.checked ? [...form.obligation_ids, o.id] : form.obligation_ids.filter((x) => x !== o.id) })} />{o.name}</label>
                  ))}</div></div>
              ))}
            </fieldset>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setAdding(false)} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button type="submit" disabled={!form.list_id || !form.client_name.trim() || !form.obligation_ids.length} className={primary}>Save and make tasks</button></div>
          </form>
        </div>
      )}
    </div>
  );
};

// --- catalogue ---------------------------------------------------------------------------------------------------

const Catalogue: React.FC<{ ws: string; canEdit: boolean }> = ({ ws, canEdit }) => {
  const [rows, setRows] = useState<Obligation[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => outboundApi.obligations(ws, true).then(setRows).catch(() => undefined), [ws]);
  useEffect(() => { load(); }, [load]);
  const set = (id: string, patch: Partial<Obligation>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const save = async (r: Obligation) => {
    setMsg(null);
    const { id, ...body } = r;
    try { await outboundApi.updateObligation(ws, id, body); setMsg({ ok: true, text: `${r.name} saved.` }); load(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const when = (r: Obligation) => r.frequency === 'monthly' ? `${r.due_day}th of the next month` : `${r.due_day} ${r.due_months.map((m) => MONTHS[m - 1]).join(', ')}`;
  return (
    <div className="mx-auto max-w-5xl">
      {msg && <p className={`mb-3 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`} role="status">{msg.text}</p>}
      <table className="w-full rounded-xl border border-gray-200 bg-white text-sm" aria-label="Filings catalogue">
        <thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-3 py-2">Filing</th><th className="px-3 py-2">Authority</th><th className="px-3 py-2">How often</th><th className="px-3 py-2">Due</th><th className="px-3 py-2">Start</th>{canEdit && <th />}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-t border-gray-100 ${r.archived ? 'opacity-50' : ''}`}>
              <td className="px-3 py-2"><div className="font-medium text-gray-900">{r.name}</div>{r.notes && <div className="text-xs text-gray-500">{r.notes}</div>}</td>
              <td className="px-3 py-2 text-gray-600">{r.authority}</td>
              <td className="px-3 py-2 text-gray-600">{FREQ[r.frequency]}</td>
              <td className="px-3 py-2">{canEdit ? <input type="number" min={1} max={31} aria-label={`Due day for ${r.name}`} value={r.due_day} onChange={(e) => set(r.id, { due_day: Number(e.target.value) })} className={`w-16 ${input}`} /> : null} <span className="text-xs text-gray-500">{when(r)}</span></td>
              <td className="px-3 py-2">{canEdit ? <input type="number" min={0} max={60} aria-label={`Lead days for ${r.name}`} value={r.lead_days} onChange={(e) => set(r.id, { lead_days: Number(e.target.value) })} className={`w-16 ${input}`} /> : r.lead_days} <span className="text-xs text-gray-500">days before</span></td>
              {canEdit && <td className="px-3 py-2 text-right"><button type="button" onClick={() => save(r)} className="rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">Save</button>
                <button type="button" onClick={() => save({ ...r, archived: !r.archived })} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">{r.archived ? 'Restore' : 'Retire'}</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
