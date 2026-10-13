// Other people's own Dashboards, for the admins and Team leads who look after them.
//
// Two parts. A grid of people, each with the three numbers that say whom to look at first, from
// which any one board opens. And the board itself, exactly as its owner sees it, under a quiet bar
// that says whose it is, that it is read-only, and lets the viewer step to the next person without
// going back to the grid.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Eye, Search, Users, X } from 'lucide-react';

import { useWork } from '../WorkContext';
import { Avatar, Portal } from '../ui';
import { dashApi, type Dashboard, type PersonBoard } from './api';
import { DashboardPage } from './DashboardPage';

const nameOf = (p: PersonBoard) => p.user.display_name || p.user.email;

type Sort = 'name' | 'overdue' | 'open';

/** How someone is doing, in one calm word -- coloured only when it needs attention. */
function standing(p: PersonBoard): { label: string; cls: string } {
  if (p.overdue >= 3) return { label: `${p.overdue} overdue`, cls: 'bg-rose-50 text-rose-700 ring-rose-100' };
  if (p.overdue > 0) return { label: `${p.overdue} overdue`, cls: 'bg-amber-50 text-amber-700 ring-amber-100' };
  return { label: 'On track', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-100' };
}

function usePeople() {
  const { workspace } = useWork();
  const [people, setPeople] = useState<PersonBoard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!workspace) return;
    let live = true;
    dashApi.people(workspace.id)
      .then((rows) => { if (live) setPeople(rows); })
      .catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [workspace]);
  return { people, error };
}

// --- the grid --------------------------------------------------------------------------------

export const PeopleBoards: React.FC = () => {
  const { people, error } = usePeople();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [sort, setSort] = useState<Sort>('name');

  const teams = useMemo(() => [...new Set((people ?? []).flatMap((p) => p.teams))].sort(), [people]);
  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    const rows = (people ?? []).filter((p) => (
      (!team || p.teams.includes(team))
      && (!text || nameOf(p).toLowerCase().includes(text) || (p.designation ?? '').toLowerCase().includes(text) || p.user.email.toLowerCase().includes(text))
    ));
    if (sort === 'overdue') return [...rows].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
    if (sort === 'open') return [...rows].sort((a, b) => b.open - a.open || b.overdue - a.overdue);
    return rows;
  }, [people, q, team, sort]);

  if (error) return <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;

  return (
    <div>
      {/* Find someone, narrow to a Team, and choose what comes first. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-[16rem] flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 shadow-sm focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/10 sm:max-w-sm">
          <Search size={15} className="shrink-0 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people"
            className="w-full bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none" />
          {q && <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>}
        </label>
        {teams.length > 1 && (
          <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team"
            className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-500/10">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <div className="ml-auto flex rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="radiogroup" aria-label="Sort people">
          {([['name', 'Name'], ['overdue', 'Most overdue'], ['open', 'Most open']] as [Sort, string][]).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={sort === v} onClick={() => setSort(v)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${sort === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {!people ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-[168px] rounded-2xl" />)}
        </div>
      ) : shown.length === 0 ? (
        <div className="mx-auto mt-16 max-w-sm text-center">
          <Users size={30} className="mx-auto text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">{people.length ? 'Nobody matches.' : 'There is nobody here yet.'}</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((p) => {
            const tag = standing(p);
            return (
              <li key={p.user.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/dashboards/people/${encodeURIComponent(p.user.id)}`)}
                  className="group flex h-full w-full flex-col rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/15"
                >
                  <div className="flex items-start gap-3">
                    <span className="rounded-full ring-2 ring-white shadow-sm"><Avatar user={p.user} size={40} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{nameOf(p)}</p>
                      <p className="truncate text-xs text-gray-500">{p.designation || p.department || 'No designation'}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tag.cls}`}>{tag.label}</span>
                  </div>

                  <dl className="mt-4 grid grid-cols-3 divide-x divide-gray-100 rounded-xl bg-gray-50/80 py-2 text-center">
                    {([['Open', p.open, 'text-gray-900'], ['Overdue', p.overdue, p.overdue ? 'text-rose-600' : 'text-gray-900'], ['Today', p.due_today, 'text-gray-900']] as const).map(([label, value, cls]) => (
                      <div key={label}>
                        <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-400">{label}</dt>
                        <dd className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-3 flex min-h-[22px] items-center gap-1.5">
                    {p.teams.slice(0, 2).map((t) => <span key={t} className="truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{t}</span>)}
                    {p.teams.length > 2 && <span className="text-[11px] text-gray-400">+{p.teams.length - 2}</span>}
                    {p.pending && <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">Not signed in yet</span>}
                    <span className="ml-auto flex items-center gap-0.5 text-xs font-medium text-gray-400 transition-colors group-hover:text-brand-700">
                      View <ArrowUpRight size={13} className="transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

// --- one person's board ------------------------------------------------------------------------

/** Pick someone else without going back to the grid. */
const Switcher: React.FC<{ people: PersonBoard[]; current: string; onPick: (id: string) => void }> = ({ people, current, onPick }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const r = button.current?.getBoundingClientRect();
    if (r) setBox({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 328)) });
    const away = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const text = q.trim().toLowerCase();
  const rows = people.filter((p) => !text || nameOf(p).toLowerCase().includes(text) || (p.designation ?? '').toLowerCase().includes(text));
  return (
    <>
      <button ref={button} type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen(!open); setQ(''); }}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50">
        Switch person <ChevronDown size={13} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && box && (
        <Portal>
          <div ref={panel} role="listbox" aria-label="People"
            style={{ position: 'fixed', top: box.top, left: box.left }}
            className="admin-pop z-[130] w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
            <div className="border-b border-gray-100 p-2">
              <label className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5">
                <Search size={14} className="text-gray-400" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find someone" aria-label="Find someone"
                  className="w-full bg-transparent text-sm focus:outline-none" />
              </label>
            </div>
            <ul className="max-h-80 overflow-y-auto py-1">
              {rows.length === 0 && <li className="px-3 py-4 text-center text-xs text-gray-400">Nobody matches.</li>}
              {rows.map((p) => (
                <li key={p.user.id}>
                  <button type="button" role="option" aria-selected={p.user.id === current}
                    onClick={() => { setOpen(false); onPick(p.user.id); }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 ${p.user.id === current ? 'bg-brand-50/50' : ''}`}>
                    <Avatar user={p.user} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-gray-900">{nameOf(p)}</span>
                      <span className="block truncate text-[11px] text-gray-500">{p.designation || p.teams.join(', ')}</span>
                    </span>
                    {p.overdue > 0 && <span className="shrink-0 rounded-full bg-rose-50 px-1.5 text-[11px] font-semibold text-rose-600">{p.overdue}</span>}
                    {p.user.id === current && <Check size={14} className="shrink-0 text-brand-600" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Portal>
      )}
    </>
  );
};

/** /dashboards/people/:userId -- someone's own Dashboard, as they see it, read-only. */
export const PersonDashboardPage: React.FC = () => {
  const { userId = '' } = useParams();
  const { workspace } = useWork();
  const navigate = useNavigate();
  const { people } = usePeople();
  const [board, setBoard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace || !userId) return;
    let live = true;
    setBoard(null);
    setError(null);
    dashApi.personBoard(workspace.id, userId)
      .then((b) => { if (live) setBoard(b); })
      .catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [workspace, userId]);

  const go = useCallback((id: string) => navigate(`/dashboards/people/${encodeURIComponent(id)}`), [navigate]);
  const index = (people ?? []).findIndex((p) => p.user.id === userId);
  const person = index >= 0 ? people![index] : null;
  const prev = index > 0 ? people![index - 1] : null;
  const next = index >= 0 && index < (people?.length ?? 0) - 1 ? people![index + 1] : null;
  const shown = person?.user ?? board?.owner ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Whose board this is, that it is theirs and read-only, and the way to the next person. */}
      <div className="no-print flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gradient-to-r from-slate-50 via-white to-white px-6 py-3">
        <Link to="/dashboards?tab=people" className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-gray-500 no-underline hover:bg-gray-100 hover:text-gray-800">
          <ArrowLeft size={15} /> People
        </Link>
        <span className="h-6 w-px bg-gray-200" aria-hidden />
        {shown ? <Avatar user={shown} size={34} /> : <span className="skeleton h-[34px] w-[34px] rounded-full" />}
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-gray-900">
            {shown ? `${shown.display_name || shown.email}'s dashboard` : 'Loading…'}
          </p>
          <p className="truncate text-xs text-gray-500">
            {[person?.designation, person?.teams.join(', ')].filter(Boolean).join(' · ') || 'Their own view of their work'}
          </p>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600" title="You see what they see. Nothing you do here changes their board.">
          <Eye size={12} /> View only
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" disabled={!prev} onClick={() => prev && go(prev.user.id)} title={prev ? `Previous: ${nameOf(prev)}` : undefined} aria-label="Previous person"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-50 disabled:opacity-40 disabled:shadow-none">
            <ChevronLeft size={16} />
          </button>
          <button type="button" disabled={!next} onClick={() => next && go(next.user.id)} title={next ? `Next: ${nameOf(next)}` : undefined} aria-label="Next person"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-50 disabled:opacity-40 disabled:shadow-none">
            <ChevronRight size={16} />
          </button>
          {people && people.length > 1 && <Switcher people={people} current={userId} onPick={go} />}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {error ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <p className="text-sm text-red-700">{error}</p>
            <Link to="/dashboards?tab=people" className="mt-3 inline-block text-sm font-medium text-brand-600">Back to People</Link>
          </div>
        ) : board ? (
          <DashboardPage key={board.id} dashboardId={board.id} heading={false} viewing />
        ) : (
          <div className="grid grid-cols-12 gap-4 p-6" role="status" aria-label="Loading their Dashboard">
            {[12, 3, 3, 3, 3, 12, 6, 6].map((span, i) => (
              <div key={i} className="skeleton" style={{ gridColumn: `span ${span} / span ${span}`, height: i === 0 ? 56 : i < 5 ? 84 : 200 }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
