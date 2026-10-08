import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Minus, Plus, Search } from 'lucide-react';
import { Avatar } from '../ui';
import { personName, type Person } from './peopleApi';
import { useHub } from './TeamsHub';

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
          {p.pending && <span className="mt-0.5 rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-800">Pending</span>}
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

/** ClickUp's Org Chart, built from each person's reporting manager. */
export const OrgChart: React.FC<{ people?: Person[]; embedded?: boolean }> = ({ people: only, embedded }) => {
  const hub = useHub();
  const everyone = only ?? hub.people;
  // "" is the whole firm. Narrowing to a Team keeps the reporting lines that exist inside it --
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
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const unmanaged = people.filter((p) => !p.manager_id).length;
  return (
    <div className={embedded ? '' : 'p-6'}>
      {!embedded && <h2 className="mb-1 text-lg font-semibold text-gray-900">Org chart</h2>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!only && hub.teams.length > 0 && (
          <select
            aria-label="Show" value={team} onChange={(e) => { setTeam(e.target.value); setCollapsed(new Set()); }}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700"
          >
            <option value="">The whole organisation</option>
            {hub.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <span className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1">
          <Search size={14} className="text-gray-400" />
          <input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value) setCollapsed(new Set()); }} placeholder="Find someone" aria-label="Find someone in the org chart" className="w-40 text-sm focus:outline-none" />
        </span>
        <span className="flex items-center rounded-md border border-gray-200 bg-white">
          <button type="button" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} className="p-1.5 text-gray-500 hover:bg-gray-50"><Minus size={14} /></button>
          <span className="w-12 text-center text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
          <button type="button" title="Zoom in" onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))} className="p-1.5 text-gray-500 hover:bg-gray-50"><Plus size={14} /></button>
        </span>
        <button type="button" onClick={() => setCollapsed(new Set())} className="text-xs text-brand-600 hover:underline">Expand all</button>
        <span className="text-xs text-gray-400">{people.length} {people.length === 1 ? 'person' : 'people'}</span>
        {unmanaged > 1 && <span className="text-xs text-gray-400">{unmanaged} have no reporting manager set — set it in their profile.</span>}
      </div>
      <div className="overflow-auto rounded-xl border border-gray-200 bg-white p-6" aria-label="Org chart">
        <div className="org-chart inline-block min-w-full text-center" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
          {trees.length === 0 ? <p className="text-sm text-gray-400">{team ? 'Nobody is in that Team yet.' : 'Nobody here yet.'}</p> : (
            <ul>{trees.map((t) => <Box key={t.person.user.id} node={t} collapsed={collapsed} toggle={toggle} match={q.trim().toLowerCase()} onOpen={hub.openPerson} />)}</ul>
          )}
        </div>
      </div>
    </div>
  );
};
