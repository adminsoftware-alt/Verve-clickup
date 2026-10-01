// Logging time on a task: a duration, or the period it actually happened in.
//
// The two say the same thing, so they stay in step. Type "45m" and the end moves to 45 minutes
// after the start; pick 5:45pm as the end and the duration above becomes 45m. Whichever you find
// easier to think in is the one you use, and the other keeps up.
//
// Both time fields take typing as well as picking, because "3:10" is faster to type than to hunt
// for, and the picker lists quarter hours, which is what most work rounds to anyway.
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Play, Square, Tag as TagIcon, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ask } from '../../components/ask';
import { notify } from '../../components/notify';
import { DurationInput } from '../DurationInput';
import { formatClock, useNow, useRunningTimer } from '../RunningTimer';
import { useMe, useWork } from '../WorkContext';
import { workApi, type TaskTime } from '../api';
import { sheetApi, type TimeTag } from '../timesheets/api';
import { Avatar, formatDuration } from '../ui';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const sameDay = (a: Date, b: Date) => isoDay(a) === isoDay(b);

/** The instant a day and a wall-clock time name, locally. */
function at(day: string, time: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0);
}

/** "4:45 pm" from "16:45". */
const spoken = (time: string) =>
  at(isoDay(new Date()), time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** What someone typed, read generously: "5", "5pm", "17:30", "5.30 pm" all land somewhere sane. */
function readTime(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const mins = Number(m[2] ?? 0);
  if (mins > 59 || hour > 23) return null;
  if (m[3] === 'pm' && hour < 12) hour += 12;
  if (m[3] === 'am' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** Every quarter hour of the day, for the picker. */
const SLOTS: string[] = Array.from({ length: 96 }, (_, i) =>
  `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);

/** Six weeks of a month, Monday first, with the days either side greyed. */
function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

// --- a day, picked from a month rather than typed into a browser control ------------------------

const DayPicker: React.FC<{ day: string; onPick: (day: string) => void }> = ({ day, onPick }) => {
  const chosen = at(day, '00:00');
  const [month, setMonth] = useState(() => new Date(chosen.getFullYear(), chosen.getMonth(), 1));
  const days = useMemo(() => monthGrid(month), [month]);
  const today = new Date();
  const step = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));
  return (
    <div className="w-[15.5rem] p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"><ChevronLeft size={15} /></button>
        <span className="text-[13px] font-semibold text-gray-800">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <button type="button" aria-label="Next month" onClick={() => step(1)} className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"><ChevronRight size={15} /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {WEEKDAYS.map((d) => <span key={d} className="py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const outside = d.getMonth() !== month.getMonth();
          const picked = sameDay(d, chosen);
          const isToday = sameDay(d, today);
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onPick(isoDay(d))}
              className={`h-7 rounded-md text-[13px] tabular-nums transition-colors ${
                picked ? 'bg-brand-600 font-semibold text-white shadow-sm'
                  : isToday ? 'font-semibold text-brand-700 ring-1 ring-inset ring-brand-300 hover:bg-brand-50'
                  : outside ? 'text-gray-300 hover:bg-gray-50' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-end border-t border-gray-100 pt-1.5">
        <button type="button" onClick={() => onPick(isoDay(new Date()))} className="rounded-md px-2 py-1 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50">Today</button>
      </div>
    </div>
  );
};

// --- a time, typed or picked -------------------------------------------------------------------

const TimeField: React.FC<{
  value: string;
  onChange: (time: string) => void;
  label: string;
  disabled?: boolean;
  /** When given, each option shows how long the period would then be. */
  from?: string;
}> = ({ value, onChange, label, disabled, from }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setDraft(null); } };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [open]);

  // Open on the slot nearest what is set, not at midnight.
  useEffect(() => {
    if (!open || !list.current) return;
    const idx = SLOTS.findIndex((s) => s >= value);
    const row = list.current.children[Math.max(0, idx)] as HTMLElement | undefined;
    if (row) list.current.scrollTop = row.offsetTop - 8;
  }, [open, value]);

  const commit = (raw: string) => {
    const read = readTime(raw);
    setDraft(null);
    if (read) onChange(read);
  };

  return (
    <div ref={box} className="relative">
      <input
        value={draft ?? spoken(value)}
        disabled={disabled}
        aria-label={label}
        onFocus={(e) => { setOpen(true); e.target.select(); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== null && commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(draft ?? value); setOpen(false); }
          if (e.key === 'Escape') { setDraft(null); setOpen(false); }
        }}
        className="h-8 w-[5.75rem] rounded-lg border border-gray-200 bg-white px-2.5 text-[13px] tabular-nums text-gray-900 transition-colors hover:border-gray-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50 disabled:text-gray-400"
      />
      {open && !disabled && (
        <ul
          ref={list}
          aria-label={`${label} options`}
          className="absolute left-0 top-full z-50 mt-1 max-h-56 w-44 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
        >
          {SLOTS.map((s) => {
            const span = from ? Math.round((at('2000-01-01', s).getTime() - at('2000-01-01', from).getTime()) / 1000) : 0;
            return (
              <li key={s}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); onChange(s); setDraft(null); setOpen(false); }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1 text-left text-[13px] tabular-nums transition-colors hover:bg-brand-50 ${s === value ? 'bg-brand-50 font-semibold text-brand-700' : 'text-gray-700'}`}
                >
                  <span>{spoken(s)}</span>
                  {from && span > 0 && <span className="text-[11px] text-gray-400">{formatDuration(span)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

// --- the popup ----------------------------------------------------------------------------------

export const TrackTime: React.FC<{
  taskId: string;
  canTrack: boolean;
  onClose: () => void;
  onChanged: () => void;
  /** The day to open on, yyyy-mm-dd. A timesheet cell already knows which day it is. */
  day?: string;
  /** Whose time this is. Admins log for other people from their timesheet. */
  forUserId?: string;
  /** In a cell, show only what is already in that cell; on a task, show the lot. */
  onlyThatDay?: boolean;
}> = ({ taskId, canTrack, onClose, onChanged, day: openOn, forUserId, onlyThatDay }) => {
  const meId = useMe();
  const { workspace } = useWork();
  const { timer, version, start, stop } = useRunningTimer();
  const running = !forUserId && timer?.entry.task_id === taskId ? timer : null;
  const canUseTimer = canTrack && !forUserId;
  const now = useNow(!!running);

  const [time, setTime] = useState<TaskTime | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [day, setDay] = useState(() => openOn ?? isoDay(new Date()));
  // Opens on the quarter hour just gone, which is where most people would start counting back from.
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
    return hhmm(d);
  });
  const [to, setTo] = useState(() => {
    const d = new Date();
    d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
    return hhmm(d);
  });
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<TimeTag[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [showTags, setShowTags] = useState(false);
  const [showDays, setShowDays] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    workApi.taskTime(taskId).then(setTime).catch((e) => setError((e as Error).message));
  }, [taskId]);
  useEffect(() => { load(); }, [load, version]);
  useEffect(() => {
    if (workspace) sheetApi.tags(workspace.id).then(setTags).catch(() => undefined);
  }, [workspace]);

  // --- the two directions -------------------------------------------------------------------------
  const setDuration = (value: number | null) => {
    setSeconds(value);
    if (value && value > 0) setTo(hhmm(new Date(at(day, from).getTime() + value * 1000)));
  };
  const setPeriod = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    const span = Math.round((at(day, nextTo).getTime() - at(day, nextFrom).getTime()) / 1000);
    setSeconds(span > 0 ? span : null);
  };

  const span = Math.round((at(day, to).getTime() - at(day, from).getTime()) / 1000);
  // Equal times are simply an untouched form, not a mistake worth a red sentence.
  const backwards = span < 0;
  const ready = !!seconds && seconds > 0 && span > 0;

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await workApi.logTime(taskId, seconds!, note.trim() || undefined, {
        started_at: at(day, from).toISOString(),
        ended_at: at(day, to).toISOString(),
      }, false, chosen, forUserId);
      setSeconds(null);
      setNote('');
      setChosen([]);
      load();
      onChanged();
      notify.ok(`${formatDuration(seconds!)} logged.`);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const remove = async (id: string, length: number) => {
    if (!await ask.confirm({ danger: true, title: `Delete this ${formatDuration(length) || 'entry'}?` })) return;
    try { await workApi.deleteTime(id); load(); onChanged(); }
    catch (e) { setError((e as Error).message); }
  };

  const byPerson = useMemo(() => {
    const out = new Map<string, { user: TaskTime['entries'][0]['user']; total: number; entries: TaskTime['entries'] }>();
    // In a cell the question is "what is already in this cell", not "what has ever been logged
    // on this task" -- the task panel is where the whole history belongs.
    const shown = onlyThatDay
      ? (time?.entries ?? []).filter((e) => isoDay(new Date(e.started_at)) === day)
      : (time?.entries ?? []);
    for (const e of shown) {
      const row = out.get(e.user.id) ?? { user: e.user, total: 0, entries: [] };
      row.total += e.duration_seconds ?? 0;
      row.entries.push(e);
      out.set(e.user.id, row);
    }
    return [...out.values()].sort((a, b) => b.total - a.total);
  }, [time, onlyThatDay, day]);

  const elapsed = running ? Math.floor((now - new Date(running.entry.started_at).getTime()) / 1000) : 0;

  return (
    <div className="w-[27rem] max-w-[calc(100vw-2rem)]" role="group" aria-label="Track time">
      {/* --- what is on the clock already ---------------------------------------------------- */}
      <div className="rounded-t-xl border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white px-4 pb-3 pt-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-semibold text-gray-900">This task and its subtasks</span>
          <span className="font-mono text-base font-semibold tabular-nums text-gray-900">
            {formatDuration(time?.subtree_seconds ?? 0) || '0h'}
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[12px] text-gray-500">
          <span>Without subtasks</span>
          <span className="font-mono tabular-nums">{formatDuration(time?.total_seconds ?? 0) || '0h'}</span>
        </div>
      </div>

      <div className="px-4 pb-3.5 pt-3">
        {/* --- how long ------------------------------------------------------------------------ */}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <DurationInput
              key={String(seconds)}
              label="Time to log"
              value={seconds}
              disabled={!canTrack || !!running}
              placeholder="Enter time, e.g. 3h 20m"
              onChange={setDuration}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-[15px] font-medium tabular-nums text-gray-900 placeholder:font-normal placeholder:text-[14px] placeholder:text-gray-400 transition-colors hover:border-gray-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50"
            />
          </div>
          {canUseTimer && (
            running ? (
              <button
                type="button"
                onClick={() => stop().then(() => { load(); onChanged(); })}
                title="Stop the timer"
                className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-red-50 px-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100"
              >
                <Square size={12} fill="currentColor" />
                <span className="font-mono tabular-nums">{formatClock(elapsed)}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => start(taskId).then(() => { load(); onChanged(); })}
                title="Start a timer"
                aria-label="Start a timer"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                <Play size={15} fill="currentColor" />
              </button>
            )
          )}
        </div>

        {/* --- and when -------------------------------------------------------------------------- */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <div className="relative">
            <button
              type="button"
              disabled={!canTrack}
              onClick={() => setShowDays(!showDays)}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-[13px] text-gray-800 transition-colors hover:border-gray-300 disabled:bg-gray-50 disabled:text-gray-400"
            >
              <CalendarDays size={13} className="text-gray-400" />
              {at(day, '00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
            </button>
            {showDays && (
              <div className="absolute left-0 top-full z-50 mt-1 rounded-xl border border-gray-200 bg-white shadow-xl">
                <DayPicker day={day} onPick={(d) => { setDay(d); setShowDays(false); }} />
              </div>
            )}
          </div>

          <Clock size={13} className="shrink-0 text-gray-300" />
          <TimeField label="From" value={from} disabled={!canTrack} onChange={(v) => setPeriod(v, to)} />
          <span className="text-gray-300">–</span>
          <TimeField label="To" value={to} from={from} disabled={!canTrack} onChange={(v) => setPeriod(from, v)} />

          {ready && !running && (
            <span className="ml-auto rounded-full bg-brand-50 px-2.5 py-1 font-mono text-[12px] font-semibold tabular-nums text-brand-700">
              {formatDuration(seconds!)}
            </span>
          )}
        </div>

        {backwards && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900">
            The end comes before the start. Work across midnight belongs to both days, so log it as two.
          </p>
        )}

        {/* --- what it was ----------------------------------------------------------------------- */}
        <input
          value={note}
          aria-label="Notes"
          disabled={!canTrack}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What you did (optional)"
          className="mt-2.5 h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50"
        />

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowTags(!showTags)}
            disabled={!canTrack}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
          >
            <TagIcon size={13} />
            {chosen.length ? `${chosen.length} tag${chosen.length === 1 ? '' : 's'}` : 'Add tags'}
          </button>
          {showTags && (
            tags.length === 0
              ? <span className="text-[12px] text-gray-400">No time tags yet — an admin adds them in Timesheet settings.</span>
              : tags.map((t) => {
                const on = chosen.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setChosen(on ? chosen.filter((x) => x !== t.id) : [...chosen, t.id])}
                    className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors ${on ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  >
                    {t.name}
                  </button>
                );
              })
          )}
        </div>

        {error && <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700">{error}</p>}

        <div className="mt-3 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[13px] text-gray-600 transition-colors hover:bg-gray-100">Close</button>
          <button
            type="button"
            onClick={save}
            disabled={!ready || busy || !canTrack}
            className="btn-accent rounded-lg px-4 py-1.5 text-[13px] font-semibold shadow-sm transition-opacity disabled:opacity-40 disabled:shadow-none"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* --- what has been logged already --------------------------------------------------------- */}
      {byPerson.length > 0 && (
        <div className="max-h-60 overflow-y-auto rounded-b-xl border-t border-gray-100 bg-gray-50/60 px-4 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {onlyThatDay ? 'Already in this cell' : 'Time entries'}
          </p>
          <ul className="space-y-2.5">
            {byPerson.map((row) => (
              <li key={row.user.id}>
                <div className="mb-1 flex items-center gap-2">
                  <Avatar user={row.user} size={18} />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-gray-700">
                    {row.user.display_name || row.user.email}
                  </span>
                  <span className="font-mono text-[12px] font-semibold tabular-nums text-gray-900">{formatDuration(row.total) || '0h'}</span>
                </div>
                <ul className="space-y-1">
                  {row.entries.map((e) => (
                    <li key={e.id} className="group flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 transition-colors hover:border-gray-300">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] tabular-nums text-gray-700">
                          {new Date(e.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                          {', '}
                          {new Date(e.started_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                          {e.ended_at
                            ? ` – ${new Date(e.ended_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                            : <span className="font-medium text-red-600"> – running</span>}
                        </span>
                        {(e.description || e.tags?.length) && (
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            {e.description && <span className="truncate text-[11px] text-gray-500">“{e.description}”</span>}
                            {(e.tags ?? []).map((t) => (
                              <span key={t.id} className="rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-600">{t.name}</span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-[12px] font-medium tabular-nums text-gray-900">
                        {e.running ? '—' : formatDuration(e.duration_seconds ?? 0) || '0m'}
                      </span>
                      {(e.user.id === meId || time?.shows_everyone) && !e.running && (
                        <button
                          type="button"
                          aria-label="Delete this entry"
                          onClick={() => remove(e.id, e.duration_seconds ?? 0)}
                          className="shrink-0 rounded-md p-1 text-gray-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {time && !time.shows_everyone && (
            <p className="mt-2 text-[11px] text-gray-400">You see your own entries. Admins see everyone's.</p>
          )}
        </div>
      )}
    </div>
  );
};
