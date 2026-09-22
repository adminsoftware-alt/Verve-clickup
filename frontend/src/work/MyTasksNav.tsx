import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BarChart3, Bell, CalendarDays, Layers, CalendarClock, Clock, ChevronDown, ChevronRight, List as ListIcon, MessageSquare, MessagesSquare, UserCheck } from 'lucide-react';
import { InboxLink } from './InboxPages';
import { useAuth } from '../components/AuthContext';
import { useWork } from './WorkContext';
import { isDueTodayOrOverdue, useMyTasks } from './MyTasksContext';

const OPEN_KEY = 'timetriq.myTasksOpen';

/** The "My Tasks" block that sits above Spaces, as in ClickUp's Home sidebar. */
export const MyTasksNav: React.FC = () => {
  const { user } = useAuth();
  const { workspace, hierarchy } = useWork();
  const { tasks, openPersonalList } = useMyTasks();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* ignore */ } }, [open]);

  if (!workspace) return null;
  const dueCount = tasks.filter((t) => isDueTodayOrOverdue(t)).length;
  const personalId = hierarchy?.personal_list?.id;
  const initial = (user?.displayName || user?.email || '?')[0]?.toUpperCase();

  const rowClass = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-sm no-underline ${active ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-black/5'}`;

  return (
    <nav aria-label="My Tasks" className="select-none">
      <InboxLink className={`${rowClass(pathname === '/inbox')} mb-0.5 pl-6`} />
      <Link to="/replies" className={`${rowClass(pathname === '/replies')} mb-0.5 pl-6`}>
        <MessageSquare size={16} className="shrink-0 text-gray-500" /><span className="flex-1 font-medium">Replies</span>
      </Link>
      <Link to="/assigned-comments" className={`${rowClass(pathname === '/assigned-comments')} mb-0.5 pl-6`}>
        <MessagesSquare size={16} className="shrink-0 text-gray-500" /><span className="flex-1 font-medium">Assigned comments</span>
      </Link>
      <Link to="/reminders" className={`${rowClass(pathname === '/reminders')} mb-0.5 pl-6`}>
        <Bell size={16} className="shrink-0 text-gray-500" /><span className="flex-1 font-medium">Reminders</span>
      </Link>
      <div className={`group ${rowClass(pathname === '/my-tasks')} pl-1.5`}>
        <button type="button" aria-label={open ? 'Collapse My Tasks' : 'Expand My Tasks'} onClick={() => setOpen(!open)} className="rounded text-gray-400 hover:bg-black/10 hover:text-gray-700">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Link to="/my-tasks" className="flex min-w-0 flex-1 items-center gap-2 font-medium text-inherit no-underline">
          <UserCheck size={16} className="shrink-0 text-gray-500" /> My Tasks
        </Link>
      </div>
      {open && (
        <div className="ml-5 border-l border-gray-200 pl-1.5">
          <Link to="/my-tasks/assigned" className={`${rowClass(pathname === '/my-tasks/assigned')} pl-2`}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white">{initial}</span>
            <span className="flex-1 truncate">Assigned to me</span>
            {tasks.length > 0 && <span className="text-xs text-gray-400">{tasks.length}</span>}
          </Link>
          <Link to="/my-tasks/today" className={`${rowClass(pathname === '/my-tasks/today')} pl-2`}>
            <CalendarClock size={15} className="shrink-0 text-gray-500" />
            <span className="flex-1 truncate">Today &amp; Overdue</span>
            {dueCount > 0 && <span className="text-xs text-gray-400">{dueCount}</span>}
          </Link>
          <button
            type="button"
            onClick={() => openPersonalList().catch((e) => window.alert(e.message))}
            className={`${rowClass(!!personalId && pathname === `/l/${personalId}`)} pl-2 text-left`}
          >
            <ListIcon size={15} className="shrink-0 text-gray-500" />
            <span className="flex-1 truncate">Personal List</span>
            {!!hierarchy?.personal_list?.open_task_count && <span className="text-xs text-gray-400">{hierarchy.personal_list.open_task_count}</span>}
          </button>
        </div>
      )}
      <Link to="/planner" className={`${rowClass(pathname === '/planner')} mt-0.5 pl-6`}>
        <CalendarDays size={16} className="shrink-0 text-gray-500" />
        <span className="flex-1 font-medium">Planner</span>
      </Link>
      <Link to="/all-tasks" className={`${rowClass(pathname === '/all-tasks')} mt-0.5 pl-6`}>
        <Layers size={16} className="shrink-0 text-gray-500" />
        <span className="flex-1 font-medium">All Tasks</span>
      </Link>
      <Link to="/dashboards" className={`${rowClass(pathname.startsWith('/dashboards'))} mt-0.5 pl-6`}>
        <BarChart3 size={16} className="shrink-0 text-gray-500" />
        <span className="flex-1 font-medium">Dashboards</span>
      </Link>
      <Link to="/timesheets" className={`${rowClass(pathname.startsWith('/timesheets'))} mt-0.5 pl-6`}>
        <Clock size={16} className="shrink-0 text-gray-500" />
        <span className="flex-1 font-medium">Timesheets</span>
      </Link>
    </nav>
  );
};
