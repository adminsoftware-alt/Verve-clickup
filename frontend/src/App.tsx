import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Tasks } from './pages/Tasks';
import { Settings } from './pages/Settings';
import { AuthProvider, useAuth } from './components/AuthContext';
import { TimerProvider } from './context/TimerContext';
import { NotificationProvider } from './context/NotificationContext';
import './index.css';
import { Toaster } from 'react-hot-toast';
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
import { AllTasksPage } from './work/AllTasksPage';
import { PlannerPage } from './work/planner/PlannerPage';
import { FormPage } from './work/views/FormView';
import { RunningTimerProvider } from './work/RunningTimer';
import { MyTasksProvider } from './work/MyTasksContext';
import { FavoritesProvider } from './work/Favorites';
import { MyTasksPage } from './work/MyTasksPage';
import { AssignedCommentsPage, InboxPage, RemindersPage, RepliesPage } from './work/InboxPages';
import { DashboardsHub } from './work/dashboards/DashboardsHub';
import { DashboardPage } from './work/dashboards/DashboardPage';
import { TimesheetsPage } from './work/timesheets/TimesheetsPage';

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

  useEffect(() => {
    initializeServiceWorker();
  }, []);

  useEffect(() => {
    if (user) {
      user.getIdToken().then(token => {
        requestNotificationPermission(token);
      });
    }
  }, [user]);

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
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
        </Route>
        {FEATURES.legacyPeoplePage && <Route path="people-classic" element={<PeoplePage />} />}
        <Route path="my-tasks" element={<MyTasksPage mode="home" />} />
        <Route path="my-tasks/assigned" element={<MyTasksPage mode="assigned" />} />
        <Route path="my-tasks/today" element={<MyTasksPage mode="today" />} />
        <Route path="all-tasks" element={<AllTasksPage />} />
        <Route path="planner" element={<PlannerPage />} />
        <Route path="forms/:viewId" element={<FormPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="replies" element={<RepliesPage />} />
        <Route path="assigned-comments" element={<AssignedCommentsPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="dashboards" element={<DashboardsHub />} />
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
      <Toaster position="top-right" />
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
