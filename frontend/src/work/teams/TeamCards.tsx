// All teams, for admins: each Team as a card with a light band across the top -- its mark, name and
// size -- and under it who leads it, how its work stands and how full its week is. Search and a sort
// sit above. The figures come in a moment after the cards, so the page never waits on them.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowUpDown, ArrowUpRight, Check, ChevronDown, Plus, Search, UserPlus } from 'lucide-react';
import { Avatar, Menu } from '../ui';
import type { UserRef } from '../api';
import { peopleApi, personName, type TeamFull } from './peopleApi';
import { CreateTeamDialog, useHub } from './TeamsHub';
import { WeekBar, loadOf } from './TeamBulk';

type Figures = { open: number; overdue: number; planned: number; capacity: number };
type Sort = 'name' | 'size' | 'late' | 'booked';
const SORTS: [Sort, string][] = [['name', 'Name'], ['size', 'Most people'], ['late', 'Most late work'], ['booked', 'Most booked']];

/** A Team's mark: its first letter on a soft navy tile, with its own colour as a small dot. */
const Mark: React.FC<{ team: TeamFull; size?: number }> = ({ team, size = 38 }) => (
  <span className="relative flex shrink-0 items-center justify-center rounded-xl bg-[#EEF2F8] font-display font-bold text-[#234788]"
    style={{ width: size, height: size, fontSize: size * 0.42 }}>
    {team.icon || team.name[0]?.toUpperCase()}
    {team.color && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ backgroundColor: team.color }} aria-hidden />}
  </span>
);

/** Whole faces in a row, each ringed in white, then "+14" -- no clipped initials. */
const Faces: React.FC<{ users: UserRef[]; max?: number }> = ({ users, max = 5 }) => (
  <span className="flex items-center">
    <span className="flex -space-x-2">
      {users.slice(0, max).map((u) => <span key={u.id} className="rounded-full ring-2 ring-white"><Avatar user={u} size={24} /></span>)}
    </span>
    {users.length > max && <span className="ml-1.5 text-[12px] font-medium text-gray-500">+{users.length - max}</span>}
  </span>
);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const AllTeams: React.FC = () => {
  const { ws, teams, people, isAdmin, reload } = useHub();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [creating, setCreating] = useState(false);
  const [figures, setFigures] = useState<Record<string, Figures> | null>(null);

  useEffect(() => {
    if (!ws || !isAdmin) return;
    peopleApi.teamFigures(ws).then(setFigures).catch(() => setFigures({}));
  }, [ws, isAdmin, teams]);

  const byId = useMemo(() => new Map(people.map((p) => [p.user.id, p])), [people]);
  const size = (t: TeamFull) => t.all_member_ids?.length ?? t.members.length;
  const leads = (t: TeamFull) => t.lead_ids.map((id) => byId.get(id)).filter(Boolean).map((p) => personName(p!));
  const late = (t: TeamFull) => figures?.[t.id]?.overdue ?? 0;
  const booked = (t: TeamFull) => { const f = figures?.[t.id]; return f && f.capacity ? f.planned / f.capacity : 0; };
  // Sub-teams are told inside their parent ("Includes: Audit, Tax") and not as cards of their own.
  const top = teams.filter((t) => !t.parent_team_id || !teams.some((x) => x.id === t.parent_team_id));
  const subOf = (t: TeamFull) => teams.filter((x) => x.parent_team_id === t.id);

  const people_ = new Set(top.flatMap((t) => t.all_member_ids ?? t.members.map((u) => u.id))).size;
  const text = q.trim().toLowerCase();
  const shown = top
    .filter((t) => !text || `${t.name} ${t.description ?? ''} ${leads(t).join(' ')} ${subOf(t).map((s) => s.name).join(' ')}`.toLowerCase().includes(text))
    .sort((a, b) => (sort === 'size' ? size(b) - size(a) : sort === 'late' ? late(b) - late(a) : sort === 'booked' ? booked(b) - booked(a) : 0) || a.name.localeCompare(b.name));

  // Every Team in the firm is an admin's list. A Manager reaching this address by hand lands on
  // their own team instead.
  if (!isAdmin) return <Navigate to="/people" replace />;

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6 pb-24">
      <header className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-[19px] font-semibold tracking-tight text-[#142B57]">All teams</h2>
          <p className="mt-0.5 text-[13px] text-gray-500">{plural(top.length, 'team')} · {plural(people_, 'person', 'people')} in them</p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#234788] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#1B3A72]"><Plus size={15} /> Create team</button>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 rounded-lg border border-[#E4E8F0] bg-white px-2.5 py-1.5 focus-within:border-[#234788]">
          <Search size={14} className="text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teams or leads" aria-label="Search teams" className="w-52 text-[13px] focus:outline-none" />
        </label>
        <span className="ml-auto">
          <Menu align="right" label="Sort teams" width={200}
            items={SORTS.map(([v, l]) => ({ label: l, icon: sort === v ? <Check size={14} className="text-[#234788]" /> : <span className="w-3.5" />, onClick: () => setSort(v) }))}
            trigger={<span className="cf-pill flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"><ArrowUpDown size={13} /> {SORTS.find(([v]) => v === sort)?.[1]} <ChevronDown size={13} className="cf-pill-caret" /></span>} />
        </span>
      </div>

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Teams">
        {shown.map((t) => {
          const f = figures?.[t.id];
          const lead = leads(t);
          const n = size(t);
          const subs = subOf(t);
          const places = { list: t.locations.filter((l) => l.kind === 'list').length, folder: t.locations.filter((l) => l.kind === 'folder').length, space: t.locations.filter((l) => l.kind === 'space').length };
          const placeText = [places.space && plural(places.space, 'Space'), places.folder && plural(places.folder, 'Folder'), places.list && plural(places.list, 'List')].filter(Boolean).join(' · ');
          const ledBy = lead.length ? <>Led by <b className="font-semibold text-gray-700">{lead.slice(0, 2).join(', ')}</b>{lead.length > 2 ? ` +${lead.length - 2}` : ''}</> : <span className="text-amber-700">No lead yet</span>;
          const figuresRow = (
            <span className="flex items-baseline gap-4 text-[12px] text-gray-500">
              <span><b className="font-display text-[17px] font-bold tabular-nums text-[#142B57]">{f ? f.open : '…'}</b> open</span>
              <span><b className={`font-display text-[17px] font-bold tabular-nums ${f?.overdue ? 'text-rose-600' : 'text-[#142B57]'}`}>{f ? f.overdue : '…'}</b> late</span>
              {f && f.capacity > 0 && <span><b className="font-display text-[17px] font-bold tabular-nums text-[#142B57]">{Math.round((f.planned / f.capacity) * 100)}%</b> booked</span>}
            </span>
          );
          const empty = n === 0 && (
            <span className="flex items-center gap-2 text-[12.5px] text-gray-500">
              No members yet
              <span className="inline-flex items-center gap-1 font-semibold text-[#234788]"><UserPlus size={13} /> Add people</span>
            </span>
          );
          const open = <ArrowUpRight size={15} className="shrink-0 text-[#234788] transition-transform duration-200 group-hover/team:-translate-y-0.5 group-hover/team:translate-x-0.5" />;
          const card = 'group/team block rounded-xl border border-[#E4E8F0] bg-white no-underline shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-[#B9C7E2]';

          const body = (
            <>
              {n ? (
                <>
                  <div className="mt-3 border-t border-[#EEF1F5] pt-3">{figuresRow}</div>
                  {f && f.capacity > 0 && <div className="mt-2.5"><WeekBar planned={f.planned} capacity={f.capacity} /></div>}
                </>
              ) : <div className="mt-3 border-t border-[#EEF1F5] pt-3">{empty}</div>}
              {subs.length > 0 && <p className="mt-2.5 truncate text-[12px] text-gray-500">Includes: <span className="font-medium text-gray-700">{subs.map((s) => s.name).join(', ')}</span></p>}
              <div className="mt-auto flex items-center gap-2 pt-3">
                {n > 0 && <Faces users={t.members} />}
                {placeText && <span className="ml-auto truncate text-[11.5px] font-medium text-gray-500">{placeText}</span>}
              </div>
            </>
          );

          const load = f ? loadOf(f.planned, f.capacity) : 'none';
          return (
              <li key={t.id}>
                <Link to={`/people/teams/${t.id}`} className={`${card} flex h-full flex-col overflow-hidden`}>
                  <span className="flex items-center gap-3 border-b border-[#EEF1F5] bg-[#F7F9FC] px-4 py-3">
                    <Mark team={t} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-[15px] font-bold text-[#142B57]">{t.name}</span>
                      <span className="block truncate text-[12px] text-gray-500">{plural(n, 'person', 'people')}{load === 'over' ? ' · over capacity' : ''}</span>
                    </span>
                    {open}
                  </span>
                  <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
                    <span className="text-[12px] text-gray-500">{ledBy}</span>
                    {t.description && <span className="mt-1 line-clamp-2 text-[12.5px] text-gray-600">{t.description}</span>}
                    {body}
                  </div>
                </Link>
              </li>
            );
        })}
        {shown.length === 0 && <li className="col-span-full py-12 text-center text-sm text-gray-400">{teams.length ? 'No team matches.' : 'No teams yet.'}</li>}
      </ul>

      {creating && <CreateTeamDialog onClose={() => setCreating(false)} onCreated={async (t) => { setCreating(false); await reload(); navigate(`/people/teams/${t.id}`); }} />}
    </div>
  );
};
