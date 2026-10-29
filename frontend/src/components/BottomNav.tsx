// The bar of tabs across the bottom of a phone: Dashboard, Tasks, Timesheet, Spaces.
//
// The same four for everybody; whose work each one shows is the switch at the top of the page
// (MobileScope.tsx). Notifications are the bell in the header, and My team (People, for an admin),
// Settings and Admin are under your avatar -- so there is no "More" drawer to open.
//
// Each tab goes back to where it was left: a manager who looks at their Team's dashboard lands
// there next time, not on their own.
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckSquare, Clock, FolderTree, LayoutDashboard } from 'lucide-react';

import { sectionOf, useTabTarget, type Section } from './MobileScope';

const TABS: { section: Section; label: string; icon: React.ReactNode }[] = [
  { section: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { section: 'tasks', label: 'Tasks', icon: <CheckSquare size={20} /> },
  { section: 'timesheet', label: 'Timesheet', icon: <Clock size={20} /> },
  { section: 'spaces', label: 'Spaces', icon: <FolderTree size={20} /> },
];

const Tab: React.FC<{ section: Section; label: string; icon: React.ReactNode; on: boolean }> = ({ section, label, icon, on }) => {
  const to = useTabTarget(section);
  return (
    <Link to={to} aria-current={on ? 'page' : undefined}
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[10px] font-medium no-underline transition-colors ${on ? 'text-brand-700' : 'text-gray-500'}`}>
      <span className={`flex h-7 w-12 items-center justify-center rounded-full ${on ? 'bg-brand-50' : ''}`}>{icon}</span>
      <span className="pb-1.5">{label}</span>
    </Link>
  );
};

export const BottomNav: React.FC = () => {
  const { pathname } = useLocation();
  const here = sectionOf(pathname);
  return (
    <nav aria-label="Main"
      className="no-print fixed inset-x-0 bottom-0 z-[60] flex border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {TABS.map((t) => <Tab key={t.section} {...t} on={here === t.section} />)}
    </nav>
  );
};
