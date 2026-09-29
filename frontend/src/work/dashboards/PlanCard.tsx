// "Plan my day": tick what you are actually doing today and watch the estimates fill the day.
//
// Ticking adds the task to your LineUp, the same one My Tasks shows, so there is one idea of
// "what I am on" rather than two. The warning is the point of the card: people commit to a day
// they cannot finish, and the overdue pile is the bill for it arriving a week later.
import React, { useState } from 'react';
import { Check, PartyPopper } from 'lucide-react';

import { useWork } from '../WorkContext';
import { planningApi } from '../planningApi';
import { formatDuration, formatDue } from '../ui';

export interface PlanTask {
  id: string;
  name: string;
  time_estimate_seconds: number | null;
  due_date: string | null;
  picked: boolean;
  overdue: boolean;
}

export const PlanCard: React.FC<{
  capacity_seconds: number;
  planned_seconds: number;
  tasks: PlanTask[];
  onOpenTask: (id: string) => void;
  /** Re-reads the card, so the totals come back from the server rather than being guessed here. */
  onChanged: () => void;
}> = ({ capacity_seconds, planned_seconds, tasks, onOpenTask, onChanged }) => {
  const { workspace } = useWork();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hours = (seconds: number) => formatDuration(Math.abs(seconds)) || '0h';
  const capacity = capacity_seconds || 0;
  const full = capacity ? planned_seconds / capacity : 0;
  const tone = full > 1 ? 'bg-red-500' : full > 0.85 ? 'bg-amber-500' : 'bg-teal-500';

  const note = capacity === 0
    ? { skin: 'bg-gray-50 text-gray-600', text: 'Not a working day for you.' }
    : full > 1
      ? { skin: 'bg-red-50 text-red-700', text: `${hours(planned_seconds - capacity)} more than a working day. Move something to tomorrow.` }
      : full > 0.85
        ? { skin: 'bg-amber-50 text-amber-800', text: `Nearly full — ${hours(capacity - planned_seconds)} left for anything that lands today.` }
        : { skin: 'bg-emerald-50 text-emerald-800', text: `${hours(capacity - planned_seconds)} still free today.` };

  const toggle = async (task: PlanTask) => {
    if (!workspace) return;
    setBusy(task.id);
    setError(null);
    try {
      if (task.picked) await planningApi.removeFromLineup(workspace.id, task.id);
      else await planningApi.addToLineup(workspace.id, task.id);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!tasks.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center text-sm text-gray-400">
        <PartyPopper size={20} />
        Nothing is due in the next week and nothing is picked. Enjoy it.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-2xl font-semibold leading-none text-gray-900">{hours(planned_seconds)}</span>
        <span className="text-xs text-gray-500">picked of {hours(capacity)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100" role="meter" aria-label="Picked against today's hours">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, full * 100)}%` }} />
      </div>
      <p className={`mt-2 rounded-lg px-3 py-1.5 text-xs ${note.skin}`}>{note.text}</p>
      {error && <p className="mt-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</p>}

      <p className="mb-1 mt-2.5 text-[11px] font-medium text-gray-500">Tick what you are doing today</p>
      <ul className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={task.picked}
              aria-label={task.picked ? `Take ${task.name} off today` : `Do ${task.name} today`}
              disabled={busy === task.id}
              onClick={() => toggle(task)}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                task.picked ? 'border-teal-500 bg-teal-500 text-white' : 'border-gray-300 hover:border-teal-400'} disabled:opacity-50`}
            >
              {task.picked && <Check size={11} strokeWidth={3} />}
            </button>
            <button
              type="button"
              onClick={() => onOpenTask(task.id)}
              className={`min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm hover:bg-gray-50 ${
                task.picked ? 'text-gray-900' : 'text-gray-700'}`}
            >
              {task.name}
            </button>
            {task.due_date && (
              <span className={`shrink-0 text-[11px] ${task.overdue ? 'text-red-600' : 'text-gray-400'}`}>
                {formatDue(task.due_date)}
              </span>
            )}
            <span className="w-12 shrink-0 text-right text-xs text-gray-500">
              {task.time_estimate_seconds ? hours(task.time_estimate_seconds) : <span className="text-gray-300">—</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
