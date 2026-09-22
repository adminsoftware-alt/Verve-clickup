import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BarChart3, Lock, Plus, Search, Share2, Users } from 'lucide-react';
import { useWork } from '../WorkContext';
import { Avatar } from '../ui';
import { dashApi, type DashboardSummary } from './api';
import { NewDashboardDialog, useLeadership } from './dialogs';

type Tab = 'all' | 'mine' | 'team' | 'shared' | 'my_team' | 'everyone';

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

  const tabs: { key: Tab; label: string; show: boolean; hint: string }[] = [
    { key: 'all', label: 'All Dashboards', show: true, hint: 'Everything you can open' },
    { key: 'mine', label: 'My Dashboards', show: !isGuest, hint: 'Personal Dashboards you created' },
    { key: 'team', label: 'Team Dashboards', show: true, hint: 'Dashboards that belong to a Team' },
    { key: 'shared', label: 'Shared with me', show: true, hint: 'Dashboards others shared with you or your Team' },
    { key: 'my_team', label: 'My Team', show: led.length > 0, hint: `Personal Dashboards of the people in ${led.map((t) => t.name).join(', ')}` },
    { key: 'everyone', label: 'Everyone', show: isAdmin, hint: 'As an admin you can view every Dashboard in the workspace' },
  ];

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items ?? [])
      .filter((x) => (
        tab === 'all' ? true
          : tab === 'team' ? !!x.team
          : tab === 'everyone' ? x.relation === 'everyone' || x.relation === 'my_team'
          : x.relation === tab
      ))
      .filter((x) => !q || x.name.toLowerCase().includes(q) || (x.owner?.display_name ?? x.owner?.email ?? '').toLowerCase().includes(q));
  }, [items, tab, search]);

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

  return (
    <div className="flex h-full min-h-0 bg-white">
      <aside className="w-56 shrink-0 border-r border-gray-200 px-3 py-4">
        <h1 className="mb-3 flex items-center gap-2 px-2 text-base font-semibold text-gray-900"><BarChart3 size={18} /> Dashboards</h1>
        <nav aria-label="Dashboard pages" className="space-y-0.5">
          {tabs.filter((t) => t.show).map((t) => (
            <button
              key={t.key}
              type="button"
              title={t.hint}
              onClick={() => setParams(t.key === 'all' ? {} : { tab: t.key })}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${tab === t.key ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto px-6 py-4">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">{tabs.find((t) => t.key === tab)?.label}</h2>
          <span className="text-sm text-gray-400">{visible.length}</span>
          <div className="ml-auto flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1">
            <Search size={14} className="text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Dashboards" className="w-48 text-sm focus:outline-none" />
          </div>
          {!isGuest && (
            <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
              <Plus size={14} /> New Dashboard
            </button>
          )}
        </div>
        <p className="mb-4 text-xs text-gray-500">{tabs.find((t) => t.key === tab)?.hint}.</p>

        {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!items ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="mx-auto mt-16 max-w-sm text-center">
            <BarChart3 size={32} className="mx-auto text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">{search ? 'No Dashboards match.' : 'No Dashboards here yet.'}</p>
            {!isGuest && !search && (tab === 'all' || tab === 'mine' || tab === 'team') && (
              <button type="button" onClick={() => setCreating(true)} className="mt-3 text-sm font-medium text-indigo-600 hover:underline">Create a Dashboard</button>
            )}
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
                            <BarChart3 size={15} className="text-indigo-500" /> {x.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {x.team ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700"><Users size={12} /> {x.team.name}</span>
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
      </main>

      {creating && <NewDashboardDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(`/dashboards/${id}`)} />}
    </div>
  );
};
