// The timesheet's week as a calendar: every entry drawn where it actually happened.
//
// The grid answers "how many hours on each task each day". This answers the question the grid
// cannot: *when*. A week with 8 hours on Tuesday looks the same in a grid whether it was one
// stretch of work or fourteen interruptions, and those are not the same Tuesday.
//
// Everything here comes off the entries the timesheet already carries, so it costs no extra read.
import React, { useMemo, useRef, useState } from 'react';

import { formatDuration } from '../ui';
import type { SheetEntry, SheetRow, Timesheet } from './api';
import { hours } from './pieces';

/** How tall an hour is. Enough that a 15-minute entry is still a visible block. */
const HOUR_PX = 44;
const MIN_BLOCK_PX = 16;

/** A colour per task, stable across renders, so the same work is the same colour all week. */
const PALETTE = [
  { bg: 'bg-sky-100', bar: 'bg-sky-500', text: 'text-sky-900' },
  { bg: 'bg-teal-100', bar: 'bg-teal-500', text: 'text-teal-900' },
  { bg: 'bg-purple-100', bar: 'bg-purple-500', text: 'text-purple-900' },
  { bg: 'bg-amber-100', bar: 'bg-amber-500', text: 'text-amber-900' },
  { bg: 'bg-rose-100', bar: 'bg-rose-500', text: 'text-rose-900' },
  { bg: 'bg-emerald-100', bar: 'bg-emerald-500', text: 'text-emerald-900' },
];
const skinFor = (taskId: string) => PALETTE[[...taskId].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];

interface Block {
  entry: SheetEntry;
  row: SheetRow;
  day: number;
  /** Minutes from midnight. */
  from: number;
  to: number;
}

const minutesInto = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase();

export const SheetCalendar: React.FC<{
  sheet: Timesheet;
  onOpenTask: (taskId: string) => void;
}> = ({ sheet, onOpenTask }) => {
  const [zoom, setZoom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const blocks = useMemo(() => {
    const out: Block[] = [];
    for (const row of sheet.rows) {
      for (const entry of row.entries) {
        if (entry.day < 0 || entry.day >= sheet.days.length) continue;
        const from = minutesInto(entry.started_at);
        // A running entry is drawn up to now; one with no end and no duration gets a token
        // 15 minutes so it is still visible rather than a zero-height sliver.
        const to = entry.ended_at
          ? minutesInto(entry.ended_at)
          : from + Math.max(15, Math.round((entry.duration_seconds ?? 900) / 60));
        out.push({ entry, row, day: entry.day, from, to: Math.max(to, from + 5) });
      }
    }
    return out;
  }, [sheet]);

  // Only the hours that hold something, unless you ask for the whole day: nobody needs to scroll
  // past midnight to four in the morning to find their Tuesday.
  const [firstHour, lastHour] = useMemo(() => {
    if (zoom || blocks.length === 0) return [0, 24];
    const lo = Math.min(...blocks.map((b) => Math.floor(b.from / 60)));
    const hi = Math.max(...blocks.map((b) => Math.ceil(b.to / 60)));
    return [Math.max(0, lo - 1), Math.min(24, Math.max(hi + 1, lo + 6))];
  }, [blocks, zoom]);

  const spanHours = Math.max(1, lastHour - firstHour);
  const top = (minutes: number) => ((minutes - firstHour * 60) / 60) * HOUR_PX;
  const today = new Date().toDateString();

  // Entries that overlap share the column's width rather than hiding each other.
  const laidOut = useMemo(() => {
    const out = new Map<string, { lane: number; lanes: number }>();
    for (let day = 0; day < sheet.days.length; day += 1) {
      const ofDay = blocks.filter((b) => b.day === day).sort((a, b) => a.from - b.from || a.to - b.to);
      const lanes: number[] = []; // the end minute of the last block in each lane
      const taken: Block[][] = [];
      for (const b of ofDay) {
        let lane = lanes.findIndex((end) => end <= b.from);
        if (lane === -1) { lane = lanes.length; lanes.push(b.to); taken.push([b]); }
        else { lanes[lane] = b.to; taken[lane].push(b); }
        out.set(b.entry.id, { lane, lanes: 1 });
      }
      // Every block in a day shares the widest lane count, which keeps columns aligned.
      ofDay.forEach((b) => { const v = out.get(b.entry.id)!; out.set(b.entry.id, { ...v, lanes: Math.max(1, lanes.length) }); });
    }
    return out;
  }, [blocks, sheet.days.length]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
        <p className="text-sm text-gray-600">
          {blocks.length} {blocks.length === 1 ? 'entry' : 'entries'} · {hours(sheet.total_seconds)} this week
        </p>
        <button
          type="button"
          onClick={() => setZoom(!zoom)}
          className="ml-auto rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
        >
          {zoom ? 'Fit to tracked hours' : 'Show the whole day'}
        </button>
      </div>

      {blocks.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-gray-400">
          No time entries this week. Hours typed straight into the timesheet have no start and end, so they do not appear here.
        </p>
      ) : (
        <div ref={scrollRef} className="max-h-[70vh] overflow-auto">
          <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `56px repeat(${sheet.days.length}, minmax(0, 1fr))` }}>
            {/* The day names stay put while the hours scroll under them. */}
            <div className="sticky top-0 z-20 border-b border-gray-200 bg-white" />
            {sheet.days.map((iso) => {
              const d = new Date(`${iso}T00:00:00`);
              const isToday = d.toDateString() === today;
              const total = blocks.filter((b) => b.day === sheet.days.indexOf(iso)).reduce((n, b) => n + (b.entry.duration_seconds ?? 0), 0);
              return (
                <div key={iso} className={`sticky top-0 z-20 border-b border-l border-gray-200 bg-white px-2 py-1.5 text-center ${isToday ? 'bg-brand-50/60' : ''}`}>
                  <p className={`text-[11px] ${isToday ? 'font-medium text-brand-700' : 'text-gray-500'}`}>
                    {d.toLocaleDateString(undefined, { weekday: 'short' })}
                  </p>
                  <p className={`text-sm font-semibold ${isToday ? 'text-brand-700' : 'text-gray-800'}`}>{d.getDate()}</p>
                  <p className="text-[11px] text-gray-400">{total ? formatDuration(total) : '—'}</p>
                </div>
              );
            })}

            {/* The hour rail. */}
            <div className="relative" style={{ height: spanHours * HOUR_PX }}>
              {Array.from({ length: spanHours }, (_, i) => (
                <div key={i} className="absolute right-2 -translate-y-1/2 text-[11px] text-gray-400" style={{ top: i * HOUR_PX }}>
                  {new Date(2000, 0, 1, firstHour + i).toLocaleTimeString(undefined, { hour: 'numeric' }).toLowerCase()}
                </div>
              ))}
            </div>

            {sheet.days.map((iso, day) => (
              <div key={iso} className="relative border-l border-gray-100" style={{ height: spanHours * HOUR_PX }}>
                {Array.from({ length: spanHours }, (_, i) => (
                  <div key={i} className="absolute inset-x-0 border-t border-gray-100" style={{ top: i * HOUR_PX }} />
                ))}
                {blocks.filter((b) => b.day === day).map((b) => {
                  const skin = skinFor(b.row.task.id);
                  const place = laidOut.get(b.entry.id) ?? { lane: 0, lanes: 1 };
                  const height = Math.max(MIN_BLOCK_PX, top(b.to) - top(b.from));
                  return (
                    <button
                      key={b.entry.id}
                      type="button"
                      onClick={() => b.row.task.can_open && onOpenTask(b.row.task.id)}
                      title={`${b.row.task.name}\n${clock(b.entry.started_at)}${b.entry.ended_at ? ` – ${clock(b.entry.ended_at)}` : ' – running'}\n${formatDuration(b.entry.duration_seconds ?? 0)}${b.entry.description ? `\n${b.entry.description}` : ''}`}
                      className={`absolute overflow-hidden rounded-md pl-1.5 pr-1 text-left ${skin.bg} ring-1 ring-black/5 hover:ring-2 hover:ring-black/10`}
                      style={{
                        top: top(b.from),
                        height,
                        left: `${(place.lane / place.lanes) * 100}%`,
                        width: `calc(${100 / place.lanes}% - 4px)`,
                      }}
                    >
                      <span className={`absolute inset-y-0 left-0 w-[3px] ${skin.bar}`} />
                      <span className={`block truncate text-[11px] font-medium leading-tight ${skin.text}`}>{b.row.task.name}</span>
                      {height > 30 && (
                        <span className={`block truncate text-[10px] leading-tight ${skin.text} opacity-70`}>
                          {clock(b.entry.started_at)} · {b.entry.running ? 'running' : formatDuration(b.entry.duration_seconds ?? 0)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
