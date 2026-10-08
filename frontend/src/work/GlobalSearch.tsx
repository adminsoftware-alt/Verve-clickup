import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, Bell, Clock, CornerDownLeft, Folder, Inbox, List as ListIcon, MessageSquare, Search, UserCheck, Users,
} from 'lucide-react';
import { workApi, type FolderNode, type SpaceNode, type Task, type UserRef } from './api';
import { Avatar, Portal, StatusDot } from './ui';
import { useIsManager, useWork } from './WorkContext';
import { recentItems } from './recent';

export const OPEN_SEARCH = 'timetriq:search';
export const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH));

interface Hit {
  key: string;
  section: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  go: () => void;
}

/** `managers` marks a page only admins and Team leads can open, so it is not offered to anyone else. */
const PAGES: { label: string; path: string; icon: React.ReactNode; words: string; managers?: boolean }[] = [
  { label: 'Inbox', path: '/inbox', icon: <Inbox size={15} />, words: 'inbox notifications' },
  { label: 'My Tasks', path: '/my-tasks', icon: <UserCheck size={15} />, words: 'my tasks home assigned' },
  { label: 'Replies', path: '/replies', icon: <MessageSquare size={15} />, words: 'replies comments threads' },
  { label: 'Reminders', path: '/reminders', icon: <Bell size={15} />, words: 'reminders' },
  { label: 'Dashboards', path: '/dashboards', icon: <BarChart3 size={15} />, words: 'dashboards reports charts' },
  { label: 'Timesheets', path: '/timesheets', icon: <Clock size={15} />, words: 'timesheets time tracking hours' },
  { label: 'People & Teams', path: '/people', icon: <Users size={15} />, words: 'people teams members', managers: true },
];

const matches = (text: string, q: string) => text.toLowerCase().includes(q);

/** ClickUp's Command Search (Ctrl+K / ⌘K): tasks, Lists, Folders, Spaces, people and pages. */
export const GlobalSearch: React.FC = () => {
  const { workspace, hierarchy, members } = useWork();
  const isManager = useIsManager();
  const pages = useMemo(() => PAGES.filter((p) => !p.managers || isManager), [isManager]);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SEARCH, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_SEARCH, onOpen); };
  }, []);
  useEffect(() => { if (!open) { setQ(''); setTasks([]); setActive(0); } }, [open]);

  // Tasks come from the server, a moment after typing stops.
  const query = q.trim().toLowerCase();
  useEffect(() => {
    if (!open || !workspace || query.length < 2) { setTasks([]); setLoading(false); return; }
    const mine = ++seq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      workApi.searchTasks(workspace.id, query, 12)
        .then((found) => { if (mine === seq.current) setTasks(found); })
        .catch(() => undefined)
        .finally(() => { if (mine === seq.current) setLoading(false); });
    }, 200);
    return () => clearTimeout(timer);
  }, [open, workspace, query]);

  const listPath = useMemo(() => {
    const out = new Map<string, string>();
    const walk = (n: SpaceNode | FolderNode, path: string[]) => {
      n.folders.forEach((f) => walk(f, [...path, f.name]));
      n.lists.forEach((l) => out.set(l.id, [...path, l.name].join(' / ')));
    };
    hierarchy?.spaces.forEach((sp) => walk(sp, [sp.name]));
    if (hierarchy?.personal_list) out.set(hierarchy.personal_list.id, 'Personal List');
    return out;
  }, [hierarchy]);

  const hits: Hit[] = useMemo(() => {
    const close = () => setOpen(false);
    const go = (path: string) => () => { close(); navigate(path); };
    const out: Hit[] = [];
    if (!query) {
      recentItems().slice(0, 8).forEach((r) => {
        if (r.kind === 'task' && r.listId) {
          out.push({ key: `rt:${r.id}`, section: 'Recent', label: r.name ?? 'Task', sub: listPath.get(r.listId), icon: <CornerDownLeft size={15} />, go: go(`/l/${r.listId}?task=${r.id}`) });
        } else if (r.kind === 'list' && listPath.has(r.id)) {
          out.push({ key: `rl:${r.id}`, section: 'Recent', label: listPath.get(r.id)!.split(' / ').pop()!, sub: listPath.get(r.id), icon: <ListIcon size={15} />, go: go(`/l/${r.id}`) });
        }
      });
      pages.forEach((p) => out.push({ key: `p:${p.path}`, section: 'Go to', label: p.label, icon: p.icon, go: go(p.path) }));
      return out;
    }
    tasks.forEach((t) => out.push({
      key: `t:${t.id}`, section: 'Tasks', label: t.name, sub: listPath.get(t.list_id),
      icon: <StatusDot status={t.status} size={12} />, go: go(`/l/${t.list_id}?task=${t.id}`),
    }));
    const places: Hit[] = [];
    const walk = (n: SpaceNode | FolderNode, path: string[]) => {
      n.folders.forEach((f) => {
        if (matches(f.name, query)) places.push({ key: `f:${f.id}`, section: 'Places', label: f.name, sub: [...path].join(' / '), icon: <Folder size={15} />, go: go(`/f/${f.id}`) });
        walk(f, [...path, f.name]);
      });
      n.lists.forEach((l) => {
        if (matches(l.name, query)) places.push({ key: `l:${l.id}`, section: 'Places', label: l.name, sub: path.join(' / '), icon: <ListIcon size={15} />, go: go(`/l/${l.id}`) });
      });
    };
    hierarchy?.spaces.forEach((sp) => {
      if (matches(sp.name, query)) {
        places.push({
          key: `s:${sp.id}`, section: 'Places', label: sp.name, sub: 'Space',
          icon: <span className="flex h-4 w-4 items-center justify-center rounded bg-brand-600 text-[9px] font-bold text-white">{sp.name[0]?.toUpperCase()}</span>, go: go(`/s/${sp.id}`),
        });
      }
      walk(sp, [sp.name]);
    });
    out.push(...places.slice(0, 8));
    members
      .filter((m) => matches(`${m.user.display_name ?? ''} ${m.user.email}`, query))
      .slice(0, 5)
      .forEach((m) => out.push({
        key: `u:${m.user.id}`, section: 'People', label: m.user.display_name || m.user.email, sub: m.user.email,
        icon: <Avatar user={m.user as UserRef} size={18} />, go: go(`/timesheets/people/${m.user.id}`),
      }));
    pages.filter((p) => matches(p.words, query)).forEach((p) => out.push({ key: `p:${p.path}`, section: 'Go to', label: p.label, icon: p.icon, go: go(p.path) }));
    return out;
  }, [query, tasks, hierarchy, members, listPath, navigate]);

  useEffect(() => { setActive(0); }, [query, tasks]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  const sections = [...new Set(hits.map((h) => h.section))];
  return (
    <Portal>
      <div className="fixed inset-0 z-[180] flex items-start justify-center bg-black/30 pt-[12vh]" onMouseDown={() => setOpen(false)}>
        <div role="dialog" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}
          className="w-[40rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-white shadow-2xl">
          <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
            <Search size={17} className="text-gray-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tasks, Lists, Folders, people…"
              aria-label="Search everything"
              className="flex-1 text-[15px] focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                if (e.key === 'Enter' && hits[active]) { e.preventDefault(); hits[active].go(); }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
              }}
            />
            {loading && <span className="text-xs text-gray-400">Searching…</span>}
            <kbd className="rounded border border-gray-200 px-1.5 text-[10px] text-gray-400">Esc</kbd>
          </div>
          <ul ref={listRef} role="listbox" aria-label="Results" className="max-h-[60vh] overflow-auto py-2">
            {hits.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-gray-400">
                {query.length < 2 ? 'Keep typing…' : loading ? 'Searching…' : `Nothing found for “${q.trim()}”.`}
              </li>
            )}
            {sections.map((section) => (
              <li key={section}>
                <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{section}</p>
                <ul>
                  {hits.map((h, i) => (h.section !== section ? null : (
                    <li key={h.key}>
                      <button type="button" role="option" aria-selected={i === active} data-index={i}
                        onMouseEnter={() => setActive(i)} onClick={h.go}
                        className={`flex w-full items-center gap-3 px-4 py-1.5 text-left ${i === active ? 'bg-brand-50' : ''}`}>
                        <span className="flex w-5 shrink-0 justify-center text-gray-500">{h.icon}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{h.label}</span>
                        {h.sub && <span className="max-w-[45%] shrink-0 truncate text-xs text-gray-400">{h.sub}</span>}
                      </button>
                    </li>
                  )))}
                </ul>
              </li>
            ))}
          </ul>
          <div className="flex gap-4 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
            <span>↑↓ to move</span><span>Enter to open</span><span>Ctrl+K anywhere</span>
          </div>
        </div>
      </div>
    </Portal>
  );
};

/** The header's search box: opens the Command Search. */
export const SearchButton: React.FC = () => (
  <button type="button" onClick={openSearch} aria-label="Search (Ctrl+K)"
    className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-400 hover:border-gray-300 hover:text-gray-600">
    <Search size={14} /> <span className="hidden md:inline">Search</span>
    <kbd className="hidden rounded border border-gray-200 px-1 text-[10px] md:inline">Ctrl K</kbd>
  </button>
);
