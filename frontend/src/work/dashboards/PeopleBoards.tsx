// Other people's own Dashboards, for the admins and Team leads who look after them.
//
// Two parts. A grid of people, each with the three numbers that say whom to look at first, from
// which any one board opens. And the board itself, exactly as its owner sees it, under a quiet bar
// that says whose it is, that it is read-only, and lets the viewer step to the next person without
// going back to the grid.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpDown, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Eye, Search, Users, X } from 'lucide-react';

import { useWork } from '../WorkContext';
import { Avatar, Portal } from '../ui';
import { dashApi, type Dashboard, type PersonBoard } from './api';
import { DashboardPage } from './DashboardPage';
import { WordSkeleton } from '../Skeleton';
import { WeekBar } from '../teams/TeamBulk';

const nameOf = (p: PersonBoard) => p.user.display_name || p.user.email;

type Sort = 'name' | 'overdue' | 'open' | 'today';
type Show = 'all' | 'overdue' | 'today';

const SORTS: [Sort, string][] = [['name', 'Name'], ['overdue', 'Most overdue'], ['open', 'Most open'], ['today', 'Due today']];
const SHOWS: [Show, string][] = [['all', 'Everyone'], ['overdue', 'With overdue work'], ['today', 'With work due today']];

/** How someone is doing, in one calm word -- coloured only when it needs attention. */
function standing(p: PersonBoard): { label: string; dot: string; text: string } {
  if (p.overdue >= 3) return { label: 'Needs attention', dot: 'bg-rose-500', text: 'text-rose-700' };
  if (p.overdue > 0) return { label: 'A little behind', dot: 'bg-amber-500', text: 'text-amber-700' };
  return { label: 'On track', dot: 'bg-[#234788]', text: 'text-[#234788]' };
}

function usePeople() {
  const { workspace } = useWork();
  const [people, setPeople] = useState<PersonBoard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!workspace) return;
    let live = true;
    // The cards first; this week's hours fill in when they arrive, which takes longer to work out.
    dashApi.people(workspace.id)
      .then((rows) => {
        if (!live) return;
        setPeople(rows);
        dashApi.peopleWeek(workspace.id)
          .then((week) => { if (live) setPeople((prev) => prev && prev.map((p) => ({ ...p, ...week[p.user.id] }))); })
          .catch(() => undefined);
      })
      .catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [workspace]);
  return { people, error };
}

// --- the filter ------------------------------------------------------------------------------

/**
 * Order, who to show, and which Team, behind one button. Three separate controls in the toolbar
 * said the same thing three times; this is the same "Filter" button as every list in the app,
 * with a count when anything differs from the plain alphabetical list of everyone.
 */
const PeopleFilter: React.FC<{
  teams: string[];
  team: string;
  sort: Sort;
  show: Show;
  onTeam: (t: string) => void;
  onSort: (s: Sort) => void;
  onShow: (s: Show) => void;
  onReset: () => void;
}> = ({ teams, team, sort, show, onTeam, onSort, onShow, onReset }) => {
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = box !== null;
  const count = (sort !== 'name' ? 1 : 0) + (show !== 'all' ? 1 : 0) + (team ? 1 : 0);
  const WIDTH = 288;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setBox(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setBox(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const toggle = () => {
    const r = button.current?.getBoundingClientRect();
    if (open || !r) { setBox(null); return; }
    setBox({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - WIDTH, window.innerWidth - WIDTH - 8)) });
  };

  /** A section's name beside a small tile of its colour, as in the other Filter menus. */
  const heading = (text: string, Icon: React.ElementType, tone: string) => (
    <p className="flex items-center gap-2 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-gray-500">
      <span className="flex h-5 w-5 items-center justify-center rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${tone} 12%, white)`, color: tone }}><Icon size={11} strokeWidth={2.25} /></span>
      {text}
    </p>
  );
  /** One choice as a chip: navy and filled when it is the one in use. */
  const chip = (on: boolean, label: string, pick: () => void) => (
    <button key={label} type="button" role="menuitemradio" aria-checked={on} onClick={pick}
      className={`truncate rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${on
        ? 'border-[#234788] bg-[#234788] text-white'
        : 'border-[#E4E8F0] bg-white text-gray-700 hover:border-[#B9C7E2] hover:text-[#142B57]'}`}>
      {label}
    </button>
  );

  return (
    <>
      <button ref={button} type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open}
        data-active={count ? '' : undefined}
        className="cf-pill relative flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium">
        Filter
        {count > 0 && <span className="cf-pill-count flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none">{count}</span>}
        <ChevronDown size={13} className={`cf-pill-caret transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {box && (
        <Portal>
          <div ref={panel} role="menu" aria-label="Filter people"
            style={{ position: 'fixed', top: box.top, left: box.left, width: WIDTH }}
            className="admin-pop z-[130] max-h-[75vh] overflow-y-auto rounded-xl border border-[#D9E1EF] bg-white shadow-[0_18px_40px_-12px_rgba(16,24,40,0.3)]">
            {/* What is set, and the one click that takes it all off. */}
            <div className="flex items-center gap-2 border-b border-[#EEF1F5] px-4 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">Filters</span>
              {count > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#234788] px-1 text-[10px] font-bold leading-none text-white">{count}</span>}
              {count > 0 && <button type="button" onClick={onReset} className="filter-clear ml-auto">Clear all</button>}
            </div>

            <section className="border-b border-[#EEF1F5] px-4 py-3">
              {heading('Sort by', ArrowUpDown, '#234788')}
              <div className="grid grid-cols-2 gap-1.5">{SORTS.map(([v, l]) => chip(sort === v, l, () => onSort(v)))}</div>
            </section>

            <section className={`px-4 py-3 ${teams.length ? 'border-b border-[#EEF1F5]' : ''}`}>
              {heading('Show', Eye, '#D97706')}
              <div className="space-y-0.5" role="radiogroup" aria-label="Show">
                {SHOWS.map(([v, l]) => {
                  const on = show === v;
                  return (
                    <button key={v} type="button" role="menuitemradio" aria-checked={on} onClick={() => onShow(v)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors ${on ? 'bg-[#F3F6FB] font-semibold text-[#142B57]' : 'text-gray-700 hover:bg-gray-50'}`}>
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? 'border-[#234788]' : 'border-gray-300'}`}>
                        {on && <span className="h-2 w-2 rounded-full bg-[#234788]" />}
                      </span>
                      {l}
                    </button>
                  );
                })}
              </div>
            </section>

            {teams.length > 0 && (
              <section className="px-4 py-3">
                {heading('Team', Users, '#7C3AED')}
                <div className="flex flex-wrap gap-1.5">
                  {chip(!team, 'All teams', () => onTeam(''))}
                  {teams.map((t) => chip(team === t, t, () => onTeam(t)))}
                </div>
              </section>
            )}
          </div>
        </Portal>
      )}
    </>
  );
};

// --- the grid --------------------------------------------------------------------------------

export const PeopleBoards: React.FC = () => {
  const { people, error } = usePeople();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [show, setShow] = useState<Show>('all');

  const teams = useMemo(() => [...new Set((people ?? []).flatMap((p) => p.teams))].sort(), [people]);
  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    const rows = (people ?? []).filter((p) => (
      (!team || p.teams.includes(team))
      && (show !== 'overdue' || p.overdue > 0)
      && (show !== 'today' || p.due_today > 0)
      && (!text || nameOf(p).toLowerCase().includes(text) || (p.designation ?? '').toLowerCase().includes(text) || p.user.email.toLowerCase().includes(text))
    ));
    if (sort === 'overdue') return [...rows].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
    if (sort === 'open') return [...rows].sort((a, b) => b.open - a.open || b.overdue - a.overdue);
    if (sort === 'today') return [...rows].sort((a, b) => b.due_today - a.due_today || b.overdue - a.overdue);
    return rows;
  }, [people, q, team, sort, show]);

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
        <div className="ml-auto">
          <PeopleFilter
            teams={teams} team={team} sort={sort} show={show}
            onTeam={setTeam} onSort={setSort} onShow={setShow}
            onReset={() => { setTeam(''); setSort('name'); setShow('all'); }}
          />
        </div>
      </div>

      {!people ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-[150px] rounded-xl" />)}
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
                  className="group/card flex h-full w-full flex-col rounded-xl border border-[#E4E8F0] bg-white text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors duration-150 hover:border-[#B9C7E2] focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/15"
                >
                  {/* Who they are, and the way in. */}
                  <div className="flex items-center gap-2.5 px-4 pt-3.5">
                    <Avatar user={p.user} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-[14.5px] font-bold leading-tight tracking-[-0.01em] text-[#142B57]">{nameOf(p)}</p>
                      <p className="truncate text-[12px] leading-tight text-gray-500">{p.designation || p.department || 'No designation'}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5 self-start text-[12px] font-semibold text-[#234788]">
                      Open board
                      <ArrowUpRight size={14} className="transition-transform duration-200 group-hover/card:-translate-y-0.5 group-hover/card:translate-x-0.5" />
                    </span>
                  </div>

                  {/* The three figures in one slim row between fine rules. */}
                  <dl className="mx-4 mt-3 grid grid-cols-3 border-y border-[#EEF1F5] py-2 text-center">
                    {([['Open', p.open, 'text-[#142B57]'], ['Overdue', p.overdue, p.overdue ? 'text-rose-600' : 'text-[#142B57]'], ['Due today', p.due_today, 'text-[#142B57]']] as const).map(([label, value, cls], i) => (
                      <div key={label} className={`flex items-baseline justify-center gap-1.5 ${i ? 'border-l border-[#EEF1F5]' : ''}`}>
                        <dd className={`font-display text-[18px] font-bold leading-none tabular-nums ${cls}`}>{value}</dd>
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">{label}</dt>
                      </div>
                    ))}
                  </dl>

                  {/* This week's hours, only for people with working hours set. */}
                  {(p.capacity ?? 0) > 0 && (
                    <div className="px-4 pt-2.5">
                      <WeekBar planned={p.planned ?? 0} capacity={p.capacity ?? 0} />
                    </div>
                  )}

                  {/* How they are doing, in one word, and their Teams. */}
                  <div className="mt-auto flex items-center gap-1.5 px-4 pb-3 pt-2.5">
                    <span className={`flex min-w-0 items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] ${tag.text}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tag.dot}`} aria-hidden /> <span className="truncate">{tag.label}</span>
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      {p.teams.slice(0, 2).map((t) => <span key={t} className="rounded-md border border-[#DCE3EF] bg-[#F5F8FD] px-1.5 py-px text-[11px] font-medium text-[#234788]">{t}</span>)}
                      {p.teams.length > 2 && <span className="text-[11px] text-gray-400">+{p.teams.length - 2}</span>}
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
            {shown ? `${shown.display_name || shown.email}'s dashboard` : <WordSkeleton className="w-40" />}
          </p>
          <p className="truncate text-xs text-gray-500">
            {[person?.designation, person?.teams.join(', ')].filter(Boolean).join(' · ') || 'Their own view of their work'}
          </p>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600" aria-label="You see what they see. Nothing you do here changes their board.">
          <Eye size={12} /> View only
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" disabled={!prev} onClick={() => prev && go(prev.user.id)} aria-label="Previous person"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-50 disabled:opacity-40 disabled:shadow-none">
            <ChevronLeft size={16} />
          </button>
          <button type="button" disabled={!next} onClick={() => next && go(next.user.id)} aria-label="Next person"
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
          <DashboardPage key={board.id} dashboardId={board.id} heading={false} viewing personId={userId} />
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
