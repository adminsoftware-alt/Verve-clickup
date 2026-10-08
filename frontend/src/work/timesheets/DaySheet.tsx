// The timesheet on a phone: one day at a time.
//
// The week grid is 1,000px at its narrowest, so on a 390px screen it scrolls sideways and you
// cannot see a single day column -- which makes the one thing people most need to do on a phone,
// filling in last night's hours, the one thing they cannot. Seven columns do not shrink into
// three. They become a strip of days you pick from, and one day's worth of rows underneath.
//
// The cell itself is the same component the week grid uses, so the two can never disagree about
// what editing an hour does.
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, MoreHorizontal, Play, Trash2 } from 'lucide-react';

import { Menu, StatusDot } from '../ui';
import { isoDay, type SheetRow, type Timesheet } from './api';
import { hours } from './pieces';

/** One day in the strip across the top: its letter, its date, and what is on it. */
const DayChip: React.FC<{
  iso: string; tracked: number; capacity: number; today: boolean; on: boolean; onPick: () => void;
}> = ({ iso, tracked, capacity, today, on, onPick }) => {
  const d = new Date(`${iso}T00:00:00`);
  const over = tracked > capacity;
  const off = capacity === 0;
  return (
    <button
      type="button" onClick={onPick} aria-pressed={on}
      aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}, ${hours(tracked)} logged`}
      className={`flex min-w-[3.1rem] shrink-0 flex-col items-center gap-0.5 rounded-xl border px-1 py-1.5 transition-colors
        ${on ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white'} ${off ? 'opacity-60' : ''}`}
    >
      <span className={`text-[10px] uppercase ${today ? 'font-semibold text-brand-700' : 'text-gray-400'}`}>
        {d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)}
      </span>
      <span className={`text-base leading-none ${on ? 'font-semibold text-brand-800' : 'text-gray-800'}`}>{d.getDate()}</span>
      <span className={`text-[10px] leading-none ${tracked ? (over ? 'text-red-600' : 'text-gray-600') : 'text-gray-300'}`}>
        {tracked ? hours(tracked) : '–'}
      </span>
    </button>
  );
};

export const DaySheet: React.FC<{
  sheet: Timesheet;
  /** The week grid's cell, handed in so the editing behaviour is literally the same code. */
  renderCell: (row: SheetRow, dayIndex: number) => React.ReactNode;
  onOpenTask: (taskId: string) => void;
  onDeleteRow: (row: SheetRow) => void;
  onStartTimer?: (taskId: string) => void;
  editable: boolean;
}> = ({ sheet, renderCell, onOpenTask, onDeleteRow, onStartTimer, editable }) => {
  const today = isoDay(new Date());
  // Today when the week has it; otherwise the day with the most on it, and failing that the first
  // day anybody works. Opening a past week on its Sunday answers a question nobody asked.
  const [day, setDay] = useState(() => {
    const now = sheet.days.indexOf(today);
    if (now >= 0) return now;
    const busiest = sheet.tracked_per_day.reduce((best, secs, i) => (secs > (sheet.tracked_per_day[best] ?? 0) ? i : best), 0);
    if (sheet.tracked_per_day[busiest]) return busiest;
    const working = sheet.capacity_per_day.findIndex((c) => c > 0);
    return working >= 0 ? working : 0;
  });
  const [openRow, setOpenRow] = useState<string | null>(null);

  const picked = Math.min(day, sheet.days.length - 1);
  const tracked = sheet.tracked_per_day[picked] ?? 0;
  const capacity = sheet.capacity_per_day[picked] ?? 0;
  const over = tracked > capacity && capacity > 0;
  const long = new Date(`${sheet.days[picked]}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  // Rows with time on this day first: on a phone the thing you are editing should not be a scroll
  // away under eleven tasks you did not touch.
  const rows = [...sheet.rows].sort((a, b) => (b.seconds_per_day[picked] ?? 0) - (a.seconds_per_day[picked] ?? 0));
  const withTime = rows.filter((r) => r.seconds_per_day[picked]).length;

  return (
    <div className="space-y-3">
      <div className="scroll-x flex gap-1.5 pb-1">
        {sheet.days.map((iso, i) => (
          <DayChip
            key={iso} iso={iso} tracked={sheet.tracked_per_day[i] ?? 0} capacity={sheet.capacity_per_day[i] ?? 0}
            today={iso === today} on={i === picked} onPick={() => setDay(i)}
          />
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-gray-900">{long}</span>
          <span className={`text-lg font-semibold ${over ? 'text-red-600' : 'text-gray-900'}`}>{hours(tracked)}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-brand-500'}`}
            style={{ width: `${capacity ? Math.min(100, (100 * tracked) / capacity) : tracked ? 100 : 0}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-gray-500">
          {capacity === 0 ? 'Not a working day.' : `of ${hours(capacity)} expected · ${hours(sheet.total_seconds)} this week`}
        </p>
      </div>

      {sheet.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-400">
          No time tracked this week. Add a task to start filling in your timesheet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white" aria-label={`Tasks on ${long}`}>
          {rows.map((row, position) => {
            const expanded = openRow === row.task.id;
            const entries = row.entries.filter((e) => e.day === picked);
            const menu = [
              ...(row.task.can_open ? [{ label: 'Open task', icon: <ExternalLink size={14} />, onClick: () => onOpenTask(row.task.id) }] : []),
              ...(onStartTimer && row.task.can_open ? [{ label: 'Start timer', icon: <Play size={14} />, onClick: () => onStartTimer(row.task.id) }] : []),
              ...(editable ? [{ label: 'Delete row', icon: <Trash2 size={14} />, danger: true, onClick: () => onDeleteRow(row) }] : []),
            ];
            return (
              <li key={row.task.id}>
                {/* The line that separates what was worked on from what was not. */}
                {position === withTime && withTime > 0 && (
                  <p className="bg-gray-50/70 px-3 py-1 text-[11px] uppercase tracking-wide text-gray-400">Nothing on this day</p>
                )}
                <div className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <button
                      type="button" disabled={!row.task.can_open} onClick={() => onOpenTask(row.task.id)}
                      className="block max-w-full truncate text-left text-[15px] font-medium text-gray-900 disabled:text-gray-700"
                    >
                      {row.task.name}
                      {row.running && <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500 align-middle" title="Timer running" />}
                    </button>
                    {row.task.status && (
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-gray-500">
                        <StatusDot status={row.task.status} size={11} />
                        {/* The last segment: the full path truncates to the folder every row shares. */}
                        {row.task.location && <span className="truncate">{row.task.location.split(' / ').pop()}</span>}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0">{renderCell(row, picked)}</div>
                  {entries.length > 1 && (
                    <button
                      type="button" aria-label={expanded ? 'Hide entries' : 'Show entries'}
                      onClick={() => setOpenRow(expanded ? null : row.task.id)}
                      className="tap -mr-1 shrink-0 rounded-lg text-gray-400"
                    >
                      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  )}
                  {menu.length > 0 && (
                    <Menu
                      align="right" label={`Actions for ${row.task.name}`} items={menu}
                      trigger={<span className="tap shrink-0 rounded-lg text-gray-400"><MoreHorizontal size={18} /></span>}
                    />
                  )}
                </div>
                {expanded && (
                  <ul className="bg-gray-50/70 px-3 pb-2 text-[13px] text-gray-600">
                    {entries.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 py-1">
                        <span className="min-w-0 truncate">{e.description || <span className="text-gray-400">No note</span>}</span>
                        <span className="shrink-0">{e.running ? <span className="text-red-600">running</span> : hours(e.duration_seconds ?? 0)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
