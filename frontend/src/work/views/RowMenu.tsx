// The right-click menu on a task row: the everyday things you'd otherwise open the task for.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft, ChevronRight, Copy, ExternalLink, Link2, MoveRight, Play, Square } from 'lucide-react';
import { workApi, type Status, type Task } from '../api';
import { collabApi } from '../collabApi';
import { Portal, StatusDot } from '../ui';
import { useWritableLists } from '../task/TaskActions';
import { useRunningTimer } from '../RunningTimer';
import { notify } from '../../components/notify';

const WIDTH = 220;

export const RowMenu: React.FC<{
  task: Task;
  at: { x: number; y: number };
  /** This task's List's statuses, once known; fetched by the caller as the menu opens. */
  statuses: Status[];
  canEdit: boolean;
  onOpen: () => void;
  onStatus: (status: Status) => void;
  onChanged: () => void;
  onClose: () => void;
}> = ({ task, at, statuses, canEdit, onOpen, onStatus, onChanged, onClose }) => {
  const panel = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'main' | 'status' | 'move'>('main');
  const [q, setQ] = useState('');
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  const lists = useWritableLists();
  const { timer, start, stop } = useRunningTimer();
  const timing = timer?.entry.task_id === task.id;

  // Kept on screen: a right-click near the bottom or the right edge opens the menu up or left.
  useLayoutEffect(() => {
    const h = panel.current?.offsetHeight ?? 0;
    setPos({
      left: Math.min(at.x, window.innerWidth - WIDTH - 8),
      top: at.y + h > window.innerHeight - 8 ? Math.max(8, at.y - h) : at.y,
    });
  }, [at, mode]);
  useEffect(() => {
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
  }, [onClose]);

  const act = (fn: () => Promise<unknown> | void, done?: string) => async () => {
    onClose();
    try { await fn(); if (done) notify.ok(done); onChanged(); } catch (e) { notify.error(e); }
  };
  const row = 'vf-menu-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-gray-700';
  const icon = 'shrink-0 text-gray-400';
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matching = lists.filter((l) => l.id !== task.list_id && words.every((w) => l.label.toLowerCase().includes(w)));

  return (
    <Portal>
      <div ref={panel} role="menu" aria-label={`Actions for ${task.name}`} style={{ position: 'fixed', left: pos.left, top: pos.top, width: WIDTH }}
        className="vf-menu z-[160] rounded-xl border p-1 text-sm" onContextMenu={(e) => e.preventDefault()}>
        {mode === 'main' && (
          <>
            <button type="button" role="menuitem" className={row} onClick={() => { onClose(); onOpen(); }}><ExternalLink size={14} className={icon} /> Open</button>
            <button type="button" role="menuitem" className={row} onClick={act(() => navigator.clipboard.writeText(`${window.location.origin}/l/${task.list_id}?task=${task.id}`), 'Link copied')}>
              <Link2 size={14} className={icon} /> Copy link
            </button>
            {canEdit && (
              <>
                <button type="button" role="menuitem" className={row} onClick={() => setMode('status')}>
                  <StatusDot status={task.status} size={12} /> <span className="flex-1">Status</span><ChevronRight size={13} className="text-gray-300" />
                </button>
                <button type="button" role="menuitem" className={row} onClick={timing ? act(stop) : act(() => start(task.id))}>
                  {timing ? <Square size={13} className="shrink-0 text-red-500" /> : <Play size={13} className={icon} />} {timing ? 'Stop timer' : 'Start timer'}
                </button>
                <button type="button" role="menuitem" className={row} onClick={act(() => collabApi.duplicateTask(task.id, { name: `${task.name} (copy)` }), 'Duplicated')}>
                  <Copy size={14} className={icon} /> Duplicate
                </button>
                <button type="button" role="menuitem" className={row} onClick={() => setMode('move')}>
                  <MoveRight size={14} className={icon} /> <span className="flex-1">Move to…</span><ChevronRight size={13} className="text-gray-300" />
                </button>
                <div className="my-1 border-t border-[#E6E8EC]" />
                <button type="button" role="menuitem" className={row} onClick={act(() => workApi.updateTask(task.id, { archived: true }), 'Archived')}>
                  <Archive size={14} className={icon} /> Archive
                </button>
              </>
            )}
          </>
        )}
        {mode === 'status' && (
          <>
            <button type="button" className={`${row} font-medium`} onClick={() => setMode('main')}><ArrowLeft size={14} className={icon} /> Status</button>
            <div className="my-1 border-t border-[#E6E8EC]" />
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
            <button type="button" className={`${row} font-medium`} onClick={() => { setMode('main'); setQ(''); }}><ArrowLeft size={14} className={icon} /> Move to…</button>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Lists…" aria-label="Search Lists"
              className="vf-menu-search my-1 w-full rounded-md border px-2 py-1 text-[13px] text-gray-800 outline-none focus:border-brand-400" />
            <div className="max-h-56 overflow-y-auto">
              {matching.length === 0 ? <p className="px-2 py-3 text-center text-xs text-gray-400">No List matches.</p>
                : matching.map((l) => {
                  const parts = l.label.split(' / ');
                  return (
                    <button key={l.id} type="button" className={`${row} flex-col !items-start !gap-0`}
                      onClick={act(() => collabApi.moveTask(task.id, l.id), `Moved to ${parts[parts.length - 1]}`)}>
                      <span className="truncate">{parts[parts.length - 1]}</span>
                      {parts.length > 1 && <span className="truncate text-[11px] text-gray-400">{parts.slice(0, -1).join(' / ')}</span>}
                    </button>
                  );
                })}
            </div>
          </>
        )}
      </div>
    </Portal>
  );
};
