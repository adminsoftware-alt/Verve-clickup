// Logging an hour you worked at six, at nine o'clock at night.
//
// Typing "1h" into a cell records an hour ending now, which is right when you fill the sheet as
// you go and wrong every other time -- and most people fill it in at the end of the day, or the
// end of the week. Then three entries sit on top of each other at the moment of typing, the day
// card reads as nonsense, and any question about when the work actually happened cannot be
// answered. This says the period out loud instead: from, to, and what it came to.
import { Clock } from 'lucide-react';
import React, { useState } from 'react';

import { formatDuration } from '../ui';
import { dayLabel } from './pieces';

/** "18:00" on a given day, in the viewer's own zone, as the instant it names. */
function at(day: string, hhmm: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0);
}

/** Now, to the last quarter hour -- a sensible end for a period someone is about to describe. */
function quarterNow(): string {
  const d = new Date();
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function minus(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = (h * 60 + m - minutes + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export const AddPeriod: React.FC<{
  /** The day this cell is in, yyyy-mm-dd. */
  day: string;
  taskName: string;
  onAdd: (started: string, ended: string, note: string | null) => Promise<void>;
  onDone: () => void;
}> = ({ day, taskName, onAdd, onDone }) => {
  const end0 = quarterNow();
  const [from, setFrom] = useState(minus(end0, 60));
  const [to, setTo] = useState(end0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = at(day, from);
  const finish = at(day, to);
  const seconds = Math.round((finish.getTime() - start.getTime()) / 1000);
  // A period that ends before it starts is far more likely a typo than a night shift, and an
  // entry across midnight belongs to two days anyway.
  const backwards = seconds <= 0;

  const save = async () => {
    if (backwards || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(start.toISOString(), finish.toISOString(), note.trim() || null);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const field = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-brand-500 focus:outline-none';
  return (
    <div className="p-3" role="group" aria-label="Add time for a period">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        <Clock size={12} /> {dayLabel(day)}
      </p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-gray-900">{taskName}</p>

      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <label className="text-[11px] font-medium text-gray-500">
          From
          <input type="time" step={300} aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className={`mt-1 ${field}`} />
        </label>
        <label className="text-[11px] font-medium text-gray-500">
          To
          <input type="time" step={300} aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className={`mt-1 ${field}`} />
        </label>
      </div>

      <p className={`mt-2 text-[13px] ${backwards ? 'text-red-600' : 'text-gray-600'}`}>
        {backwards
          ? 'The end has to come after the start. An entry across midnight belongs to both days, so log it as two.'
          : <>That is <b className="font-semibold text-gray-900">{formatDuration(seconds)}</b>, added to what this cell already holds.</>}
      </p>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What you did (optional)"
        aria-label="Note"
        className={`mt-2 ${field} font-normal`}
      />

      {error && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-md px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        <button
          type="button"
          onClick={save}
          disabled={backwards || busy}
          className="btn-accent rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add time'}
        </button>
      </div>
    </div>
  );
};
