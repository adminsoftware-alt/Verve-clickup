import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWork } from './WorkContext';
import { useRunningTimer } from './RunningTimer';
import { workApi, type Task } from './api';
import { startOfDay } from './ui';

const DAY_MS = 86_400_000;

interface MyTasksValue {
  /** Open tasks assigned to me, anywhere I can still open them. */
  tasks: Task[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** My Personal List's id, creating the List the first time. */
  ensurePersonalList: () => Promise<string | null>;
  /** Go to my Personal List, creating it the first time. */
  openPersonalList: () => Promise<void>;
}

const Ctx = createContext<MyTasksValue | null>(null);

export const useMyTasks = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMyTasks must be used inside MyTasksProvider');
  return ctx;
};

export const isOpen = (t: Task) => t.status.group !== 'closed' && t.status.group !== 'done';

/** Due before the end of today and still open: ClickUp's "Today & Overdue". */
export function isDueTodayOrOverdue(t: Task, now = new Date()): boolean {
  if (!t.due_date || !isOpen(t)) return false;
  return new Date(t.due_date).getTime() < startOfDay(now).getTime() + DAY_MS;
}

export const MyTasksProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { workspace, hierarchy, refresh: refreshTree } = useWork();
  const { version } = useRunningTimer();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const seq = useRef(0);
  const refresh = useCallback(async () => {
    if (!workspace) return;
    const mine = ++seq.current; // only the newest load may land
    try {
      const page = await workApi.myTasks(workspace.id);
      if (mine !== seq.current) return;
      setError(null);
      setTasks(page.tasks);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [workspace]);

  // The tree reloads after every change made on a location page, so follow it.
  useEffect(() => { refresh(); }, [refresh, hierarchy, version]);

  const ensurePersonalList = useCallback(async () => {
    if (!workspace) return null;
    if (hierarchy?.personal_list) return hierarchy.personal_list.id;
    const created = await workApi.openPersonalList(workspace.id);
    await refreshTree();
    return created.id;
  }, [workspace, hierarchy, refreshTree]);

  const openPersonalList = useCallback(async () => {
    const id = await ensurePersonalList();
    if (id) navigate(`/l/${id}`);
  }, [ensurePersonalList, navigate]);

  const value = useMemo(
    () => ({ tasks, loading, error, refresh, ensurePersonalList, openPersonalList }),
    [tasks, loading, error, refresh, ensurePersonalList, openPersonalList],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
