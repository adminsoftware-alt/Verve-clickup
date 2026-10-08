// The bar of tabs across the bottom of a phone.
//
// A 240px sidebar is most of a 390px screen, so on a phone it hides behind a button -- and a
// sidebar you have to open is a sidebar nobody opens. These five tabs are the things somebody
// actually reaches for on a phone: what they have to do, what has happened, their hours, and a
// way through to everything else. The rest of the app is one tap away under "More", which opens
// the same sidebar rather than a second, poorer menu.
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, CheckSquare, Clock, LayoutDashboard, Menu } from 'lucide-react';

import { useIsAdmin } from '../work/WorkContext';
import { useInboxCount } from '../work/InboxPages';

type Tab = { to: string; label: string; icon: React.ReactNode; match: (path: string) => boolean; badge?: number };

export const BottomNav: React.FC<{ onMore: () => void; moreOpen: boolean }> = ({ onMore, moreOpen }) => {
  const { pathname } = useLocation();
  const isAdmin = useIsAdmin();
  const unread = useInboxCount();

  const tabs: Tab[] = [
    {
      to: '/my-tasks', label: 'My work', icon: <CheckSquare size={20} />,
      match: (p) => p.startsWith('/my-tasks') || p.startsWith('/all-tasks'),
    },
    // Notifications, which is what the Inbox is. On a phone the header bell is a 20px target in
    // a crowded bar, so the tab carries the unread count instead -- one door, reachable by thumb.
    {
      to: '/inbox', label: 'Notifications', icon: <Bell size={20} />,
      match: (p) => p.startsWith('/inbox'), badge: unread,
    },
    {
      to: '/timesheets', label: 'Hours', icon: <Clock size={20} />,
      match: (p) => p.startsWith('/timesheets'),
    },
    {
      // An admin has no personal board; the Company one is the first row of Dashboards.
      to: isAdmin ? '/dashboards' : '/', label: isAdmin ? 'Boards' : 'Home', icon: <LayoutDashboard size={20} />,
      match: (p) => p === '/' || p.startsWith('/dashboards'),
    },
  ];

  const row = 'flex flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[10px] font-medium no-underline transition-colors';

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-[60] flex border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {tabs.map((t) => {
        const on = t.match(pathname);
        return (
          <Link key={t.to} to={t.to} aria-current={on ? 'page' : undefined} className={`${row} ${on ? 'text-brand-700' : 'text-gray-500'}`}>
            <span className="relative flex h-6 items-center">
              {t.icon}
              {!!t.badge && (
                <span className="absolute -right-2.5 -top-1 min-w-4 rounded-full bg-brand-600 px-1 text-[9px] font-semibold leading-4 text-white">
                  {t.badge > 99 ? '99+' : t.badge}
                </span>
              )}
            </span>
            <span className="pb-1.5">{t.label}</span>
          </Link>
        );
      })}
      <button
        type="button" onClick={onMore} aria-expanded={moreOpen} aria-label="More"
        className={`${row} ${moreOpen ? 'text-brand-700' : 'text-gray-500'}`}
      >
        <span className="flex h-6 items-center"><Menu size={20} /></span>
        <span className="pb-1.5">More</span>
      </button>
    </nav>
  );
};
