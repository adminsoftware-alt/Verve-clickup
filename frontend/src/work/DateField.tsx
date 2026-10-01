// A date you can type ("tomorrow", "next fri", "in 3 days", "25 dec"), pick from the calendar, or
// take from the shortcuts beside it. Where the caller passes a repeat rule, the same popover is
// also the way to "Set Recurring", because a date and how often it comes back are one decision.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Keyboard } from 'lucide-react';
import type { Recurrence, Status } from './api';
import { compactDate, parseTypedDate, shortDate } from './dates';
import { RecurrencePanel, SetRecurringRow } from './RecurrenceEditor';
import { Portal, startOfDay } from './ui';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const WIDTH = 420;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

const plus = (days: number) => {
  const d = startOfDay(new Date());
  d.setDate(d.getDate() + days);
  return d;
};

/** The next occurrence of a weekday (1 = Monday … 6 = Saturday), never today. */
const next = (weekday: number, weeksOn = 0) => {
  const d = startOfDay(new Date());
  const ahead = ((weekday - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + ahead + weeksOn * 7);
  return d;
};

/** The shortcuts down the left of the picker, in the order people reach for them. */
const SHORTCUTS: { label: string; when: () => Date }[] = [
  { label: 'Today', when: () => startOfDay(new Date()) },
  { label: 'Tomorrow', when: () => plus(1) },
  { label: 'This weekend', when: () => next(6) },
  { label: 'Next week', when: () => next(1) },
  { label: 'Next weekend', when: () => next(6, 1) },
  { label: '2 weeks', when: () => plus(14) },
  { label: '4 weeks', when: () => plus(28) },
];

/** Typing a date, kept where the calendar is rather than in the field itself. */
const TypeADate: React.FC<{ onType: (text: string) => boolean }> = ({ onType }) => {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <form
      className="mb-2 flex items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1 focus-within:border-brand-400"
      onSubmit={(e) => { e.preventDefault(); if (!onType(text)) setBad(true); }}
    >
      <Keyboard size={13} className="shrink-0 text-gray-400" />
      <input
        aria-label="Type a date"
        value={text}
        onChange={(e) => { setText(e.target.value); setBad(false); }}
        placeholder="next fri, 25 dec, in 3 days…"
        className="min-w-0 flex-1 text-sm focus:outline-none"
      />
      {bad && <span role="alert" className="shrink-0 text-[11px] text-red-600">Not a date</span>}
    </form>
  );
};

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

/** The calendar itself: shortcuts, one month, arrows, and the repeat rule underneath. */
const Calendar: React.FC<{
  value: string | null;
  onPick: (iso: string | null) => void;
  at: { top: number; left: number };
  recurrence?: Recurrence | null;
  statuses?: Status[] | null;
  onRecurrence?: (r: Recurrence | null) => Promise<void>;
  /** The date a repeat is counted from -- the due date, whichever half of the range is open. */
  anchorDate?: string | null;
  /** The field watches this to tell a click inside the calendar from a click elsewhere. */
  panelRef?: React.RefObject<HTMLDivElement | null>;
  /** Typing a date is still offered, inside the panel, for "next fri" and the like. */
  onType?: (text: string) => boolean;
}> = ({ value, onPick, at, recurrence, statuses, onRecurrence, anchorDate, panelRef, onType }) => {
  const chosen = value ? new Date(value) : null;
  const [month, setMonth] = useState(() => {
    const base = chosen ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [repeating, setRepeating] = useState(false);
  const days = useMemo(() => monthGrid(month), [month]);
  const today = startOfDay(new Date());
  const step = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));

  // The repeat panel takes over the popover rather than opening a second one on top of it.
  if (repeating && onRecurrence) {
    return (
      <div
        ref={panelRef}
        role="dialog" aria-label="Recurring" onMouseDown={(e) => e.stopPropagation()}
        style={{ position: 'fixed', top: at.top, left: at.left }}
        className="z-[140] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
      >
        <RecurrencePanel
          value={recurrence ?? null}
          dueDate={anchorDate ?? value}
          statuses={statuses}
          onCancel={() => setRepeating(false)}
          onSave={onRecurrence}
        />
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Pick a date"
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: at.top, left: at.left, width: WIDTH }}
      className="z-[140] rounded-xl border border-gray-200 bg-white p-3 shadow-2xl"
    >
      {onType && <TypeADate onType={onType} />}
      <div className="flex gap-3">
        <div className="flex w-[8.5rem] shrink-0 flex-col gap-0.5 border-r border-gray-100 pr-2">
          {SHORTCUTS.map((s) => {
            const day = s.when();
            return (
              <button
                key={s.label}
                type="button"
                onClick={() => onPick(day.toISOString())}
                className="flex items-baseline justify-between gap-1 rounded-md px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
              >
                <span className="truncate">{s.label}</span>
                <span className="shrink-0 text-[11px] text-gray-400">{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              </button>
            );
          })}
        </div>

        <div className="min-w-0 flex-1">
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
        </div>
      </div>

      {onRecurrence && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          <SetRecurringRow value={recurrence ?? null} onClick={() => setRepeating(true)} />
        </div>
      )}

      <div className="mt-1 flex items-center justify-between border-t border-gray-100 pt-2 text-sm">
        <button type="button" onClick={() => onPick(null)} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100">Clear</button>
        <button type="button" onClick={() => onPick(startOfDay(new Date()).toISOString())} className="rounded px-2 py-1 font-medium text-brand-600 hover:bg-brand-50">Today</button>
      </div>
    </div>
  );
};

/**
 * Start and due as one field, the way ClickUp puts them: "Start → Due".
 *
 * They are one decision, not two -- a task that starts on Monday and is wanted by Friday is a
 * single sentence -- and asking for them as one row means the second is never left behind. Give
 * the start and the caret moves straight to the due date.
 */
export const DateRange: React.FC<{
  start: string | null;
  due: string | null;
  disabled?: boolean;
  overdue?: boolean;
  onChange: (patch: { start_date?: string | null; due_date?: string | null }) => void;
  recurrence?: Recurrence | null;
  onRecurrence?: (r: Recurrence | null) => Promise<void>;
  statuses?: Status[] | null;
}> = ({ start, due, disabled, overdue, onChange, recurrence, onRecurrence, statuses }) => {
  const dueBox = useRef<HTMLButtonElement>(null);
  const backwards = !!start && !!due && new Date(due) < new Date(start);
  return (
    // w-full, or the pair shrinks to its own text and the dates truncate inside a half-empty box.
    <span className="flex w-full min-w-0 items-center gap-1">
      {/* Both halves offer the same picker, shortcuts and "Set Recurring". Which of the two
          dates you happen to be setting is no reason to be offered a different control. */}
      <span className="min-w-0 flex-1">
        <DateField
          label="Start date" placeholder="Start" format="compact" disabled={disabled} value={start}
          onChange={(iso) => {
            onChange({ start_date: iso });
            // Straight on to the due date: on its own, a start date says almost nothing, and
            // the picker you want next is the one for the other half.
            if (iso && !due) setTimeout(() => dueBox.current?.click(), 0);
          }}
          recurrence={recurrence} onRecurrence={onRecurrence} statuses={statuses} anchorDate={due ?? start}
        />
      </span>
      <ArrowRight size={13} className="shrink-0 text-gray-300" aria-hidden />
      <span className="min-w-0 flex-1">
        <DateField
          label="Due date" placeholder="Due" format="compact" disabled={disabled} value={due} inputRef={dueBox}
          overdue={overdue || backwards}
          onChange={(iso) => onChange({ due_date: iso })}
          recurrence={recurrence} onRecurrence={onRecurrence} statuses={statuses}
        />
      </span>
      {backwards && <span role="alert" className="shrink-0 text-[11px] text-red-600">Due before start</span>}
    </span>
  );
};

export const DateField: React.FC<{
  value: string | null; onChange: (iso: string | null) => void; disabled?: boolean; label: string; className?: string; overdue?: boolean;
  /** Pass these and the picker also offers "Set Recurring", the way ClickUp's due date does. */
  recurrence?: Recurrence | null;
  onRecurrence?: (r: Recurrence | null) => Promise<void>;
  statuses?: Status[] | null;
  /** The date a repeat is counted from, when this box is not the due date itself. */
  anchorDate?: string | null;
  /** What the box says when it is empty. */
  placeholder?: string;
  /** "compact" drops the weekday and this year, for the two dates that share the Dates row. */
  format?: 'long' | 'compact';
  /** So a caller can move the caret here -- the due date, once a start date has been given. */
  inputRef?: React.Ref<HTMLButtonElement>;
}> = ({ value, onChange, disabled, label, className = '', overdue, recurrence, onRecurrence, statuses, anchorDate, placeholder = 'Set a date', format = 'long', inputRef }) => {
  const show = format === 'compact' ? compactDate : shortDate;
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setAt(null), []);
  useEffect(() => {
    if (!at) return;
    // Capture phase, so the dialogs that stop mousedown bubbling -- the task panel, for one --
    // cannot keep this from firing. Without it two pickers could sit open on top of each other.
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || button.current?.contains(target)) return;
      close();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', away, true);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc); };
  }, [at, close]);
  const openCalendar = () => {
    if (at) { close(); return; }  // the field toggles its own calendar
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setAt({
      top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 400)),
      left: Math.min(Math.max(8, rect.left), window.innerWidth - WIDTH - 8),
    });
  };
  /** A date typed into the panel: true when it was understood. */
  const typed = (text: string) => {
    if (!text.trim()) { onChange(null); close(); return true; }
    const d = parseTypedDate(text);
    if (!d) return false;
    onChange(d.toISOString());
    close();
    return true;
  };
  return (
    <span className={`flex min-w-0 items-center gap-1 ${className}`}>
      {/* The field is the button. A text box that also has a calendar icon asks people to decide
          how they want to enter a date before they enter one; this opens the calendar, and the
          typing everyone liked ("next fri") is still there, at the top of the panel. */}
      <button
        ref={(node) => {
          button.current = node;
          if (typeof inputRef === 'function') inputRef(node);
          else if (inputRef) (inputRef as React.MutableRefObject<HTMLButtonElement | null>).current = node;
        }}
        type="button"
        aria-label={label}
        aria-expanded={!!at}
        disabled={disabled}
        onClick={openCalendar}
        className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 py-1 text-left text-sm transition-colors disabled:cursor-default ${
          at ? 'border-brand-400 bg-white' : 'border-transparent hover:border-gray-200 hover:bg-white'} ${
          value ? (overdue ? 'text-red-600' : 'text-gray-800') : 'text-gray-400'}`}
      >
        <CalendarDays size={13} className="shrink-0 text-gray-400" />
        <span className="truncate">{value ? show(value) : placeholder}</span>
      </button>
      <span className="relative shrink-0">
        {at && (
          <Portal>
            <Calendar
              value={value}
              at={at}
              panelRef={panel}
              onType={typed}
              recurrence={recurrence}
              statuses={statuses}
              anchorDate={anchorDate}
              onRecurrence={onRecurrence && (async (r) => { await onRecurrence(r); close(); })}
              onPick={(iso) => { onChange(iso); close(); }}
            />
          </Portal>
        )}
      </span>
    </span>
  );
};
