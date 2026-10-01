// Task panel sections: the Lists a task is in (Tasks in Multiple Lists) and Time in Status.
import React, { useCallback, useEffect, useState } from 'react';
import { Clock3, List as ListIcon, Plus, X } from 'lucide-react';
import { formatDuration } from '../ui';
import { spacesApi, type TaskListRef, type TimeInStatus } from '../spacesApi';
import { useWritableLists } from './TaskActions';

export const TaskLists: React.FC<{ taskId: string; isSubtask: boolean; editable: boolean; enabled: boolean; onChanged: () => void }> = ({ taskId, isSubtask, editable, enabled, onChanged }) => {
  const [lists, setLists] = useState<TaskListRef[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writable = useWritableLists();
  const load = useCallback(() => { spacesApi.taskLists(taskId).then(setLists).catch(() => undefined); }, [taskId]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn: () => Promise<TaskListRef[]>) => {
    setError(null);
    try { setLists(await fn()); onChanged(); } catch (e) { setError((e as Error).message); }
  };
  // A task in one List is the ordinary case, and "List  home" states what the breadcrumb above
  // the task already says. The section is for the exception -- a task deliberately put in more
  // than one place. Putting it in another moved to the task menu, beside the other things you do
  // to a task, rather than a dashed button sitting under every task forever.
  if (isSubtask || lists.length <= 1) return null;
  const choices = writable.filter((l) => !lists.some((x) => x.id === l.id));
  return (
    <section className="mt-4 border-t border-gray-100 pt-3" aria-label="Lists">
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400"><ListIcon size={13} /> Lists</h4>
      <div className="flex flex-wrap items-center gap-1.5">
        {lists.map((l) => (
          <span key={l.id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${l.home ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-gray-200 text-gray-700'}`} title={l.path}>
            {l.name}{l.home && <span className="text-[10px] text-brand-500">home</span>}
            {!l.home && editable && (
              <button type="button" aria-label={`Remove from ${l.name}`} onClick={() => run(() => spacesApi.removeFromList(taskId, l.id))}><X size={11} /></button>
            )}
          </span>
        ))}
        {editable && enabled && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:text-gray-800">
            <Plus size={11} /> Add to another List
          </button>
        )}
        {adding && (
          <select autoFocus aria-label="Add to List" defaultValue="" onBlur={() => setAdding(false)}
            onChange={(e) => { setAdding(false); if (e.target.value) run(() => spacesApi.addToList(taskId, e.target.value)); }}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-xs">
            <option value="">Choose a List…</option>
            {choices.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </section>
  );
};

export const TimeInStatusSection: React.FC<{ taskId: string; refreshKey: number }> = ({ taskId, refreshKey }) => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TimeInStatus | null>(null);
  // Only the newest answer may land (a status change and the first load can overlap).
  const seq = React.useRef(0);
  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    spacesApi.timeInStatus(taskId).then((d) => { if (mine === seq.current) setData(d); }).catch(() => undefined);
  }, [open, taskId, refreshKey]);
  const total = data ? data.totals.reduce((a, t) => a + t.seconds, 0) : 0;
  return (
    <section className="mt-4" aria-label="Time in status">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600">
        <Clock3 size={13} /> Time in status
      </button>
      {open && data && (
        <div className="mt-2 rounded-lg border border-gray-200 p-3">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
            {data.totals.map((t) => <span key={t.status} style={{ width: `${total ? (t.seconds / total) * 100 : 0}%`, backgroundColor: t.color ?? '#9ca3af' }} />)}
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {data.totals.map((t) => (
              <li key={t.status} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color ?? '#9ca3af' }} />
                <span className="flex-1 uppercase text-gray-700">{t.status}{t.status.toLowerCase() === data.current.toLowerCase() && <span className="ml-1 text-[10px] normal-case text-brand-600">now</span>}</span>
                <span className="text-xs text-gray-500">{t.times > 1 ? `${t.times} times · ` : ''}{formatDuration(t.seconds) || '0m'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
