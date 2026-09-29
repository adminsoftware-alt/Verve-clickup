// Typing an amount of time, without having to know how to write one.
//
// "3" is ambiguous and always was: three hours or three minutes? The old input guessed hours and
// said so only in a tooltip nobody opens. This offers the readings instead -- type 3 and it shows
// "3h" and "3m" to pick from; type 2.4 and it shows "2h 40m", because a dot is how people write
// a clock. Nothing is guessed silently, and the shorthand teaches itself.
import React, { useMemo, useRef, useState } from 'react';

import { formatDuration, parseDuration } from './ui';

interface Reading {
  /** The text that would be committed, e.g. "2h 40m". */
  text: string;
  seconds: number;
}

/**
 * What someone could mean by what they have typed so far, best first.
 *
 * Only offered while the meaning is genuinely open: once they have written a unit ("45m"), or a
 * clock ("2.40"), there is one reading and a list of one is noise.
 */
export function readingsOf(raw: string): Reading[] {
  const value = raw.trim().toLowerCase();
  if (!value) return [];

  const bare = value.match(/^(\d+)$/);
  if (bare) {
    const n = Number(bare[1]);
    if (!n) return [];
    const out: Reading[] = [{ text: `${n}h`, seconds: n * 3600 }];
    // Minutes only make sense as a second reading while the number could be either.
    if (n < 60) out.push({ text: `${n}m`, seconds: n * 60 });
    return out;
  }

  // "2.4" reads as 2:40 the way a clock does, which is how people say it out loud. The digits
  // after the dot are minutes, so a single one is tens of minutes.
  const clock = value.match(/^(\d+)[.:](\d{1,2})$/);
  if (clock) {
    const hours = Number(clock[1]);
    const raw2 = clock[2];
    const minutes = raw2.length === 1 ? Number(raw2) * 10 : Number(raw2);
    if (minutes > 59) return [];
    const out: Reading[] = [{ text: `${hours}h ${minutes}m`, seconds: hours * 3600 + minutes * 60 }];
    // A single digit is also readable as itself: 2.4 as two hours and four minutes.
    if (raw2.length === 1) {
      out.push({ text: `${hours}h ${Number(raw2)}m`, seconds: hours * 3600 + Number(raw2) * 60 });
    }
    return out;
  }

  const seconds = parseDuration(value);
  return seconds ? [{ text: formatDuration(seconds), seconds }] : [];
}

export const DurationInput: React.FC<{
  /** What it currently holds, as seconds. */
  value: number | null;
  onChange: (seconds: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  label: string;
  className?: string;
  /** Cleared after a successful entry, for logging rather than setting. */
  clearOnCommit?: boolean;
}> = ({ value, onChange, disabled, placeholder = 'e.g. 2h 30m', label, className, clearOnCommit }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const blurTimer = useRef<number | undefined>(undefined);

  const text = draft ?? (clearOnCommit ? '' : formatDuration(value) || '');
  const readings = useMemo(() => (draft === null ? [] : readingsOf(draft)), [draft]);
  // One reading that already matches what is typed teaches nothing.
  const suggest = picking && readings.length > 0 && !(readings.length === 1 && readings[0].text === draft?.trim());

  const commit = (seconds: number | null) => {
    window.clearTimeout(blurTimer.current);
    setDraft(clearOnCommit ? '' : null);
    setPicking(false);
    onChange(seconds);
  };

  return (
    <div className="relative">
      <input
        aria-label={label}
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        onChange={(e) => { setDraft(e.target.value); setPicking(true); }}
        onFocus={() => setPicking(true)}
        // The blur is deferred so a click on a suggestion lands before the list closes.
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => {
            setPicking(false);
            if (draft === null) return;
            const typed = draft.trim();
            if (!typed) { commit(null); return; }
            const best = readingsOf(typed)[0];
            if (best) commit(best.seconds);
            else setDraft(null);  // nonsense: put back what was there
          }, 140);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setDraft(null); setPicking(false); }
        }}
        className={className ?? 'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-sm text-gray-800 hover:border-gray-200 hover:bg-gray-50 focus:border-brand-400 focus:bg-white focus:outline-none'}
      />
      {suggest && (
        <ul
          className="absolute left-0 top-full z-30 mt-1 min-w-full overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          aria-label={`${label} suggestions`}
        >
          {readings.map((r) => (
            <li key={r.text}>
              <button
                type="button"
                // mousedown, not click: the input's blur would otherwise fire first.
                onMouseDown={(e) => { e.preventDefault(); commit(r.seconds); }}
                className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-50"
              >
                <span className="font-medium">{r.text}</span>
                <span className="text-[11px] text-gray-400">{formatDuration(r.seconds)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
