// The pieces of the top bar: who you're signed in as.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react';

import { useAuth } from './AuthContext';
import { useIsAdmin, useIsManager, useWork } from '../work/WorkContext';
import { Avatar, Portal } from '../work/ui';
import { accessOf } from '../work/teams/access';

const item = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50';

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

  const mine = allMembers.find((m) => m.user.id === me);
  // Until the members load, the sign-in already knows a name and an email; drawing "?" and "You"
  // for that moment read as if the app did not know who you were.
  const known = signedIn?.displayName || signedIn?.email;
  const user = mine?.user ?? { id: me || signedIn?.uid || 'me', email: signedIn?.email ?? '', display_name: signedIn?.displayName ?? null };
  const waiting = !mine && !known;
  const stored = mine?.role ?? workspace?.role;
  // Admin, Manager or Employee -- not the stored role's own name ("member").
  const role = stored ? accessOf(stored, me ?? '', teams) : undefined;

  return (
    <Dropdown
      label="Your account" width={272} align="right"
      trigger={(open) => (
        waiting ? (
          <span className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2" aria-busy="true">
            <span className="h-7 w-7 animate-pulse rounded-full bg-gray-200" />
            <span className="hidden h-3 w-20 animate-pulse rounded bg-gray-200 sm:block" />
          </span>
        ) : (
          <span className={`flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2 ${open ? 'bg-gray-100' : 'hover:bg-gray-100'}`}>
            <Avatar user={user} size={28} />
            <span className="hidden max-w-[120px] truncate text-sm font-medium text-gray-700 sm:block">
              {user.display_name || user.email.split('@')[0]}
            </span>
          </span>
        )
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 border-b border-gray-100 px-3 pb-3 pt-2">
            <Avatar user={user} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-800">{user.display_name || user.email.split('@')[0] || 'Loading…'}</p>
              <p className="truncate text-xs text-gray-500">{user.email}</p>
              {role && <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">{role}</p>}
            </div>
          </div>
          {/* Running teams is a manager's job, and the directory is part of it. */}
          {isManager && <Link to="/people" role="menuitem" onClick={close} className={item}><UserRound size={15} className="text-gray-400" /> People &amp; Teams</Link>}
          {/* On a phone there is no sidebar, so Admin's way in is here. */}
          {isAdmin && <Link to="/admin" role="menuitem" onClick={close} className={`${item} md:hidden`}><ShieldCheck size={15} className="text-gray-400" /> Admin</Link>}
          <Link to="/settings" role="menuitem" onClick={close} className={item}><Settings size={15} className="text-gray-400" /> Settings</Link>
          <button type="button" role="menuitem" onClick={() => { close(); logout(); }} className={`${item} text-red-600 hover:bg-red-50`}>
            <LogOut size={15} /> Sign out
          </button>
        </>
      )}
    </Dropdown>
  );
};
