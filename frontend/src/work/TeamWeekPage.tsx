import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarRange, CheckCircle2, Clock, Plane, Users } from 'lucide-react';
import { useWork } from './WorkContext';
import { Avatar } from './ui';
import { outboundApi, type TeamDigest } from './outboundApi';

const h = (s: number) => `${Math.round((s / 3600) * 10) / 10}h`;
const day = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** The manager's weekly digest, in the app: last week for each direct report and team member, and who is away soon. */
export const TeamWeekPage: React.FC = () => {
  const { workspace } = useWork();
  const [digest, setDigest] = useState<TeamDigest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (workspace) outboundApi.teamDigest(workspace.id).then(setDigest).catch((e) => setError(e.message)); }, [workspace]);
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="border-b border-gray-200 px-6 py-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><Users size={18} className="text-brand-600" /> My team's week</h1>
        {digest && <p className="text-xs text-gray-500">Last week ({day(digest.week_start)} – {day(digest.week_end)}) for your direct reports and the Teams you lead, plus leave in the next two weeks. Also emailed on Mondays.</p>}
      </header>
      <main className="min-h-0 flex-1 overflow-auto bg-gray-50/60 p-6">
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!digest ? <p className="text-sm text-gray-400">Loading…</p> : digest.people.length === 0 ? (
          <p className="mx-auto max-w-md rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">Nobody reports to you and you don't lead a Team yet.</p>
        ) : (
          <ul className="mx-auto grid max-w-6xl grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Team members">
            {digest.people.map((p) => {
              const pct = p.capacity_seconds ? Math.round((100 * p.tracked_seconds) / p.capacity_seconds) : null;
              return (
                <li key={p.user.id} aria-label={p.user.display_name || p.user.email} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <Avatar user={p.user} size={28} />
                    <span className="font-medium text-gray-900">{p.user.display_name || p.user.email}</span>
                    {p.timesheet_status && <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[11px] capitalize text-gray-600">timesheet {p.timesheet_status.replace('_', ' ')}</span>}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className={`rounded-lg p-2 ${p.overdue ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}><AlertTriangle size={14} className="mx-auto" /><b className="block text-lg">{p.overdue}</b>overdue</div>
                    <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><CheckCircle2 size={14} className="mx-auto" /><b className="block text-lg">{p.done_last_week}</b>done last week</div>
                    <div className={`rounded-lg p-2 ${pct != null && pct < 80 ? 'bg-amber-50 text-amber-800' : 'bg-brand-50 text-brand-700'}`}><Clock size={14} className="mx-auto" /><b className="block text-lg">{h(p.tracked_seconds)}</b>of {h(p.capacity_seconds)} logged</div>
                  </div>
                  {p.overdue_tasks.length > 0 && (
                    <ul className="mt-3 space-y-1 text-sm">
                      {p.overdue_tasks.map((t) => (
                        <li key={t.id}><Link to={`/l/${t.list_id}?task=${t.id}`} className="flex justify-between gap-2 text-gray-700 no-underline hover:text-brand-700"><span className="truncate">{t.name}</span>{t.due_date && <span className="shrink-0 text-xs text-red-600">{new Date(t.due_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}</Link></li>
                      ))}
                    </ul>
                  )}
                  {p.leave.length > 0 && (
                    <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-amber-800"><Plane size={12} />
                      {p.leave.map((l, i) => <span key={i}>{l.type} {day(l.start_date)}{l.end_date !== l.start_date ? `–${day(l.end_date)}` : ''}{l.status === 'pending' ? ' (requested)' : ''}</span>)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-gray-400"><CalendarRange size={12} /> Hours logged are compared with working hours, less holidays and approved leave.</p>
      </main>
    </div>
  );
};
