// Which size of screen we are on, as a value a component can branch on.
//
// Tailwind's `sm:` and `md:` handle anything that is only a matter of styling, and should be
// preferred: CSS does it without a re-render. This is for the cases where the markup itself has to
// differ -- a table that becomes a list of cards, a side panel that becomes a whole page, a dialog
// that becomes a sheet -- because no amount of CSS turns one into the other.
import { useEffect, useState } from 'react';

/** The same numbers Tailwind uses, so a hook and a class never disagree about what "small" is. */
export const SCREENS = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;
export type Screen = keyof typeof SCREENS;

const match = (query: string) => typeof window !== 'undefined' && window.matchMedia(query).matches;

/** True while the viewport is narrower than the named breakpoint. */
export function useBelow(screen: Screen): boolean {
  const query = `(max-width: ${SCREENS[screen] - 0.02}px)`;
  const [below, setBelow] = useState(() => match(query));
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setBelow(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return below;
}

/**
 * A phone: narrower than Tailwind's `md`, so a tablet in portrait counts as one too.
 *
 * That is deliberate. An iPad in portrait is 768px, and the task list needs 1,062px before its
 * columns stop overlapping -- so the phone layout is the honest one there as well.
 */
export const usePhone = () => useBelow('md');

/** Narrow enough that two columns do not fit: a phone held upright. */
export const useNarrow = () => useBelow('sm');

/**
 * True where a finger is the pointer. Some affordances (drag handles, swipe hints) are worth
 * showing on a touch screen and only clutter a desktop, whatever the window is sized to.
 */
export function useTouch(): boolean {
  const [touch, setTouch] = useState(() => match('(pointer: coarse)'));
  useEffect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    const onChange = () => setTouch(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return touch;
}
