import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { Check, LayoutGrid, List as ListIcon, Network, Search, Shapes, ShieldCheck, Users } from 'lucide-react';
import { useIsManager, useMe, useWork } from '../WorkContext';
import type { Role } from '../api';
import { Avatar, Portal } from '../ui';
import { peopleApi, personName, type Person, type TeamFull } from './peopleApi';
import { PersonPanel, accessOf } from './PersonDialogs';
import { FEATURES } from '../../config/features';
import { LinesSkeleton } from '../Skeleton';
import { dashApi, type PersonBoard } from '../dashboards/api';
import { TwoStepFilter, type FilterField } from '../views/TwoStepFilter';
import { AccessDialog, BulkBar, HandOverDialog, RemindDialog, WeekBar, loadOf } from './TeamBulk';
import { currentReviewMonth, reviewApi, reviewMonthName } from '../review/MonthlyReview';

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
  const [params, setParams] = useSearchParams();
  // A link straight to someone ("Open their profile" after adding them) opens their profile here.
  const [open, setOpenState] = useState<string | null>(() => params.get('person'));
  const setOpen = (id: string | null) => {
    setOpenState(id);
    if (!id && params.has('person')) { params.delete('person'); setParams(params, { replace: true }); }
  };
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
        My team is for admins and Managers.
      </div>
    );
  }
  const nav = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm no-underline ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-600 hover:bg-gray-100'}`;
  return (
    <HubContext.Provider value={hub}>
      <div className="flex h-full min-h-0 bg-white">
        <nav className="w-52 shrink-0 border-r border-gray-200 p-3" aria-label="Teams Hub">
          <h1 className="mb-3 px-2.5 text-base font-semibold text-gray-900">{isAdmin ? 'People' : 'My team'}</h1>
          {/* A Manager's whole view is their own team: the firm-wide lists, and the "My teams"
              shortcuts that sat under them, were rows leading to people they are not over. */}
          <NavLink to="/people" end className={nav}><Users size={15} /> {isAdmin ? 'All people' : 'Team'}</NavLink>
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

type Show = 'all' | 'free' | 'over' | 'review';

export const PeopleDirectory: React.FC = () => {
  const { ws, people: visible, isAdmin, teams: allTeams, me, openPerson, reload } = useHub();
  const scope = useScope();
  const people = useMemo(() => (scope.ids ? visible.filter((p) => scope.ids!.has(p.user.id)) : visible), [visible, scope]);
  const teams = scope.teams;
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [role, setRole] = useState('');
  const [manager, setManager] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'remind' | 'access' | 'handover' | null>(null);
  const [layout, setLayout] = useState<'grid' | 'cards'>(() => { try { return (localStorage.getItem('timetriq.peopleLayout') as 'grid' | 'cards') || 'grid'; } catch { return 'grid'; } });
  useEffect(() => { try { localStorage.setItem('timetriq.peopleLayout', layout); } catch { /* ignore */ } }, [layout]);

  // This month's review: who has marked it done. Empty until it loads, and for anyone outside it.
  const reviewMonth = currentReviewMonth();
  const [reviews, setReviews] = useState<Map<string, string | null> | null>(null);
  const loadReviews = useCallback(() => {
    if (ws) reviewApi.team(ws, reviewMonth).then((rows) => setReviews(new Map(rows.map((r) => [r.user_id, r.completed_at])))).catch(() => setReviews(new Map()));
  }, [ws, reviewMonth]);
  useEffect(() => { loadReviews(); }, [loadReviews]);
  /** Done, not yet, or not someone who does one (themselves, an admin). */
  const reviewOf = (p: Person): 'done' | 'pending' | 'none' => {
    if (!reviews || !reviews.has(p.user.id)) return 'none';
    return reviews.get(p.user.id) ? 'done' : 'pending';
  };

  // This week for each person -- hours they can work, open work planned into them, what is open
  // and late -- from the same figures as their Dashboards. Without it the page still works.
  const [weekRows, setWeekRows] = useState<PersonBoard[] | null>(null);
  const loadWeek = useCallback(() => {
    if (!ws) return;
    // Open and late counts first, then the hours, which take longer to work out.
    dashApi.people(ws).then((rows) => {
      setWeekRows(rows);
      dashApi.peopleWeek(ws).then((week) => setWeekRows((prev) => prev && prev.map((p) => ({ ...p, ...week[p.user.id] })))).catch(() => undefined);
    }).catch(() => setWeekRows([]));
  }, [ws]);
  useEffect(() => { loadWeek(); }, [loadWeek]);
  const week = useMemo(() => new Map((weekRows ?? []).map((r) => [r.user.id, r])), [weekRows]);

  // Names for "Reports to" come from everyone the server sent, so a lead's own manager is named.
  const byId = useMemo(() => new Map(visible.map((p) => [p.user.id, p])), [visible]);
  const active = people.filter((p) => !p.deactivated_at);
  const loadFor = (p: Person) => { const w = week.get(p.user.id); return w ? loadOf(w.planned ?? 0, w.capacity ?? 0) : 'none'; };
  const ratio = (p: Person) => { const w = week.get(p.user.id); return w && w.capacity ? (w.planned ?? 0) / w.capacity : 1; };
  const freeCount = active.filter((p) => loadFor(p) === 'free').length;
  const overCount = active.filter((p) => loadFor(p) === 'over').length;
  const shown = active.filter((p) => {
    const text = `${personName(p)} ${p.user.email} ${p.designation ?? ''} ${p.department ?? ''} ${p.employee_code ?? ''}`.toLowerCase();
    return (!q || text.includes(q.trim().toLowerCase()))
      && (!team || p.team_ids.includes(team))
      && (!role || accessOf(p.role, p.user.id, allTeams) === role)
      && (!manager || p.manager_id === manager)
      && (show === 'all' || (show === 'review' ? reviewOf(p) === 'pending' : show === 'free' ? loadFor(p) === 'free' : loadFor(p) === 'over'));
  });
  // On "Free this week" the freest come first, so the person to give work to is the top row.
  if (show === 'free') shown.sort((a, b) => ratio(a) - ratio(b));
  if (show === 'over') shown.sort((a, b) => ratio(b) - ratio(a));
  const managers = people.filter((p) => p.direct_reports > 0);
  const pickedPeople = active.filter((p) => picked.has(p.user.id));
  const allPicked = shown.length > 0 && shown.every((p) => picked.has(p.user.id));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(shown.map((p) => p.user.id)));

  const fields: FilterField[] = [
    ...(teams.length > 1 ? [{ key: 'team', label: 'Team', Icon: Users, single: true, options: teams.map((t) => ({ value: t.id, label: t.name })), selected: team ? [team] : [] }] : []),
    { key: 'role', label: 'Role', Icon: ShieldCheck, single: true, options: ['Admin', 'Manager', 'Employee'].map((r) => ({ value: r, label: r })), selected: role ? [role] : [] },
    { key: 'manager', label: 'Reports to', Icon: Network, single: true, options: managers.map((m) => ({ value: m.user.id, label: personName(m) })), selected: manager ? [manager] : [] },
  ];
  const setField = (key: string, value: string) => {
    if (key === 'team') setTeam(team === value ? '' : value);
    else if (key === 'role') setRole(role === value ? '' : value);
    else setManager(manager === value ? '' : value);
  };
  const clearField = (key: string) => { if (key === 'team') setTeam(''); else if (key === 'role') setRole(''); else setManager(''); };

  const tabs: [Show, string, number | null][] = [
    ['all', 'Everyone', active.length],
    ['free', 'Free this week', weekRows ? freeCount : null],
    ['over', 'Overloaded', weekRows ? overCount : null],
    ['review', `${reviewMonthName(reviewMonth)} review pending`, reviews ? active.filter((p) => reviewOf(p) === 'pending').length : null],
  ];
  // The week's hours are what Free and Overloaded are about; on Everyone they are one more column
  // of the same "0h of 40h" for most people, so they are left to those two tabs.
  const weekShown = show === 'free' || show === 'over';
  // What each tab is, in a sentence: "Everyone" and "Free this week" can list the same people, and
  // without saying why that reads as the tab not working.
  const explain = show === 'all'
    ? `Everyone in ${isAdmin ? 'the firm' : 'your team'}, ${active.length} ${active.length === 1 ? 'person' : 'people'}.`
    : show === 'review'
      ? `People who have not marked their ${reviewMonthName(reviewMonth)} review done on the PMS. Tick them and use Remind.`
      : 'People with more work planned this week than hours to do it. Move something off them.';
  const check = (on: boolean, onClick: () => void, label: string) => (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex h-4 w-4 items-center justify-center rounded-[5px] border transition-colors ${on ? 'border-[#234788] bg-[#234788] text-white' : 'border-gray-300 bg-white hover:border-[#234788]'}`}>
      {on && <Check size={11} strokeWidth={3.5} />}
    </button>
  );

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6 pb-24">
      <header className="mb-5">
        <h2 className="text-[19px] font-semibold tracking-tight text-[#142B57]">{isAdmin ? 'All people' : 'My team'} <span className="ml-1 text-sm font-normal tabular-nums text-gray-400">{active.length}</span></h2>
        <p className="mt-0.5 text-[13px] text-gray-500">{isAdmin ? 'Everyone in the firm, and how full their week is.' : 'The people in the teams you lead, and how full their week is.'}</p>
        {/* Adding and importing people were buttons here as well as in the Admin menu. Admin is
            where they are done; two doors to the same form was one too many. */}
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* Who to give work to, and who to take it off: the two questions this page is opened for. */}
        <nav role="tablist" aria-label="Show" className="flex rounded-lg border border-[#E4E8F0] bg-white p-0.5">
          {tabs.map(([key, label, count]) => {
            const on = show === key;
            return (
              <button key={key} type="button" role="tab" aria-selected={on} onClick={() => setShow(key)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium transition-colors ${on ? 'bg-[#234788] text-white' : 'text-gray-600 hover:text-gray-900'}`}>
                {label}
                {count !== null && (
                  <span className={`min-w-4 rounded-full px-1.5 text-[11px] tabular-nums ${on ? 'bg-white/20 text-white' : key === 'over' && count ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
                )}
              </button>
            );
          })}
        </nav>
        <label className="flex items-center gap-1.5 rounded-lg border border-[#E4E8F0] bg-white px-2.5 py-1.5 focus-within:border-[#234788]">
          <Search size={14} className="text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" className="w-44 text-[13px] focus:outline-none" />
        </label>
        <TwoStepFilter fields={fields} onToggle={(f, v) => setField(f.key, v)} onClear={(f) => clearField(f.key)}
          onClearAll={() => { setTeam(''); setRole(''); setManager(''); }} />
        <span className="ml-auto flex rounded-lg border border-[#E4E8F0] bg-white p-0.5">
          <button aria-label="Table" type="button" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')} className={`rounded-md p-1 ${layout === 'grid' ? 'bg-[#EEF2F8] text-[#234788]' : 'text-gray-400 hover:text-gray-700'}`}><ListIcon size={15} /></button>
          <button aria-label="Cards" type="button" aria-pressed={layout === 'cards'} onClick={() => setLayout('cards')} className={`rounded-md p-1 ${layout === 'cards' ? 'bg-[#EEF2F8] text-[#234788]' : 'text-gray-400 hover:text-gray-700'}`}><LayoutGrid size={15} /></button>
        </span>
      </div>

      {show !== 'free' && <p className="mb-3 text-[12.5px] text-gray-500">{explain}</p>}
      {layout === 'grid' ? (
        <div className="overflow-x-auto rounded-xl border border-[#E4E8F0] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <table className={`w-full text-sm ${weekShown ? 'min-w-[980px]' : 'min-w-[760px]'}`} aria-label="People">
            <thead className="border-b border-[#E4E8F0] bg-[#F7F9FC] text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="w-10 py-2.5 pl-4">{check(allPicked, toggleAll, allPicked ? 'Unselect everyone' : 'Select everyone shown')}</th>
                <th className="px-3 py-2.5">Name</th>
                {weekShown && <th className="w-64 px-3 py-2.5">This week</th>}
                {show !== 'free' && <th className="px-3 py-2.5">Open work</th>}
                <th className="px-3 py-2.5">Reports to</th>
                <th className="px-3 py-2.5">Teams</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5">{reviewMonthName(reviewMonth)} review</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const boss = p.manager_id ? byId.get(p.manager_id) : undefined;
                const w = week.get(p.user.id);
                const on = picked.has(p.user.id);
                return (
                  <tr key={p.user.id} onClick={() => openPerson(p.user.id)}
                    className={`cursor-pointer border-t border-[#EEF1F5] transition-colors first:border-t-0 ${on ? 'bg-[#F3F6FB]' : 'hover:bg-[#F9FAFC]'}`}>
                    <td className="py-3 pl-4">{check(on, () => toggle(p.user.id), `Select ${personName(p)}`)}</td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-2.5"><Avatar user={p.user} size={30} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-gray-900">{personName(p)}{p.user.id === me && <span className="ml-1.5 text-[11px] font-normal text-gray-400">you</span>}</span>
                          <span className="block truncate text-xs text-gray-500">{p.designation ?? '—'}</span>
                        </span>
                      </span>
                    </td>
                    {weekShown && <td className="px-3 py-3">{w && w.capacity !== undefined ? <WeekBar planned={w.planned ?? 0} capacity={w.capacity} /> : <span className="text-xs text-gray-300">…</span>}</td>}
                    {show !== 'free' && (
                      <td className="px-3 py-3 text-[13px] tabular-nums">
                        {w ? (
                          <span className="flex items-center gap-2">
                            <span className="text-gray-800"><b className="font-semibold">{w.open}</b> open</span>
                            {w.overdue > 0 && <span className="rounded-full bg-red-50 px-1.5 text-[11px] font-semibold text-red-700">{w.overdue} late</span>}
                          </span>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                    )}
                    <td className="px-3 py-3 text-[13px] text-gray-700">{boss ? personName(boss) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-3">
                      <span className="flex flex-wrap gap-1">{p.team_ids.map((id) => {
                        const t = allTeams.find((x) => x.id === id);
                        return t ? <span key={id} className="rounded-md border border-[#DCE3EF] bg-[#F5F8FD] px-1.5 py-px text-[11px] font-medium text-[#234788]">{t.name}</span> : null;
                      })}</span>
                    </td>
                    <td className="px-3 py-3"><RolePill role={accessOf(p.role, p.user.id, allTeams)} /></td>
                    <td className="px-3 py-3 text-[12.5px]">
                      {reviewOf(p) === 'done'
                        ? <span className="inline-flex items-center gap-1 font-semibold text-[#234788]"><Check size={13} strokeWidth={3} /> Done {new Date(reviews!.get(p.user.id)!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                        : reviewOf(p) === 'pending'
                          ? <span className="inline-flex items-center gap-1.5 font-medium text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Not yet</span>
                          : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={6 + (weekShown ? 1 : 0) + (show !== 'free' ? 1 : 0)} className="px-3 py-12 text-center text-sm text-gray-400">
                  {show === 'free' ? 'Nobody has much room this week.' : show === 'over' ? 'Nobody is planned past their hours this week.' : show === 'review' ? 'Everyone has marked their review done.' : 'Nobody matches.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="People cards">
          {shown.map((p) => {
            const w = week.get(p.user.id);
            const on = picked.has(p.user.id);
            return (
              <li key={p.user.id} className={`relative rounded-xl border p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${on ? 'border-[#B9C7E2] bg-[#F7F9FC]' : 'border-[#E4E8F0] bg-white'}`}>
                <span className="absolute left-3 top-3">{check(on, () => toggle(p.user.id), `Select ${personName(p)}`)}</span>
                <button type="button" onClick={() => openPerson(p.user.id)} className="flex w-full flex-col items-center text-center">
                  <Avatar user={p.user} size={48} />
                  <span className="mt-2 w-full truncate text-sm font-semibold text-gray-900">{personName(p)}</span>
                  <span className="w-full truncate text-xs text-gray-500">{p.designation ?? accessOf(p.role, p.user.id, allTeams)}</span>
                </button>
                {weekShown && w && w.capacity !== undefined && <div className="mt-3 border-t border-[#EEF1F5] pt-3"><WeekBar planned={w.planned ?? 0} capacity={w.capacity} /></div>}
              </li>
            );
          })}
        </ul>
      )}

      {pickedPeople.length > 0 && (
        <BulkBar count={pickedPeople.length} onClear={() => setPicked(new Set())}
          onRemind={() => setDialog('remind')} onAccess={() => setDialog('access')} onHandOver={() => setDialog('handover')} />
      )}
      {dialog === 'remind' && <RemindDialog ws={ws} people={pickedPeople} onClose={() => setDialog(null)} />}
      {dialog === 'access' && <AccessDialog people={pickedPeople} onClose={() => setDialog(null)} />}
      {dialog === 'handover' && (
        <HandOverDialog ws={ws} people={pickedPeople} team={active} week={week} onClose={() => setDialog(null)}
          onDone={() => { setPicked(new Set()); loadWeek(); reload(); }} />
      )}
    </div>
  );
};

/** Admin / Manager / Employee as a small label, navy for the two that run things. */
const RolePill: React.FC<{ role: string }> = ({ role }) => (
  <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${role === 'Employee' ? 'bg-gray-100 text-gray-600' : 'bg-[#EEF2F8] text-[#234788]'}`}>{role}</span>
);

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

// All teams lives in TeamCards.tsx; the route still asks for TeamsList by name.
export { AllTeams as TeamsList } from './TeamCards';
