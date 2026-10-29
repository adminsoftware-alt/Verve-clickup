// On a phone: whose Dashboard, Tasks or Timesheet you are looking at, switched at the top of the page.
//
// The bottom bar has four tabs -- Dashboard, Tasks, Timesheet, Spaces -- the same for everybody.
// What differs by role is *whose* work a tab shows, and that is this bar:
//
//   Employee  no bar: it is always their own.
//   Manager   Mine | Team (a Team picker when they lead more than one).
//   Admin     Dashboard: Company | Team | Person.  Tasks and Timesheet: Mine | Everyone.
//
// A bar rather than a pop-up on every tap of the tab: the tab opens where you were last (see
// `lastFor`), and changing whose work it is is one tap away when you want to.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';

import { dashApi, type DashboardSummary } from '../work/dashboards/api';
import { useWork } from '../work/WorkContext';

export type Section = 'dashboard' | 'tasks' | 'timesheet' | 'spaces';

interface Choice { key: string; label: string; to?: string; pick?: { label: string; to: string }[] }

const KEY = 'verve.mobile.last';

/** Which tab a path belongs to. */
export function sectionOf(path: string): Section | null {
  if (path === '/' || path.startsWith('/dashboards')) return 'dashboard';
  if (path.startsWith('/my-tasks') || path.startsWith('/all-tasks') || path.startsWith('/team-tasks')) return 'tasks';
  if (path.startsWith('/timesheets')) return 'timesheet';
  if (path.startsWith('/spaces') || path.startsWith('/s/') || path.startsWith('/f/') || path.startsWith('/l/')) return 'spaces';
  return null;
}

/** Where a tab was left, so tapping it again goes back there. */
export function lastFor(section: Section): string | null {
  try { return (JSON.parse(window.localStorage.getItem(KEY) || '{}') as Record<string, string>)[section] ?? null; } catch { return null; }
}
function remember(section: Section, path: string) {
  try {
    const all = JSON.parse(window.localStorage.getItem(KEY) || '{}') as Record<string, string>;
    window.localStorage.setItem(KEY, JSON.stringify({ ...all, [section]: path }));
  } catch { /* a private window: the tab just opens on its default */ }
}

// The Dashboards list, fetched once per session for the bar and the tab.
let boardsCache: { ws: string; boards: Promise<DashboardSummary[]> } | null = null;
function useBoards(): DashboardSummary[] {
  const { workspace } = useWork();
  const [boards, setBoards] = useState<DashboardSummary[]>([]);
  useEffect(() => {
    if (!workspace) return;
    if (!boardsCache || boardsCache.ws !== workspace.id) boardsCache = { ws: workspace.id, boards: dashApi.list(workspace.id).catch(() => []) };
    let live = true;
    boardsCache.boards.then((b) => { if (live) setBoards(b); });
    return () => { live = false; };
  }, [workspace]);
  return boards;
}

/** Who you are, for the bar: an admin, a manager (with the Teams they lead), or neither. */
function useRole() {
  const { hierarchy, teams, me } = useWork();
  const isAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
  const led = teams.filter((t) => t.lead_ids.includes(me));
  return { isAdmin, led, me };
}

/** The tab's own address: where it was left, else where it starts for this role. */
export function useTabTarget(section: Section): string {
  const { isAdmin } = useRole();
  const boards = useBoards();
  const company = boards.find((b) => b.standard === 'company');
  const start: Record<Section, string> = {
    // An admin has no personal board; the Company one is theirs.
    dashboard: isAdmin ? (company ? `/dashboards/${company.id}` : '/dashboards') : '/',
    tasks: '/my-tasks',
    timesheet: '/timesheets',
    spaces: '/spaces',
  };
  // Spaces always opens on the tree: it is how you get anywhere, not a place in itself.
  return section === 'spaces' ? start.spaces : lastFor(section) ?? start[section];
}

function useChoices(section: Section): Choice[] {
  const { isAdmin, led, me } = useRole();
  const { members } = useWork();
  const boards = useBoards();
  return useMemo(() => {
    if (!isAdmin && led.length === 0) return [];  // an Employee: always their own
    const teamBoards = boards.filter((b) => b.standard === 'team' && (isAdmin || led.some((t) => t.id === b.team?.id)));
    const teamChoice = (label: string): Choice | null => {
      if (!teamBoards.length) return null;
      if (teamBoards.length === 1) return { key: 'team', label, to: `/dashboards/${teamBoards[0].id}` };
      return { key: 'team', label, pick: teamBoards.map((b) => ({ label: b.team?.name ?? b.name, to: `/dashboards/${b.id}` })) };
    };
    if (section === 'dashboard') {
      if (isAdmin) {
        const company = boards.find((b) => b.standard === 'company');
        return [
          ...(company ? [{ key: 'company', label: 'Company', to: `/dashboards/${company.id}` }] : []),
          ...[teamChoice('Team')].filter((c): c is Choice => !!c),
          {
            key: 'person', label: 'Person',
            pick: members.filter((m) => m.user.id !== me && !m.deactivated)
              .map((m) => ({ label: m.user.display_name || m.user.email, to: `/dashboards/people/${m.user.id}` }))
              .sort((a, b) => a.label.localeCompare(b.label)),
          },
        ];
      }
      return [{ key: 'mine', label: 'My dashboard', to: '/' }, ...[teamChoice('Team')].filter((c): c is Choice => !!c)];
    }
    if (section === 'tasks') {
      return isAdmin
        ? [{ key: 'mine', label: 'Mine', to: '/my-tasks' }, { key: 'all', label: 'Everyone', to: '/all-tasks' }]
        : [{ key: 'mine', label: 'Mine', to: '/my-tasks' }, { key: 'team', label: 'Team', to: '/team-tasks' }];
    }
    if (section === 'timesheet') {
      return isAdmin
        ? [{ key: 'mine', label: 'Mine', to: `/timesheets/people/${me}` }, { key: 'all', label: 'Everyone', to: '/timesheets' }]
        : [{ key: 'mine', label: 'Mine', to: '/timesheets' }, { key: 'team', label: 'Team', to: '/timesheets/all' }];
    }
    return [];
  }, [section, isAdmin, led, me, members, boards]);
}

/** How well a choice matches the page: exact beats a prefix, a longer prefix beats a shorter. */
const fit = (c: Choice, path: string): number => {
  if (c.pick?.some((p) => p.to === path) || c.to === path) return 10_000;
  return c.to && c.to !== '/' && path.startsWith(`${c.to}/`) ? c.to.length : -1;
};

/** The switch, phone only. Renders nothing for an Employee or off a tab's pages. */
export const MobileScopeBar: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const section = sectionOf(pathname);
  // Every page a tab shows is remembered, so the tab reopens it.
  useEffect(() => { if (section) remember(section, pathname); }, [section, pathname]);
  const choices = useChoices(section ?? 'spaces');
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  if (!section || choices.length < 2) return null;
  const best = Math.max(...choices.map((c) => fit(c, pathname)));
  const active = best >= 0 ? choices.find((c) => fit(c, pathname) === best)?.key : undefined;

  return (
    <div ref={bar} className="no-print relative z-[6] border-b border-gray-200 bg-white px-3 py-2 md:hidden">
      <div role="tablist" aria-label="Whose work" className="flex rounded-xl bg-gray-100 p-1">
        {choices.map((c) => {
          const on = c.key === active;
          const picked = c.pick?.find((p) => p.to === pathname)?.label;
          const cls = `flex flex-1 items-center justify-center gap-1 truncate rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors ${
            on ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-600'}`;
          return c.pick ? (
            <button key={c.key} type="button" role="tab" aria-selected={on} aria-haspopup="listbox" aria-expanded={open === c.key}
              onClick={() => setOpen(open === c.key ? null : c.key)} className={cls}>
              <span className="truncate">{on && picked ? picked : c.label}</span><ChevronDown size={13} className="shrink-0" />
            </button>
          ) : (
            <Link key={c.key} to={c.to!} role="tab" aria-selected={on} className={`${cls} no-underline`}>{c.label}</Link>
          );
        })}
      </div>
      {open && (() => {
        const c = choices.find((x) => x.key === open);
        if (!c?.pick) return null;
        return (
          <ul role="listbox" aria-label={c.label}
            className="absolute inset-x-3 top-full z-10 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-xl">
            {c.pick.map((p) => (
              <li key={p.to}>
                <button type="button" role="option" aria-selected={p.to === pathname}
                  onClick={() => { setOpen(null); navigate(p.to); }}
                  className={`block w-full truncate px-4 py-2.5 text-left text-sm ${p.to === pathname ? 'bg-brand-50 font-medium text-brand-800' : 'text-gray-800 hover:bg-gray-50'}`}>
                  {p.label}
                </button>
              </li>
            ))}
            {c.pick.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">Nothing to show yet.</li>}
          </ul>
        );
      })()}
    </div>
  );
};
