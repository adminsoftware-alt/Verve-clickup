// The firm's leave rules, in one place.
//
// Every one of these is a question only the firm can answer -- whether the year runs from April,
// whether unused days carry over, how much notice is fair, whether the audit season is closed --
// and the leave engine behaves differently for each answer. Hard-coding any of them would be
// choosing one firm's policy for everybody, so they are settings with sensible Indian defaults.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, ScrollText, Trash2 } from 'lucide-react';

import { peopleApi, type TeamFull } from '../teams/peopleApi';
import { leaveApi, MONTHS, type Blackout, type LeavePolicy } from './leaveApi';

const input = 'rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15';
const primary = 'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';

/** One rule: what it is called, why it matters, and the control that sets it. */
const Rule: React.FC<{ title: string; why: string; children: React.ReactNode }> = ({ title, why, children }) => (
  <div className="grid grid-cols-1 gap-1 border-t border-gray-100 py-3 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-4">
    <div className="min-w-0">
      <div className="text-sm font-medium text-gray-900">{title}</div>
      <p className="text-xs text-gray-500">{why}</p>
    </div>
    <div className="flex shrink-0 items-center gap-2 pt-0.5">{children}</div>
  </div>
);

const Switch: React.FC<{ on: boolean; onChange: (on: boolean) => void; label: string }> = ({ on, onChange, label }) => (
  <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
    <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="accent-brand-600" />
    {on ? 'Yes' : 'No'}
  </label>
);

const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const LeavePolicyForm: React.FC<{ ws: string; onSaved?: (p: LeavePolicy) => void }> = ({ ws, onSaved }) => {
  const [form, setForm] = useState<LeavePolicy | null>(null);
  const [teams, setTeams] = useState<TeamFull[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    leaveApi.policy(ws).then(setForm).catch((e) => setMsg({ ok: false, text: (e as Error).message }));
    peopleApi.teams(ws).then(setTeams).catch(() => undefined);
  }, [ws]);
  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof LeavePolicy>(key: K, value: LeavePolicy[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const badWindow = useMemo(
    () => (form?.blackout ?? []).some((b) => !MD.test(b.from) || !MD.test(b.to)),
    [form?.blackout],
  );

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setMsg(null);
    try {
      const saved = await leaveApi.savePolicy(ws, { ...form, blackout: form.blackout.filter((b) => MD.test(b.from) && MD.test(b.to)) });
      setForm(saved);
      onSaved?.(saved);
      setMsg({ ok: true, text: 'Saved. Requests already waiting have been re-counted.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!form) return <p className="text-sm text-gray-400">Loading…</p>;

  const windows = form.blackout ?? [];
  const setWindow = (i: number, patch: Partial<Blackout>) =>
    set('blackout', windows.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <section aria-label="Leave policy" className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="flex items-center gap-2 font-semibold text-gray-900"><ScrollText size={16} className="text-brand-600" /> Leave policy</h3>
      <p className="mb-2 text-xs text-gray-500">The rules the whole leave process follows. They apply from the moment you save.</p>

      <Rule title="The leave year starts in" why="Allowances and balances are counted over this year. Most Indian firms run April to March.">
        <select aria-label="Leave year starts in" value={form.year_start_month} onChange={(e) => set('year_start_month', Number(e.target.value))} className={input}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </Rule>

      <Rule title="Unused days carry over" why="How many days a person may bring into the new year. Leave it empty and nothing carries.">
        <input
          type="number" min={0} max={366} step={0.5} aria-label="Days that carry over"
          value={form.carry_forward_days ?? ''} placeholder="None"
          onChange={(e) => set('carry_forward_days', e.target.value === '' ? null : Number(e.target.value))}
          className={`w-24 ${input}`}
        />
        <span className="text-xs text-gray-500">days</span>
      </Rule>

      <Rule title="Someone who joins mid-year earns part of the allowance" why="On: a person joining in October earns six months of it. Off: they get the full year.">
        <Switch on={form.prorate_joiners} onChange={(v) => set('prorate_joiners', v)} label="Pro-rate for joiners" />
      </Rule>

      <Rule title="Notice needed before leave starts" why="Asking for less is refused, with the reason. An admin can still record it afterwards.">
        <input
          type="number" min={0} max={180} aria-label="Days of notice needed" value={form.min_notice_days}
          onChange={(e) => set('min_notice_days', Math.max(0, Number(e.target.value) || 0))} className={`w-20 ${input}`}
        />
        <span className="text-xs text-gray-500">days</span>
      </Rule>

      <Rule title="People may ask for leave in the past" why="Off: only an admin can record leave that has already been taken.">
        <Switch on={form.allow_backdated} onChange={(v) => set('allow_backdated', v)} label="Allow leave in the past" />
      </Rule>

      <Rule title="Weekends and holidays inside a leave span are counted" why="The sandwich rule. On: Friday to Monday costs four days, not two. Days off at either end are never counted.">
        <Switch on={form.count_days_off_inside} onChange={(v) => set('count_days_off_inside', v)} label="Count days off inside a span" />
      </Rule>

      <Rule title="HR team" why="They see every request, they decide when the manager is away, and they are told when nobody decides.">
        <select aria-label="HR team" value={form.hr_team_id ?? ''} onChange={(e) => set('hr_team_id', e.target.value || null)} className={input}>
          <option value="">No HR team</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Rule>

      <Rule title="Tell HR when nobody has decided" why="A request sitting unanswered is the commonest complaint about any leave process. Empty: nobody is chased.">
        <input
          type="number" min={1} max={90} aria-label="Days before HR is told" value={form.escalate_after_days ?? ''} placeholder="Never"
          onChange={(e) => set('escalate_after_days', e.target.value === '' ? null : Math.max(1, Number(e.target.value)))}
          className={`w-20 ${input}`}
        />
        <span className="text-xs text-gray-500">days</span>
      </Rule>

      <div className="border-t border-gray-100 pt-3">
        <div className="text-sm font-medium text-gray-900">Closed seasons</div>
        <p className="mb-2 text-xs text-gray-500">
          Days nobody may book -- audit season, a filing week. Given as month and day, so they come round every year.
          An admin can still record leave over them.
        </p>
        <ul className="space-y-2">
          {windows.map((b, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <input aria-label={`Closed from, window ${i + 1}`} value={b.from} onChange={(e) => setWindow(i, { from: e.target.value })} placeholder="09-15" className={`w-20 ${input} ${MD.test(b.from) ? '' : 'border-red-400'}`} />
              <span className="text-xs text-gray-500">to</span>
              <input aria-label={`Closed to, window ${i + 1}`} value={b.to} onChange={(e) => setWindow(i, { to: e.target.value })} placeholder="09-30" className={`w-20 ${input} ${MD.test(b.to) ? '' : 'border-red-400'}`} />
              <input aria-label={`Why, window ${i + 1}`} value={b.reason ?? ''} onChange={(e) => setWindow(i, { reason: e.target.value })} placeholder="Audit season" className={`min-w-0 flex-1 ${input}`} />
              <button type="button" title="Remove this season" onClick={() => set('blackout', windows.filter((_, j) => j !== i))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
        {windows.length < 24 && (
          <button type="button" onClick={() => set('blackout', [...windows, { from: '', to: '', reason: '' }])} className="mt-2 flex items-center gap-1 text-sm text-brand-700 hover:underline">
            <Plus size={14} /> Add a closed season
          </button>
        )}
        {badWindow && <p className="mt-1 text-xs text-amber-700">Dates must read like 09-15. Anything else is dropped when you save.</p>}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className={primary}>Save policy</button>
        <button type="button" onClick={load} className="text-sm text-gray-500 hover:text-gray-800 hover:underline">Undo my changes</button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`} role="status">{msg.text}</span>}
      </div>
    </section>
  );
};
