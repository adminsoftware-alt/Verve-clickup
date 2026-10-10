// The way in: a button that sits in the bottom-right corner of every screen.
//
// A header icon is where a tool goes. An assistant is a thing you turn to, so it waits in the
// corner where chat and help buttons have waited for a decade -- recognisable before it is read.
// On a phone it lifts clear of the tab bar rather than sitting on top of it.

import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

import { usePhone } from '../useBreakpoint';

// The panel, and everything it reads a sentence with -- the parser, the Hindi tables, the
// destination resolver -- loads when somebody first opens it. It is on every screen in the app, so
// as a static import it was in the first download for everybody, including the people who never
// press it.
const Assistant = lazy(() => import('./Assistant').then((m) => ({ default: m.Assistant })));

/** What the label says. Rotated, because the second thing somebody learns is that it does more
 *  than the first thing they used it for -- and a label that never changes stops being read. */
const HINTS = [
  'Say what you want — "call the auditor tomorrow"',
  'Log hours — "2 hours on the Sharma audit"',
  'Close one — "mark the GST filing done"',
  'Ask — "what\'s overdue?"',
  'Ask about your own figures — "how many hours this week?"',
];

export const AssistantButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const phone = usePhone();
  // A different hint each time it is hovered, so the four things it does get discovered.
  const shown = useRef(0);

  // Ctrl/Cmd+J from anywhere, which is how anybody who uses it twice will open it thereafter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (open) {
    return (
      <Suspense fallback={null}>
        <Assistant onClose={() => setOpen(false)} />
      </Suspense>
    );
  }

  return (
    <div
      className={`no-print fixed right-4 z-[90] flex items-center gap-2 sm:right-6
        ${phone ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))]' : 'bottom-6'}`}
      onMouseEnter={() => { shown.current = (shown.current + 1) % HINTS.length; setHovering(true); }}
      onMouseLeave={() => setHovering(false)}
    >
      {/* The label, not a browser tooltip: that takes a second to appear, sits where the cursor
          happens to be, and vanishes the moment anything moves. Hidden on a phone, where there
          is no hover and the thumb is already on its way to the button. */}
      <span
        aria-hidden
        className={`hidden select-none whitespace-nowrap rounded-xl bg-gray-900/92 px-3 py-2 text-xs text-white shadow-lg
          transition-all duration-150 md:block
          ${hovering ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-2 opacity-0'}`}
      >
        {HINTS[shown.current]}
        <span className="ml-2 rounded border border-white/25 px-1 text-[10px] text-white/70">Ctrl J</span>
      </span>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Assistant — say what you want (Ctrl+J)"
        className="group relative flex h-12 w-12 items-center justify-center rounded-full
          bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-700/25
          transition-transform hover:scale-105 active:scale-95"
      >
        <Sparkles size={20} />
        <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-brand-400/0 transition-all group-hover:ring-4 group-hover:ring-brand-400/25" />
      </button>
    </div>
  );
};
