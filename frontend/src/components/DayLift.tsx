// A word about the day, once a day, that arrives and then leaves.
//
// Every weekday has a reputation. Monday is a wall, Tuesday is the boring one nobody writes songs
// about, Wednesday is the middle, Thursday is nearly, Friday is a scramble. Saying so and then
// turning it round is warmer than a generic "have a great day", because it sounds like it was
// written by someone who has also had a Tuesday.
//
// It shows once per person per day and leaves on its own. Something that greets you on every
// navigation is not a greeting, it is an interruption -- so the day it has already been shown on
// is remembered, and it never appears twice.
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

const SEEN_KEY = 'verve.dayLift';
/** Long enough to read twice, short enough that nobody has to dismiss it. */
const ON_SCREEN_MS = 9000;
const ARRIVES_AFTER_MS = 1400;

interface Line {
  /** What the day is, said plainly. */
  is: string;
  /** And what to do with it. */
  so: string;
}

/**
 * Several per day, so the same person does not read the same sentence every Tuesday. Which one
 * comes up is counted off the week, so a whole office sees the same line on the same morning.
 */
const LINES: Record<number, Line[]> = {
  1: [ // Monday
    { is: 'Mondays get a bad name.', so: 'Pick the one thing that would make this week feel handled, and start there.' },
    { is: 'A fresh week, nothing overdue yet.', so: 'Choose what matters before the inbox chooses for you.' },
    { is: 'Nobody does their best work at 9am on a Monday.', so: 'Start with something small and let the day warm up.' },
  ],
  2: [ // Tuesday
    { is: 'Tuesday feels like the boring one.', so: 'It is also the day most real work actually gets done — quietly, with nobody watching.' },
    { is: 'No one writes songs about Tuesday.', so: 'Which is exactly why it is the best day to get the hard thing out of the way.' },
    { is: 'Tuesday asks nothing of you.', so: 'So give it the task you have been putting off since Friday.' },
  ],
  3: [ // Wednesday
    { is: 'Halfway.', so: 'Look at what is left, not at what is behind — the week is still yours to shape.' },
    { is: 'Wednesday is the top of the hill.', so: 'Everything from here rolls a little easier.' },
    { is: 'Middle of the week, middle of the work.', so: 'A good day to finish something rather than start three more.' },
  ],
  4: [ // Thursday
    { is: 'Almost there.', so: 'Close what you can today so tomorrow is not a scramble.' },
    { is: 'Thursday is the quiet workhorse.', so: 'Tidy the loose ends now and Friday becomes a good day instead of a rush.' },
    { is: 'One more push.', so: 'Pick the thing that would be a relief to have done, and do that one.' },
  ],
  5: [ // Friday
    { is: 'Friday.', so: 'Finish what you can, write down what you cannot, and let Monday have the rest.' },
    { is: 'The week is nearly filed.', so: 'Five minutes on your timesheet now is worth an hour of remembering later.' },
    { is: 'Last stretch.', so: 'Hand over anything someone else is waiting on before you log off.' },
  ],
  6: [ // Saturday
    { is: 'It is Saturday.', so: 'If you are here, keep it short — the work will still be here on Monday.' },
    { is: 'Weekend.', so: 'Whatever you are catching up on, give it an hour, not a day.' },
  ],
  0: [ // Sunday
    { is: 'Sunday.', so: 'Rest counts as work in a job that runs on judgement.' },
    { is: 'The week has not started yet.', so: 'If you are planning, plan lightly — then close the laptop.' },
  ],
};

/** A warm colour per day, so the week has a shape you half-notice. */
const SKINS = [
  'from-purple-500 to-fuchsia-500',   // Sunday
  'from-rose-500 to-orange-500',      // Monday
  'from-sky-500 to-cyan-500',         // Tuesday
  'from-amber-500 to-orange-500',     // Wednesday
  'from-emerald-500 to-teal-500',     // Thursday
  'from-fuchsia-500 to-pink-500',     // Friday
  'from-slate-500 to-slate-600',      // Saturday
];

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const DayLift: React.FC = () => {
  const [line, setLine] = useState<Line | null>(null);
  const [skin, setSkin] = useState(SKINS[0]);

  useEffect(() => {
    const today = new Date();
    const key = isoDay(today);
    try {
      if (localStorage.getItem(SEEN_KEY) === key) return;
    } catch { /* private window: show it, that is the kinder failure */ }

    const day = today.getDay();
    const choices = LINES[day] ?? LINES[1];
    // Counted off the week so everyone sees the same line on the same morning.
    const week = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 1).getTime()) / 604_800_000);
    const chosen = choices[week % choices.length];

    const arrive = window.setTimeout(() => {
      setSkin(SKINS[day]);
      setLine(chosen);
      try { localStorage.setItem(SEEN_KEY, key); } catch { /* ignore */ }
    }, ARRIVES_AFTER_MS);
    return () => window.clearTimeout(arrive);
  }, []);

  useEffect(() => {
    if (!line) return;
    const leave = window.setTimeout(() => setLine(null), ON_SCREEN_MS);
    return () => window.clearTimeout(leave);
  }, [line]);

  const weekday = new Date().toLocaleDateString(undefined, { weekday: 'long' });

  return (
    <AnimatePresence>
      {line && (
        <motion.div
          // Bottom right: seen without being stood in front of. A modal for a kind word would
          // be worse than saying nothing.
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-[120] w-[22rem] max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        >
          <div className={`h-1 w-full bg-gradient-to-r ${skin}`} />
          <div className="flex items-start gap-3 px-4 py-3.5">
            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${skin} text-[13px] font-bold text-white shadow-sm`}>
              {weekday.slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-gray-900">{line.is}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-gray-600">{line.so}</p>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setLine(null)}
              className="-mr-1 -mt-1 rounded-lg p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          </div>
          {/* A bar draining away, so it is obvious this is leaving on its own. */}
          <motion.div
            className={`h-0.5 bg-gradient-to-r ${skin} opacity-60`}
            initial={{ width: '100%' }}
            animate={{ width: '0%' }}
            transition={{ duration: ON_SCREEN_MS / 1000, ease: 'linear' }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
