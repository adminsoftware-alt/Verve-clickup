import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Square } from 'lucide-react';
import { useAuth } from '../components/AuthContext';
import { workApi, type RunningTimer } from './api';
import { notify } from '../components/notify';

interface TimerContextValue {
  timer: RunningTimer | null;
  /** Bumps whenever a timer starts or stops, so views can refresh their totals. */
  version: number;
  start: (taskId: string) => Promise<void>;
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

  const start = useCallback(async (taskId: string) => {
    await workApi.startTimer(taskId);
    await refresh();
    setVersion((v) => v + 1);
  }, [refresh]);

  const stop = useCallback(async () => {
    await workApi.stopTimer();
    setTimer(null);
    setVersion((v) => v + 1);
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
    <div className="fresh-label flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-[#D9E1EF] bg-white py-1 pl-3 pr-1 text-[13px] shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
      {/* Recording: a red dot that breathes while the clock runs. */}
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-60" />
        <span className="relative h-2 w-2 rounded-full bg-red-500" />
      </span>
      <Link to={`/l/${timer.list_id}`} className="max-w-[9rem] truncate font-medium text-[#1B2A4A] no-underline hover:underline xl:max-w-[12rem]">
        {timer.task_name}
      </Link>
      <span className="font-semibold tabular-nums text-[#234788]">{formatClock(elapsed)}</span>
      <button aria-label="Stop timer" type="button" onClick={() => stop().catch((e) => notify.error(e))}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 hover:bg-red-100">
        <Square size={10} fill="currentColor" />
      </button>
    </div>
  );
};
