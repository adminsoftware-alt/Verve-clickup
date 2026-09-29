import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { HomePage } from './work/dashboards/HomePage';
import { Login } from './pages/Login';
import { Tasks } from './pages/Tasks';
import { Settings } from './pages/Settings';
import { AuthProvider, useAuth } from './components/AuthContext';
import { TimerProvider } from './context/TimerContext';
import { NotificationProvider } from './context/NotificationContext';
import './index.css';
import { Toaster } from 'react-hot-toast';
import { DayLift } from './components/DayLift';
import { AskHost } from './components/ask';
import { initializeServiceWorker, requestNotificationPermission } from './services/notificationService';

import { TimeEntries } from './pages/TimeEntries';

import { Reports } from './pages/Reports';
import { Calendar } from './pages/Calendar';
import { Workload } from './pages/Workload';
import { SpaceView } from './pages/SpaceView';
import { Teams } from './pages/Teams';
import { TeamDetails } from './pages/TeamDetails';
import { Projects } from './pages/Projects';
import { ChatApp } from './pages/ChatApp';
import { FEATURES } from './config/features';
import { WorkProvider } from './work/WorkContext';
import { LocationPage } from './work/LocationPage';
import { PeoplePage } from './work/PeoplePage';
import { PeopleDirectory, TeamsHub, TeamsList } from './work/teams/TeamsHub';
import { TeamPage } from './work/teams/TeamPage';
import { OrgChart } from './work/teams/OrgChart';
import { AdminPage } from './work/teams/AdminPage';
import { TaskTypesPage } from './work/teams/TaskTypesPage';
import { AllTasksPage } from './work/AllTasksPage';
import { PlannerPage } from './work/planner/PlannerPage';
import { LeavePage } from './work/leave/LeavePage';
import { BillingPage } from './work/leave/BillingPage';
import { TeamWeekPage } from './work/TeamWeekPage';
import { CompliancePage } from './work/compliance/CompliancePage';
import { FormPage } from './work/views/FormView';
import { RunningTimerProvider } from './work/RunningTimer';
import { MyTasksProvider } from './work/MyTasksContext';
import { FavoritesProvider } from './work/Favorites';
import { MyTasksPage } from './work/MyTasksPage';
import { AssignedCommentsPage, InboxPage, RemindersPage, RepliesPage } from './work/InboxPages';
import { DashboardsHub } from './work/dashboards/DashboardsHub';
import { DashboardPage } from './work/dashboards/DashboardPage';
import { PreviewPage } from './work/dashboards/PreviewPage';
import { TimesheetsPage } from './work/timesheets/TimesheetsPage';
import { PublicPage } from './work/PublicPage';
import { AllSpacesPage } from './work/AllSpacesPage';
import { GoalsPage } from './work/goals/GoalsPage';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

const PlaceholderPage: React.FC<{ title: string }> = ({ title }) => (
  <div style={{ padding: 'var(--spacing-8)', textAlign: 'center', marginTop: '10vh' }}>
    <h1 style={{ fontSize: '2rem', marginBottom: 'var(--spacing-4)', color: 'var(--color-text-primary)' }}>{title}</h1>
    <p style={{ color: 'var(--color-text-secondary)' }}>This module is currently under construction and will be available in the next phase.</p>
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
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      {/* Public links: read-only, no sign-in. */}
      <Route path="/p/:token" element={<PublicPage />} />
      
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={FEATURES.legacyHome ? <Dashboard /> : <HomePage />} />
        {FEATURES.legacyTasks && <Route path="tasks" element={<Tasks />} />}
        <Route path="time-entries" element={<TimeEntries />} />
        <Route path="settings" element={<Settings />} />
        
        <Route path="calendar" element={<Calendar />} />
        <Route path="workload" element={<Workload />} />
        <Route path="reports" element={<Reports />} />
        <Route path="projects" element={<Projects />} />
        <Route path="clients" element={<PlaceholderPage title="Clients" />} />
        <Route path="team" element={<Teams />} />
        <Route path="teams" element={<Teams />} />
        <Route path="teams/:id" element={<TeamDetails />} />
        {FEATURES.chat && <Route path="chat" element={<ChatApp />} />}
        <Route path="capacity" element={<PlaceholderPage title="Capacity" />} />
        <Route path="integrations" element={<PlaceholderPage title="Integrations" />} />
        
        {/* Work hierarchy: Space, Folder and List pages with their views */}
        <Route path="s/:id" element={<LocationPage />} />
        <Route path="f/:id" element={<LocationPage />} />
        <Route path="l/:id" element={<LocationPage />} />
        <Route path="people" element={<TeamsHub />}>
          <Route index element={<PeopleDirectory />} />
          <Route path="teams" element={<TeamsList />} />
          <Route path="teams/:id" element={<TeamPage />} />
          <Route path="org" element={<OrgChart />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="task-types" element={<TaskTypesPage />} />
        </Route>
        {FEATURES.legacyPeoplePage && <Route path="people-classic" element={<PeoplePage />} />}
        {/* My Tasks and All Tasks are one page now; the old links still land somewhere sensible. */}
        <Route path="my-tasks" element={FEATURES.myTasksChildren ? <MyTasksPage mode="home" /> : <AllTasksPage initialScope="mine" />} />
        {/* The older grouped pages are still there behind the flag that shows their rail rows. */}
        <Route path="my-tasks/assigned" element={FEATURES.myTasksChildren ? <MyTasksPage mode="assigned" /> : <AllTasksPage initialScope="mine" />} />
        <Route path="my-tasks/today" element={FEATURES.myTasksChildren ? <MyTasksPage mode="today" /> : <AllTasksPage initialScope="now" />} />
        <Route path="all-tasks" element={<AllTasksPage />} />
        <Route path="planner" element={<PlannerPage />} />
        <Route path="leave" element={<LeavePage />} />
        <Route path="billing" element={<BillingPage />} />
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
        <Route path="dashboards/:id" element={<DashboardPage />} />
        <Route path="timesheets" element={<TimesheetsPage tab="mine" />} />
        <Route path="timesheets/all" element={<TimesheetsPage tab="all" />} />
        <Route path="timesheets/approvals" element={<TimesheetsPage tab="approvals" />} />
        <Route path="timesheets/people/:userId" element={<TimesheetsPage tab="person" />} />

        <Route path="spaces/:spaceId" element={<SpaceView type="space" />} />
        <Route path="folders/:folderId" element={<SpaceView type="folder" />} />
        <Route path="lists/:listId" element={<SpaceView type="list" />} />
      </Route>
      
      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      {/* A word about the day, once a day, that leaves on its own. */}
      <DayLift />
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
