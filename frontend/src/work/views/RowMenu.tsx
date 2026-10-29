// A task's menu, from its "···" button or a right-click on its row or card: the everyday things
// you would otherwise open the task for. Copy link and ID along the top, then the task itself
// (favourite, rename, follow, remind), where it lives (status, move, add to, merge, duplicate,
// make it a subtask, its type), the timer, and archive or delete at the foot.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClock, Archive, ArrowLeft, Bell, BellOff, ChevronRight, Columns3, Copy, CornerDownRight, ExternalLink, GitMerge, Link2, ListPlus,
  MoveRight, Pencil, Play, Shapes, Square, Star, Trash2,
} from 'lucide-react';
import { workApi, type Status, type Task, type TaskDetail } from '../api';
import { collabApi } from '../collabApi';
import { spacesApi } from '../spacesApi';
import { Portal, StatusDot } from '../ui';
import { useWork, useMe } from '../WorkContext';
import { useFavorites } from '../Favorites';
import { useWritableLists } from '../task/TaskActions';
import { MergeDialog } from '../task/TaskLinks';
import { useRunningTimer } from '../RunningTimer';
import { notify } from '../../components/notify';
import { ask } from '../../components/ask';

const WIDTH = 248;
type Mode = 'main' | 'status' | 'move' | 'add' | 'remind' | 'convert' | 'type';

const REMIND_AT: { label: string; at: () => Date }[] = [
  { label: 'In 1 hour', at: () => new Date(Date.now() + 3600_000) },
  { label: 'Later today (5 pm)', at: () => { const d = new Date(); d.setHours(17, 0, 0, 0); return d; } },
  { label: 'Tomorrow, 9 am', at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
  { label: 'Next Monday, 9 am', at: () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d; } },
];

export const RowMenu: React.FC<{
  task: Task;
  /** Where to open: under the button (y), or -- when there is no room below -- above it (top). */
  at: { x: number; y: number; top?: number };
  /** This task's List's statuses, once known; fetched by the caller as the menu opens. */
  statuses: Status[];
  canEdit: boolean;
  /** The other tasks on screen, for "Convert to subtask" (its new parent comes from its own List). */
  siblings?: Task[];
  /** Where the List offers it: add a column (a custom field). */
  onAddColumn?: () => void;
  onOpen: () => void;
  onStatus: (status: Status) => void;
  onChanged: () => void;
  onClose: () => void;
}> = ({ task, at, statuses, canEdit, siblings = [], onAddColumn, onOpen, onStatus, onChanged, onClose }) => {
  const panel = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('main');
  const [q, setQ] = useState('');
  const [pos, setPos] = useState({ left: at.x, top: at.y, maxHeight: window.innerHeight - 16 });
  const [merging, setMerging] = useState(false);
  const [following, setFollowing] = useState<boolean | null>(null);
  const lists = useWritableLists();
  const { workspace, taskTypes } = useWork();
  const me = useMe();
  const favorites = useFavorites();
  const { timer, start, stop } = useRunningTimer();
  const timing = timer?.entry.task_id === task.id;
  const full = task.permission_level === 'full';

  useEffect(() => { collabApi.watchers(task.id).then((w) => setFollowing(w.watching)).catch(() => undefined); }, [task.id]);

  // Kept on screen and at its button: under it when it fits, else opening upwards with its bottom
  // edge on the button, and never taller than the window -- it scrolls instead of losing Delete.
  // Placed again whenever its size changes: "Follow task" arrives a moment after the menu opens,
  // and placing it only once left the menu a row too long for the space under the button.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return undefined;
    const place = () => {
      const room = window.innerHeight - 16;
      const h = Math.min(el.scrollHeight, room);
      let top = at.y;
      if (at.y + h > window.innerHeight - 8) {
        top = at.top !== undefined && at.top - h >= 8 ? at.top - h : Math.max(8, window.innerHeight - h - 8);
      }
      setPos((prev) => {
        const next = { left: Math.max(8, Math.min(at.x, window.innerWidth - WIDTH - 8)), top, maxHeight: room };
        return prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight ? prev : next;
      });
    };
    place();
    const watch = new ResizeObserver(place);
    Array.from(el.children).forEach((child) => watch.observe(child));
    watch.observe(el);
    return () => watch.disconnect();
  }, [at, mode, following]);
  useEffect(() => {
    if (merging) return;
    const away = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', away, true);
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose, merging]);

  const act = (fn: () => Promise<unknown> | void, done?: string) => async () => {
    onClose();
    try { await fn(); if (done) notify.ok(done); onChanged(); } catch (e) { notify.error(e); }
  };
  const copy = (text: string, done: string) => act(() => navigator.clipboard.writeText(text), done);

  const row = 'vf-menu-row flex w-full items-center gap-2.5 rounded-md px-1.5 py-[3px] text-left text-[13px] text-gray-700';
  const icon = 'shrink-0 text-gray-400';
  /** The action's icon in a small tile washed in its own colour, as in the Dashboard card menus. */
  const tile = (Icon: React.ElementType, tone: string, extra?: string) => (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${tone} 12%, white)`, color: tone }}>
      <Icon size={12} strokeWidth={2.1} className={extra} />
    </span>
  );
  const head = (text: string) => <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">{text}</div>;
  const more = <ChevronRight size={13} className="ml-auto text-gray-300" />;
  const rule = <div className="mx-1 my-0.5 border-t border-[#EEF0F3]" />;
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchingLists = lists.filter((l) => l.id !== task.list_id && words.every((w) => l.label.toLowerCase().includes(w)));
  const parents = useMemo(() => siblings.filter((t) => t.id !== task.id && t.list_id === task.list_id && !t.parent_id
    && words.every((w) => t.name.toLowerCase().includes(w))), [siblings, task, words]);
  const back = (title: string) => (
    <>
      <button type="button" className={`${row} font-medium`} onClick={() => { setMode('main'); setQ(''); }}><ArrowLeft size={14} className={icon} /> {title}</button>
      {rule}
    </>
  );
  const search = (placeholder: string) => (
    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder}
      className="vf-menu-search mb-1 w-full rounded-md border px-2 py-1 text-[13px] text-gray-800 outline-none focus:border-brand-400" />
  );
  const listPick = (onPick: (id: string, name: string) => void) => (
    <div className="max-h-56 overflow-y-auto">
      {matchingLists.length === 0 ? <p className="px-2 py-3 text-center text-xs text-gray-400">No List matches.</p>
        : matchingLists.map((l) => {
          const parts = l.label.split(' / ');
          return (
            <button key={l.id} type="button" className={`${row} flex-col !items-start !gap-0`} onClick={() => onPick(l.id, parts[parts.length - 1])}>
              <span className="truncate">{parts[parts.length - 1]}</span>
              {parts.length > 1 && <span className="truncate text-[11px] text-gray-400">{parts.slice(0, -1).join(' / ')}</span>}
            </button>
          );
        })}
    </div>
  );

  if (merging) {
    return <MergeDialog task={task as unknown as TaskDetail} onClose={onClose} onDone={() => { onClose(); onChanged(); }} />;
  }

  return (
    <Portal>
      <div ref={panel} role="menu" aria-label={`Actions for ${task.name}`} style={{ position: 'fixed', left: pos.left, top: pos.top, width: WIDTH, maxHeight: pos.maxHeight }}
        className="vf-menu z-[160] overflow-y-auto rounded-xl border p-1.5 text-sm" onContextMenu={(e) => e.preventDefault()}>
        {mode === 'main' && (
          <>
            <div className="mb-1 grid grid-cols-2 gap-1">
              <button type="button" role="menuitem" onClick={copy(`${window.location.origin}/l/${task.list_id}?task=${task.id}`, 'Link copied')}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-[#E3E8F0] bg-white py-1.5 text-[12.5px] font-medium text-gray-700 transition-colors hover:border-[#B9C7E2] hover:text-[#234788]"><Link2 size={13} /> Copy link</button>
              <button type="button" role="menuitem" onClick={copy(task.custom_id ?? task.id, 'ID copied')}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-[#E3E8F0] bg-white py-1.5 text-[12.5px] font-medium text-gray-700 transition-colors hover:border-[#B9C7E2] hover:text-[#234788]"><Copy size={13} /> Copy ID</button>
            </div>

            {head('Task')}
            <button type="button" role="menuitem" className={row} onClick={() => { onClose(); onOpen(); }}>{tile(ExternalLink, '#234788')} Open</button>
            {onAddColumn && <button type="button" role="menuitem" className={row} onClick={() => { onClose(); onAddColumn(); }}>{tile(Columns3, '#4F46E5')} Add a column</button>}
            <button type="button" role="menuitem" className={row} onClick={() => { onClose(); favorites.toggle('task', task.id); }}>
              {tile(Star, '#D97706', favorites.isFavorite('task', task.id) ? 'fill-current' : undefined)}
              {favorites.isFavorite('task', task.id) ? 'Remove from Favourites' : 'Add to Favourites'}
            </button>
            {canEdit && (
              <button type="button" role="menuitem" className={row} onClick={async () => {
                onClose();
                const name = await ask.prompt('Rename task', task.name);
                if (name?.trim() && name.trim() !== task.name) act(() => workApi.updateTask(task.id, { name: name.trim() }), 'Renamed')();
              }}>{tile(Pencil, '#7C3AED')} Rename</button>
            )}
            {following !== null && (
              <button type="button" role="menuitem" className={row}
                onClick={act(() => (following ? collabApi.unwatch(task.id, me) : collabApi.watch(task.id)), following ? 'You will no longer be notified' : 'You will be notified of changes')}>
                {tile(following ? BellOff : Bell, '#0284C7')} {following ? 'Unfollow task' : 'Follow task'}
              </button>
            )}
            <button type="button" role="menuitem" className={row} onClick={() => setMode('remind')}>{tile(AlarmClock, '#DB2777')} Remind me {more}</button>

            {canEdit && (
              <>
                {rule}
                {head('Organise')}
                <button type="button" role="menuitem" className={row} onClick={() => setMode('status')}>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#F2F4F7]"><StatusDot status={task.status} size={11} /></span> Status {more}
                </button>
                <button type="button" role="menuitem" className={row} onClick={() => setMode('move')}>{tile(MoveRight, '#0284C7')} Move to {more}</button>
                {full && !task.parent_id && <button type="button" role="menuitem" className={row} onClick={() => setMode('add')}>{tile(ListPlus, '#0D9488')} Add to another List {more}</button>}
                <button type="button" role="menuitem" className={row} onClick={() => setMerging(true)}>{tile(GitMerge, '#7C3AED')} Merge</button>
                <button type="button" role="menuitem" className={row} onClick={act(() => collabApi.duplicateTask(task.id, { name: `${task.name} (copy)` }), 'Duplicated')}>
                  {tile(Copy, '#4F46E5')} Duplicate
                </button>
                {!task.parent_id && <button type="button" role="menuitem" className={row} onClick={() => setMode('convert')}>{tile(CornerDownRight, '#234788')} Convert to subtask {more}</button>}
                {taskTypes.length > 0 && <button type="button" role="menuitem" className={row} onClick={() => setMode('type')}>{tile(Shapes, '#DB2777')} Task type {more}</button>}

                {rule}
                {head('Time')}
                <button type="button" role="menuitem" className={row} onClick={timing ? act(stop) : act(() => start(task.id, task))}>
                  {timing ? tile(Square, '#DC2626', 'fill-current') : tile(Play, '#234788', 'fill-current')} {timing ? 'Stop timer' : 'Start timer'}
                </button>

                {rule}
                <button type="button" role="menuitem" className={row} onClick={act(() => workApi.updateTask(task.id, { archived: true }), 'Archived')}>
                  {tile(Archive, '#64748B')} Archive
                </button>
                {full && (
                  <button type="button" role="menuitem" className={`${row} !text-red-600`} onClick={async () => {
                    onClose();
                    if (await ask.confirm({ danger: true, title: `Delete "${task.name}"? This cannot be undone.` })) act(() => workApi.deleteTask(task.id), 'Deleted')();
                  }}>{tile(Trash2, '#DC2626')} Delete</button>
                )}
              </>
            )}
          </>
        )}

        {mode === 'status' && (
          <>
            {back('Status')}
            {statuses.map((st) => (
              <button key={st.id} type="button" role="menuitemradio" aria-checked={st.id === task.status.id}
                className={`${row} ${st.id === task.status.id ? 'font-medium text-brand-700' : ''}`}
                onClick={() => { onClose(); if (st.id !== task.status.id) onStatus(st); }}>
                <StatusDot status={st} size={12} /> {st.name}
              </button>
            ))}
          </>
        )}
        {mode === 'move' && (
          <>
            {back('Move to')}
            {search('Search Lists…')}
            {listPick((id, name) => act(() => collabApi.moveTask(task.id, id), `Moved to ${name}`)())}
          </>
        )}
        {mode === 'add' && (
          <>
            {back('Add to another List')}
            <p className="px-2 pb-1 text-[11px] text-gray-400">The same task shows there too; it keeps this List as its home.</p>
            {search('Search Lists…')}
            {listPick((id, name) => act(() => spacesApi.addToList(task.id, id), `Also in ${name}`)())}
          </>
        )}
        {mode === 'remind' && (
          <>
            {back('Remind me')}
            {REMIND_AT.map((r) => (
              <button key={r.label} type="button" className={row}
                onClick={act(async () => workspace && collabApi.addReminder(workspace.id, { task_id: task.id, title: task.name, remind_at: r.at().toISOString() }), 'Reminder set')}>
                <AlarmClock size={14} className={icon} /> {r.label}
              </button>
            ))}
          </>
        )}
        {mode === 'convert' && (
          <>
            {back('Convert to subtask of…')}
            {search('Search tasks in this List…')}
            <div className="max-h-56 overflow-y-auto">
              {parents.length === 0 ? <p className="px-2 py-3 text-center text-xs text-gray-400">No task in this List matches.</p>
                : parents.slice(0, 50).map((t) => (
                  <button key={t.id} type="button" className={row} onClick={act(() => workApi.updateTask(task.id, { parent_id: t.id }), `Now a subtask of ${t.name}`)}>
                    <StatusDot status={t.status} size={11} /> <span className="truncate">{t.name}</span>
                  </button>
                ))}
            </div>
          </>
        )}
        {mode === 'type' && (
          <>
            {back('Task type')}
            {[{ id: null as string | null, name: 'Task' }, ...taskTypes].map((t) => (
              <button key={t.id ?? 'task'} type="button" role="menuitemradio" aria-checked={(task.type_id ?? null) === t.id}
                className={`${row} ${(task.type_id ?? null) === t.id ? 'font-medium text-brand-700' : ''}`}
                onClick={act(() => workApi.updateTask(task.id, { type_id: t.id }), 'Type changed')}>
                <Shapes size={14} className={icon} /> {t.name}
              </button>
            ))}
          </>
        )}
      </div>
    </Portal>
  );
};
