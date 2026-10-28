import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Search, Users } from 'lucide-react';
import { useWork } from '../WorkContext';
import { FEATURES } from '../../config/features';
import { ApiError, peek } from '../api';
import { Avatar } from '../ui';
import { Select } from '../Select';
import { STATUS_CLASS, STATUS_LABEL, isoDay, sheetApi, type AllTimesheets as Data, type SubmissionStatus } from './api';
import { WeekNav, dayLabel, hours, isWeekend, prefetchWeeks, WEEKEND } from './pieces';

type Person = Data['people'][number];

/**
 * What a lead is actually scanning for in a week of everyone's hours.
 *
 * Not "show me rows matching a field" -- the questions are who has logged nothing, who is over
 * their capacity, and whose sheet is still sitting unsubmitted. Each of those is a shape in the
 * numbers already on screen, so they are worked out here rather than asked of the server.
 */
const SHAPES: { value: string; label: string; keep: (p: Person) => boolean }[] = [
  { value: 'all', label: 'Everyone', keep: () => true },
  { value: 'nothing', label: 'Logged nothing', keep: (p) => p.total_seconds === 0 && p.capacity_seconds > 0 },
  { value: 'under', label: 'Under capacity', keep: (p) => p.total_seconds > 0 && p.total_seconds < p.capacity_seconds },
  { value: 'over', label: 'Over capacity', keep: (p) => p.capacity_seconds > 0 && p.total_seconds > p.capacity_seconds },
  { value: 'on_target', label: 'On target', keep: (p) => p.capacity_seconds > 0 && p.total_seconds >= p.capacity_seconds * 0.95 && p.total_seconds <= p.capacity_seconds },
];

const SORTS: { value: string; label: string; by: (a: Person, b: Person) => number }[] = [
  { value: 'name', label: 'Name', by: (a, b) => (a.user.display_name || a.user.email).localeCompare(b.user.display_name || b.user.email) },
  { value: 'most', label: 'Most hours', by: (a, b) => b.total_seconds - a.total_seconds },
  { value: 'least', label: 'Least hours', by: (a, b) => a.total_seconds - b.total_seconds },
  { value: 'gap', label: 'Furthest from capacity', by: (a, b) => (b.capacity_seconds - b.total_seconds) - (a.capacity_seconds - a.total_seconds) },
];

/** Plus "not submitted", which is the absence of a submission rather than one of its states. */
const APPROVAL_STATES: SubmissionStatus[] = ['pending', 'approved', 'changes_needed', 'withdrawn'];

/** Everyone's week at a glance: owners and admins see everybody, Team leads their Teams. */
export const AllTimesheets: React.FC = () => {
  const { workspace, teams } = useWork();
  const navigate = useNavigate();
  const today = isoDay(new Date());
  const [params, setParams] = useSearchParams();
  const day = params.get('week') || isoDay(new Date());
  const [teamId, setTeamId] = useState('');
  const [query, setQuery] = useState('');
  const [shape, setShape] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('name');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);

  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    if (!workspace) return;
    // A week seen before (or fetched ahead, below) draws at once; the fresh copy replaces it.
    const fetchWeek = () => sheetApi.all(workspace.id, day, teamId || undefined);
    const last = peek(fetchWeek);
    if (last) setData(last);
    setBusy(!last);
    fetchWeek()
      .then((d) => { setData(d); setError(null); setRefused(false); })
      .finally(() => setBusy(false))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) setRefused(true);
        else setError(e.message);
      });
  }, [workspace, day, teamId]);
  useEffect(() => { load(); }, [load]);
  const shownStart = data?.period_start;
  useEffect(() => {
    if (!workspace || !shownStart) return undefined;
    return prefetchWeeks(shownStart, (start) => sheetApi.all(workspace.id, start, teamId || undefined));
  }, [workspace, shownStart, teamId]);

  const people = useMemo(() => {
    const rows = data?.people ?? [];
    const q = query.trim().toLowerCase();
    const keep = SHAPES.find((s) => s.value === shape)?.keep ?? (() => true);
    const by = SORTS.find((s) => s.value === sort)?.by;
    const out = rows.filter((p) => (
      (!q || `${p.user.display_name ?? ''} ${p.user.email}`.toLowerCase().includes(q))
      && keep(p)
      && (status === 'all' || (p.submission_status ?? 'none') === status)
    ));
    return by ? [...out].sort(by) : out;
  }, [data, query, shape, status, sort]);

  const openPerson = useCallback((userId: string) => {
    navigate(`/timesheets/people/${encodeURIComponent(userId)}?week=${shownStart}`);
  }, [navigate, shownStart]);

  const narrowed = (data?.people.length ?? 0) - people.length;
  // Somebody who may only see their own hours gets told so, not an empty week with no dates.
  if (refused) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm" role="alert">
        <Lock size={22} className="mx-auto text-gray-400" aria-hidden />
        <h2 className="mt-3 text-base font-semibold text-gray-900">You don’t have access to everyone’s timesheets</h2>
        <p className="mt-1 text-sm text-gray-600">Admins and Team leads can see other people’s hours. Your own week is in My timesheet.</p>
        <button type="button" onClick={() => navigate('/timesheets')} className="mt-4 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
          Open my timesheet
        </button>
      </div>
    );
  }
  const control = 'h-9 w-36';
  const cols = 'minmax(220px,1.6fr) repeat(7, minmax(80px,1fr)) minmax(110px,1fr)';
  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="flex flex-wrap items-center gap-3">
        <WeekNav start={data?.period_start ?? null} end={data?.period_end ?? null} onGo={(d) => setParams({ week: d })} />

        <label className="flex h-9 w-56 items-center gap-2 rounded-lg border border-gray-300 bg-white px-2.5 transition-colors hover:border-gray-400 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/15">
          <Search size={14} className="shrink-0 text-gray-400" />
          <input
            aria-label="Find someone" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Find someone" className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
          />
        </label>

        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className={control}>
            <Select
              label="Team" value={teamId} onChange={setTeamId}
              choices={[
                { value: '', label: 'All members', icon: <Users size={13} className="text-gray-400" /> },
                ...teams.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          </span>
          <span className={control}>
            <Select label="Showing" value={shape} onChange={setShape} choices={SHAPES.map((s) => ({ value: s.value, label: s.label }))} />
          </span>
          {data?.approvals_enabled && (
            <span className={control}>
              <Select
                label="Approval" value={status} onChange={setStatus}
                choices={[
                  { value: 'all', label: 'Any status' },
                  { value: 'none', label: 'Not submitted' },
                  ...APPROVAL_STATES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
                ]}
              />
            </span>
          )}
          {/* The sort chip comes off: a week is read by name, which is what it is ordered by.
              The orderings themselves are still here if the chip is ever wanted back. */}
          {FEATURES.timesheetSortChip && (
            <span className={control}>
              <Select label="Sort" value={sort} onChange={setSort} choices={SORTS.map((s) => ({ value: s.value, label: s.label }))} />
            </span>
          )}
        </span>
      </div>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {data && (
        <>
          {/* Say what is being left out, and offer the way back. A filtered list that looks like
              an empty week is how people conclude nobody tracked anything. */}
          {narrowed > 0 && (
            <p className="mt-3 flex items-center gap-2 text-xs text-gray-500">
              Showing {people.length} of {data.people.length}.
              <button
                type="button"
                onClick={() => { setQuery(''); setShape('all'); setStatus('all'); }}
                className="rounded px-1.5 py-0.5 font-medium text-brand-600 transition-colors hover:bg-brand-50"
              >
                Clear the filters
              </button>
            </p>
          )}
          <div className={`ui-card mt-4 overflow-x-auto ts-week ${busy ? 'is-busy' : ''}`}>
            <div className="min-w-[980px]" role="table" aria-label="All timesheets">
              <div className="grid border-b border-gray-200 text-xs text-gray-500" style={{ gridTemplateColumns: cols }} role="row">
                <div className="px-4 py-3 text-sm text-gray-700">Person</div>
                {data.days.map((d) => (
                  <div key={d} className={`border-l border-gray-100 px-2.5 py-3 ${d === today ? 'bg-brand-50/50 font-medium text-brand-700' : isWeekend(d) ? `${WEEKEND} text-gray-400` : ''}`}>{dayLabel(d)}</div>
                ))}
                <div className="border-l border-gray-100 px-2.5 py-3">Total</div>
              </div>
              {people.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-gray-400">
                  {data.people.length === 0 ? 'No one here.' : 'Nobody matches those filters this week.'}
                </div>
              )}
              {people.map((p) => (
                <PersonRow key={p.user.id} p={p} days={data.days} cols={cols} approvals={data.approvals_enabled} onOpen={openPerson} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/**
 * One person's week. Drawn again only when their figures change, not on every click on the page:
 * with seventy-odd people, redrawing them all to move the week's title is what made it lag.
 */
const PersonRow = React.memo<{ p: Person; days: string[]; cols: string; approvals: boolean; onOpen: (userId: string) => void }>(({ p, days, cols, approvals, onOpen }) => (
  <div className="grid cursor-pointer border-b border-gray-100 transition-colors last:border-b-0 hover:bg-gray-50/70" style={{ gridTemplateColumns: cols }} role="row"
    onClick={() => onOpen(p.user.id)}>
    <div className="flex min-w-0 items-center gap-2.5 px-4 py-2.5">
      <Avatar user={p.user} size={28} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-gray-900">{p.user.display_name || p.user.email}</div>
        <div className="text-xs text-gray-400">Capacity {hours(p.capacity_seconds)}</div>
      </div>
      {approvals && p.submission_status && (
        <span className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[p.submission_status]}`}>{STATUS_LABEL[p.submission_status]}</span>
      )}
    </div>
    {p.tracked_per_day.map((sec, i) => {
      const cap = p.capacity_per_day[i];
      const over = sec > cap;
      return (
        <div key={i} className={`border-l border-gray-100 px-2.5 py-2.5 ${isWeekend(days[i]) ? WEEKEND : cap === 0 ? 'bg-gray-50' : ''}`}
          title={`Capacity ${hours(cap)} · Tracked ${hours(sec)} · Billable ${hours(p.billable_per_day[i])} · ${over ? `Over by ${hours(sec - cap)}` : `Remaining ${hours(cap - sec)}`}`}>
          <div className={`text-sm ${sec ? 'text-gray-900' : 'text-gray-300'}`}>{sec ? hours(sec) : '—'}</div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-gray-200"><div className={`h-full ${over ? 'bg-red-500' : 'bg-brand-500'}`} style={{ width: `${cap ? Math.min(100, (100 * sec) / cap) : sec ? 100 : 0}%` }} /></div>
        </div>
      );
    })}
    <div className="border-l border-gray-100 px-2.5 py-2.5">
      <div className="text-sm font-medium text-gray-900">{hours(p.total_seconds)}</div>
      <div className="text-xs text-gray-400">of {hours(p.capacity_seconds)}</div>
    </div>
  </div>
), (a, b) => a.cols === b.cols && a.approvals === b.approvals && a.onOpen === b.onOpen
  && a.days.join() === b.days.join() && JSON.stringify(a.p) === JSON.stringify(b.p));
PersonRow.displayName = 'PersonRow';
