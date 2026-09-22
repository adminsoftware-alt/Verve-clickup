import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import { useWork } from '../WorkContext';
import { Avatar } from '../ui';
import { STATUS_CLASS, STATUS_LABEL, isoDay, sheetApi, type AllTimesheets as Data } from './api';
import { WeekNav, dayLabel, hours } from './pieces';

/** Everyone's week at a glance: owners and admins see everybody, Team leads their Teams. */
export const AllTimesheets: React.FC = () => {
  const { workspace, teams } = useWork();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const day = params.get('week') || isoDay(new Date());
  const [teamId, setTeamId] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!workspace) return;
    sheetApi.all(workspace.id, day, teamId || undefined).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, [workspace, day, teamId]);
  useEffect(() => { load(); }, [load]);

  const cols = 'minmax(220px,1.6fr) repeat(7, minmax(80px,1fr)) minmax(110px,1fr)';
  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="flex flex-wrap items-center gap-4">
        <WeekNav start={data?.period_start ?? null} end={data?.period_end ?? null} onGo={(d) => setParams({ week: d })} />
        <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
          <Users size={15} />
          <select aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm">
            <option value="">All members</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {data && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <div className="min-w-[980px]" role="table" aria-label="All timesheets">
            <div className="grid border-b border-gray-200 text-xs text-gray-500" style={{ gridTemplateColumns: cols }} role="row">
              <div className="px-4 py-3 text-sm text-gray-700">Person</div>
              {data.days.map((d) => <div key={d} className="border-l border-gray-100 px-2.5 py-3">{dayLabel(d)}</div>)}
              <div className="border-l border-gray-100 px-2.5 py-3">Total</div>
            </div>
            {data.people.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-400">No one here.</div>}
            {data.people.map((p) => (
              <div key={p.user.id} className="grid cursor-pointer border-b border-gray-100 last:border-b-0 hover:bg-gray-50/70" style={{ gridTemplateColumns: cols }} role="row"
                onClick={() => navigate(`/timesheets/people/${encodeURIComponent(p.user.id)}?week=${data.period_start}`)}>
                <div className="flex min-w-0 items-center gap-2.5 px-4 py-2.5">
                  <Avatar user={p.user} size={28} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">{p.user.display_name || p.user.email}</div>
                    <div className="text-xs text-gray-400">Capacity {hours(p.capacity_seconds)}</div>
                  </div>
                  {data.approvals_enabled && p.submission_status && (
                    <span className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[p.submission_status]}`}>{STATUS_LABEL[p.submission_status]}</span>
                  )}
                </div>
                {p.tracked_per_day.map((sec, i) => {
                  const cap = p.capacity_per_day[i];
                  const over = sec > cap;
                  return (
                    <div key={i} className={`border-l border-gray-100 px-2.5 py-2.5 ${cap === 0 ? 'bg-gray-50' : ''}`}
                      title={`Capacity ${hours(cap)} · Tracked ${hours(sec)} · Billable ${hours(p.billable_per_day[i])} · ${over ? `Over by ${hours(sec - cap)}` : `Remaining ${hours(cap - sec)}`}`}>
                      <div className={`text-sm ${sec ? 'text-gray-900' : 'text-gray-300'}`}>{sec ? hours(sec) : '—'}</div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-gray-200"><div className={`h-full ${over ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${cap ? Math.min(100, (100 * sec) / cap) : sec ? 100 : 0}%` }} /></div>
                    </div>
                  );
                })}
                <div className="border-l border-gray-100 px-2.5 py-2.5">
                  <div className="text-sm font-medium text-gray-900">{hours(p.total_seconds)}</div>
                  <div className="text-xs text-gray-400">of {hours(p.capacity_seconds)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
