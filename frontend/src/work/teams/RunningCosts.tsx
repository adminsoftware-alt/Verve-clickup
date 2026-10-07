// What running this costs, on every scale that gets asked about.
//
// Three questions get asked and they are the same arithmetic: what does this cost a day, a
// month, a year, and what is that per person. Nothing here is discovered -- no billing API is
// wired up, and a figure invented by the app would be quoted back as fact -- so an admin records
// what the firm actually pays and this does the sums over it.
//
// The per-person figure is the one that decides things. A tool is kept or dropped on "it costs
// us X a head", and until now that number lived in somebody's spreadsheet.
import { Check, Pencil, Plus, Server, Trash2, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { ask } from '../../components/ask';
import { peopleApi, type CostLine, type CostSuggestion, type CostSummary } from './peopleApi';

const PERIODS: [string, string][] = [
  ['monthly', 'a month'], ['yearly', 'a year'], ['daily', 'a day'], ['once', 'one-off'],
];
const SCALES: [string, string][] = [
  ['flat', 'flat'], ['per_person', 'per person'], ['per_gb', 'per GB stored'],
];
const CATEGORIES = ['hosting', 'database', 'email', 'authentication', 'storage', 'domain', 'licence', 'other'];

/** Minor units to something a person reads. Kept in one place so every figure rounds alike. */
function money(minor: number, currency: string, decimals = 0): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, maximumFractionDigits: decimals, minimumFractionDigits: decimals,
    }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(decimals)}`;
  }
}

const input = 'h-9 rounded-lg border border-gray-300 px-2.5 text-sm transition-colors hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15';

/** One of the three headline figures. */
const Headline: React.FC<{ label: string; value: string; hint?: string; strong?: boolean }> = ({ label, value, hint, strong }) => (
  <div className={`rounded-xl border px-4 py-3 ${strong ? 'border-brand-200 bg-brand-50/60' : 'border-gray-200 bg-white'}`}>
    <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
    <span className={`mt-0.5 block text-2xl font-semibold leading-tight ${strong ? 'text-brand-800' : 'text-gray-900'}`}>{value}</span>
    {hint && <span className="mt-0.5 block text-[11px] text-gray-500">{hint}</span>}
  </div>
);

const blank = {
  name: '', category: 'hosting', amount_minor: 0, currency: 'INR',
  period: 'monthly', scales: 'flat', note: '', active: true,
};

/** The add / edit row. Money is typed in major units and stored in minor. */
const CostForm: React.FC<{
  initial?: CostLine | null;
  currency: string;
  onCancel: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}> = ({ initial, currency, onCancel, onSave }) => {
  const [form, setForm] = useState(() => ({
    ...blank,
    currency,
    ...(initial ? {
      name: initial.name, category: initial.category, amount_minor: initial.amount_minor,
      currency: initial.currency, period: initial.period, scales: initial.scales,
      note: initial.note ?? '', active: initial.active,
    } : {}),
  }));
  const [amount, setAmount] = useState(() => String((initial?.amount_minor ?? 0) / 100));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    const minor = Math.round(Number(amount || 0) * 100);
    if (!form.name.trim() || !Number.isFinite(minor) || minor < 0) return;
    setBusy(true);
    try { await onSave({ ...form, amount_minor: minor, note: form.note.trim() || null }); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="What it is" value={form.name} onChange={(e) => set({ name: e.target.value })}
          placeholder="e.g. Application server" className={`${input} min-w-52 flex-1`} autoFocus />
        <select aria-label="Kind of cost" value={form.category} onChange={(e) => set({ category: e.target.value })} className={input}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <input aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          inputMode="decimal" placeholder="0" className={`${input} w-28`} />
        <input aria-label="Currency" value={form.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase().slice(0, 3) })}
          className={`${input} w-20`} />
        <select aria-label="How often" value={form.period} onChange={(e) => set({ period: e.target.value, ...(e.target.value === 'once' ? { scales: 'flat' } : {}) })} className={input}>
          {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {form.period !== 'once' && (
          <select aria-label="Flat or a rate" value={form.scales} onChange={(e) => set({ scales: e.target.value })} className={input}>
            {SCALES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </div>
      <input aria-label="Note" value={form.note} onChange={(e) => set({ note: e.target.value })} maxLength={300}
        placeholder="Note — the plan, the provider, who owns the account (optional)" className={`${input} mt-2 w-full`} />
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={save} disabled={busy || !form.name.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50">
          <Check size={14} /> {busy ? 'Saving…' : initial ? 'Save' : 'Add it'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100">Cancel</button>
      </div>
    </div>
  );
};

export const RunningCosts: React.FC<{ ws: string }> = ({ ws }) => {
  const [data, setData] = useState<CostSummary | null>(null);
  const [tips, setTips] = useState<CostSuggestion[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    peopleApi.costs(ws).then(setData).catch((e) => setError(e.message));
    peopleApi.costSuggestions(ws).then(setTips).catch(() => undefined);
  }, [ws]);

  const run = async (fn: () => Promise<CostSummary>) => {
    setError(null);
    try { setData(await fn()); setAdding(false); setEditing(null); } catch (e) { setError((e as Error).message); }
  };

  const ccy = data?.currency ?? 'INR';
  const biggest = useMemo(() => Math.max(1, ...(data?.lines ?? []).map((l) => l.yearly_minor)), [data]);
  const gb = (data?.usage.stored_bytes ?? 0) / 1024 ** 3;

  if (!data) return <p className="text-sm text-gray-400">{error ?? 'Loading…'}</p>;
  const running = data.lines.filter((l) => l.active && l.period !== 'once');

  return (
    <div className="space-y-4">
      {/* The same money four ways, because the question arrives in all four forms. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Headline label="A day" value={money(data.daily_minor, ccy)} />
        <Headline label="A month" value={money(data.monthly_minor, ccy)} />
        <Headline label="A year" value={money(data.yearly_minor, ccy)} />
        <Headline
          strong
          label="Per person, a month"
          value={money(data.per_person_monthly_minor, ccy)}
          hint={`across ${data.usage.active_people} active ${data.usage.active_people === 1 ? 'person' : 'people'}`}
        />
      </div>

      {data.mixed_currencies && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          These lines are not all in the same currency, so the totals above add up numbers that are not comparable.
          Convert them to one currency for the figures to mean anything.
        </p>
      )}
      {data.one_off_minor > 0 && (
        <p className="text-xs text-gray-500">
          Plus {money(data.one_off_minor, ccy)} of one-off payments, which are listed but never spread across the year —
          deciding how to amortise those is an accounting choice, not one this page should make quietly.
        </p>
      )}

      {/* Where it goes, biggest first. The bar is the share of the yearly total. */}
      {running.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {[...data.lines].sort((a, b) => b.yearly_minor - a.yearly_minor).map((line) => (
            <li key={line.id}>
              {editing === line.id ? (
                <div className="p-3">
                  <CostForm
                    initial={line} currency={ccy}
                    onCancel={() => setEditing(null)}
                    onSave={(body) => run(() => peopleApi.updateCost(ws, line.id, body))}
                  />
                </div>
              ) : (
                <div className={`flex items-center gap-3 px-3.5 py-2.5 ${line.active ? '' : 'opacity-55'}`}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-gray-900">{line.name}</span>
                      <span className="shrink-0 rounded-full bg-gray-100 px-1.5 text-[10px] uppercase tracking-wide text-gray-500">{line.category}</span>
                      {!line.active && <span className="shrink-0 text-[11px] text-gray-400">not counted</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-gray-500">
                      {money(line.amount_minor, line.currency, 2)} {PERIODS.find(([v]) => v === line.period)?.[1]}
                      {line.scales === 'per_person' && ` × ${data.usage.active_people} people`}
                      {line.scales === 'per_gb' && ` × ${Math.max(1, Math.ceil(gb))} GB`}
                      {line.note ? ` · ${line.note}` : ''}
                    </span>
                    {line.period !== 'once' && line.active && (
                      <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-gray-100">
                        <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(100 * line.yearly_minor) / biggest}%` }} />
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold text-gray-900">
                      {line.period === 'once' ? money(line.once_minor, line.currency) : money(line.monthly_minor, line.currency)}
                    </span>
                    <span className="block text-[11px] text-gray-400">{line.period === 'once' ? 'one-off' : 'a month'}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button type="button" aria-label={`Edit ${line.name}`} onClick={() => { setEditing(line.id); setAdding(false); }}
                      className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"><Pencil size={13} /></button>
                    <button type="button" aria-label={`Remove ${line.name}`}
                      onClick={async () => await ask.confirm({ danger: true, title: `Remove “${line.name}” from the costs?` }) && run(() => peopleApi.deleteCost(ws, line.id))}
                      className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600"><Trash2 size={13} /></button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding
        ? <CostForm currency={ccy} onCancel={() => setAdding(false)} onSave={(body) => run(() => peopleApi.addCost(ws, body))} />
        : (
          <button type="button" onClick={() => { setAdding(true); setEditing(null); }}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50">
            <Plus size={14} /> Add something you pay for
          </button>
        )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* What this deployment actually needs, as a starting list -- never with a price on it. */}
      {data.lines.length === 0 && tips.length > 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-4">
          <p className="text-[13px] font-medium text-gray-800">Nothing recorded yet. This application runs on:</p>
          <p className="mt-0.5 text-xs text-gray-500">
            No prices here — they depend on your provider, region and plan, and a figure invented by the app would get
            quoted back as fact. Add each line with what you actually pay.
          </p>
          <ul className="mt-3 space-y-1.5">
            {tips.map((t) => (
              <li key={t.name} className="flex items-start gap-2 text-[13px]">
                <Server size={13} className="mt-0.5 shrink-0 text-gray-400" />
                <span><b className="text-gray-800">{t.name}</b> <span className="text-gray-500">— {t.why}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-gray-500">
        <X size={12} className="mt-0.5 shrink-0 text-gray-300" />
        Nothing here is read from a bill. These are the figures somebody typed in, so they are only as current as the
        last time one was checked.
      </p>
    </div>
  );
};
