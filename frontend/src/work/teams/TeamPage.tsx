import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Crown, Folder, List as ListIcon, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useWork } from '../WorkContext';
import type { FolderNode, SpaceNode } from '../api';
import { Avatar, StatusDot } from '../ui';
import { describeActivity } from '../task/TaskFeed';
import { TeamView } from '../views/TeamView';
import { peopleApi, personName, type TeamLocation, type TeamOverview } from './peopleApi';
import { OrgChart } from './OrgChart';
import { TeamBadge, useHub } from './TeamsHub';

type Tab = 'overview' | 'work' | 'members' | 'chart';

const ago = (iso: string) => {
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.floor(m)}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const Card: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, action, children, className }) => (
  <section className={`rounded-xl border border-gray-200 bg-white p-4 ${className ?? ''}`} aria-label={title}>
    <div className="mb-2 flex items-center"><h3 className="text-sm font-semibold text-gray-800">{title}</h3><span className="ml-auto">{action}</span></div>
    {children}
  </section>
);

/** ClickUp's team overview: who's in the team, where it works, what it's doing. */
export const TeamPage: React.FC = () => {
  const { id = '' } = useParams();
  const { people, me, isAdmin, reload, openPerson } = useHub();
  const { hierarchy, locate } = useWork();
  const navigate = useNavigate();
  const [data, setData] = useState<TeamOverview | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState('');
  const [adding, setAdding] = useState(false);
  const [addingPlace, setAddingPlace] = useState(false);
  const load = useCallback(() => peopleApi.overview(id).then(setData).catch((e) => setError(e.message)), [id]);
  useEffect(() => { setData(null); setTab('overview'); load(); }, [load]);

  const team = data?.team;
  const isLead = !!team?.lead_ids.includes(me);
  const canDescribe = isAdmin || isLead;
  const memberPeople = useMemo(() => people.filter((p) => team?.members.some((u) => u.id === p.user.id)), [people, team]);
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try { await action(); await load(); await reload(); } catch (e) { setError((e as Error).message); }
  };
  const setMembers = (ids: string[], leads: string[]) => run(() => peopleApi.setMembers(id, ids, leads));

  // Places the team works in, as links; offered from the sidebar tree.
  const places = useMemo(() => {
    const out: { key: string; loc: TeamLocation; label: string }[] = [];
    const walk = (n: SpaceNode | FolderNode, path: string[]) => {
      n.folders.forEach((f) => { out.push({ key: f.id, loc: { kind: 'folder', id: f.id }, label: [...path, f.name].join(' / ') }); walk(f, [...path, f.name]); });
      n.lists.forEach((l) => out.push({ key: l.id, loc: { kind: 'list', id: l.id }, label: [...path, l.name].join(' / ') }));
    };
    hierarchy?.spaces.forEach((sp) => { out.push({ key: sp.id, loc: { kind: 'space', id: sp.id }, label: sp.name }); walk(sp, [sp.name]); });
    return out;
  }, [hierarchy]);

  if (error && !data) return <p className="m-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!team || !data) return <p className="p-10 text-center text-sm text-gray-400">Loading…</p>;
  const leads = new Set(team.lead_ids);
  const open = data.tasks.filter((t) => t.status.group !== 'done' && t.status.group !== 'closed');
  const overdue = open.filter((t) => t.is_overdue).length;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const doneWeek = data.tasks.filter((t) => { const w = t.date_done || t.date_closed; return w && new Date(w).getTime() > weekAgo; }).length;
  const memberIds = team.members.map((u) => u.id);
  const locName = (l: TeamLocation) => places.find((p) => p.key === l.id)?.label ?? locate(l.kind, l.id)?.node.name;

  const tabs: [Tab, string][] = [['overview', 'Overview'], ['work', 'Work'], ['members', `Members (${team.members.length})`], ['chart', 'Org chart']];
  return (
    <div className="p-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <TeamBadge team={team} size={44} />
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
            {team.name}
            {isAdmin && <button type="button" title="Rename team" onClick={() => { const n = window.prompt('Team name', team.name); if (n && n.trim() !== team.name) run(() => peopleApi.updateTeam(id, { name: n.trim() })); }} className="text-gray-300 hover:text-gray-600"><Pencil size={14} /></button>}
          </h2>
          <p className="text-sm text-gray-500">{team.handle ? `@${team.handle} · ` : ''}{team.members.length} member{team.members.length === 1 ? '' : 's'}</p>
        </div>
        <span className="ml-auto flex gap-2">
          {isAdmin && <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"><Plus size={14} /> Add member</button>}
          {isAdmin && (
            <button type="button" title="Delete team" onClick={() => { if (window.confirm(`Delete the team “${team.name}”? Its members stay in the workspace; things shared with the team lose that sharing.`)) run(() => peopleApi.deleteTeam(id)).then(() => navigate('/people/teams')); }}
              className="rounded-md border border-gray-200 p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>
          )}
        </span>
      </header>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <nav className="mb-4 flex gap-5 border-b border-gray-200" aria-label="Team tabs">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 pb-2 text-sm ${tab === k ? 'border-indigo-600 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{label}</button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title="About" action={canDescribe && !editingDesc && <button type="button" onClick={() => { setDesc(team.description ?? ''); setEditingDesc(true); }} className="text-xs text-indigo-600 hover:underline">Edit</button>}>
              {editingDesc ? (
                <>
                  <textarea aria-label="Team description" autoFocus rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" onClick={() => setEditingDesc(false)} className="rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">Cancel</button>
                    <button type="button" onClick={() => run(() => peopleApi.updateTeam(id, { description: desc.trim() || null })).then(() => setEditingDesc(false))} className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white">Save</button>
                  </div>
                </>
              ) : <p className="whitespace-pre-wrap text-sm text-gray-700">{team.description || <span className="text-gray-400">No description yet.</span>}</p>}
            </Card>
            <div className="grid grid-cols-3 gap-3" aria-label="Team numbers">
              {[[open.length, 'Open tasks', 'text-gray-900'], [overdue, 'Overdue', overdue ? 'text-red-600' : 'text-gray-900'], [doneWeek, 'Done this week', 'text-emerald-700']].map(([n, label, cls]) => (
                <div key={label as string} className="rounded-xl border border-gray-200 bg-white p-3 text-center">
                  <p className={`text-2xl font-semibold ${cls}`}>{n}</p><p className="text-xs text-gray-500">{label}</p>
                </div>
              ))}
            </div>
            <Card title="Recent activity">
              {data.feed.length === 0 ? <p className="text-sm text-gray-400">Nothing yet. Activity on tasks assigned to the team's members shows here.</p> : (
                <ul className="space-y-2" aria-label="Team feed">
                  {data.feed.slice(0, 25).map((f) => (
                    <li key={f.id} className="flex items-start gap-2 text-sm">
                      {f.user ? <Avatar user={f.user} size={22} /> : <span className="h-[22px] w-[22px] rounded-full bg-gray-200" />}
                      <span className="min-w-0 flex-1">
                        <span className="text-gray-800"><b className="font-medium">{f.user ? personName(f.user) : 'Someone'}</b> {describeActivity({ ...f }, (uid) => personName(people.find((p) => p.user.id === uid) ?? null) || 'someone')}</span>
                        <Link to={`/l/${f.task.list_id}?task=${f.task.id}`} className="flex items-center gap-1 truncate text-xs text-indigo-700 no-underline hover:underline">
                          {f.task.status && <StatusDot status={f.task.status} size={9} />}{f.task.name}
                        </Link>
                      </span>
                      <span className="shrink-0 text-xs text-gray-400">{ago(f.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Members" action={<button type="button" onClick={() => setTab('members')} className="text-xs text-indigo-600 hover:underline">View all</button>}>
              <ul className="space-y-1.5">
                {team.members.slice(0, 8).map((u) => {
                  const p = people.find((x) => x.user.id === u.id);
                  return (
                    <li key={u.id}>
                      <button type="button" onClick={() => openPerson(u.id)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-gray-50">
                        <Avatar user={u} size={24} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm text-gray-800">{personName(u)}</span><span className="block truncate text-[11px] text-gray-400">{p?.designation ?? ''}</span></span>
                        {leads.has(u.id) && <span className="flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700"><Crown size={10} /> Lead</span>}
                      </button>
                    </li>
                  );
                })}
                {team.members.length === 0 && <li className="text-sm text-gray-400">No members yet.</li>}
              </ul>
            </Card>
            <Card title="Where the team works" action={canDescribe && <button type="button" onClick={() => setAddingPlace(true)} className="text-xs text-indigo-600 hover:underline">Add</button>}>
              {team.locations.length === 0 ? <p className="text-sm text-gray-400">Pin the Spaces, Folders or Lists this team works in.</p> : (
                <ul className="space-y-1">
                  {team.locations.map((l) => (
                    <li key={l.id} className="group flex items-center gap-2 text-sm">
                      {l.kind === 'space' ? <span className="h-4 w-4 rounded bg-indigo-500" /> : l.kind === 'folder' ? <Folder size={15} className="text-gray-400" /> : <ListIcon size={15} className="text-gray-400" />}
                      <Link to={`/${l.kind === 'space' ? 's' : l.kind === 'folder' ? 'f' : 'l'}/${l.id}`} className="min-w-0 flex-1 truncate text-indigo-700 no-underline hover:underline">{locName(l) ?? 'A place you can\'t open'}</Link>
                      {canDescribe && <button type="button" title="Unpin" onClick={() => run(() => peopleApi.updateTeam(id, { locations: team.locations.filter((x) => x.id !== l.id) }))} className="text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100"><X size={13} /></button>}
                    </li>
                  ))}
                </ul>
              )}
              {addingPlace && (
                <select autoFocus aria-label="Pin a place" defaultValue="" onBlur={() => setAddingPlace(false)}
                  onChange={(e) => { const p = places.find((x) => x.key === e.target.value); setAddingPlace(false); if (p) run(() => peopleApi.updateTeam(id, { locations: [...team.locations, p.loc] })); }}
                  className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm">
                  <option value="" disabled>Choose a Space, Folder or List…</option>
                  {places.filter((p) => !team.locations.some((l) => l.id === p.key)).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === 'work' && (
        <div className="-mx-6 -mt-4"><TeamView tasks={data.tasks.filter((t) => t.assignees.some((a) => memberIds.includes(a.id)))} people={team.members} listName={(lid) => locate('list', lid)?.node.name ?? null}
          onOpenTask={(tid) => { const t = data.tasks.find((x) => x.id === tid); if (t) navigate(`/l/${t.list_id}?task=${tid}`); }} /></div>
      )}

      {tab === 'members' && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm" aria-label="Team members">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Designation</th><th className="px-3 py-2">Team lead</th><th className="px-3 py-2" /></tr></thead>
            <tbody>
              {team.members.map((u) => {
                const p = people.find((x) => x.user.id === u.id);
                return (
                  <tr key={u.id} className="border-t border-gray-100">
                    <td className="px-3 py-2"><button type="button" onClick={() => openPerson(u.id)} className="flex items-center gap-2 hover:underline"><Avatar user={u} size={24} />{personName(u)}</button></td>
                    <td className="px-3 py-2 text-gray-600">{p?.designation ?? '—'}</td>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Lead: ${personName(u)}`} disabled={!isAdmin} checked={leads.has(u.id)}
                        onChange={(e) => setMembers(memberIds, e.target.checked ? [...team.lead_ids, u.id] : team.lead_ids.filter((x) => x !== u.id))} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isAdmin && <button type="button" title={`Remove ${personName(u)} from the team`} onClick={() => setMembers(memberIds.filter((x) => x !== u.id), team.lead_ids.filter((x) => x !== u.id))} className="text-gray-300 hover:text-red-600"><X size={15} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">Team leads see their team's dashboards and tracked time, and can assign Lists to people in their team.</p>
        </div>
      )}

      {tab === 'chart' && <OrgChart people={memberPeople} embedded />}

      {adding && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={() => setAdding(false)}>
          <div role="dialog" aria-label="Add members" onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[80vh] w-[26rem] flex-col rounded-xl bg-white p-5 shadow-xl">
            <h3 className="mb-2 font-semibold text-gray-900">Add members to {team.name}</h3>
            <ul className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200">
              {people.filter((p) => !memberIds.includes(p.user.id)).map((p) => (
                <li key={p.user.id}>
                  <button type="button" onClick={() => setMembers([...memberIds, p.user.id], team.lead_ids)} className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-1.5 text-left text-sm first:border-t-0 hover:bg-gray-50">
                    <Avatar user={p.user} size={22} /><span className="min-w-0 flex-1 truncate">{personName(p)}</span><span className="text-xs text-gray-400">{p.designation ?? ''}</span><Plus size={14} className="text-indigo-600" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end"><button type="button" onClick={() => setAdding(false)} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Done</button></div>
          </div>
        </div>
      )}
    </div>
  );
};
