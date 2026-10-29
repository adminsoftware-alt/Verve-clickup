// Admin -> Working hours: the week everyone's capacity is measured against, set in one place.
//
// Three layers, the most specific winning: a person's own hours, then their Team's, then the
// company's. Most people sit on the company week; a Team that works six days, or one person on
// part time, gets its own. Every figure in the app -- timesheets, Workload, the Dashboards --
// reads the result, so a change here shows up everywhere at once.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Pencil, RotateCcw, Search, Users, UserRound, X } from 'lucide-react';
import { request, type UserRef } from '../api';
import { Avatar, Portal } from '../ui';
import { ask } from '../../components/ask';

// --- the API ---------------------------------------------------------------------------------------------

type Source = 'person' | 'team' | 'company';
export interface PersonHours {
  user: UserRef; designation: string | null; teams: string[];
  capacity_seconds: number[]; source: Source; team_id: string | null; team_name: string | null;
}
export interface TeamHours { id: string; name: string; color: string | null; member_count: number; capacity_seconds: number[] | null }
export interface WorkingHours { company: number[]; teams: TeamHours[]; people: PersonHours[] }

const base = (ws: string) => `/workspaces/${ws}/working-hours`;
export const hoursApi = {
  get: (ws: string) => request<WorkingHours>('GET', base(ws)),
  setCompany: (ws: string, seconds: number[]) => request<WorkingHours>('PUT', `${base(ws)}/company`, { capacity_seconds: seconds }),
  setTeam: (ws: string, teamId: string, seconds: number[] | null) =>
    request<WorkingHours>('PUT', `${base(ws)}/teams/${teamId}`, { capacity_seconds: seconds }),
  setPeople: (ws: string, userIds: string[], seconds: number[] | null) =>
    request<WorkingHours>('PUT', `${base(ws)}/people`, { user_ids: userIds, capacity_seconds: seconds }),
};

// --- a week, read and written ----------------------------------------------------------------------------

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const H = 3600;
const PRESETS: { label: string; week: number[] }[] = [
  { label: '5 days × 8h', week: [8, 8, 8, 8, 8, 0, 0].map((h) => h * H) },
  { label: '6 days × 8h', week: [8, 8, 8, 8, 8, 8, 0].map((h) => h * H) },
  { label: '7 days × 8h', week: [8, 8, 8, 8, 8, 8, 8].map((h) => h * H) },
  { label: '5½ days', week: [8, 8, 8, 8, 8, 4, 0].map((h) => h * H) },
];

const fmt = (seconds: number) => {
  const h = Math.floor(seconds / H), m = Math.round((seconds % H) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};
const daysOf = (week: number[]) => week.filter((s) => s > 0).length;
const totalOf = (week: number[]) => week.reduce((a, b) => a + b, 0);
const summary = (week: number[]) => `${daysOf(week)} days · ${fmt(totalOf(week))} a week`;
const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Seven small cells, Monday first: the hours on working days, a dash on days off. */
const WeekStrip: React.FC<{ week: number[]; muted?: boolean }> = ({ week, muted }) => (
  <span className="inline-flex gap-1" aria-label={summary(week)}>
    {week.map((s, i) => (
      <span key={i} aria-label={`${DAYS[i]}: ${s ? fmt(s) : 'off'}`}
        className={`flex h-7 w-9 flex-col items-center justify-center rounded-md text-[10px] leading-none ${
          s ? (muted ? 'bg-gray-100 text-gray-600' : 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-100') : 'bg-gray-50 text-gray-300'}`}>
        <span className="text-[9px] uppercase tracking-wide opacity-70">{DAYS[i].slice(0, 2)}</span>
        <span className="font-semibold">{s ? fmt(s).replace(' ', '') : '–'}</span>
      </span>
    ))}
  </span>
);

const SOURCE: Record<Source, { label: (p: PersonHours) => string; cls: string; Icon: React.ElementType }> = {
  person: { label: () => 'Own hours', cls: 'bg-violet-50 text-violet-700 ring-violet-100', Icon: UserRound },
  team: { label: (p) => `Team: ${p.team_name}`, cls: 'bg-sky-50 text-sky-700 ring-sky-100', Icon: Users },
  company: { label: () => 'Company', cls: 'bg-gray-100 text-gray-600 ring-gray-200', Icon: Building2 },
};

/**
 * Edit one week. Presets for the common shapes, and an hour box per day for anything else.
 * `fallback` is what clearing goes back to -- "Use the Team's hours" -- when there is one.
 */
const WeekEditor: React.FC<{
  title: string; subtitle?: string; initial: number[];
  fallback?: { label: string; onUse: () => Promise<void> };
  onSave: (week: number[]) => Promise<void>; onClose: () => void;
}> = ({ title, subtitle, initial, fallback, onSave, onClose }) => {
  const [week, setWeek] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); onClose(); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <Portal>
      {/* Above the Admin window, which sits at z-[126]. */}
      <div className="admin-fade fixed inset-0 z-[140] flex items-center justify-center bg-gray-900/30 p-4" onMouseDown={onClose}>
        <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
          className="admin-pop w-[min(94vw,34rem)] rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
          <header className="flex items-start gap-3 border-b border-gray-100 px-5 py-4">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-gray-900">{title}</h3>
              {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
            </div>
            <button type="button" aria-label="Close" onClick={onClose} className="ml-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </header>
          <div className="space-y-4 px-5 py-4">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common weeks">
              {PRESETS.map((p) => (
                <button key={p.label} type="button" onClick={() => setWeek(p.week)} aria-pressed={same(week, p.week)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                    same(week, p.week) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Hours per day">
              {DAYS.map((d, i) => (
                <label key={d} className={`rounded-lg px-1 pb-1.5 pt-1 text-center ${week[i] ? 'bg-brand-50/60' : 'bg-gray-50'}`}>
                  <span className="text-[11px] font-medium text-gray-500">{d}</span>
                  <input
                    type="number" min={0} max={24} step={0.5} aria-label={`${d} hours`}
                    value={week[i] / H}
                    onChange={(e) => {
                      const next = [...week];
                      next[i] = Math.round(Math.max(0, Math.min(24, Number(e.target.value) || 0)) * 2) * (H / 2);
                      setWeek(next);
                    }}
                    className="tabular mt-0.5 w-full rounded-md border border-gray-200 bg-white px-1 py-1 text-center text-sm text-gray-900 focus:border-brand-500 focus:outline-none"
                  />
                </label>
              ))}
            </div>
            <p className="text-sm text-gray-600"><span className="font-semibold text-gray-900">{summary(week)}</span>{daysOf(week) ? ` · ${fmt(Math.round(totalOf(week) / daysOf(week)))} a day on average` : ''}</p>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
            {fallback && (
              <button type="button" disabled={busy} onClick={() => run(fallback.onUse)}
                className="mr-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                <RotateCcw size={14} /> {fallback.label}
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="button" disabled={busy || totalOf(week) === 0} onClick={() => run(() => onSave(week))}
              aria-label={totalOf(week) === 0 ? 'A week needs at least one working day' : undefined}
              className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </footer>
        </div>
      </div>
    </Portal>
  );
};

// --- the screen ------------------------------------------------------------------------------------------

type Tab = 'people' | 'teams' | 'company';
type Editing =
  | { kind: 'company' }
  | { kind: 'team'; team: TeamHours }
  | { kind: 'people'; ids: string[] };

export const WorkingHoursSection: React.FC<{ ws: string }> = ({ ws }) => {
  const [data, setData] = useState<WorkingHours | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('people');
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => { hoursApi.get(ws).then(setData).catch((e) => setError(e.message)); }, [ws]);
  useEffect(() => { load(); }, [load]);
  const saved = (out: WorkingHours, text: string) => { setData(out); setNote(text); setTimeout(() => setNote(null), 3500); };

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.people ?? []).filter((p) => (
      (!q || (p.user.display_name || p.user.email).toLowerCase().includes(q) || (p.designation ?? '').toLowerCase().includes(q))
      && (!team || p.teams.includes(team))
    ));
  }, [data, query, team]);

  if (error) return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!data) return <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-12" />)}</div>;

  const allShown = people.length > 0 && people.every((p) => selected.has(p.user.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const name = (p: PersonHours) => p.user.display_name || p.user.email;
  const nameOf = (id: string) => { const p = data.people.find((x) => x.user.id === id); return p ? name(p) : 'this person'; };

  /** What a person goes back to when their own hours are cleared. */
  const fallbackFor = (ids: string[]) => ({
    label: ids.length === 1 ? 'Use their Team’s or the company’s hours' : 'Back to Team or company hours',
    onUse: async () => saved(await hoursApi.setPeople(ws, ids, null), ids.length === 1 ? `${nameOf(ids[0])} is back on the standard hours.` : `${ids.length} people are back on the standard hours.`),
  });

  const counts = {
    person: data.people.filter((p) => p.source === 'person').length,
    team: data.people.filter((p) => p.source === 'team').length,
  };

  const tabs: [Tab, string, React.ElementType][] = [['people', 'People', UserRound], ['teams', 'Teams', Users], ['company', 'Company default', Building2]];

  return (
    <div>
      {/* How the three layers fit together, once, in a line. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
        <span>A person’s <b className="font-semibold text-gray-800">own hours</b> win over their <b className="font-semibold text-gray-800">Team’s</b>, which win over the <b className="font-semibold text-gray-800">company default</b>.</span>
        <span className="ml-auto text-xs text-gray-500">{counts.person} on their own hours · {counts.team} on a Team’s · {data.people.length - counts.person - counts.team} on the default</span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-gray-200" role="tablist" aria-label="Working hours for">
        {tabs.map(([key, label, Icon]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
        {note && <span role="status" className="ml-auto rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">{note}</span>}
      </div>

      {tab === 'company' && (
        <div className="ui-card flex flex-wrap items-center gap-4 p-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100 text-gray-600"><Building2 size={20} /></span>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900">Company default</p>
            <p className="text-sm text-gray-500">{summary(data.company)} · everyone without a Team week or their own hours</p>
          </div>
          <WeekStrip week={data.company} />
          <button type="button" onClick={() => setEditing({ kind: 'company' })}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"><Pencil size={14} /> Edit</button>
        </div>
      )}

      {tab === 'teams' && (
        data.teams.length === 0
          ? <p className="py-10 text-center text-sm text-gray-500">No Teams yet. Teams are made in People.</p>
          : (
            <ul className="space-y-2">
              {data.teams.map((t) => (
                <li key={t.id} className="ui-card flex flex-wrap items-center gap-4 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: t.color || '#64748b' }}>
                    {t.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-[10rem] flex-1">
                    <p className="font-medium text-gray-900">{t.name}</p>
                    <p className="text-xs text-gray-500">
                      {t.member_count} {t.member_count === 1 ? 'person' : 'people'} · {t.capacity_seconds ? summary(t.capacity_seconds) : `Follows the company default (${summary(data.company)})`}
                    </p>
                  </div>
                  <WeekStrip week={t.capacity_seconds ?? data.company} muted={!t.capacity_seconds} />
                  <button type="button" onClick={() => setEditing({ kind: 'team', team: t })}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    <Pencil size={14} /> {t.capacity_seconds ? 'Edit' : 'Set hours'}
                  </button>
                </li>
              ))}
            </ul>
          )
      )}

      {tab === 'people' && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5">
              <Search size={14} className="text-gray-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people" aria-label="Search people" className="w-full text-sm focus:outline-none" />
            </span>
            <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
              <option value="">All teams</option>
              {data.teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </div>

          {/* Several people at once: pick them, then set or clear their hours together. */}
          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm text-white shadow-sm" role="region" aria-label="Selected people">
              <span className="font-medium">{selected.size} selected</span>
              <button type="button" onClick={() => setEditing({ kind: 'people', ids: [...selected] })} className="ml-auto rounded-lg bg-white/15 px-3 py-1 font-medium hover:bg-white/25">Set hours</button>
              <button type="button" onClick={async () => {
                if (!await ask.confirm(`Put ${selected.size} ${selected.size === 1 ? 'person' : 'people'} back on their Team’s or the company’s hours?`)) return;
                try { saved(await hoursApi.setPeople(ws, [...selected], null), `${selected.size} back on the standard hours.`); setSelected(new Set()); } catch (e) { setError((e as Error).message); }
              }} className="rounded-lg px-3 py-1 hover:bg-white/15">Use standard hours</button>
              <button type="button" aria-label="Clear selection" onClick={() => setSelected(new Set())} className="rounded-lg p-1 hover:bg-white/15"><X size={15} /></button>
            </div>
          )}

          {/* A phone gets a card per person: the week underneath the name rather than off the
              right edge of a table that has to be scrolled to reach the Edit button. */}
          <ul className="space-y-2 sm:hidden">
            {people.map((p) => {
              const src = SOURCE[p.source];
              return (
                <li key={p.user.id} className={`ui-card p-3 ${selected.has(p.user.id) ? '!border-brand-300 !bg-brand-50/40' : ''}`}>
                  <div className="flex items-center gap-2.5">
                    <input type="checkbox" aria-label={`Select ${name(p)}`} checked={selected.has(p.user.id)} onChange={() => toggle(p.user.id)} />
                    <Avatar user={p.user} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">{name(p)}</span>
                      <span className="block truncate text-xs text-gray-500">{daysOf(p.capacity_seconds)} days · {fmt(totalOf(p.capacity_seconds))} a week</span>
                    </span>
                    <button type="button" onClick={() => setEditing({ kind: 'people', ids: [p.user.id] })} aria-label={`Edit ${name(p)}'s hours`}
                      className="tap rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Pencil size={16} /></button>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                    <WeekStrip week={p.capacity_seconds} muted={p.source === 'company'} />
                    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${src.cls}`}>
                      <src.Icon size={12} /> {src.label(p)}
                    </span>
                  </div>
                </li>
              );
            })}
            {people.length === 0 && <li className="py-10 text-center text-sm text-gray-500">Nobody matches.</li>}
          </ul>

          <div className="ui-card hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500">
                  <th className="w-10 px-3 py-2.5">
                    <input type="checkbox" aria-label="Select everyone shown" checked={allShown}
                      onChange={() => setSelected(allShown ? new Set() : new Set(people.map((p) => p.user.id)))} />
                  </th>
                  <th className="py-2.5 pr-3">Person</th>
                  <th className="py-2.5 pr-3">Week</th>
                  <th className="py-2.5 pr-3">Total</th>
                  <th className="py-2.5 pr-3">From</th>
                  <th className="py-2.5 pr-3" />
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const src = SOURCE[p.source];
                  return (
                    <tr key={p.user.id} className={`border-b border-gray-100 last:border-0 ${selected.has(p.user.id) ? 'bg-brand-50/40' : 'hover:bg-gray-50/70'}`}>
                      <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${name(p)}`} checked={selected.has(p.user.id)} onChange={() => toggle(p.user.id)} /></td>
                      <td className="py-2 pr-3">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar user={p.user} size={28} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-gray-900">{name(p)}</span>
                            <span className="block truncate text-xs text-gray-500">{[p.designation, p.teams.join(', ')].filter(Boolean).join(' · ') || '—'}</span>
                          </span>
                        </span>
                      </td>
                      <td className="py-2 pr-3"><WeekStrip week={p.capacity_seconds} muted={p.source === 'company'} /></td>
                      <td className="tabular whitespace-nowrap py-2 pr-3 text-gray-700">{daysOf(p.capacity_seconds)}d · {fmt(totalOf(p.capacity_seconds))}</td>
                      <td className="py-2 pr-3">
                        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${src.cls}`}>
                          <src.Icon size={12} /> {src.label(p)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <button type="button" onClick={() => setEditing({ kind: 'people', ids: [p.user.id] })} aria-label={`Edit ${name(p)}'s hours`}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Pencil size={15} /></button>
                      </td>
                    </tr>
                  );
                })}
                {people.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-sm text-gray-500">Nobody matches.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing?.kind === 'company' && (
        <WeekEditor title="Company default" subtitle="Everyone without a Team week or their own hours"
          initial={data.company} onClose={() => setEditing(null)}
          onSave={async (week) => saved(await hoursApi.setCompany(ws, week), 'Company default saved.')} />
      )}
      {editing?.kind === 'team' && (
        <WeekEditor title={`${editing.team.name}: working hours`} subtitle={`${editing.team.member_count} people, unless someone has their own hours`}
          initial={editing.team.capacity_seconds ?? data.company} onClose={() => setEditing(null)}
          fallback={editing.team.capacity_seconds ? {
            label: 'Use the company default',
            onUse: async () => saved(await hoursApi.setTeam(ws, editing.team.id, null), `${editing.team.name} follows the company default.`),
          } : undefined}
          onSave={async (week) => saved(await hoursApi.setTeam(ws, editing.team.id, week), `${editing.team.name}’s hours saved.`)} />
      )}
      {editing?.kind === 'people' && (() => {
        const ids = editing.ids;
        const one = ids.length === 1 ? data.people.find((p) => p.user.id === ids[0]) : undefined;
        return (
          <WeekEditor
            title={one ? `${name(one)}: working hours` : `Working hours for ${ids.length} people`}
            subtitle={one ? `Now: ${SOURCE[one.source].label(one)}` : 'Each of them gets this week as their own hours'}
            initial={one ? one.capacity_seconds : data.company} onClose={() => setEditing(null)}
            fallback={!one || one.source === 'person' ? fallbackFor(ids) : undefined}
            onSave={async (week) => {
              saved(await hoursApi.setPeople(ws, ids, week), one ? `${name(one)}’s hours saved.` : `Hours saved for ${ids.length} people.`);
              setSelected(new Set());
            }} />
        );
      })()}
    </div>
  );
};
