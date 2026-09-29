// The pieces of the top bar: where you've just been, help, and who you're signed in as.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CircleHelp, Clock3, CornerDownLeft, List as ListIcon, LogOut, Settings, UserRound } from 'lucide-react';

import { useAuth } from './AuthContext';
import { useWork } from '../work/WorkContext';
import { Avatar, Portal } from '../work/ui';
import { recentItems, type RecentItem } from '../work/recent';
import type { FolderNode, SpaceNode } from '../work/api';

const item = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50';

/**
 * A top-bar dropdown. The panel is drawn in a portal and placed against the button, because the
 * header lives inside a pane that clips whatever overflows it -- which is what cut these menus off.
 * It never runs past the window: it stays on screen horizontally and scrolls inside if it is tall.
 */
const Dropdown: React.FC<{
  label: string;
  width: number;
  align?: 'left' | 'right';
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  onOpen?: () => void;
}> = ({ label, width, align = 'left', trigger, children, onOpen }) => {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const place = useCallback(() => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const left = align === 'right' ? rect.right - width : rect.left;
    setBox({
      top: rect.bottom + 6,
      left: Math.min(Math.max(margin, left), window.innerWidth - width - margin),
      maxHeight: window.innerHeight - rect.bottom - 6 - margin,
    });
  }, [align, width]);

  useEffect(() => {
    if (!open) return;
    place();
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!button.current?.contains(target) && !panel.current?.contains(target)) close();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place, close]);

  return (
    <>
      <button
        ref={button} type="button" aria-label={label} aria-expanded={open} aria-haspopup="menu"
        onClick={() => { if (!open) onOpen?.(); setOpen(!open); }}
      >
        {trigger(open)}
      </button>
      {open && box && (
        <Portal>
          <div
            ref={panel} role="menu" aria-label={label}
            style={{ position: 'fixed', top: box.top, left: box.left, width, maxHeight: box.maxHeight }}
            className="z-[120] overflow-auto overscroll-contain rounded-xl border border-gray-200 bg-white py-1.5 shadow-2xl"
          >
            {children(close)}
          </div>
        </Portal>
      )}
    </>
  );
};

// --- where you've just been ------------------------------------------------------

export const RecentMenu: React.FC = () => {
  const { hierarchy } = useWork();
  const navigate = useNavigate();
  const [items, setItems] = useState<RecentItem[]>(recentItems);

  const paths = useMemo(() => {
    const out = new Map<string, string>();
    const walk = (node: SpaceNode | FolderNode, path: string[]) => {
      node.folders.forEach((f) => walk(f, [...path, f.name]));
      node.lists.forEach((l) => out.set(l.id, [...path, l.name].join(' / ')));
    };
    hierarchy?.spaces.forEach((sp) => walk(sp, [sp.name]));
    if (hierarchy?.personal_list) out.set(hierarchy.personal_list.id, 'Personal List');
    return out;
  }, [hierarchy]);

  const rows = items
    .filter((r) => (r.kind === 'list' ? paths.has(r.id) : r.listId && paths.has(r.listId)))
    .slice(0, 10);

  return (
    <Dropdown
      label="Recently opened" width={320} align="left" onOpen={() => setItems(recentItems())}
      trigger={(open) => (
        <span className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium ${open ? 'bg-gray-100 text-gray-800' : 'text-gray-600 hover:bg-gray-100'}`}>
          <Clock3 size={16} /> Recent
        </span>
      )}
    >
      {(close) => (rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-gray-500">Lists and tasks you open show up here.</p>
      ) : rows.map((r) => {
        const where = r.kind === 'list' ? paths.get(r.id)! : paths.get(r.listId!)!;
        const to = r.kind === 'list' ? `/l/${r.id}` : `/l/${r.listId}?task=${r.id}`;
        return (
          <button key={`${r.kind}:${r.id}`} type="button" role="menuitem" className={item} onClick={() => { close(); navigate(to); }}>
            {r.kind === 'list' ? <ListIcon size={15} className="shrink-0 text-gray-400" /> : <CornerDownLeft size={15} className="shrink-0 text-gray-400" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{r.kind === 'list' ? where.split(' / ').pop() : r.name}</span>
              <span className="block truncate text-xs text-gray-400">{where}</span>
            </span>
          </button>
        );
      }))}
    </Dropdown>
  );
};

// --- help ------------------------------------------------------------------------

const SHORTCUTS: [string, string][] = [
  ['Ctrl K', 'Search tasks, Lists, people and pages'],
  ['Esc', 'Close the panel or dialog in front of you'],
  ['Enter', 'Open whatever is highlighted in search'],
  ['Space', 'Start or stop the timer on an open task'],
];

export const HelpMenu: React.FC = () => (
  <Dropdown
    label="Help and keyboard shortcuts" width={320} align="right"
    trigger={(open) => (
      <span title="Help" className={`flex rounded-lg p-1.5 ${open ? 'bg-gray-100 text-gray-700' : 'text-gray-500 hover:bg-gray-100'}`}>
        <CircleHelp size={20} />
      </span>
    )}
  >
    {() => (
      <>
        <p className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Keyboard shortcuts</p>
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys} className="flex items-center gap-3 px-3 py-1.5 text-sm text-gray-700">
            <kbd className="w-16 shrink-0 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-center text-[11px] font-semibold text-gray-600">{keys}</kbd>
            <span className="min-w-0 flex-1">{what}</span>
          </div>
        ))}
      </>
    )}
  </Dropdown>
);

// --- who you are -----------------------------------------------------------------

export const ProfileChip: React.FC = () => {
  const { logout } = useAuth();
  const { me, workspace, allMembers } = useWork();

  const mine = allMembers.find((m) => m.user.id === me);
  const user = mine?.user ?? { id: me || 'me', email: '', display_name: null };
  const role = mine?.role ?? workspace?.role;

  return (
    <Dropdown
      label="Your account" width={272} align="right"
      trigger={(open) => (
        <span className={`flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2 ${open ? 'bg-gray-100' : 'hover:bg-gray-100'}`}>
          <Avatar user={user} size={28} />
          <span className="hidden max-w-[120px] truncate text-sm font-medium text-gray-700 sm:block">
            {user.display_name || user.email.split('@')[0] || 'You'}
          </span>
        </span>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 border-b border-gray-100 px-3 pb-3 pt-2">
            <Avatar user={user} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-800">{user.display_name || 'You'}</p>
              <p className="truncate text-xs text-gray-500">{user.email}</p>
              {role && <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">{role}</p>}
            </div>
          </div>
          <Link to="/people" role="menuitem" onClick={close} className={item}><UserRound size={15} className="text-gray-400" /> People &amp; Teams</Link>
          <Link to="/settings" role="menuitem" onClick={close} className={item}><Settings size={15} className="text-gray-400" /> Settings</Link>
          <button type="button" role="menuitem" onClick={() => { close(); logout(); }} className={`${item} text-red-600 hover:bg-red-50`}>
            <LogOut size={15} /> Sign out
          </button>
        </>
      )}
    </Dropdown>
  );
};
