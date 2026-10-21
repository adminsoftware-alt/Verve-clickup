import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './components/AuthContext';
import { TimerProvider } from './context/TimerContext';
import { NotificationProvider } from './context/NotificationContext';
import './index.css';
import { Toaster } from 'react-hot-toast';
import { AskHost } from './components/ask';
import { initializeServiceWorker, requestNotificationPermission } from './services/notificationService';


import { FEATURES } from './config/features';
import { WorkProvider } from './work/WorkContext';
import { RunningTimerProvider } from './work/RunningTimer';
import { MyTasksProvider } from './work/MyTasksContext';
import { FavoritesProvider } from './work/Favorites';


// --- pages, each loaded the first time somebody opens it -------------------------------------
//
// Every one of these used to be a static import, so the first visit downloaded the whole
// application: 4.17 MB of JavaScript, 1.16 MB over the wire, parsed before anything appeared on
// screen. Most of it could never even be reached -- 77 of the 80 feature flags are off, and the
// pages behind them were still in the bundle. The flags are read from localStorage at runtime, so
// no bundler can prove them dead and shake them out; the import has to be deferred instead.
//
// Now each page is its own chunk, fetched when its route is first visited and cached after. A
// page nobody opens costs nothing, and a page behind a flag that is off is never asked for at all.
const HomePage = lazy(() => import('./work/dashboards/HomePage').then((m) => ({ default: m.HomePage })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const LocationPage = lazy(() => import('./work/LocationPage').then((m) => ({ default: m.LocationPage })));
const PeopleDirectory = lazy(() => import('./work/teams/TeamsHub').then((m) => ({ default: m.PeopleDirectory })));
const TeamsHub = lazy(() => import('./work/teams/TeamsHub').then((m) => ({ default: m.TeamsHub })));
const TeamsList = lazy(() => import('./work/teams/TeamsHub').then((m) => ({ default: m.TeamsList })));
const TeamPage = lazy(() => import('./work/teams/TeamPage').then((m) => ({ default: m.TeamPage })));
const OrgChart = lazy(() => import('./work/teams/OrgChart').then((m) => ({ default: m.OrgChart })));
const AdminPage = lazy(() => import('./work/teams/AdminPage').then((m) => ({ default: m.AdminPage })));
const AdminStandalone = lazy(() => import('./work/teams/AdminPage').then((m) => ({ default: m.AdminStandalone })));
const TaskTypesPage = lazy(() => import('./work/teams/TaskTypesPage').then((m) => ({ default: m.TaskTypesPage })));
const AllTasksPage = lazy(() => import('./work/AllTasksPage').then((m) => ({ default: m.AllTasksPage })));
const PlannerPage = lazy(() => import('./work/planner/PlannerPage').then((m) => ({ default: m.PlannerPage })));
const TeamWeekPage = lazy(() => import('./work/TeamWeekPage').then((m) => ({ default: m.TeamWeekPage })));
const CompliancePage = lazy(() => import('./work/compliance/CompliancePage').then((m) => ({ default: m.CompliancePage })));
const FormPage = lazy(() => import('./work/views/FormView').then((m) => ({ default: m.FormPage })));
const AssignedCommentsPage = lazy(() => import('./work/InboxPages').then((m) => ({ default: m.AssignedCommentsPage })));
const InboxPage = lazy(() => import('./work/InboxPages').then((m) => ({ default: m.InboxPage })));
const RemindersPage = lazy(() => import('./work/InboxPages').then((m) => ({ default: m.RemindersPage })));
const RepliesPage = lazy(() => import('./work/InboxPages').then((m) => ({ default: m.RepliesPage })));
const DashboardsHub = lazy(() => import('./work/dashboards/DashboardsHub').then((m) => ({ default: m.DashboardsHub })));
const DashboardPage = lazy(() => import('./work/dashboards/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const PersonDashboardPage = lazy(() => import('./work/dashboards/PeopleBoards').then((m) => ({ default: m.PersonDashboardPage })));
const PreviewPage = lazy(() => import('./work/dashboards/PreviewPage').then((m) => ({ default: m.PreviewPage })));
const TimesheetsPage = lazy(() => import('./work/timesheets/TimesheetsPage').then((m) => ({ default: m.TimesheetsPage })));
const PublicPage = lazy(() => import('./work/PublicPage').then((m) => ({ default: m.PublicPage })));
const SpacesPage = lazy(() => import('./work/SpacesPage').then((m) => ({ default: m.SpacesPage })));
const AllSpacesPage = lazy(() => import('./work/AllSpacesPage').then((m) => ({ default: m.AllSpacesPage })));
const GoalsPage = lazy(() => import('./work/goals/GoalsPage').then((m) => ({ default: m.GoalsPage })));

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

/** For a page that renders with no shell around it -- a public link, or the sign-in screen. */
// Both of these reach for framer-motion, which is 40 KB gzipped of animation library. Neither is
// on the path to seeing your work: the sign-in screen is for people who are not signed in, and the
// day's note shows once a day and leaves on its own. Loaded eagerly they taxed every page load in
// the app for an animation most of those loads never played.
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const DayLift = lazy(() => import('./components/DayLift').then((m) => ({ default: m.DayLift })));

const FullPageWaiting: React.FC = () => (
  <div className="flex min-h-screen items-center justify-center" aria-busy="true" aria-label="Loading">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
  </div>
);

const AppContent: React.FC = () => {
  const { user } = useAuth();

  // The old Firebase push (v1) is hidden; v2 push goes through /sw.js (Inbox → Settings → this device).
  useEffect(() => {
    if (FEATURES.legacyNotifications) initializeServiceWorker();
  }, []);

  useEffect(() => {
    if (user && FEATURES.legacyNotifications) {
      user.getIdToken().then(token => {
        requestNotificationPermission(token);
      });
    }
  }, [user]);

  return (
    // The outer boundary, for the two routes that render outside the shell. Everything under the
    // shell has its own boundary inside Layout, so the sidebar and header stay put there; here
    // there is nothing to keep, so a plain wait is honest.
    <Suspense fallback={<FullPageWaiting />}>
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      {/* Public links: read-only, no sign-in. */}
      <Route path="/p/:token" element={<PublicPage />} />
      
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<HomePage />} />
        <Route path="settings" element={<Settings />} />
        {/* The old practice pages (/projects, /teams, /time-entries, /calendar, /workload,
            /reports, and the v1 /spaces, /folders and /lists) are gone; their addresses fall
            through to the catch-all below, which goes home. */}

        {/* Work hierarchy: Space, Folder and List pages with their views */}
        <Route path="s/:id" element={<LocationPage />} />
        <Route path="f/:id" element={<LocationPage />} />
        <Route path="l/:id" element={<LocationPage />} />
        {/* Admin on its own, beside Teams & People rather than inside it. The nested route
            below still answers, so an old link lands somewhere sensible. */}
        <Route path="admin" element={<AdminStandalone />} />
        <Route path="people" element={<TeamsHub />}>
          <Route index element={<PeopleDirectory />} />
          <Route path="teams" element={<TeamsList />} />
          <Route path="teams/:id" element={<TeamPage />} />
          <Route path="org" element={<OrgChart />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="task-types" element={<TaskTypesPage />} />
        </Route>
        {/* My Tasks and All Tasks are one page now; the old links still land somewhere sensible. */}
        <Route path="my-tasks" element={<AllTasksPage initialScope="mine" />} />
        {/* The older grouped pages are still there behind the flag that shows their rail rows. */}
        <Route path="my-tasks/assigned" element={<AllTasksPage initialScope="mine" />} />
        <Route path="my-tasks/today" element={<AllTasksPage initialScope="now" />} />
        <Route path="all-tasks" element={<AllTasksPage />} />
        {/* A manager's Team: tasks given to the people in the Teams they lead (the phone's Tasks › Team). */}
        <Route path="team-tasks" element={<AllTasksPage initialScope="team" />} />
        <Route path="spaces" element={<SpacesPage />} />
        <Route path="planner" element={<PlannerPage />} />
        <Route path="team-week" element={<TeamWeekPage />} />
        <Route path="compliance" element={<CompliancePage />} />
        <Route path="all-spaces" element={<AllSpacesPage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="goals/:id" element={<GoalsPage />} />
        <Route path="forms/:viewId" element={<FormPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="replies" element={<RepliesPage />} />
        <Route path="assigned-comments" element={<AssignedCommentsPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="dashboards" element={<DashboardsHub />} />
        {/* Before ":id", or "preview" is read as a dashboard id. */}
        <Route path="dashboards/preview" element={<PreviewPage />} />
        <Route path="dashboards/people/:userId" element={<PersonDashboardPage />} />
        <Route path="dashboards/:id" element={<DashboardPage />} />
        <Route path="timesheets" element={<TimesheetsPage tab="mine" />} />
        <Route path="timesheets/all" element={<TimesheetsPage tab="all" />} />
        <Route path="timesheets/approvals" element={<TimesheetsPage tab="approvals" />} />
        <Route path="timesheets/people/:userId" element={<TimesheetsPage tab="person" />} />

      </Route>
      
      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      {/* A word about the day, once a day, that leaves on its own. */}
      <Suspense fallback={null}><DayLift /></Suspense>
      {/* Confirmations and the odd "type a name", in the app's own shape rather than the
          browser's grey box. Anything can ask; this is what draws it. */}
      <AskHost />
      {/* Errors used to be an operating-system dialog. These sit under the header, out of the
          way of the toolbar, and carry the app's own shape rather than the library's. */}
      <Toaster
        position="top-right"
        containerStyle={{ top: 72 }}
        toastOptions={{
          duration: 4000,
          style: {
            borderRadius: '10px',
            border: '1px solid #E5E7EB',
            background: '#fff',
            color: '#1F2937',
            fontSize: '13px',
            padding: '10px 14px',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.10)',
            maxWidth: '26rem',
          },
          success: { iconTheme: { primary: '#0F766E', secondary: '#fff' } },
          error: { iconTheme: { primary: '#DC2626', secondary: '#fff' } },
        }}
      />
      <AuthProvider>
        <NotificationProvider>
          <TimerProvider>
            <WorkProvider>
              <RunningTimerProvider>
                <MyTasksProvider><FavoritesProvider><AppContent /></FavoritesProvider></MyTasksProvider>
              </RunningTimerProvider>
            </WorkProvider>
          </TimerProvider>
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
