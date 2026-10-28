// The left of the top bar holds the page's own title -- its breadcrumb, star and owner -- so a
// page needs no title row of its own under the bar. A page portals its title into this slot;
// a page that does not shows the workspace name there instead.
import { createContext, useContext } from 'react';
import { usePhone } from '../work/useBreakpoint';

export const TopBarSlotContext = createContext<HTMLElement | null>(null);

/** Where to portal the page title, or null to draw it in the page as before (on a phone the
 *  top bar has no room for it). */
export const useTopBarSlot = (): HTMLElement | null => {
  const slot = useContext(TopBarSlotContext);
  const phone = usePhone();
  return phone ? null : slot;
};
