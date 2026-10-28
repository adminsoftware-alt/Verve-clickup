import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Portal } from '../ui';
import { isoDay, parseDay } from './api';

/**
 * Choosing a week, drawn as weeks.
 *
 * The browser's own date input picks a day, highlights one square and looks different in every
 * browser. A timesheet is a week at a time, so the rows here are weeks: the one on screen is a
 * navy band, the one under the pointer a pale one, and a click anywhere on a row goes to it.
 * The columns start on the firm's first day of the week, read from the week being shown.
 */
export const WeekPicker: React.FC<{
  anchor: React.RefObject<HTMLElement | null>;
  /** First day of the week on screen. */
  start: string;
  onPick: (day: string) => void;
  onClose: () => void;
}> = ({ anchor, start, onPick, onClose }) => {
  const panel = useRef<HTMLDivElement>(null);
  const first = parseDay(start);
  const weekStart = first.getDay();
  const [month, setMonth] = useState(() => new Date(first.getFullYear(), first.getMonth(), 1));
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const today = isoDay(new Date());

  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 320 - 8)) });
  }, [anchor]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [anchor, onClose]);

  // Six rows of weeks from the one holding the 1st, whatever the month's shape.
  const top = new Date(month);
  top.setDate(1 - ((month.getDay() - weekStart + 7) % 7));
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => {
    const x = new Date(top); x.setDate(top.getDate() + w * 7 + d); return x;
  }));
  const names = Array.from({ length: 7 }, (_, d) => new Date(2026, 1, 1 + ((weekStart + d) % 7)).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2));
  const shiftMonth = (by: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + by, 1));
  const away = (weeks: number) => { const d = new Date(); d.setDate(d.getDate() + weeks * 7); return isoDay(d); };
  const pick = (day: string) => { onPick(day); onClose(); };

  if (!pos) return null;
  return (
    <Portal>
      <div ref={panel} role="dialog" aria-label="Choose a week" className="week-picker fixed z-[130]" style={{ top: pos.top, left: pos.left }}>
        <div className="week-picker-head">
          <span className="week-picker-month">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
          <span className="flex">
            <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)} className="week-picker-step"><ChevronLeft size={16} /></button>
            <button type="button" aria-label="Next month" onClick={() => shiftMonth(1)} className="week-picker-step"><ChevronRight size={16} /></button>
          </span>
        </div>
        <div className="week-picker-names" aria-hidden>{names.map((n, i) => <span key={i}>{n}</span>)}</div>
        <div role="listbox" aria-label="Weeks">
          {weeks.map((week) => {
            const key = isoDay(week[0]);
            const on = key === start;
            return (
              <button
                key={key} type="button" role="option" aria-selected={on}
                aria-label={`Week of ${week[0].toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`}
                onClick={() => pick(key)} onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)}
                className={`week-picker-row ${on ? 'is-on' : hover === key ? 'is-hover' : ''}`}
              >
                {week.map((d) => {
                  const iso = isoDay(d);
                  return (
                    <span key={iso} className={`${d.getMonth() !== month.getMonth() ? 'is-out' : ''} ${iso === today ? 'is-today' : ''}`}>
                      {d.getDate()}
                    </span>
                  );
                })}
              </button>
            );
          })}
        </div>
        <div className="week-picker-foot">
          <button type="button" onClick={() => pick(away(-1))}>Last week</button>
          <button type="button" onClick={() => pick(today)} className="is-main">This week</button>
          <button type="button" onClick={() => pick(away(1))}>Next week</button>
        </div>
      </div>
    </Portal>
  );
};
