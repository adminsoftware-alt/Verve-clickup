// A date you can type ("tomorrow", "next fri", "in 3 days", "25 dec") or pick from the calendar.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { parseTypedDate, shortDate } from './dates';
import { Portal, startOfDay } from './ui';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** The six-week grid for a month, Monday first, with the days either side of it greyed. */
function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });
}

/** The calendar itself: one month, arrows, today and clear. */
const Calendar: React.FC<{ value: string | null; onPick: (iso: string | null) => void; at: { top: number; left: number } }> = ({ value, onPick, at }) => {
  const chosen = value ? new Date(value) : null;
  const [month, setMonth] = useState(() => {
    const base = chosen ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const days = useMemo(() => monthGrid(month), [month]);
  const today = startOfDay(new Date());
  const step = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));
  return (
    <div
      role="dialog"
      aria-label="Pick a date"
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: at.top, left: at.left }}
      className="z-[140] w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-2xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronLeft size={16} /></button>
        <span className="text-sm font-semibold text-gray-800">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <button type="button" aria-label="Next month" onClick={() => step(1)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-medium text-gray-400">
        {WEEKDAYS.map((d) => <span key={d} className="py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((day) => {
          const outside = day.getMonth() !== month.getMonth();
          const picked = chosen && sameDay(day, chosen);
          const isToday = sameDay(day, today);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onPick(startOfDay(day).toISOString())}
              className={`h-8 rounded-md text-sm transition-colors ${
                picked ? 'bg-brand-600 font-semibold text-white'
                  : isToday ? 'border border-brand-300 text-brand-700 hover:bg-brand-50'
                  : outside ? 'text-gray-300 hover:bg-gray-50' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-sm">
        <button type="button" onClick={() => onPick(null)} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100">Clear</button>
        <button type="button" onClick={() => onPick(startOfDay(new Date()).toISOString())} className="rounded px-2 py-1 font-medium text-brand-600 hover:bg-brand-50">Today</button>
      </div>
    </div>
  );
};

export const DateField: React.FC<{
  value: string | null; onChange: (iso: string | null) => void; disabled?: boolean; label: string; className?: string; overdue?: boolean;
}> = ({ value, onChange, disabled, label, className = '', overdue }) => {
  const [text, setText] = useState(shortDate(value));
  const [bad, setBad] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setAt(null), []);
  useEffect(() => { setText(shortDate(value)); setBad(false); }, [value]);
  useEffect(() => {
    if (!at) return;
    const away = () => close();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [at, close]);
  const openCalendar = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 256;
    setAt({
      top: Math.min(rect.bottom + 6, window.innerHeight - 330),
      left: Math.min(Math.max(8, rect.left - width + rect.width), window.innerWidth - width - 8),
    });
  };
  const commit = () => {
    if (text.trim() === shortDate(value)) return;
    if (!text.trim()) { setBad(false); if (value) onChange(null); return; }
    const d = parseTypedDate(text);
    if (!d) { setBad(true); return; }
    setBad(false);
    const iso = d.toISOString();
    if (iso !== value) onChange(iso);
    setText(shortDate(iso));
  };
  return (
    <span className={`flex items-center gap-1 ${className}`}>
      <input
        aria-label={label}
        value={text}
        disabled={disabled}
        placeholder="Type a date, e.g. next fri"
        title='Type "today", "tomorrow", "next monday", "in 3 days", "25 dec" or 25/12/2026'
        onChange={(e) => { setText(e.target.value); setBad(false); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setText(shortDate(value)); setBad(false); }
        }}
        className={`w-full rounded-md border bg-transparent px-2 py-1 text-sm hover:border-gray-200 focus:border-brand-400 focus:outline-none ${bad ? 'border-red-300 text-red-700' : 'border-transparent'} ${overdue ? 'text-red-600' : 'text-gray-800'}`}
      />
      {bad && <span role="alert" className="shrink-0 text-[11px] text-red-600">Not a date</span>}
      <span className="relative shrink-0">
        <button ref={button} type="button" title="Pick a date" disabled={disabled} onClick={openCalendar}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"><CalendarDays size={14} /></button>
        {at && (
          <Portal>
            <Calendar value={value} at={at} onPick={(iso) => { onChange(iso); close(); }} />
          </Portal>
        )}
      </span>
    </span>
  );
};
