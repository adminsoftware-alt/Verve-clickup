import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Target, BarChart3, Bell, CalendarDays, Landmark, Layers, Users, Clock, MessageSquare, MessagesSquare, UserCheck } from 'lucide-react';
import { InboxLink } from './InboxPages';
import { useWork } from './WorkContext';
import { FEATURES } from '../config/features';
import { isDueTodayOrOverdue, useMyTasks } from './MyTasksContext';

/** The "My Tasks" block that sits above Spaces, as in ClickUp's Home sidebar. */
export const MyTasksNav: React.FC = () => {
  const { workspace, hierarchy, teams, me } = useWork();
  const { tasks } = useMyTasks();
  const { pathname } = useLocation();

  if (!workspace) return null;
  const isAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
  const looksAfterOthers = isAdmin || teams.some((t) => t.lead_ids.includes(me));
  const dueCount = tasks.filter((t) => isDueTodayOrOverdue(t)).length;

  const rowClass = (active: boolean) =>
    `side-row flex w-full items-center gap-2 no-underline ${active ? 'is-active bg-brand-50 text-brand-700' : 'text-gray-700'}`;
  /** A row with no twisty keeps the twisty's slot, so every icon sits in the same column. */
  const gap = <span className="w-4 shrink-0" aria-hidden />;

  return (
    <nav aria-label="My Tasks" className="select-none">
      {FEATURES.inbox && <InboxLink className={`${rowClass(pathname === '/inbox')} pl-1.5`} leading={gap} />}
      {FEATURES.replies && (
        <Link to="/replies" className={`${rowClass(pathname === '/replies')} pl-1.5`}>
          {gap}<MessageSquare size={16} className="shrink-0 text-gray-500" /><span className="flex-1 truncate font-medium">Replies</span>
        </Link>
      )}
      {FEATURES.assignedComments && (
        <Link to="/assigned-comments" className={`${rowClass(pathname === '/assigned-comments')} pl-1.5`}>
          {gap}<MessagesSquare size={16} className="shrink-0 text-gray-500" /><span className="flex-1 truncate font-medium">Assigned comments</span>
        </Link>
      )}
      {FEATURES.reminders && (
        <Link to="/reminders" className={`${rowClass(pathname === '/reminders')} pl-1.5`}>
          {gap}<Bell size={16} className="shrink-0 text-gray-500" /><span className="flex-1 truncate font-medium">Reminders</span>
        </Link>
      )}
      {/* My Tasks is one page with its own views (list, today, calendar, planner, timesheet),
          so the rail carries a single row rather than a little tree.

          An admin is not doing the task work; their own handful of assigned tasks is not what
          they open the app for. The page still answers at /my-tasks if they go looking. */}
      {!isAdmin && (
        <Link to="/my-tasks" className={`${rowClass(pathname.startsWith('/my-tasks'))} pl-1.5`}>
          {gap}<UserCheck size={16} className="shrink-0 text-gray-500" />
          <span className="flex-1 truncate font-medium">My Tasks</span>
          {dueCount > 0 && <span className="text-xs text-gray-400">{dueCount}</span>}
        </Link>
      )}
      {FEATURES.plannerRow && (
        <Link to="/planner" className={`${rowClass(pathname === '/planner')} pl-1.5`}>
          {gap}<CalendarDays size={16} className="shrink-0 text-gray-500" />
          <span className="flex-1 truncate font-medium">Planner</span>
        </Link>
      )}
      {FEATURES.allTasksRow && (
        <Link to="/all-tasks" className={`${rowClass(pathname === '/all-tasks')} pl-1.5`}>
          {gap}<Layers size={16} className="shrink-0 text-gray-500" />
          <span className="flex-1 truncate font-medium">All Tasks</span>
        </Link>
      )}
      {/* The Dashboards hub is for people who look after others: admins, owners and Team leads.
          Everyone else has their own Dashboard, which is what the app opens on. */}
      {looksAfterOthers && (
        <Link to="/dashboards" className={`${rowClass(pathname.startsWith('/dashboards'))} pl-1.5`}>
          {gap}<BarChart3 size={16} className="shrink-0 text-gray-500" />
          <span className="flex-1 truncate font-medium">Dashboards</span>
        </Link>
      )}
      {FEATURES.goals && (
        <Link to="/goals" className={`${rowClass(pathname.startsWith('/goals'))} pl-1.5`}>
          {gap}<Target size={16} className="shrink-0 text-gray-500" />
          <span className="flex-1 truncate font-medium">Goals</span>
        </Link>
      )}
      {FEATURES.teamWeek && (
        <Link to="/team-week" className={`${rowClass(pathname === '/team-week')} pl-1.5`}>
          {gap}<Users size={16} className="shrink-0 text-gray-500" />
          <span className="flex-1 truncate font-medium">My team's week</span>
        </Link>
      )}
      {FEATURES.compliance && (
        <Link to="/compliance" className={`${rowClass(pathname === '/compliance')} pl-1.5`}>
          {gap}<Landmark size={16} className="shrink-0 text-gray-500" />
          <span className="flex-1 truncate font-medium">Compliance</span>
        </Link>
      )}
      <Link to="/timesheets" className={`${rowClass(pathname.startsWith('/timesheets'))} pl-1.5`}>
        {gap}<Clock size={16} className="shrink-0 text-gray-500" />
        <span className="flex-1 truncate font-medium">Timesheet</span>
      </Link>
    </nav>
  );
};
