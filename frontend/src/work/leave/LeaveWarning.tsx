import React, { useEffect, useState } from 'react';
import { Plane } from 'lucide-react';
import type { UserRef } from '../api';
import { useWork } from '../WorkContext';
import { iso, leaveApi, type LeaveRequest } from './leaveApi';

// One request per day shown, shared by every task panel that asks.
const cache = new Map<string, Promise<LeaveRequest[]>>();

/** "Priya is on leave that day": shown under a task's assignees when its due date falls on their leave. */
export const LeaveWarning: React.FC<{ dueDate: string | null; assignees: UserRef[] }> = ({ dueDate, assignees }) => {
  const { workspace } = useWork();
  const [away, setAway] = useState<LeaveRequest[]>([]);
  const day = dueDate ? iso(new Date(dueDate)) : null;
  useEffect(() => {
    if (!workspace || !day || !assignees.length) { setAway([]); return; }
    const key = `${workspace.id}:${day}`;
    if (!cache.has(key)) {
      cache.set(key, leaveApi.calendar(workspace.id, day, day).then((c) => c.leave).catch(() => []));
      setTimeout(() => cache.delete(key), 60_000);
    }
    let live = true;
    cache.get(key)!.then((rows) => { if (live) setAway(rows.filter((r) => r.user && assignees.some((a) => a.id === r.user!.id))); });
    return () => { live = false; };
  }, [workspace, day, assignees]);
  if (!away.length) return null;
  return (
    <p className="mx-2 mt-1.5 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800" role="note">
      <Plane size={12} className="mt-0.5 shrink-0" />
      <span>
        {away.map((r) => `${r.user?.display_name || r.user?.email}${r.part !== 'full' ? ' (half day)' : ''}${r.status === 'pending' ? ' (requested)' : ''}`).join(', ')}
        {away.length === 1 ? ' is' : ' are'} on leave on the due date.
      </span>
    </p>
  );
};
