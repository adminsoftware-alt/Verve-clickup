import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { workApi, type LocationActivity, type LocationKind } from '../api';
import { Avatar } from '../ui';
import { useWork } from '../WorkContext';
import { describeActivity } from '../task/TaskFeed';

const FILTERS: { key: string; label: string; kinds: string[] | null }[] = [
  { key: 'all', label: 'Everything', kinds: null },
  { key: 'comment', label: 'Comments', kinds: ['comment'] },
  { key: 'status', label: 'Status changes', kinds: ['status'] },
  { key: 'people', label: 'Assignees', kinds: ['assignees'] },
  { key: 'dates', label: 'Dates', kinds: ['due_date', 'start_date'] },
  { key: 'created', label: 'New tasks', kinds: ['created'] },
];

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
};

/** ClickUp's Activity view: everything that happened to the tasks here, newest first. */
export const ActivityView: React.FC<{ kind: LocationKind; id: string; refreshKey: number; onOpenTask: (id: string) => void }> = ({ kind, id, refreshKey, onOpenTask }) => {
  const { members } = useWork();
  const [items, setItems] = useState<LocationActivity[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [more, setMore] = useState(true);
  const load = useCallback(() => workApi.locationActivity(kind, id).then((rows) => { setItems(rows); setMore(rows.length >= 100); }).catch(() => setItems([])), [kind, id]);
  useEffect(() => { load(); }, [load, refreshKey]);
  const older = async () => {
    if (!items?.length) return;
    const rows = await workApi.locationActivity(kind, id, items[items.length - 1].created_at);
    setItems((cur) => [...(cur ?? []), ...rows]);
    setMore(rows.length >= 100);
  };
  const name = (uid: string) => { const m = members.find((x) => x.user.id === uid); return m ? m.user.display_name || m.user.email : 'someone'; };
  const shown = useMemo(() => {
    const kinds = FILTERS.find((f) => f.key === filter)?.kinds;
    return (items ?? []).filter((i) => !kinds || kinds.includes(i.kind));
  }, [items, filter]);
  const days = useMemo(() => {
    const out: { day: string; items: LocationActivity[] }[] = [];
    shown.forEach((i) => {
      const d = dayLabel(i.created_at);
      if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, items: [i] });
      else out[out.length - 1].items.push(i);
    });
    return out;
  }, [shown]);
  return (
    <div className="mx-auto max-w-3xl px-6 py-4">
      <div className="mb-3 flex flex-wrap gap-1" role="radiogroup" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" role="radio" aria-checked={filter === f.key} onClick={() => setFilter(f.key)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${filter === f.key ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{f.label}</button>
        ))}
      </div>
      {items === null ? <p className="text-sm text-gray-400">Loading…</p> : days.length === 0 ? <p className="py-10 text-center text-sm text-gray-400">Nothing yet.</p> : (
        <div className="space-y-5" aria-label="Activity">
          {days.map((d) => (
            <section key={d.day}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{d.day}</h3>
              <ul className="space-y-2">
                {d.items.map((a) => (
                  <li key={a.id} className="flex items-start gap-2.5 rounded-lg border border-gray-100 bg-white px-3 py-2">
                    {a.user ? <Avatar user={a.user} size={24} /> : <span className="h-6 w-6 rounded-full bg-gray-200" />}
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="text-gray-700">
                        <b className="font-medium text-gray-900">{a.user ? a.user.display_name || a.user.email : (a.data as Record<string, unknown>)?.automation ? 'Automation' : 'Someone'}</b>{' '}
                        {a.kind === 'comment' ? 'commented on' : describeActivity({ id: a.id, user: a.user, kind: a.kind, data: a.data, created_at: a.created_at }, name)}
                        {a.kind === 'comment' ? ' ' : ' · '}
                        <button type="button" onClick={() => onOpenTask(a.task_id)} className="font-medium text-indigo-700 hover:underline">{a.task_name}</button>
                      </p>
                      {a.comment && <p className="mt-1 whitespace-pre-wrap rounded bg-gray-50 px-2 py-1 text-gray-800">{a.comment}</p>}
                    </div>
                    <span className="shrink-0 text-xs text-gray-400">{new Date(a.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {more && <button type="button" onClick={older} className="w-full rounded-md border border-gray-200 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Load older activity</button>}
        </div>
      )}
    </div>
  );
};
