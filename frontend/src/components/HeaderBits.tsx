// The pieces of the top bar: who you're signed in as.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, LogOut, ShieldCheck, UserRound, Users } from 'lucide-react';

import { useAuth } from './AuthContext';
import { useIsAdmin, useIsManager, useWork } from '../work/WorkContext';
import { Avatar, Portal } from '../work/ui';
import { accessOf } from '../work/teams/access';
import { WordSkeleton } from '../work/Skeleton';
import { PRESENCE_COLORS } from '../services/presenceService';
import { statuses, useMyStatus } from './StatusSelector';
import { ShortcutsDialog } from './ShortcutsDialog';

const item = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 no-underline hover:bg-gray-50';
/** Your own avatar: the navy, wherever it stands for you. */
export const SELF_COLOR = '#234788';

/**
 * A top-bar dropdown. The panel is drawn in a portal and placed against the button, because the
 * header lives inside a pane that clips whatever overflows it -- which is what cut these menus off.
 * It never runs past the window: it stays on screen horizontally and scrolls inside if it is tall.
 */
const Dropdown: React.FC<{
  label: string;
  width: number;
  align?: 'left' | 'right';
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  onOpen?: () => void;
}> = ({ label, width, align = 'left', trigger, children, onOpen }) => {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const place = useCallback(() => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const left = align === 'right' ? rect.right - width : rect.left;
    setBox({
      top: rect.bottom + 6,
      left: Math.min(Math.max(margin, left), window.innerWidth - width - margin),
      maxHeight: window.innerHeight - rect.bottom - 6 - margin,
    });
  }, [align, width]);

  useEffect(() => {
    if (!open) return;
    place();
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!button.current?.contains(target) && !panel.current?.contains(target)) close();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', away, true);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', away, true);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place, close]);

  return (
    <>
      <button
        ref={button} type="button" aria-label={label} aria-expanded={open} aria-haspopup="menu"
        onClick={() => { if (!open) onOpen?.(); setOpen(!open); }}
      >
        {trigger(open)}
      </button>
      {open && box && (
        <Portal>
          <div
            ref={panel} role="menu" aria-label={label}
            style={{ position: 'fixed', top: box.top, left: box.left, width, maxHeight: box.maxHeight }}
            className="z-[120] overflow-auto overscroll-contain rounded-xl border border-gray-200 bg-white py-1.5 shadow-2xl"
          >
            {children(close)}
          </div>
        </Portal>
      )}
    </>
  );
};

// --- who you are -----------------------------------------------------------------

export const ProfileChip: React.FC = () => {
  const { logout, user: signedIn } = useAuth();
  const { me, workspace, allMembers, teams } = useWork();
  const isManager = useIsManager();
  const isAdmin = useIsAdmin();
  const [status, setStatus] = useMyStatus();
  const [picking, setPicking] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);

  const mine = allMembers.find((m) => m.user.id === me);
  // Until the members load, the sign-in already knows a name and an email; drawing "?" and "You"
  // for that moment read as if the app did not know who you were.
  const known = signedIn?.displayName || signedIn?.email;
  const user = mine?.user ?? { id: me || signedIn?.uid || 'me', email: signedIn?.email ?? '', display_name: signedIn?.displayName ?? null };
  const waiting = !mine && !known;
  const stored = mine?.role ?? workspace?.role;
  // Admin, Manager or Employee -- not the stored role's own name ("member").
  const role = stored ? accessOf(stored, me ?? '', teams) : undefined;
  const dot = PRESENCE_COLORS[status];

  return (
    <>
      <Dropdown
        label="Your account" width={300} align="right" onOpen={() => setPicking(false)}
        trigger={(open) => (
          waiting ? (
            <span className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2" aria-busy="true">
              <span className="h-7 w-7 animate-pulse rounded-full bg-gray-200" />
              <span className="hidden h-3 w-20 animate-pulse rounded bg-gray-200 sm:block" />
            </span>
          ) : (
            <span className={`flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2 ${open ? 'bg-gray-100' : 'hover:bg-gray-100'}`}>
              {/* Your status shows as the dot on your avatar. */}
              <span className="relative flex">
                <Avatar user={user} size={28} color={SELF_COLOR} />
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: dot }} />
              </span>
              <span className="hidden max-w-[120px] truncate text-sm font-medium text-gray-700 lg:block">
                {user.display_name || user.email.split('@')[0]}
              </span>
              <ChevronDown size={14} className="hidden text-gray-400 lg:block" />
            </span>
          )
        )}
      >
        {(close) => (
          <>
            <div className="flex items-center gap-3 px-3 pb-3 pt-2">
              <Avatar user={user} size={40} color={SELF_COLOR} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#1B2A4A]">{user.display_name || user.email.split('@')[0] || <WordSkeleton />}</p>
                <p className="truncate text-xs text-gray-500">{user.email}</p>
                {role && <span className="mt-1 inline-block rounded-full bg-[#EEF2F8] px-2 py-0.5 text-[11px] font-medium text-[#234788]">{role}</span>}
              </div>
            </div>

            {/* Your status, set right here rather than on Settings. */}
            <div className="border-t border-gray-100 px-1.5 py-1.5">
              <button type="button" onClick={() => setPicking(!picking)} aria-expanded={picking} className={`${item} rounded-lg`}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} />
                <span className="flex-1">{status}</span>
                <span className="text-xs text-gray-400">Set status</span>
                <ChevronDown size={14} className={`text-gray-400 transition-transform ${picking ? 'rotate-180' : ''}`} />
              </button>
              {picking && (
                <div className="grid grid-cols-2 gap-0.5 px-1 pb-1">
                  {statuses.map((s) => (
                    <button key={s} type="button" onClick={() => { setStatus(s); setPicking(false); }}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${s === status ? 'bg-[#EEF2F8] font-medium text-[#1B2A4A]' : 'text-gray-600 hover:bg-gray-50'}`}>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PRESENCE_COLORS[s] }} />
                      <span className="truncate">{s}</span>
                      {s === status && <Check size={12} className="ml-auto shrink-0 text-[#234788]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 py-1">
              <Link to="/settings" role="menuitem" onClick={close} className={item}><UserRound size={15} className="text-gray-400" /> My profile</Link>
              {/* Running teams is a manager's job, and the directory is part of it. */}
              {isManager && <Link to="/people" role="menuitem" onClick={close} className={item}><Users size={15} className="text-gray-400" /> People &amp; Teams</Link>}
              {/* On a phone there is no sidebar, so Admin's way in is here. */}
              {isAdmin && <Link to="/admin" role="menuitem" onClick={close} className={`${item} md:hidden`}><ShieldCheck size={15} className="text-gray-400" /> Admin</Link>}
            </div>
            <div className="border-t border-gray-100 pt-1">
              <button type="button" role="menuitem" onClick={() => { close(); logout(); }} className={`${item} text-red-600 hover:bg-red-50`}>
                <LogOut size={15} /> Sign out
              </button>
            </div>
          </>
        )}
      </Dropdown>
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
      <ShortcutsKey onOpen={() => setShortcuts(true)} />
    </>
  );
};

/** "?" anywhere outside a text box opens the keyboard shortcuts. */
const ShortcutsKey: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      e.preventDefault();
      onOpen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
  return null;
};
