import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, FileSpreadsheet, FileText, List as ListIcon, Minus, Network, Plus, Search } from 'lucide-react';
import { Avatar, Menu } from '../ui';
import { orgChartTableExcel, orgChartTablePdf, orgChartTreeExcel, orgChartTreePdf } from './exportOrgChart';
import { personName, type Person } from './peopleApi';
import { useHub, useScope } from './TeamsHub';

interface Node { person: Person; children: Node[] }

/** Build reporting trees: anyone whose manager isn't in the set starts a tree. */
function build(people: Person[]): Node[] {
  const ids = new Set(people.map((p) => p.user.id));
  const kids = new Map<string, Person[]>();
  people.forEach((p) => { if (p.manager_id && ids.has(p.manager_id)) kids.set(p.manager_id, [...(kids.get(p.manager_id) ?? []), p]); });
  const make = (p: Person, seen: Set<string>): Node => ({
    person: p,
    children: seen.has(p.user.id) ? [] : (kids.get(p.user.id) ?? [])
      .sort((a, b) => personName(a).localeCompare(personName(b)))
      .map((c) => make(c, new Set([...seen, p.user.id]))),
  });
  return people
    .filter((p) => !p.manager_id || !ids.has(p.manager_id))
    .sort((a, b) => (kids.get(b.user.id)?.length ?? 0) - (kids.get(a.user.id)?.length ?? 0) || personName(a).localeCompare(personName(b)))
    .map((p) => make(p, new Set()));
}

const Box: React.FC<{ node: Node; collapsed: Set<string>; toggle: (id: string) => void; match: string; onOpen: (id: string) => void }> = ({ node, collapsed, toggle, match, onOpen }) => {
  const p = node.person;
  const closed = collapsed.has(p.user.id);
  const hit = !!match && `${personName(p)} ${p.designation ?? ''}`.toLowerCase().includes(match);
  return (
    <li className="org-node">
      <div className={`relative mx-2 inline-flex w-44 flex-col items-center rounded-xl border bg-white px-3 py-2.5 text-center shadow-sm ${hit ? 'border-amber-400 ring-2 ring-amber-200' : 'border-gray-200'}`}>
        <button type="button" onClick={() => onOpen(p.user.id)} className="flex flex-col items-center" aria-label={`Open ${personName(p)}`}>
          <Avatar user={p.user} size={34} />
          <span className="mt-1 w-40 truncate text-sm font-semibold text-gray-900">{personName(p)}</span>
          <span className="w-40 truncate text-[11px] text-gray-500">{p.designation || '—'}</span>
          {p.level != null && (
            <span className="mt-0.5 rounded-full bg-gray-100 px-1.5 text-[10px] font-medium text-gray-600">Level {p.level}</span>
          )}
        </button>
        {node.children.length > 0 && (
          <button type="button" onClick={() => toggle(p.user.id)} aria-label={closed ? `Show ${personName(p)}'s reports` : `Hide ${personName(p)}'s reports`}
            className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-gray-200 bg-white px-1.5 text-[10px] text-gray-600 hover:bg-gray-50">
            {node.children.length} {closed ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
          </button>
        )}
      </div>
      {!closed && node.children.length > 0 && (
        <ul>{node.children.map((c) => <Box key={c.person.user.id} node={c} collapsed={collapsed} toggle={toggle} match={match} onOpen={onOpen} />)}</ul>
      )}
    </li>
  );
};

type Layout = 'tree' | 'table';
const LAYOUT_KEY = 'timetriq.orgLayout';

/** ClickUp's Org Chart, built from each person's reporting manager: as a tree, or as a table
 *  for when the question is "who reports to whom" across more people than fit on a screen. */
export const OrgChart: React.FC<{ people?: Person[]; embedded?: boolean }> = ({ people: only, embedded }) => {
  const hub = useHub();
  const scope = useScope();
  // A Manager's chart is their own team, as on "My team"; an admin's is the firm.
  const everyone = useMemo(
    () => only ?? (scope.ids ? hub.people.filter((p) => scope.ids!.has(p.user.id)) : hub.people),
    [only, scope, hub.people],
  );
  const byId = useMemo(() => new Map(hub.people.map((p) => [p.user.id, p])), [hub.people]);
  // "" is everyone in reach. Narrowing to a Team keeps the reporting lines that exist inside it --
  // someone whose manager is outside the Team simply starts a tree of their own.
  const [team, setTeam] = useState('');
  const people = useMemo(
    () => (team ? everyone.filter((p) => p.team_ids.includes(team)) : everyone),
    [everyone, team],
  );
  const trees = useMemo(() => build(people), [people]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [zoom, setZoom] = useState(1);
  const [layout, setLayout] = useState<Layout>(() => { try { return localStorage.getItem(LAYOUT_KEY) === 'table' ? 'table' : 'tree'; } catch { return 'tree'; } });
  const pick = (l: Layout) => { setLayout(l); try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* ignore */ } };
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const match = q.trim().toLowerCase();
  // The tree highlights a search; the table narrows to it, which is what a table is for.
  const rows = useMemo(() => people
    .filter((p) => !match || `${personName(p)} ${p.user.email} ${p.designation ?? ''} ${p.department ?? ''}`.toLowerCase().includes(match))
    .sort((a, b) => personName(a).localeCompare(personName(b))), [people, match]);
  const teamName = (id: string) => hub.teams.find((t) => t.id === id)?.name;
  const chartTitle = team ? `Org chart: ${teamName(team) ?? 'Team'}` : 'Org chart';
  const sel = 'rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700';
  return (
    <div className={embedded ? '' : 'p-6'}>
      {!embedded && <h2 className="mb-1 text-lg font-semibold text-gray-900">Org chart</h2>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex rounded-md border border-gray-200 bg-white p-0.5" role="group" aria-label="Show the org chart as">
          <button type="button" aria-pressed={layout === 'tree'} onClick={() => pick('tree')} className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${layout === 'tree' ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-500'}`}><Network size={13} /> Tree</button>
          <button type="button" aria-pressed={layout === 'table'} onClick={() => pick('table')} className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${layout === 'table' ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-500'}`}><ListIcon size={13} /> Table</button>
        </span>
        {!only && scope.teams.length > 0 && (
          <select aria-label="Show" value={team} onChange={(e) => { setTeam(e.target.value); setCollapsed(new Set()); }} className={sel}>
            <option value="">{scope.ids ? 'My whole team' : 'The whole organisation'}</option>
            {scope.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <span className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1">
          <Search size={14} className="text-gray-400" />
          <input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value) setCollapsed(new Set()); }} placeholder="Find someone" aria-label="Find someone in the org chart" className="w-40 text-sm focus:outline-none" />
        </span>
        {layout === 'tree' && (
          <>
            <span className="flex items-center rounded-md border border-gray-200 bg-white">
              <button aria-label="Zoom out" type="button" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} className="p-1.5 text-gray-500 hover:bg-gray-50"><Minus size={14} /></button>
              <span className="w-12 text-center text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
              <button aria-label="Zoom in" type="button" title="Zoom in" onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))} className="p-1.5 text-gray-500 hover:bg-gray-50"><Plus size={14} /></button>
            </span>
            <button type="button" onClick={() => setCollapsed(new Set())} className="text-xs text-brand-600 hover:underline">Expand all</button>
          </>
        )}
        {people.length > 0 && (
          <Menu
            label="Download the org chart"
            width={160}
            // Whatever is open is what downloads: the tree as a tree, the table as a table.
            items={[
              { label: 'Excel', icon: <FileSpreadsheet size={14} className="text-gray-400" />, onClick: () => (layout === 'tree' ? orgChartTreeExcel(trees) : orgChartTableExcel(people, { byId, teamName })) },
              { label: 'PDF', icon: <FileText size={14} className="text-gray-400" />, onClick: () => (layout === 'tree' ? orgChartTreePdf(trees, people.length, chartTitle) : orgChartTablePdf(people, { byId, teamName }, chartTitle)) },
            ]}
            trigger={<span className="flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"><Download size={14} /> Download</span>}
          />
        )}
      </div>
      {layout === 'tree' ? (
        <div className="overflow-auto rounded-xl border border-gray-200 bg-white p-6" aria-label="Org chart">
          <div className="org-chart inline-block min-w-full text-center" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
            {trees.length === 0 ? <p className="text-sm text-gray-400">{team ? 'Nobody is in that Team yet.' : 'Nobody here yet.'}</p> : (
              <ul>{trees.map((t) => <Box key={t.person.user.id} node={t} collapsed={collapsed} toggle={toggle} match={match} onOpen={hub.openPerson} />)}</ul>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[760px] text-sm" aria-label="Org chart table">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500">
              <tr>
                <th className="px-3 py-2">Name</th><th className="px-3 py-2">Designation</th><th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Reports to</th><th className="px-3 py-2">Teams</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const boss = p.manager_id ? byId.get(p.manager_id) : undefined;
                return (
                  <tr key={p.user.id} onClick={() => hub.openPerson(p.user.id)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2"><Avatar user={p.user} size={26} />
                        <span className="min-w-0 truncate font-medium text-gray-900">{personName(p)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{p.designation ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-700">{p.department ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-700">{boss ? personName(boss) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">{p.team_ids.map((id) => { const name = teamName(id); return name ? <span key={id} className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">{name}</span> : null; })}</span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={5}className="px-3 py-10 text-center text-sm text-gray-400">{people.length ? 'Nobody matches.' : team ? 'Nobody is in that Team yet.' : 'Nobody here yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
