// Feature flags: toggle modules without removing their code.
export const FEATURES = {
  chat: false,
  // The old standalone Tasks page. Tasks now live inside Spaces > Folders > Lists.
  legacyTasks: false,
  // Old top-level pages. As in ClickUp, these now live inside Spaces instead:
  // Calendar, Workload and Dashboard are views; time is tracked on tasks;
  // teams are managed under People & Teams.
  legacyTimeTracking: false,
  legacyCalendar: false,
  legacyTeams: false,
  legacyReports: false,
  legacyWorkload: false,
  // Sidebar extras: the Settings/Integrations group and the workspace card at the bottom.
  // Settings stays reachable from the profile menu.
  sidebarSettings: false,
  sidebarWorkspaceCard: false,
  // The header's "Request Leave" button (leave requests on the old v1 pages).
  leave: false,
  // The header bell's old v1 notification popover. The bell now opens the v2 Inbox.
  legacyNotifications: false,
  // The header's bell (Inbox stays in the sidebar) and the "Available" status picker.
  headerBell: false,
  availabilityStatus: false,
  // The first People & Teams page, replaced by the Teams Hub.
  legacyPeoplePage: false,
};
