import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { useWork } from '../WorkContext';
import { workApi, type LocationKind, type Workload, type WorkloadRow } from '../api';
import { Avatar, StatusDot, formatDue, startOfDay } from '../ui';

const DAY_MS = 86_400_000;

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mondayOf(d: Date): Date {
  const day = startOfDay(d);
  return new Date(day.getTime() - ((day.getDay() + 6) % 7) * DAY_MS);
}

function formatHours(seconds: number): string {
  if (seconds <= 0) return '';
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)}m`;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

/** Same bands ClickUp uses for WIP limits: under, nearing or at, over. */
function tone(scheduled: number, capacity: number): string {
  if (scheduled === 0) return 'bg-gray-50 text-gray-300';
  if (capacity === 0 || scheduled > capacity) return 'bg-red-100 text-red-700';
  if (scheduled >= capacity * 0.8) return 'bg-amber-100 text-amber-800';
  return 'bg-emerald-50 text-emerald-700';
}

export const WorkloadView: React.FC<{
  kind: LocationKind;
  id: string;
  refreshKey: number;
  listName: (listId: string) => string | null;
  onOpenTask: (id: string) => void;
}> = ({ kind, id, refreshKey, listName, onOpenTask }) => {
  const { teams } = useWork();
  const [start, setStart] = useState(() => mondayOf(new Date()));
  const [days, setDays] = useState(14);
  const [teamId, setTeamId] = useState('');
  const [data, setData] = useState<Workload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    setError(null);
    workApi.workload(kind, id, isoDate(start), days, teamId || undefined).then(setData).catch((e) => setError(e.message));
  }, [kind, id, start, days, teamId, refreshKey]);

  const dates = useMemo(() => (data?.days ?? []).map((d) => new Date(`${d}T00:00:00`)), [data]);
  const today = isoDate(new Date());

  const toggle = (key: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const rowKey = (row: WorkloadRow) => row.user?.id ?? '__unassigned';
  const total = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const grid = { gridTemplateColumns: `240px repeat(${days}, minmax(52px, 1fr))` };

  return (
    <div className="px-6 pb-8">
      <div className="flex flex-wrap items-center gap-3 py-3">
        <button type="button" onClick={() => setStart(mondayOf(new Date()))} className="rounded-md border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">
          Today
        </button>
        <button type="button" title="Earlier" onClick={() => setStart(new Date(start.getTime() - 7 * DAY_MS))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronLeft size={18} /></button>
        <button type="button" title="Later" onClick={() => setStart(new Date(start.getTime() + 7 * DAY_MS))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronRight size={18} /></button>
        <span className="text-sm font-medium text-gray-700">
          {start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – {new Date(start.getTime() + (days - 1) * DAY_MS).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-700">
          <option value={7}>1 week</option>
          <option value={14}>2 weeks</option>
          <option value={28}>4 weeks</option>
        </select>
        <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
          <Users size={15} />
          <select aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-700">
            <option value="">Everyone</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>

      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {!data ? (
        <div className="py-10 text-center text-sm text-gray-400">Loading workload…</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200" role="table" aria-label="Workload">
            <div className="grid border-b border-gray-200 bg-gray-50 text-xs font-medium text-gray-500" style={grid} role="row">
              <div className="px-3 py-2">Person</div>
              {dates.map((d) => (
                <div key={d.toISOString()} className={`px-1 py-2 text-center ${[0, 6].includes(d.getDay()) ? 'bg-gray-100' : ''} ${isoDate(d) === today ? 'text-indigo-600' : ''}`}>
                  {d.toLocaleDateString(undefined, { weekday: 'short' })} {d.getDate()}
                </div>
              ))}
            </div>

            {data.rows.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-gray-400">No one in this {teamId ? 'Team' : kind === 'space' ? 'Space' : kind === 'folder' ? 'Folder' : 'List'} yet.</div>
            )}

            {data.rows.map((row) => {
              const key = rowKey(row);
              const expanded = open.has(key);
              const scheduled = total(row.scheduled_seconds);
              const capacity = total(row.capacity_seconds);
              return (
                <div key={key} className="border-b border-gray-100 last:border-b-0" role="rowgroup">
                  <div className="grid items-stretch text-sm" style={grid} role="row">
                    <button type="button" onClick={() => toggle(key)} className="flex min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                      {row.tasks.length > 0 ? (expanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />) : <span className="w-3.5" />}
                      {row.user ? <Avatar user={row.user} size={22} /> : <span className="h-[22px] w-[22px] rounded-full bg-gray-200" />}
                      <span className="min-w-0 flex-1 truncate text-gray-800">{row.user ? row.user.display_name || row.user.email : 'Unassigned'}</span>
                      <span className="shrink-0 text-xs text-gray-400">{formatHours(scheduled) || '0h'}{row.user ? ` / ${formatHours(capacity) || '0h'}` : ''}</span>
                    </button>
                    {row.scheduled_seconds.map((value, i) => {
                      const cap = row.capacity_seconds[i];
                      return (
                        <div
                          key={i}
                          title={row.user ? `${formatHours(value) || '0h'} scheduled of ${formatHours(cap) || '0h'} capacity` : `${formatHours(value)} unassigned`}
                          className={`m-0.5 flex items-center justify-center rounded text-xs font-medium ${row.user ? tone(value, cap) : value ? 'bg-gray-100 text-gray-600' : 'bg-gray-50 text-gray-300'}`}
                        >
                          {formatHours(value) || (row.user && cap === 0 ? '' : '–')}
                        </div>
                      );
                    })}
                  </div>
                  {expanded && row.tasks.map((task) => (
                    <div key={task.id} className="grid items-center bg-gray-50/60 text-xs" style={grid} role="row">
                      <button type="button" onClick={() => onOpenTask(task.id)} className="flex min-w-0 items-center gap-2 py-1.5 pl-10 pr-3 text-left hover:underline">
                        <StatusDot status={task.status} size={10} />
                        <span className="min-w-0 truncate text-gray-700">{task.name}</span>
                        <span className="ml-auto shrink-0 truncate text-[11px] text-gray-400">{listName(task.list_id) ?? ''}</span>
                      </button>
                      {task.seconds_per_day.map((value, i) => (
                        <div key={i} className="text-center text-gray-500">{formatHours(value)}</div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <p className="mt-2 text-xs text-gray-400">
            Capacity is 8h on weekdays. Each task's estimate is spread evenly over the working days between its start and due dates.
            <span className="ml-2 inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-emerald-200" />under 80%</span>
            <span className="ml-2 inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-amber-200" />80–100%</span>
            <span className="ml-2 inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-red-200" />over capacity</span>
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            {([['Unscheduled', data.unscheduled, 'Open tasks with no start or due date'], ['No estimate', data.no_estimate, 'Scheduled in this period, but with no time estimate']] as const).map(([title, items, hint]) => (
              <section key={title} className="rounded-lg border border-gray-200">
                <header className="border-b border-gray-100 px-3 py-2">
                  <h4 className="text-sm font-semibold text-gray-700">{title} <span className="font-normal text-gray-400">{items.length}</span></h4>
                  <p className="text-xs text-gray-400">{hint}</p>
                </header>
                {items.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-gray-400">Nothing here</div>
                ) : items.map((t) => (
                  <button key={t.id} type="button" onClick={() => onOpenTask(t.id)} className="flex w-full items-center gap-2 border-b border-gray-50 px-3 py-1.5 text-left text-sm hover:bg-gray-50">
                    <StatusDot status={t.status} size={10} />
                    <span className="min-w-0 flex-1 truncate text-gray-700">{t.name}</span>
                    <span className="shrink-0 text-xs text-gray-400">{formatDue(t.due_date)}</span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
