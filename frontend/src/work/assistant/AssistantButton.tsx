// The way in: a button that sits in the bottom-right corner of every screen.
//
// A header icon is where a tool goes. An assistant is a thing you turn to, so it waits in the
// corner where chat and help buttons have waited for a decade -- recognisable before it is read.
// On a phone it lifts clear of the tab bar rather than sitting on top of it.

import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';

import { usePhone } from '../useBreakpoint';
import { ChatBubble } from './Bubble';

// The panel, and everything it reads a sentence with -- the parser, the Hindi tables, the
// destination resolver -- loads when somebody first opens it. It is on every screen in the app, so
// as a static import it was in the first download for everybody, including the people who never
// press it.
const Assistant = lazy(() => import('./Assistant').then((m) => ({ default: m.Assistant })));

export const AssistantButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const phone = usePhone();
  // Focus goes back to the button the panel was opened from, so a keyboard user closing it with
  // Escape is not dropped at the top of the page.
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open && wasOpen.current) button.current?.focus();
    wasOpen.current = open;
  }, [open]);

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

  // What it can do is said on its Home screen, where it can be read; the button itself only has to
  // be found, so it carries no label that appears on hover.
  return (
    <button
      ref={button}
      type="button"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      aria-label="Verveflow Assistant (Ctrl+J)"
      className={`assistant-launcher no-print fixed right-4 z-[90] flex h-14 w-14 items-center justify-center rounded-full bg-[#234788] hover:bg-[#1B3A72] sm:right-6
        ${phone ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))]' : 'bottom-6'}`}
    >
      <ChatBubble />
    </button>
  );
};
