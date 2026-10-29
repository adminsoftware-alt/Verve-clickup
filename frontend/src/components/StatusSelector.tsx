import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useAuth } from './AuthContext';
import { presenceService, PRESENCE_COLORS } from '../services/presenceService';
import type { PresenceStatus } from '../services/presenceService';
import { Portal } from '../work/ui';

const statusColors = PRESENCE_COLORS;
// Everything but Offline, which is what you are when you are not signed in, not a choice.
export const statuses = (Object.keys(PRESENCE_COLORS) as PresenceStatus[]).filter((s) => s !== 'Offline');

// Fourteen statuses read as a wall in one list; grouped by what they say, each is found at a glance.
const GROUPS: { title: string; items: string[] }[] = [
  { title: 'Working', items: ['Available', 'Busy', 'In Meeting', 'Focus Mode', 'Do Not Disturb'] },
  { title: 'Away', items: ['Break', 'Lunch'] },
  { title: 'Where I am', items: ['In Office', 'Work From Home', 'Client Visit', 'Travelling', 'In Training'] },
  { title: 'Off', items: ['Sick Leave', 'On Leave'] },
];

/** Your own status, kept in step with the presence store, and a way to change it. Used here and
 *  in the account menu, so both always show the same thing. */
export const useMyStatus = (): [PresenceStatus, (status: PresenceStatus) => Promise<void>] => {
  const { user } = useAuth();
  const [currentStatus, setCurrentStatus] = useState<PresenceStatus>('Available');
  useEffect(() => {
    if (!user) return;
    // We subscribe to all presences, but only care about the current user
    const unsubscribe = presenceService.subscribeToPresence((presences) => {
      const myPresence = presences.find(p => p.userId === user.uid);
      if (myPresence) {
        setCurrentStatus(myPresence.currentStatus);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user]);
  const change = async (status: PresenceStatus) => {
    setCurrentStatus(status);
    await presenceService.updatePresence({ currentStatus: status });
  };
  return [currentStatus, change];
};

const WIDTH = 232;

/** The status pill, and its menu. The menu floats above the page at the pill -- inside a card it
 *  used to open within the card and be cut off by the card's edge. */
export const StatusSelector: React.FC<{ align?: 'left' | 'right' }> = ({ align = 'right' }) => {
  const [currentStatus, setStatus] = useMyStatus();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Placed under the pill, lined up with its left or right edge; above it when there is no room below.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const h = panel.current?.offsetHeight ?? 360;
    const left = align === 'left' ? r.left : r.right - WIDTH;
    const below = r.bottom + 6;
    setPos({
      left: Math.max(8, Math.min(left, window.innerWidth - WIDTH - 8)),
      top: below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below,
    });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const scroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', esc);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('mousedown', away, true);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);

  const pick = async (status: PresenceStatus) => {
    setOpen(false);
    await setStatus(status);
  };
  const dot = (status: string, size = 8) => (
    <span className="shrink-0 rounded-full" style={{ width: size, height: size, backgroundColor: statusColors[status as PresenceStatus] ?? '#9CA3AF', boxShadow: `0 0 0 3px ${(statusColors[status as PresenceStatus] ?? '#9CA3AF')}22` }} />
  );
  const known = new Set(GROUPS.flatMap((g) => g.items));
  const groups = [...GROUPS, { title: 'Other', items: statuses.filter((s) => !known.has(s)) }].filter((g) => g.items.length);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Your status: ${currentStatus}`}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-8 items-center gap-2 rounded-full border bg-white pl-3 pr-2 text-[13px] font-semibold text-[#1B2A4A] transition-colors ${
          open ? 'border-[#B3C3DF] bg-[#F8FAFD]' : 'border-[#E3E8F0] hover:border-[#C9D3E3]'}`}
      >
        {dot(currentStatus)}
        <span className="whitespace-nowrap">{currentStatus}</span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <Portal>
          <div ref={panel} role="menu" aria-label="Set your status"
            style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH }}
            className="z-[200] max-h-[min(26rem,calc(100vh-1rem))] overflow-y-auto rounded-xl border border-[#E3E8F0] bg-white p-1.5 shadow-[0_12px_32px_-12px_rgba(16,24,40,0.28)]">
            <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Set your status</p>
            {groups.map((g, gi) => (
              <div key={g.title} className={gi ? 'mt-1 border-t border-[#EEF1F5] pt-1' : ''}>
                <p className="px-2.5 pb-0.5 pt-1 text-[11px] font-medium text-gray-400">{g.title}</p>
                {g.items.map((status) => {
                  const on = status === currentStatus;
                  return (
                    <button key={status} type="button" role="menuitemradio" aria-checked={on} onClick={() => pick(status as PresenceStatus)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${on ? 'bg-[#EEF2F8] font-semibold text-[#1C3A70]' : 'text-[#1F2A44] hover:bg-[#F5F7FB]'}`}>
                      {dot(status)}
                      <span className="flex-1">{status}</span>
                      {on && <Check size={14} className="shrink-0 text-[#234788]" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </Portal>
      )}
    </>
  );
};
