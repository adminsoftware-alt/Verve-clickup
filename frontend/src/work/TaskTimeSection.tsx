import { useMe } from './WorkContext';
import React, { useCallback, useEffect, useState } from 'react';
import { Play, Square, Trash2 } from 'lucide-react';
import { workApi, type TaskTime } from './api';
import { formatClock, useNow, useRunningTimer } from './RunningTimer';
import { Avatar, formatDuration, parseDuration } from './ui';

/**
 * Time tracked on a task, as in ClickUp's task view: start/stop the timer, log time
 * by hand ("1h 30m", "45m", "1.5"), and see the entries. Members see their own
 * entries; owners and admins see everyone's. The total always covers everyone.
 */
export const TaskTimeSection: React.FC<{ taskId: string; canTrack: boolean; onChanged: () => void }> = ({ taskId, canTrack, onChanged }) => {
  const meId = useMe();
  const { timer, version, start, stop } = useRunningTimer();
  const [time, setTime] = useState<TaskTime | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const running = timer?.entry.task_id === taskId ? timer : null;
  const now = useNow(!!running);

  const load = useCallback(async () => {
    try { setTime(await workApi.taskTime(taskId)); } catch (e) { setError((e as Error).message); }
  }, [taskId]);
  useEffect(() => { load(); }, [load, version]);

  const act = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const log = (e: React.FormEvent) => {
    e.preventDefault();
    const seconds = parseDuration(draft);
    if (!seconds) { setError('Enter a duration like 1h 30m, 45m or 1.5'); return; }
    act(async () => {
      await workApi.logTime(taskId, seconds, note.trim() || undefined);
      setDraft('');
      setNote('');
    });
  };

  const elapsed = running ? (now - new Date(running.entry.started_at).getTime()) / 1000 : 0;
  const total = (time?.total_seconds ?? 0) + elapsed;
  const done = time?.entries.filter((en) => !en.running) ?? [];

  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center gap-3">
        <h4 className="text-sm font-semibold text-gray-700">Time tracked</h4>
        <span className="text-sm text-gray-500">{formatDuration(Math.floor(total)) || '0m'}</span>
        {canTrack && (running ? (
          <button type="button" onClick={() => act(stop)} className="ml-auto flex items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1 text-sm font-medium text-red-700 hover:bg-red-100">
            <Square size={11} fill="currentColor" /> Stop <span className="font-mono tabular-nums">{formatClock(elapsed)}</span>
          </button>
        ) : (
          <button type="button" onClick={() => act(() => start(taskId))} className="ml-auto flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:border-indigo-300 hover:text-indigo-700">
            <Play size={11} fill="currentColor" /> Start timer
          </button>
        ))}
      </div>
      {error && <p className="mb-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</p>}
      <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
        {done.map((entry) => (
          <div key={entry.id} className="group flex items-center gap-2 px-3 py-2 text-sm">
            <Avatar user={entry.user} size={20} />
            <span className="w-16 shrink-0 font-medium text-gray-800">{formatDuration(entry.duration_seconds)}</span>
            <span className="min-w-0 flex-1 truncate text-gray-500">{entry.description || ''}</span>
            <span className="shrink-0 text-xs text-gray-400">{new Date(entry.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
            {(entry.user.id === meId || time?.shows_everyone) && (
              <button type="button" title="Delete entry" onClick={() => act(() => workApi.deleteTime(entry.id))} className="invisible text-gray-400 hover:text-red-600 group-hover:visible">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
        {done.length === 0 && !canTrack && <div className="px-3 py-2 text-sm text-gray-400">No time tracked.</div>}
        {canTrack && (
          <form onSubmit={log} className="flex items-center gap-2 px-3 py-2">
            <input aria-label="Time to log" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Log time, e.g. 1h 30m" className="w-40 text-sm focus:outline-none" />
            <input aria-label="What was done" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="min-w-0 flex-1 text-sm focus:outline-none" />
            <button type="submit" disabled={!draft.trim()} className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40">Log</button>
          </form>
        )}
      </div>
    </div>
  );
};
