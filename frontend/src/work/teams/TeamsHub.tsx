import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutGrid, List as ListIcon, Network, Plus, Search, Shapes, Users, X } from 'lucide-react';
import { useIsManager, useMe, useWork } from '../WorkContext';
import type { Role } from '../api';
import { Avatar, AvatarStack, Portal } from '../ui';
import { peopleApi, personName, type Person, type TeamFull } from './peopleApi';
import { PersonPanel, accessOf } from './PersonDialogs';
import { FEATURES } from '../../config/features';
import { LinesSkeleton } from '../Skeleton';

export interface Hub {
  ws: string; people: Person[]; teams: TeamFull[]; me: string; isAdmin: boolean; roles: Role[];
  reload: () => Promise<void>; openPerson: (id: string) => void;
}
/** Exported so Admin can stand on its own page and still use the sections written for the hub. */
export const HubContext = createContext<Hub | null>(null);
export const useHub = () => {
  const hub = useContext(HubContext);
  if (!hub) throw new Error('useHub outside the Teams Hub');
  return hub;
};

/** Who the People pages are about for this viewer.
 *
 *  An admin's is the firm (ids is null). A Manager's is the Team(s) they lead, sub-teams
 *  included, and themselves -- "My team" and its org chart, nothing beside it. The server already
 *  keeps everyone else's profile from a non-admin (people.visible_people); what it sends a lead
 *  can still hold their own manager or a Team-mate from a Team they only sit in, which is right
 *  for naming who someone reports to but is not the list a lead came here to manage. */
export function useScope(): { ids: Set<string> | null; teams: TeamFull[] } {
  const { isAdmin, teams, me } = useHub();
  return useMemo(() => {
    if (isAdmin) return { ids: null, teams };
    const led = new Set(teams.filter((t) => t.lead_ids.includes(me)).map((t) => t.id));
    // Sub-teams of a led Team are led too, however deep.
    let grew = true;
    while (grew) {
      grew = false;
      teams.forEach((t) => { if (t.parent_team_id && led.has(t.parent_team_id) && !led.has(t.id)) { led.add(t.id); grew = true; } });
    }
    const mine = teams.filter((t) => led.has(t.id));
    const ids = new Set<string>([me]);
    mine.forEach((t) => (t.all_member_ids ?? t.members.map((u) => u.id)).forEach((id) => ids.add(id)));
    return { ids, teams: mine };
  }, [isAdmin, teams, me]);
}

export const TEAM_COLORS = ['#7c3aed', '#0ea5e9', '#16a34a', '#ea580c', '#db2777', '#4f46e5', '#0d9488', '#b45309'];
export const TeamBadge: React.FC<{ team: TeamFull; size?: number }> = ({ team, size = 32 }) => (
  <span className="flex shrink-0 items-center justify-center rounded-lg font-bold text-white"
    style={{ width: size, height: size, fontSize: size * 0.42, backgroundColor: team.color || TEAM_COLORS[team.name.length % TEAM_COLORS.length] }}>
    {team.name[0]?.toUpperCase()}
  </span>
);

/** ClickUp's Teams Hub. An admin gets all people, all teams and the org chart; a Manager gets
 *  their own team and its org chart. */
export const TeamsHub: React.FC = () => {
  const { workspace, hierarchy, refresh } = useWork();
  const myId = useMe();
  const [people, setPeople] = useState<Person[]>([]);
  const [teams, setTeams] = useState<TeamFull[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ws = workspace?.id ?? '';
  const reload = useCallback(async () => {
    if (!ws) return;
    try {
      const [p, t] = await Promise.all([peopleApi.list(ws), peopleApi.teams(ws)]);
      setPeople(p);
      setTeams(t);
    } catch (e) { setError((e as Error).message); }
  }, [ws]);
  useEffect(() => { reload(); }, [reload]);
  const role = hierarchy?.role;
  const isAdmin = role === 'owner' || role === 'admin';
  const isManager = useIsManager();
  // Only the owner makes admins; nobody makes a second owner.
  // Admin or Employee is all anyone is given; a Manager is an employee made a Team's lead.
  const roles: Role[] = role === 'owner' ? ['member', 'admin'] : ['member'];
  const hub: Hub = useMemo(() => ({
    ws, people, teams, me: myId, isAdmin, roles,
    reload: async () => { await reload(); refresh(); },
    openPerson: setOpen,
  }), [ws, people, teams, myId, isAdmin, roles, reload, refresh]);
  const person = people.find((p) => p.user.id === open);
  if (!workspace) return <div className="p-10 text-center text-sm text-gray-500"><LinesSkeleton /></div>;
  // Hiding the link is not the same as closing the door: this page is reachable by typing its
  // address, so it says no here too.
  if (!isManager) {
    return (
      <div className="p-10 text-center text-sm text-gray-500">
        People &amp; Teams is for admins and the people who lead teams.
      </div>
    );
  }
  const nav = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm no-underline ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-600 hover:bg-gray-100'}`;
  return (
    <HubContext.Provider value={hub}>
      <div className="flex h-full min-h-0 bg-white">
        <nav className="w-52 shrink-0 border-r border-gray-200 p-3" aria-label="Teams Hub">
          <h1 className="mb-3 px-2.5 text-base font-semibold text-gray-900">Teams</h1>
          {/* A Manager's whole view is their own team: the firm-wide lists, and the "My teams"
              shortcuts that sat under them, were rows leading to people they are not over. */}
          <NavLink to="/people" end className={nav}><Users size={15} /> {isAdmin ? 'All people' : 'My team'}</NavLink>
          {isAdmin && <NavLink to="/people/teams" end className={nav}><LayoutGrid size={15} /> All teams</NavLink>}
          <NavLink to="/people/org" className={nav}><Network size={15} /> Org chart</NavLink>
          {/* Admin used to be the fourth row here, under a heading that says "Teams". Adding a
              person, what the workspace costs to run and the audit log are not teams work, and
              putting them behind a Teams tab meant an admin looking for them went through a page
              about something else. It is its own entry in the sidebar now, below this one. */}
          {/* Task types is a workspace setting, not a page about people. It still answers at
              /people/task-types, and the manage entry inside a task'"'"'s Type field still opens it. */}
          {FEATURES.taskTypesPage && isAdmin && <NavLink to="/people/task-types" className={nav}><Shapes size={15} /> Task types</NavLink>}
        </nav>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-gray-50/60">
          {error && <p className="m-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Outlet />
        </main>
      </div>
      {person && (
        <PersonPanel ws={ws} person={person} people={people} teams={teams} me={myId} isAdmin={isAdmin} roles={roles}
          onClose={() => setOpen(null)} onChanged={hub.reload} onOpenPerson={setOpen} />
      )}
    </HubContext.Provider>
  );
};

// --- All people ---------------------------------------------------------------------------------------

export const PeopleDirectory: React.FC = () => {
  const { people: visible, isAdmin, teams: allTeams, openPerson } = useHub();
  const scope = useScope();
  const people = useMemo(() => (scope.ids ? visible.filter((p) => scope.ids!.has(p.user.id)) : visible), [visible, scope]);
  const teams = scope.teams;
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [role, setRole] = useState('');
  const [manager, setManager] = useState('');
  const [layout, setLayout] = useState<'grid' | 'cards'>(() => { try { return (localStorage.getItem('timetriq.peopleLayout') as 'grid' | 'cards') || 'grid'; } catch { return 'grid'; } });
  useEffect(() => { try { localStorage.setItem('timetriq.peopleLayout', layout); } catch { /* ignore */ } }, [layout]);
  // Names for "Reports to" come from everyone the server sent, so a lead's own manager is named.
  const byId = useMemo(() => new Map(visible.map((p) => [p.user.id, p])), [visible]);
  const shown = people.filter((p) => {
    const text = `${personName(p)} ${p.user.email} ${p.designation ?? ''} ${p.department ?? ''} ${p.employee_code ?? ''}`.toLowerCase();
    return (!q || text.includes(q.trim().toLowerCase()))
      && (!team || p.team_ids.includes(team))
      && (!role || accessOf(p.role, p.user.id, allTeams) === role)
      && (!manager || p.manager_id === manager)
      && !p.deactivated_at;
  });
  const leftCount = people.filter((p) => p.deactivated_at).length;
  const managers = people.filter((p) => p.direct_reports > 0);
  const sel = 'rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700';
  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-lg font-semibold text-gray-900">{isAdmin ? 'All people' : 'My team'} <span className="text-sm font-normal text-gray-400">{people.length - leftCount}</span></h2>
        {/* Adding and importing people were buttons here as well as in the Admin menu. Admin is
            where they are done; two doors to the same form was one too many. */}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1">
          <Search size={14} className="text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" className="w-44 text-sm focus:outline-none" />
        </span>
        <select aria-label="Filter by team" value={team} onChange={(e) => setTeam(e.target.value)} className={sel}>
          <option value="">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)} className={sel}>
          <option value="">All access</option>{['Admin', 'Manager', 'Employee'].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select aria-label="Filter by manager" value={manager} onChange={(e) => setManager(e.target.value)} className={sel}>
          <option value="">Any manager</option>{managers.map((m) => <option key={m.user.id} value={m.user.id}>Reports to {personName(m)}</option>)}
        </select>
        {(q || team || role || manager) && (
          <button type="button" onClick={() => { setQ(''); setTeam(''); setRole(''); setManager(''); }} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600"><X size={12} /> Clear</button>
        )}
        <span className="ml-auto flex rounded-md border border-gray-200 bg-white p-0.5">
          <button aria-label="Table" type="button" title="Table" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')} className={`rounded p-1 ${layout === 'grid' ? 'bg-gray-100 text-gray-900' : 'text-gray-400'}`}><ListIcon size={15} /></button>
          <button aria-label="Cards" type="button" title="Cards" aria-pressed={layout === 'cards'} onClick={() => setLayout('cards')} className={`rounded p-1 ${layout === 'cards' ? 'bg-gray-100 text-gray-900' : 'text-gray-400'}`}><LayoutGrid size={15} /></button>
        </span>
      </div>

      {layout === 'grid' ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[900px] text-sm" aria-label="People">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500">
              <tr>
                <th className="px-3 py-2">Name</th><th className="px-3 py-2">Designation</th><th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Reports to</th><th className="px-3 py-2">Teams</th><th className="px-3 py-2">Role</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const boss = p.manager_id ? byId.get(p.manager_id) : undefined;
                return (
                  <tr key={p.user.id} onClick={() => openPerson(p.user.id)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2"><Avatar user={p.user} size={26} />
                        <span className="min-w-0"><span className="block truncate font-medium text-gray-900">{personName(p)}</span><span className="block truncate text-xs text-gray-400">{p.user.email}</span></span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{p.designation ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-700">{p.department ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-700">{boss ? personName(boss) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">{p.team_ids.map((id) => { const t = allTeams.find((x) => x.id === id); return t ? <span key={id} className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">{t.name}</span> : null; })}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{accessOf(p.role, p.user.id, allTeams)}</td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-gray-400">Nobody matches.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="People cards">
          {shown.map((p) => (
            <li key={p.user.id}>
              <button type="button" onClick={() => openPerson(p.user.id)} className="flex w-full flex-col items-center rounded-xl border border-gray-200 bg-white p-4 text-center hover:border-brand-300">
                <Avatar user={p.user} size={48} />
                <span className="mt-2 w-full truncate text-sm font-semibold text-gray-900">{personName(p)}</span>
                <span className="w-full truncate text-xs text-gray-500">{p.designation ?? accessOf(p.role, p.user.id, allTeams)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// --- All teams ------------------------------------------------------------------------------------------

export const CreateTeamDialog: React.FC<{ onClose: () => void; onCreated: (t: TeamFull) => void }> = ({ onClose, onCreated }) => {
  const { ws, people, teams } = useHub();
  const [parent, setParent] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(TEAM_COLORS[0]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [leadIds, setLeadIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const save = async () => {
    try {
      onCreated(await peopleApi.createTeam(ws, { name: name.trim(), description: description.trim() || null, color, member_ids: memberIds, lead_ids: leadIds, parent_team_id: parent || null }));
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div role="dialog" aria-label="Create team" onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[88vh] w-[32rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white p-5 shadow-xl">
          <h3 className="mb-3 font-semibold text-gray-900">Create a team</h3>
          <label className="block text-xs font-medium text-gray-600">Team name
            <input autoFocus aria-label="Team name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HR" className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal" />
          </label>
          <label className="mt-3 block text-xs font-medium text-gray-600">Description
            <textarea aria-label="Team description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this team do?" className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal" />
          </label>
          <label className="mt-3 block text-xs font-medium text-gray-600">Sub-team of
            <select aria-label="Sub-team of" value={parent} onChange={(e) => setParent(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal">
              <option value="">No parent (a top-level team)</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <div className="mt-3 flex gap-1.5" role="radiogroup" aria-label="Team colour">
            {TEAM_COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className={`h-6 w-6 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`} style={{ backgroundColor: c }} />)}
          </div>
          <p className="mb-1 mt-3 text-xs font-medium text-gray-600">Members <span className="font-normal text-gray-400">— tick “Lead” for team leads</span></p>
          <ul className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200" aria-label="Choose members">
            {/* Someone who has left (access off) can't be put in a new Team. */}
            {people.filter((p) => !p.deactivated_at).map((p) => (
              <li key={p.user.id} className="flex items-center gap-2 border-t border-gray-100 px-2 py-1 first:border-t-0">
                <input type="checkbox" aria-label={`Member: ${personName(p)}`} checked={memberIds.includes(p.user.id)} onChange={() => { setMemberIds((m) => toggle(m, p.user.id)); setLeadIds((l) => l.filter((x) => x !== p.user.id || !memberIds.includes(p.user.id))); }} />
                <Avatar user={p.user} size={20} /><span className="min-w-0 flex-1 truncate text-sm">{personName(p)}</span>
                <label className="flex items-center gap-1 text-xs text-gray-500"><input type="checkbox" aria-label={`Lead: ${personName(p)}`} checked={leadIds.includes(p.user.id)} onChange={() => { setLeadIds((l) => toggle(l, p.user.id)); setMemberIds((m) => (m.includes(p.user.id) ? m : [...m, p.user.id])); }} /> Lead</label>
              </li>
            ))}
          </ul>
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="button" disabled={!name.trim()} onClick={save} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">Create team</button>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export const TeamsList: React.FC = () => {
  const { teams, isAdmin, reload } = useHub();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const shown = teams.filter((t) => `${t.name} ${t.description ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  // Every Team in the firm is an admin's list. A Manager reaching this address by hand lands on
  // their own team instead.
  if (!isAdmin) return <Navigate to="/people" replace />;
  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-lg font-semibold text-gray-900">All teams <span className="text-sm font-normal text-gray-400">{teams.length}</span></h2>
        <span className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1">
          <Search size={14} className="text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teams" aria-label="Search teams" className="w-40 text-sm focus:outline-none" />
        </span>
        {isAdmin && <button type="button" onClick={() => setCreating(true)} className="ml-auto flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"><Plus size={14} /> Create team</button>}
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Teams">
        {shown.map((t) => (
          <li key={t.id}>
            <Link to={`/people/teams/${t.id}`} className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-4 no-underline hover:border-brand-300">
              <span className="flex items-center gap-3">
                <TeamBadge team={t} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-gray-900">{t.name}</span>
                  {t.handle && <span className="block text-xs text-gray-400">@{t.handle}</span>}
                  {t.parent_team_id && <span className="block text-xs text-brand-600">Sub-team of {teams.find((x) => x.id === t.parent_team_id)?.name}</span>}
                </span>
              </span>
              <span className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm text-gray-600">{t.description || <span className="text-gray-300">No description</span>}</span>
              <span className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                <AvatarStack users={t.members} max={5} /> {t.members.length} member{t.members.length === 1 ? '' : 's'}
                {(t.all_member_ids?.length ?? 0) > t.members.length && <span>· {t.all_member_ids!.length} with sub-teams</span>}
              </span>
            </Link>
          </li>
        ))}
        {shown.length === 0 && <li className="col-span-full py-10 text-center text-sm text-gray-400">{teams.length ? 'No team matches.' : 'No teams yet.'}</li>}
      </ul>
      {creating && <CreateTeamDialog onClose={() => setCreating(false)} onCreated={async (t) => { setCreating(false); await reload(); navigate(`/people/teams/${t.id}`); }} />}
    </div>
  );
};
