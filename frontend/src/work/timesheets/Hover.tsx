// Hover cards for the timesheet grid.
//
// A day column and a single cell each carry more than fits in them: what the day was against your
// capacity, and which entries make a cell's total. Both used to be a `title` attribute -- a plain
// browser tooltip, unstyled, slow to appear and impossible to read as a table. These are proper
// cards, shown on hover, and they are why the grid no longer needs a separate list of entries
// beside it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatDuration } from '../ui';
import type { SheetEntry } from './api';

const OPEN_DELAY = 180;
const CARD_WIDTH = 300;

const pad = (n: number) => String(n).padStart(2, '0');

/** "08h 36m" — the wide form, so figures line up in a column. */
export function longHours(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${pad(Math.floor(s / 3600))}h ${pad(Math.floor((s % 3600) / 60))}m`;
}

const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((100 * part) / whole)}%` : '—');

/**
 * Wraps an element so that hovering it (or focusing it) shows `card` beside it.
 *
 * The card is a portal pinned to the viewport, so it is never clipped by the grid's own
 * horizontal scroll, and it flips above the anchor when there is no room below.
 */
export const HoverCard: React.FC<{
  card: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ card, className, children }) => {
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - CARD_WIDTH / 2, window.innerWidth - CARD_WIDTH - 8));
    // Guessing the height is enough to decide which side; the card corrects itself visually
    // because it is anchored by its own edge either way.
    const above = rect.bottom + 220 > window.innerHeight;
    setPos({ top: above ? rect.top - 8 : rect.bottom + 8, left, above });
  }, []);

  const show = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(place, OPEN_DELAY); };
  const hide = () => { window.clearTimeout(timer.current); setPos(null); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!pos) return;
    const away = () => setPos(null);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => { window.removeEventListener('scroll', away, true); window.removeEventListener('resize', away); };
  }, [pos]);

  return (
    <div
      ref={anchorRef}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={place}
      onBlurCapture={hide}
    >
      {children}
      {pos && createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[60]"
          style={{ top: pos.top, left: pos.left, width: CARD_WIDTH, transform: pos.above ? 'translateY(-100%)' : undefined }}
        >
          {card}
        </div>,
        document.body,
      )}
    </div>
  );
};

// --- the day card -----------------------------------------------------------------------------

const Line: React.FC<{ label: string; percent: string; value: string; accent: string; strong?: boolean }> = ({ label, percent, value, accent, strong }) => (
  <div className="flex items-center gap-2 py-[3px] pl-2.5" style={{ boxShadow: `inset 2px 0 0 ${accent}` }}>
    <span className={`flex-1 truncate ${strong ? 'text-white' : 'text-gray-300'}`}>{label}</span>
    <span className="w-10 shrink-0 text-right text-[11px] text-gray-400 tabular-nums">{percent}</span>
    <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">{value}</span>
  </div>
);

/** What a day held: capacity, what was tracked against it, and how it split. */
export const DayCard: React.FC<{
  title: string; capacity: number; tracked: number; billable: number;
}> = ({ title, capacity, tracked, billable }) => {
  const over = tracked > capacity;
  return (
    <div className="rounded-xl bg-gray-900 px-3 py-2.5 text-[13px] shadow-2xl ring-1 ring-black/20">
      <p className="font-semibold text-white">{title}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="flex-1 text-gray-300">Total capacity</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">{longHours(capacity)}</span>
      </div>
      <div className="my-2 h-px bg-white/10" />
      <Line label="Tracked time" percent={share(tracked, capacity)} value={longHours(tracked)} accent="#38bdf8" strong />
      <Line label="Billable" percent={share(billable, tracked)} value={longHours(billable)} accent="#34d399" />
      <Line label="Non-billable" percent={share(tracked - billable, tracked)} value={longHours(tracked - billable)} accent="#a78bfa" />
      <div className="my-2 h-px bg-white/10" />
      <Line
        label={over ? 'Over capacity' : 'Remaining'}
        percent={capacity ? `${Math.round((100 * Math.abs(tracked - capacity)) / capacity)}%` : '—'}
        value={`${over ? '+' : ''}${longHours(Math.abs(tracked - capacity))}`}
        accent={over ? '#f87171' : '#94a3b8'}
        strong
      />
    </div>
  );
};

// --- the cell card ----------------------------------------------------------------------------

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase();

/**
 * The entries behind one cell: when each one ran and how long for.
 *
 * This is what the separate "Time entries" list used to be for. Asking "where did those 3 hours
 * come from" about a cell, and being answered somewhere else on the page, was never the same
 * question -- so it is answered on the cell.
 */
export const CellCard: React.FC<{ title: string; task: string; entries: SheetEntry[]; total: number }> = ({ title, task, entries, total }) => (
  <div className="rounded-xl bg-white p-2.5 text-[13px] shadow-2xl ring-1 ring-gray-200">
    <p className="truncate font-semibold text-gray-900">{task}</p>
    <p className="truncate text-[11px] text-gray-500">{title}</p>
    {entries.length === 0 ? (
      <p className="mt-2 text-[12px] text-gray-400">No time entries — this was typed straight into the cell.</p>
    ) : (
      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-gray-400">
            <th className="pb-1 text-left font-semibold">Start</th>
            <th className="pb-1 text-left font-semibold">End</th>
            <th className="pb-1 text-right font-semibold">Tracked</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-gray-100">
              <td className="py-1 text-gray-600 tabular-nums">{clock(e.started_at)}</td>
              <td className="py-1 text-gray-600 tabular-nums">{e.ended_at ? clock(e.ended_at) : <span className="text-red-600">running</span>}</td>
              <td className="py-1 text-right font-medium text-gray-900 tabular-nums">
                {e.running ? '—' : formatDuration(e.duration_seconds ?? 0) || '0m'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200">
            <td colSpan={2} className="pt-1 text-[11px] text-gray-500">
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            </td>
            <td className="pt-1 text-right font-semibold text-gray-900 tabular-nums">{formatDuration(total) || '0m'}</td>
          </tr>
        </tfoot>
      </table>
    )}
    {entries.some((e) => e.description) && (
      <ul className="mt-2 space-y-0.5 border-t border-gray-100 pt-1.5">
        {entries.filter((e) => e.description).slice(0, 3).map((e) => (
          <li key={e.id} className="truncate text-[11px] text-gray-500">“{e.description}”</li>
        ))}
      </ul>
    )}
  </div>
);
