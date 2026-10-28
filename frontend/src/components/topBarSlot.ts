// The top bar once held each page's title. Since 2026-10-28 every page draws its own title on the
// page, under the bar, as the Timesheet does -- the bar and the page read as two separate things.
// The slot is kept so the bar still shows the workspace name; no page portals into it any more.
import { createContext } from 'react';

export const TopBarSlotContext = createContext<HTMLElement | null>(null);

/** Always null: a page draws its title on the page itself. */
export const useTopBarSlot = (): HTMLElement | null => null;
