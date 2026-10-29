import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Square } from 'lucide-react';
import { useAuth } from '../components/AuthContext';
import { workApi, type RunningTimer, type UserRef } from './api';
import { notify } from '../components/notify';

interface TimerContextValue {
  timer: RunningTimer | null;
  /** Bumps whenever a timer starts or stops, so views can refresh their totals. */
  version: number;
  /** Pass the task's name and List where they are known, and the header shows the timer at once. */
  start: (taskId: string, task?: { name: string; list_id: string }) => Promise<void>;
  stop: () => Promise<void>;
}

const Ctx = createContext<TimerContextValue | null>(null);

export const useRunningTimer = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRunningTimer must be used inside RunningTimerProvider');
  return ctx;
};

/** Re-renders every `ms` while `active`, for ticking clocks. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const RunningTimerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [timer, setTimer] = useState<RunningTimer | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    try { setTimer(await workApi.runningTimer()); } catch { setTimer(null); }
  }, []);

  useEffect(() => { if (user) refresh(); }, [user, refresh]);

  const current = useRef(timer);
  current.current = timer;

  // Starting and stopping show at once; the server is a long way off, and a click that waited
  // for two round trips before anything moved felt broken. A refusal puts things back and says why.
  const start = useCallback(async (taskId: string, task?: { name: string; list_id: string }) => {
    const before = current.current;
    if (task) {
      setTimer({
        entry: {
          id: 'starting', task_id: taskId, user: { id: user?.uid ?? '' } as UserRef, started_at: new Date().toISOString(),
          ended_at: null, duration_seconds: null, running: true, description: null, billable: false,
        },
        task_name: task.name, list_id: task.list_id,
      });
    }
    try {
      const entry = await workApi.startTimer(taskId);
      // The server's own start time, so the clock agrees with the timesheet.
      if (task) setTimer({ entry, task_name: task.name, list_id: task.list_id });
      else await refresh();
      setVersion((v) => v + 1);
    } catch (e) {
      setTimer(before);
      throw e;
    }
  }, [refresh, user]);

  const stop = useCallback(async () => {
    const before = current.current;
    setTimer(null);
    try {
      await workApi.stopTimer();
      setVersion((v) => v + 1);
    } catch (e) {
      setTimer(before);
      throw e;
    }
  }, []);

  const value = useMemo(() => ({ timer, version, start, stop }), [timer, version, start, stop]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

/** The header chip: what you are timing right now, with a stop button. */
export const RunningTimerChip: React.FC = () => {
  const { timer, stop } = useRunningTimer();
  const now = useNow(!!timer);
  if (!timer) return null;
  const elapsed = (now - new Date(timer.entry.started_at).getTime()) / 1000;
  return (
    // Compact: the dot, the clock (which goes to the task's List) and stop. The task's name joins
    // them only on a wide screen, where there is room for it without crowding the bar.
    <div className="fresh-label flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[#D9E1EF] bg-white py-0.5 pl-2.5 pr-0.5 text-xs shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
      {/* Recording: a red dot that breathes while the clock runs. */}
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-60" />
        <span className="relative h-1.5 w-1.5 rounded-full bg-red-500" />
      </span>
      <Link to={`/l/${timer.list_id}`} aria-label={`Timer on ${timer.task_name}`} className="flex min-w-0 items-center gap-1.5 text-[#1B2A4A] no-underline">
        <span className="hidden max-w-[10rem] truncate font-medium 2xl:block">{timer.task_name}</span>
        <span className="font-semibold tabular-nums text-[#234788]">{formatClock(elapsed)}</span>
      </Link>
      <button aria-label="Stop timer" type="button" onClick={() => stop().catch((e) => notify.error(e))}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 hover:bg-red-100">
        <Square size={8} fill="currentColor" />
      </button>
    </div>
  );
};
