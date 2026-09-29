import React, { useEffect, useState } from 'react';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CalendarX, CheckCircle2, Clock3, ListTodo, UserX } from 'lucide-react';
import { workApi, type Bucket, type Dashboard, type LocationKind } from '../api';
import { StatusDot, formatDue } from '../ui';

type BucketKey = 'done_today' | 'overdue' | 'unassigned' | 'no_estimate' | 'unscheduled';

const CARDS: { key: BucketKey; label: string; icon: React.ReactNode; tone: string }[] = [
  { key: 'done_today', label: 'Work done today', icon: <CheckCircle2 size={18} />, tone: 'text-emerald-600' },
  { key: 'overdue', label: 'Overdue', icon: <AlertTriangle size={18} />, tone: 'text-red-600' },
  { key: 'unassigned', label: 'Unassigned', icon: <UserX size={18} />, tone: 'text-amber-600' },
  { key: 'no_estimate', label: 'Without estimate', icon: <Clock3 size={18} />, tone: 'text-sky-600' },
  { key: 'unscheduled', label: 'Unscheduled', icon: <CalendarX size={18} />, tone: 'text-brand-600' },
];

export const DashboardView: React.FC<{
  kind: LocationKind;
  id: string;
  refreshKey: number;
  listName: (listId: string) => string | null;
  onOpenTask: (id: string) => void;
}> = ({ kind, id, refreshKey, listName, onOpenTask }) => {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openBucket, setOpenBucket] = useState<BucketKey | null>(null);

  useEffect(() => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    workApi.dashboard(kind, id, midnight.toISOString()).then(setData).catch((e) => setError(e.message));
  }, [kind, id, refreshKey]);

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!data) return <div className="p-6 text-sm text-gray-400">Loading dashboard…</div>;

  const bucket: Bucket | null = openBucket ? data[openBucket] : null;
  const assigneeData = data.by_assignee.map((a) => ({
    name: a.user ? a.user.display_name || a.user.email.split('@')[0] : 'Unassigned',
    count: a.count,
  }));

  return (
    <div className="space-y-5 px-6 py-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500"><ListTodo size={18} className="text-brand-600" />Open tasks</div>
          <div className="mt-2 text-3xl font-semibold text-gray-900">{data.total_open}</div>
        </div>
        {CARDS.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => setOpenBucket(openBucket === card.key ? null : card.key)}
            className={`rounded-xl border bg-white p-4 text-left transition hover:shadow-sm ${openBucket === card.key ? 'border-brand-400 ring-2 ring-brand-100' : 'border-gray-200'}`}
          >
            <div className="flex items-center gap-2 text-sm text-gray-500"><span className={card.tone}>{card.icon}</span>{card.label}</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">{data[card.key].count}</div>
          </button>
        ))}
      </div>

      {bucket && (
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700">
            {CARDS.find((c) => c.key === openBucket)?.label} · {bucket.count}
            {bucket.count > bucket.tasks.length && <span className="ml-2 font-normal text-gray-400">showing first {bucket.tasks.length}</span>}
          </div>
          {bucket.tasks.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">Nothing here — good.</div>
          ) : (
            bucket.tasks.map((t) => (
              <button key={t.id} type="button" onClick={() => onOpenTask(t.id)} className="grid w-full grid-cols-[minmax(0,1fr)_160px_100px] items-center gap-2 border-b border-gray-50 px-4 py-2 text-left text-sm hover:bg-gray-50">
                <span className="flex min-w-0 items-center gap-2"><StatusDot status={t.status} size={12} /><span className="truncate text-gray-800">{t.name}</span></span>
                <span className="truncate text-xs text-gray-400">{listName(t.list_id) ?? ''}</span>
                <span className="text-xs text-gray-500">{formatDue(t.due_date)}</span>
              </button>
            ))
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Workload by status</h3>
          {data.by_status.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">No open tasks</div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="h-56 flex-1">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={data.by_status} dataKey="count" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {data.by_status.map((s) => <Cell key={s.name + s.group} fill={s.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5 text-sm">
                {data.by_status.map((s) => (
                  <li key={s.name + s.group} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-gray-700">{s.name}</span>
                    <span className="text-gray-400">{s.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Open tasks by assignee</h3>
          {assigneeData.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">No open tasks</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={assigneeData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
