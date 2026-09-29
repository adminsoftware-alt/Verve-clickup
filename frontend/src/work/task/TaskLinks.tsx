import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, GitMerge, Link2, Plus, Search, Trash2, X } from 'lucide-react';
import { workApi, type LinkKind, type Task, type TaskDetail, type TaskLinks } from '../api';
import { Portal, StatusDot, formatDue, useEscapeToClose } from '../ui';
import { useWork } from '../WorkContext';
import { ask } from '../../components/ask';

/** Search the workspace for a task to link or merge (excluding some). */
export const TaskPicker: React.FC<{ exclude: string[]; onPick: (t: Task) => void; placeholder?: string; autoFocus?: boolean }> = ({ exclude, onPick, placeholder, autoFocus }) => {
  const { workspace, listName } = useWork();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Task[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    if (!workspace || q.trim().length < 2) { setFound([]); return; }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      workApi.searchTasks(workspace.id, q.trim(), 10).then((r) => { if (mine === seq.current) setFound(r.filter((t) => !exclude.includes(t.id))); }).catch(() => undefined);
    }, 200);
    return () => clearTimeout(timer);
  }, [q, workspace, exclude]);
  return (
    <div className="relative">
      <span className="flex items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1">
        <Search size={13} className="text-gray-400" />
        <input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? 'Search tasks by name or ID'} aria-label="Find a task" className="flex-1 text-sm focus:outline-none" />
      </span>
      {found.length > 0 && (
        <ul role="listbox" aria-label="Matching tasks" className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {found.map((t) => (
            <li key={t.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => { onPick(t); setQ(''); setFound([]); }}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-gray-50">
                <StatusDot status={t.status} size={10} />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {t.custom_id && <span className="font-mono text-[10px] text-gray-400">{t.custom_id}</span>}
                <span className="max-w-[40%] truncate text-xs text-gray-400">{listName(t.list_id)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const KIND_TITLE: Record<LinkKind, string> = { waiting_on: 'Waiting on', blocking: 'Blocking', relates: 'Linked tasks' };

/** ClickUp's Relationships section: dependencies (waiting on / blocking) and links. */
export const TaskRelations: React.FC<{ task: TaskDetail; editable: boolean; onChanged: () => void }> = ({ task, editable, onChanged }) => {
  const [links, setLinks] = useState<TaskLinks | null>(null);
  const [adding, setAdding] = useState<LinkKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => workApi.links(task.id).then(setLinks).catch((e) => setError(e.message)), [task.id]);
  useEffect(() => { load(); }, [load]);
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try { await action(); await load(); onChanged(); } catch (e) { setError((e as Error).message); }
  };
  if (!links) return null;
  const groups: [LinkKind, TaskLinks['waiting_on']][] = [['waiting_on', links.waiting_on], ['blocking', links.blocking], ['relates', links.linked]];
  const total = links.waiting_on.length + links.blocking.length + links.linked.length;
  const openBlockers = links.waiting_on.filter((l) => !l.finished).length;
  const shown = new Set([task.id, ...links.waiting_on.map((l) => l.id), ...links.blocking.map((l) => l.id), ...links.linked.map((l) => l.id)]);
  return (
    <section className="mt-5" aria-label="Relationships">
      <div className="mb-1.5 flex items-center gap-2">
        <Link2 size={15} className="text-gray-500" />
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Relationships {total > 0 && <span className="text-gray-400">{total}</span>}</h4>
        {openBlockers > 0 && <span className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"><Ban size={11} /> Waiting on {openBlockers}</span>}
        {editable && (
          <span className="ml-auto flex gap-1">
            {(['waiting_on', 'blocking', 'relates'] as LinkKind[]).map((k) => (
              <button key={k} type="button" onClick={() => setAdding(adding === k ? null : k)}
                className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs ${adding === k ? 'bg-brand-50 text-brand-700' : 'text-brand-600 hover:bg-brand-50'}`}>
                <Plus size={11} /> {k === 'waiting_on' ? 'Waiting on' : k === 'blocking' ? 'Blocking' : 'Link'}
              </button>
            ))}
          </span>
        )}
      </div>
      {error && <p className="mb-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      {adding && (
        <div className="mb-2">
          <p className="mb-1 text-xs text-gray-500">
            {adding === 'waiting_on' ? 'This task can’t be finished until…' : adding === 'blocking' ? 'This task must be finished before…' : 'Link a related task'}
          </p>
          <TaskPicker autoFocus exclude={[...shown]} onPick={(t) => run(() => workApi.addLink(task.id, t.id, adding)).then(() => setAdding(null))} />
        </div>
      )}
      {total === 0 && !adding && <p className="text-xs text-gray-400">No dependencies or links.</p>}
      {groups.map(([kind, items]) => items.length > 0 && (
        <div key={kind} className="mb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{KIND_TITLE[kind]}</p>
          <ul className="rounded-lg border border-gray-200" aria-label={KIND_TITLE[kind]}>
            {items.map((l) => (
              <li key={l.link_id} className="group flex items-center gap-2 border-t border-gray-100 px-3 py-1 first:border-t-0">
                <StatusDot status={l.status} size={10} />
                <Link to={`/l/${l.list_id}?task=${l.id}`} className={`min-w-0 flex-1 truncate text-sm no-underline hover:underline ${l.finished ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{l.name}</Link>
                {l.due_date && <span className="text-xs text-gray-400">{formatDue(l.due_date)}</span>}
                {kind === 'waiting_on' && !l.finished && <Ban size={12} className="text-red-500" aria-label="Not finished yet" />}
                {editable && <button type="button" title="Remove" onClick={() => run(() => workApi.removeLink(l.link_id))} className="text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100"><X size={13} /></button>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
};

/** Merge duplicate tasks into this one (ClickUp's "Merge"). */
export const MergeDialog: React.FC<{ task: TaskDetail; onClose: () => void; onDone: () => void }> = ({ task, onClose, onDone }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEscapeToClose(ref, onClose);
  const [picked, setPicked] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!(await ask.confirm({ danger: true, title: `Merge ${picked.length} task${picked.length === 1 ? '' : 's'} into “${task.name}”? Their comments, files, checklists, time and subtasks move here, and they are deleted.` }))) return;
    setBusy(true);
    try { await workApi.mergeTasks(task.id, picked.map((p) => p.id)); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Portal>
      <div className="fixed inset-0 z-[125] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div ref={ref} role="dialog" aria-label="Merge tasks" onMouseDown={(e) => e.stopPropagation()} className="w-[30rem] max-w-[calc(100vw-2rem)] rounded-xl bg-white p-5 shadow-xl">
          <div className="mb-2 flex items-center gap-2"><GitMerge size={17} className="text-brand-600" /><h3 className="font-semibold text-gray-900">Merge into “{task.name}”</h3></div>
          <p className="mb-3 text-xs text-gray-500">Pick the duplicates. Everything on them moves to this task, and they are deleted.</p>
          <TaskPicker autoFocus exclude={[task.id, ...picked.map((p) => p.id)]} onPick={(t) => setPicked((p) => [...p, t])} placeholder="Find the duplicate tasks" />
          <ul className="mt-2 space-y-1" aria-label="Tasks to merge">
            {picked.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-md bg-gray-50 px-2 py-1 text-sm">
                <StatusDot status={p.status} size={10} /><span className="min-w-0 flex-1 truncate">{p.name}</span>
                <button type="button" title="Remove" onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))} className="text-gray-400 hover:text-red-600"><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
          {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="button" disabled={!picked.length || busy} onClick={go} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">Merge {picked.length || ''}</button>
          </div>
        </div>
      </div>
    </Portal>
  );
};
