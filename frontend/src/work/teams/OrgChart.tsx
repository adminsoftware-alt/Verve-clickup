import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown, Download, FileSpreadsheet, FileText, List as ListIcon, Maximize, Minus, Network, Plus, Search } from 'lucide-react';
import { Avatar, Menu } from '../ui';
import { orgChartTableExcel, orgChartTablePdf, orgChartTreeExcel, orgChartTreePdf } from './exportOrgChart';
import { personName, type Person } from './peopleApi';
import { LEVEL_NAMES, LEVELS, levelLabel, levelTag } from './levels';
import { useHub, useScope } from './TeamsHub';

interface Node { person: Person; children: Node[] }

/** Senior first, then by name: people at the same level sit together under their manager. */
const byLevel = (a: Person, b: Person) => (a.level ?? 99) - (b.level ?? 99) || personName(a).localeCompare(personName(b));

/** One colour per level, L1 darkest, so a level reads at a glance across the whole chart. */
const LEVEL_STYLE: Record<number, string> = {
  1: 'bg-teal-800 text-white', 2: 'bg-teal-600 text-white', 3: 'bg-teal-100 text-teal-800',
  4: 'bg-sky-100 text-sky-800', 5: 'bg-gray-100 text-gray-700', 6: 'bg-amber-50 text-amber-800',
};
const LevelBadge: React.FC<{ level: number | null }> = ({ level }) => level == null ? null : (
  <span aria-label={levelLabel(level)} className={`mt-0.5 inline-block rounded-full px-1.5 text-[10px] font-semibold ${LEVEL_STYLE[level] ?? 'bg-gray-100 text-gray-600'}`}>
    {levelTag(level)} · {LEVEL_NAMES[level] ?? ''}
  </span>
);

/** Build reporting trees: anyone whose manager isn't in the set starts a tree. */
function build(people: Person[]): Node[] {
  const ids = new Set(people.map((p) => p.user.id));
  const kids = new Map<string, Person[]>();
  people.forEach((p) => { if (p.manager_id && ids.has(p.manager_id)) kids.set(p.manager_id, [...(kids.get(p.manager_id) ?? []), p]); });
  const make = (p: Person, seen: Set<string>): Node => ({
    person: p,
    children: seen.has(p.user.id) ? [] : (kids.get(p.user.id) ?? [])
      .sort(byLevel)
      .map((c) => make(c, new Set([...seen, p.user.id]))),
  });
  return people
    .filter((p) => !p.manager_id || !ids.has(p.manager_id))
    .sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || (kids.get(b.user.id)?.length ?? 0) - (kids.get(a.user.id)?.length ?? 0) || personName(a).localeCompare(personName(b)))
    .map((p) => make(p, new Set()));
}

type BoxProps = { node: Node; collapsed: Set<string>; toggle: (id: string) => void; match: string; onOpen: (id: string) => void };

/** One person: photo, name and designation side by side, and the count of their reports below. */
const Card: React.FC<BoxProps> = ({ node, collapsed, toggle, match, onOpen }) => {
  const p = node.person;
  const closed = collapsed.has(p.user.id);
  const hit = !!match && `${personName(p)} ${p.designation ?? ''}`.toLowerCase().includes(match);
  return (
    <div className={`org-card relative flex w-52 items-center gap-2.5 rounded-xl border bg-white px-2.5 py-2 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${hit ? 'border-amber-400 ring-2 ring-amber-200' : 'border-[#E4E8F0]'}`}>
      <button type="button" onClick={() => onOpen(p.user.id)} className="flex min-w-0 flex-1 items-center gap-2.5" aria-label={`Open ${personName(p)}`}>
        <Avatar user={p.user} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-gray-900">{personName(p)}</span>
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[11px] text-gray-500">{p.designation || '—'}</span>
            <LevelBadge level={p.level} />
          </span>
        </span>
      </button>
      {node.children.length > 0 && (
        <button type="button" onClick={() => toggle(p.user.id)} aria-label={closed ? `Show ${personName(p)}'s reports` : `Hide ${personName(p)}'s reports`}
          className="absolute -bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-[#D9E1EF] bg-white px-1.5 text-[10px] font-semibold tabular-nums text-[#234788] hover:bg-[#EEF2F8]">
          {node.children.length} {closed ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
        </button>
      )}
    </div>
  );
};

/** A person and, under them, their reports. People with no reports of their own are stacked in
 *  one column under their manager rather than spread in a row: a team of nine juniors was nine
 *  cards wide, which is what pushed the chart off the side of the screen. */
const Box: React.FC<BoxProps> = (props) => {
  const { node, collapsed } = props;
  const closed = collapsed.has(node.person.user.id);
  const kids = node.children;
  const stack = kids.length >= 3 && kids.every((c) => c.children.length === 0);
  return (
    <li className="org-node">
      <Card {...props} />
      {!closed && kids.length > 0 && (stack ? (
        <ul className="org-stack">
          <li>
            <div className="org-stack-box">
              {kids.map((c) => <Card key={c.person.user.id} {...props} node={c} />)}
            </div>
          </li>
        </ul>
      ) : (
        <ul>{kids.map((c) => <Box key={c.person.user.id} {...props} node={c} />)}</ul>
      ))}
    </li>
  );
};

/** The tree on a canvas you move around rather than scroll: drag to pan, Ctrl + scroll (or the
 *  buttons) to zoom, and Fit to bring the whole chart into view -- which is how it opens. */
const Canvas: React.FC<{ fitKey: string; children: React.ReactNode; onExpandAll: () => void; onCollapseAll: () => void }> = ({ fitKey, children, onExpandAll, onCollapseAll }) => {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 24, z: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const fit = useCallback(() => {
    const f = frame.current, c = content.current;
    if (!f || !c) return;
    const w = c.offsetWidth, h = c.offsetHeight;
    const z = Math.max(0.3, Math.min(1, (f.clientWidth - 48) / w, (f.clientHeight - 48) / h));
    setView({ x: (f.clientWidth - w * z) / 2, y: Math.max(24, (f.clientHeight - h * z) / 2), z });
  }, []);
  useLayoutEffect(() => { fit(); }, [fit, fitKey]);

  /** Zoom by a factor around a point of the canvas, so what is under the pointer stays put. */
  const zoomAt = (factor: number, px?: number, py?: number) => setView((v) => {
    const f = frame.current;
    const cx = px ?? (f ? f.clientWidth / 2 : 0), cy = py ?? (f ? f.clientHeight / 2 : 0);
    const z = Math.max(0.3, Math.min(1.5, v.z * factor));
    return { z, x: cx - ((cx - v.x) * z) / v.z, y: cy - ((cy - v.y) * z) / v.z };
  });
  // Ctrl + scroll (or a trackpad pinch) zooms; a plain scroll is left to the page, so scrolling
  // down past the chart never gets caught in it. Moving the chart is a drag. Not passive, so the
  // zoom does not also zoom the browser.
  useEffect(() => {
    const f = frame.current;
    if (!f) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = f.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    };
    f.addEventListener('wheel', onWheel, { passive: false });
    return () => f.removeEventListener('wheel', onWheel);
  }, []);

  const tool = 'flex h-8 w-8 items-center justify-center text-gray-600 hover:bg-[#EEF2F8] hover:text-[#234788]';
  return (
    <div ref={frame} aria-label="Org chart"
      className={`org-canvas relative h-[calc(100vh-210px)] min-h-[420px] overflow-hidden rounded-xl border border-[#E4E8F0] ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button, a, input')) return;
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
      }}
      onPointerUp={() => { drag.current = null; setDragging(false); }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}>
      <div ref={content} className="org-chart absolute left-0 top-0 inline-block text-center"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: '0 0' }}>
        {children}
      </div>

      {/* The tools, where a drawing tool keeps them: a small bar in the corner of the canvas. */}
      <div className="absolute bottom-3 right-3 flex items-center overflow-hidden rounded-lg border border-[#E4E8F0] bg-white shadow-[0_4px_12px_-4px_rgba(16,24,40,0.15)]">
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.15)} className={tool}><Minus size={14} /></button>
        <span className="w-12 text-center text-xs tabular-nums text-gray-600">{Math.round(view.z * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.15)} className={tool}><Plus size={14} /></button>
        <span className="h-5 w-px bg-[#E4E8F0]" />
        <button type="button" aria-label="Fit to screen" onClick={fit} className={`${tool} w-auto gap-1.5 px-2.5 text-xs font-medium`}><Maximize size={13} /> Fit</button>
        <span className="h-5 w-px bg-[#E4E8F0]" />
        <button type="button" aria-label="Expand all" onClick={onExpandAll} className={tool}><ChevronsUpDown size={14} /></button>
        <button type="button" aria-label="Collapse all" onClick={onCollapseAll} className={tool}><ChevronsDownUp size={14} /></button>
      </div>
      <p className="pointer-events-none absolute bottom-4 left-4 text-[11px] text-gray-400">Drag to move · Ctrl + scroll to zoom</p>
    </div>
  );
};

type Layout = 'tree' | 'table';
const LAYOUT_KEY = 'timetriq.orgLayout';

/** ClickUp's Org Chart, built from each person's reporting manager: as a tree, or as a table
 *  for when the question is "who reports to whom" across more people than fit on a screen. */
const BRANCH = '__branch';

export const OrgChart: React.FC<{ people?: Person[]; embedded?: boolean }> = ({ people: only, embedded }) => {
  const hub = useHub();
  const scope = useScope();
  // A Manager's chart is their own team, as on "My team"; an admin's is the firm.
  const everyone = useMemo(
    () => only ?? (scope.ids ? hub.people.filter((p) => scope.ids!.has(p.user.id)) : hub.people),
    [only, scope, hub.people],
  );
  const byId = useMemo(() => new Map(hub.people.map((p) => [p.user.id, p])), [hub.people]);
  // A Manager's chart opens on their own branch: them, and everyone who reports to them however far
  // down -- the people they answer for -- rather than the whole team they sit in. Admins see the firm.
  const branch = useMemo(() => {
    if (only || !scope.ids) return null;
    const under = new Set([hub.me]);
    for (let grew = true; grew;) {
      grew = false;
      hub.people.forEach((p) => { if (p.manager_id && under.has(p.manager_id) && !under.has(p.user.id)) { under.add(p.user.id); grew = true; } });
    }
    return under.size > 1 ? under : null;
  }, [only, scope.ids, hub.me, hub.people]);
  // "" is everyone in reach, BRANCH the viewer's own branch. Narrowing to a Team keeps the reporting
  // lines that exist inside it -- someone whose manager is outside the Team starts a tree of their own.
  const [picked, setTeam] = useState<string | null>(null);
  const team = picked ?? (branch ? BRANCH : '');
  const [level, setLevel] = useState('');
  const people = useMemo(
    () => (team === BRANCH && branch ? hub.people.filter((p) => branch.has(p.user.id) && !p.deactivated_at) : everyone)
      .filter((p) => (!team || team === BRANCH || p.team_ids.includes(team)) && (!level || String(p.level) === level)),
    [everyone, team, level, branch, hub.people],
  );
  const trees = useMemo(() => build(people), [people]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [layout, setLayout] = useState<Layout>(() => { try { return localStorage.getItem(LAYOUT_KEY) === 'table' ? 'table' : 'tree'; } catch { return 'tree'; } });
  const pick = (l: Layout) => { setLayout(l); try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* ignore */ } };
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const match = q.trim().toLowerCase();
  // The tree highlights a search; the table narrows to it, which is what a table is for.
  const rows = useMemo(() => people
    .filter((p) => !match || `${personName(p)} ${p.user.email} ${p.designation ?? ''} ${p.department ?? ''}`.toLowerCase().includes(match))
    .sort(byLevel), [people, match]);
  const teamName = (id: string) => hub.teams.find((t) => t.id === id)?.name;
  const chartTitle = team === BRANCH ? 'Org chart: my branch' : team ? `Org chart: ${teamName(team) ?? 'Team'}` : 'Org chart';
  const sel = 'rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700';
  return (
    <div className={embedded ? '' : 'p-6'}>
      {!embedded && <h2 className="mb-1 text-lg font-semibold text-gray-900">Org chart</h2>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex rounded-md border border-gray-200 bg-white p-0.5" role="group" aria-label="Show the org chart as">
          <button type="button" aria-pressed={layout === 'tree'} onClick={() => pick('tree')} className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${layout === 'tree' ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-500'}`}><Network size={13} /> Tree</button>
          <button type="button" aria-pressed={layout === 'table'} onClick={() => pick('table')} className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${layout === 'table' ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-500'}`}><ListIcon size={13} /> Table</button>
        </span>
        {!only && (scope.teams.length > 0 || branch) && (
          <select aria-label="Show" value={team} onChange={(e) => { setTeam(e.target.value); setCollapsed(new Set()); }} className={sel}>
            {branch && <option value={BRANCH}>Me and everyone under me</option>}
            <option value="">{scope.ids ? 'My whole team' : 'The whole organisation'}</option>
            {/* A Manager who leads one Team would see it twice -- "My whole team" is that Team -- so
                the Teams are listed one by one only when there are several to choose between. */}
            {(!scope.ids || scope.teams.length > 1) && scope.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select aria-label="Level" value={level} onChange={(e) => { setLevel(e.target.value); setCollapsed(new Set()); }} className={sel}>
          <option value="">All levels</option>
          {LEVELS.map((n) => <option key={n} value={n}>{levelLabel(n)}</option>)}
        </select>
        <span className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1">
          <Search size={14} className="text-gray-400" />
          <input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value) setCollapsed(new Set()); }} placeholder="Find someone" aria-label="Find someone in the org chart" className="w-40 text-sm focus:outline-none" />
        </span>
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
        trees.length === 0 ? (
          <p className="rounded-xl border border-[#E4E8F0] bg-white p-10 text-center text-sm text-gray-400">{team ? 'Nobody is in that Team yet.' : 'Nobody here yet.'}</p>
        ) : (
          <Canvas fitKey={`${team}|${level}|${people.length}|${collapsed.size}`}
            onExpandAll={() => setCollapsed(new Set())}
            onCollapseAll={() => setCollapsed(new Set(people.filter((p) => people.some((c) => c.manager_id === p.user.id)).map((p) => p.user.id)))}>
            <ul>{trees.map((t) => <Box key={t.person.user.id} node={t} collapsed={collapsed} toggle={toggle} match={match} onOpen={hub.openPerson} />)}</ul>
          </Canvas>
        )
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[760px] text-sm" aria-label="Org chart table">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500">
              <tr>
                <th className="px-3 py-2">Name</th><th className="px-3 py-2">Level</th><th className="px-3 py-2">Designation</th><th className="px-3 py-2">Department</th>
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
                    <td className="px-3 py-2">{p.level != null ? <LevelBadge level={p.level} /> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-700">{p.designation ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-700">{p.department ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-700">{boss ? personName(boss) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">{p.team_ids.map((id) => { const name = teamName(id); return name ? <span key={id} className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">{name}</span> : null; })}</span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={6}className="px-3 py-10 text-center text-sm text-gray-400">{people.length ? 'Nobody matches.' : team ? 'Nobody is in that Team yet.' : 'Nobody here yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
