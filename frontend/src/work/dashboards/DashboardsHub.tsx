import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BarChart3, Lock, Plus, Search, Share2, Sparkles, Users } from 'lucide-react';
import { FEATURES } from '../../config/features';
import { useWork } from '../WorkContext';
import { Avatar } from '../ui';
import { dashApi, type DashboardSummary } from './api';
import { NewDashboardDialog, useLeadership } from './dialogs';
import { PeopleBoards } from './PeopleBoards';
import { ListSkeleton } from '../Skeleton';

type Tab = 'all' | 'mine' | 'team' | 'shared' | 'my_team' | 'everyone' | 'people';

const LEVEL_LABEL = { view: 'View', edit: 'Edit', full: 'Full' } as const;

/** Every Dashboard you can open, ClickUp's Dashboards Hub. */
export const DashboardsHub: React.FC = () => {
  const { workspace } = useWork();
  const { isAdmin, led, isGuest } = useLeadership();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'all';
  const [items, setItems] = useState<DashboardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!workspace) return;
    try { setItems(await dashApi.list(workspace.id)); } catch (e) { setError((e as Error).message); }
  }, [workspace]);
  useEffect(() => { load(); }, [load]);

  // A manager has their own work and their Team; an admin also has the whole firm.
  const tabs: { key: Tab; label: string; show: boolean; hint: string }[] = [
    { key: 'all', label: 'All Dashboards', show: true, hint: 'Everything you can open' },
    // An admin has no personal board -- the Company one is theirs -- so the tab would be empty.
    { key: 'mine', label: 'My Dashboard', show: !isGuest && !isAdmin, hint: 'Your own work' },
    { key: 'team', label: 'Team Dashboards', show: led.length > 0 || isAdmin, hint: 'The Teams you look after, person by person' },
    { key: 'everyone', label: 'Company', show: isAdmin, hint: 'Everyone in the firm, managers included' },
    // "Shared with me" came off the Hub: everything you can open is already in All Dashboards,
    // and a second list of a subset of the same rows is a tab people check to see if they missed
    // something. The sharing itself, and the "shared" relation the rows carry, are untouched.
    ...(FEATURES.dashboardsSharedTab ? [{ key: 'shared' as Tab, label: 'Shared with me', show: !isGuest, hint: 'Dashboards others shared with you or your Team' }] : []),
  ];

  // A manager's own work is already their home page, and their people's boards open from the
  // People page. What the Hub is for, to them, is the Teams they look after -- so that is all it lists.
  const teamsOnly = led.length > 0 && !isAdmin;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items ?? [])
      .filter((x) => (
        teamsOnly ? !!x.team
        // Everyone has a "My work"; other people's belong under "My Team" and "Everyone", not in the main list.
        : tab === 'all' ? !(x.standard === 'my_work' && x.relation !== 'mine')
          : tab === 'team' ? !!x.team
          : tab === 'everyone' ? x.relation === 'everyone' || x.relation === 'my_team'
          : x.relation === tab
      ))
      .filter((x) => !q || x.name.toLowerCase().includes(q) || (x.owner?.display_name ?? x.owner?.email ?? '').toLowerCase().includes(q));
  }, [items, tab, search, teamsOnly]);

  // "My Team" and "Everyone" read best grouped by person.
  const grouped = tab === 'my_team' || tab === 'everyone';
  const groups = useMemo(() => {
    if (!grouped) return [{ key: '', title: '', rows: visible }];
    const map = new Map<string, { key: string; title: string; rows: DashboardSummary[] }>();
    for (const x of visible) {
      const key = x.team ? `team:${x.team.id}` : x.owner?.id ?? 'unknown';
      const title = x.team ? `Team: ${x.team.name}` : x.owner?.display_name || x.owner?.email || 'Former member';
      if (!map.has(key)) map.set(key, { key, title, rows: [] });
      map.get(key)!.rows.push(x);
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [visible, grouped]);

  const shownTabs = tabs.filter((t) => t.show);
  // Admins see everyone's own board; Team leads, their people's. The boards themselves are the
  // people grid, not rows in the table -- a list of seventy boards all called "My work" says nothing.
  const canSeePeople = !isGuest && (isAdmin || led.length > 0);
  const peopleView = canSeePeople && tab === 'people';
  const switchCls = (on: boolean) => `flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors ${on ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`;
  return (
    <div className="flex h-full min-h-0 bg-white">
      {/* A whole column of chrome to hold three or four words. With this many boards the panel
          was a navigation step in front of a list you can read in one screen, so the scopes sit
          above the table as chips and the table gets the width. */}
      <main className="min-w-0 flex-1 overflow-auto px-6 py-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <BarChart3 size={18} /> {peopleView ? 'People’s dashboards' : teamsOnly ? 'Team Dashboards' : 'Dashboards'}
          </h1>
          {!peopleView && <span className="text-sm text-gray-400">{visible.length}</span>}
          {canSeePeople && (
            <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="tablist" aria-label="Dashboards or people">
              <button type="button" role="tab" aria-selected={!peopleView} onClick={() => setParams({})} className={switchCls(!peopleView)}>
                <BarChart3 size={14} /> Dashboards
              </button>
              <button type="button" role="tab" aria-selected={peopleView} onClick={() => setParams({ tab: 'people' })} className={switchCls(peopleView)}>
                <Users size={14} /> People
              </button>
            </div>
          )}
          {!peopleView && (<>
          <div className="ml-auto flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1">
            <Search size={14} className="text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Dashboards" className="w-48 text-sm focus:outline-none" />
          </div>
          {/* "Monthly review packs" stood here: one Dashboard per person, shared with them and
              their manager, emailed to both on the 1st. Off, for two reasons. It would make
              seventy-five more Dashboards on one press, and the half that made it worth having --
              the email -- no longer goes out, since email is invitations only now. The endpoint
              and the packs themselves are untouched. */}
          {!isGuest && (
            <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              <Plus size={14} /> New Dashboard
            </button>
          )}
          </>)}
        </div>
        {peopleView ? <PeopleBoards /> : (<>
        {/* The scopes came off: with a handful of boards, All / Team / Company narrowed a list
            that already fits on one screen, and every row says whose it is. The tabs still work
            from a ?tab= link, and the filtering they drive is untouched. */}
        {FEATURES.dashboardScopeTabs && !teamsOnly && shownTabs.length > 1 && (
          <div className="mb-3 flex flex-wrap items-center gap-1">
            {shownTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                title={t.hint}
                onClick={() => setParams(t.key === 'all' ? {} : { tab: t.key })}
                className={`rounded-lg px-2.5 py-1 text-sm transition-colors ${
                  tab === t.key ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        {FEATURES.dashboardPreview && (
          <Link to="/dashboards/preview" className="mb-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm text-teal-700 no-underline hover:bg-teal-50">
            <Sparkles size={14} /> Card previews
          </Link>
        )}

        {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!items ? (
          <ListSkeleton rows={4} label="Loading Dashboards" />
        ) : visible.length === 0 ? (
          <div className="mx-auto mt-16 max-w-sm text-center">
            <BarChart3 size={32} className="mx-auto text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">{search ? 'No Dashboards match.' : teamsOnly ? 'No Team Dashboards yet.' : 'No Dashboards here yet.'}</p>
            {!isGuest && !search && (tab === 'all' || tab === 'mine' || tab === 'team') && (
              <button type="button" onClick={() => setCreating(true)} className="mt-3 text-sm font-medium text-brand-600 hover:underline">Create a Dashboard</button>
            )}
          </div>
        ) : teamsOnly ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Team</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cards</th>
                  <th className="px-4 py-2.5 text-right font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {[...visible].sort((a, b) => (a.team!.name.localeCompare(b.team!.name)) || a.name.localeCompare(b.name)).map((x) => (
                  <tr key={x.id} onClick={() => navigate(`/dashboards/${x.id}`)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link to={`/dashboards/${x.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 font-medium text-gray-900 no-underline hover:underline">
                        <BarChart3 size={15} className="text-brand-500" /> {x.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <span className="inline-flex items-center gap-1.5"><Users size={13} className="text-gray-400" /> {x.team!.name}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">{x.card_count}</td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500">{new Date(x.updated_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="mb-5">
              {grouped && <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{group.title}</h3>}
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-gray-50 text-left text-xs text-gray-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Belongs to</th>
                      <th className="px-3 py-2 font-medium">Sharing</th>
                      <th className="px-3 py-2 font-medium">Your access</th>
                      <th className="px-3 py-2 text-right font-medium">Cards</th>
                      <th className="px-3 py-2 text-right font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((x) => (
                      <tr key={x.id} onClick={() => navigate(`/dashboards/${x.id}`)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <Link to={`/dashboards/${x.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 font-medium text-gray-900 no-underline hover:underline">
                            <BarChart3 size={15} className="text-brand-500" /> {x.name}
                          </Link>
                          {x.standard && (
                            <span className="mt-0.5 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                              {x.standard === 'my_work' ? 'Made for you' : x.standard === 'team' ? 'Your team, person by person' : 'Everyone in the company'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {x.team ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700"><Users size={12} /> {x.team.name}</span>
                          ) : x.owner ? (
                            <span className="flex items-center gap-1.5"><Avatar user={x.owner} size={20} /> <span className="truncate">{x.relation === 'mine' ? 'Me' : x.owner.display_name || x.owner.email}</span></span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {x.is_shared ? <span className="inline-flex items-center gap-1"><Share2 size={12} /> Shared</span> : <span className="inline-flex items-center gap-1"><Lock size={12} /> Private</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">{LEVEL_LABEL[x.your_level]}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{x.card_count}</td>
                        <td className="px-3 py-2 text-right text-xs text-gray-500">{new Date(x.updated_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        )}
        </>)}
      </main>

      {creating && (
        <NewDashboardDialog
          onClose={() => setCreating(false)} onCreated={(id) => navigate(`/dashboards/${id}`)}
          defaultTeam={teamsOnly ? led[0]?.id : undefined}
        />
      )}
    </div>
  );
};
