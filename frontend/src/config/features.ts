// Feature flags: toggle modules without removing their code.
const DEFAULTS = {
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
  // The header's bell (the Inbox is in the sidebar too) and the "Available" status picker.
  headerBell: true,
  availabilityStatus: false,
  // The first People & Teams page, replaced by the Teams Hub.
  legacyPeoplePage: false,
  // The old Firestore-backed home page. Home now shows your own "My work" Dashboard.
  legacyHome: false,

  // Candidate dashboard cards rendered with made-up data, so they could be judged and picked
  // before any was built for real. That choosing is done, so the link is off. The page still
  // exists at /dashboards/preview for the next time we are weighing up a card.
  dashboardPreview: false,

  // Dashboard header controls. The layout editor still works — it moved into the "..." menu — and
  // the scheduled-report dialog and the full-screen card modal are both still wired up.
  dashboardEditButton: false,
  dashboardEmailReports: false,
  dashboardCardFullScreen: false,
  // The Calendar and Workload views on the timesheet, and the "Fill from Planner" button.
  // All three still exist -- the Calendar and the Workload are the same components My Tasks
  // uses, and the prefill endpoint is untouched -- they are just not on this page.
  timesheetExtraViews: false,
  timesheetFillFromPlanner: false,
  // The sort chip on the timesheet. A week of one person's work is read by task name, which is
  // now what it is always ordered by; the chip only ever offered the ordering it already had.
  timesheetSortChip: false,
  // The Billable status and Tag chips on the timesheet. Both still filter -- the query fields
  // are untouched and the entry menus still set billable and tags -- they are just not two more
  // controls in a row that is now one dropdown.
  timesheetBillableAndTagChips: false,
  // The separate "Time entries" list beside the timesheet. Hovering a cell now shows the entries
  // behind it, which is the same answer in the place the question is asked.
  timesheetEntriesView: false,

  // The "Custom fields" entry on a view's menu, and the "+" that added a column from the list
  // header. Fields are set up per Space in its own settings; offering it again from every view
  // that happens to show them put schema editing one stray click from a task list. The dialog
  // and the service behind it are untouched -- turn this on and both come straight back.
  listCustomFields: false,

  // Automations: "when this happens here, do that", on a Space, Folder or List. Six triggers
  // against six actions, all built and all tested. It comes off the menu because a rule you
  // cannot trace or silence from the notification it sent is a rule people end up muting
  // wholesale -- see the plan for moving it into the Inbox. The service, the routes and the
  // scheduled due-soon/overdue runs are untouched; no rule exists yet to be affected.
  automations: false,

  // The watch toggle on a task header -- the eye, and the little row of watcher faces beside
  // it. Watching still happens: being assigned a task, commenting on it, being mentioned in
  // one or having it shared with you all start it, and those notifications still arrive. This
  // only takes away the button for subscribing to a task that is not yours, which is a habit
  // nobody here has yet and a control that has to be explained before it is used.
  taskWatchers: false,

  // The Relationships section on a task -- waiting on, blocking, links. The service and the
  // data are untouched; the section is simply not on the panel.
  taskRelationships: false,

  // Four rows taken off the task panel, so what is left is what a task is actually filled in by:
  // who, when, how long, what kind. Every one of them still works elsewhere --
  //  * Group: still set in bulk from a List and still what "Group by" reads.
  //  * Tags: still typed on the List and Table views, and still filterable.
  //  * Custom fields: still defined per Space and still shown as columns.
  //  * Time in status: still recorded on every status change, and still on the reports.
  // Turn any of them back on and the row comes straight back where it was.
  taskGroupField: false,
  // The Repeat row. A repeat is a property of the dates it repeats on, and it is set from the
  // date picker now -- "Set Recurring", on either half of the Dates field. The rule, the editor
  // and the whole recurrence engine are untouched.
  taskRepeatField: false,

  // The "Start the joiner checklist" tick on the Add person dialog. Adding someone and running
  // their induction are two jobs, usually two people and often two days apart; asking both at
  // once got the box ticked by reflex. The checklist, its tasks and the leaver rules are all
  // still there -- it is started from the person'"'"'s own page instead.
  joinerChecklistOnAdd: false,

  // The "Shared with me" tab on the Dashboards hub. All Dashboards already lists everything you
  // can open, shared ones included, and each row says whose it is -- so the tab was a filtered
  // view of a list you are already looking at. Sharing is untouched.
  dashboardsSharedTab: false,

  // The "Task types" entry in the People & Teams rail. A task type is a workspace setting, not a
  // page about people, and it is already reachable from "Manage task types…" inside a task'"'"'s own
  // Type field -- which is where someone is standing when they want one. The page is untouched.
  taskTypesPage: false,
  taskTagsField: false,
  taskCustomFields: false,
  taskTimeInStatus: false,

  // --- the Spaces menu ------------------------------------------------------------------------
  // Entries taken off the Space / Folder / List menu. Every one of them still works: Favourites
  // still drive the Favourites row, settings and statuses are reachable from the location's own
  // page, and archiving is still what the Archived page restores from.
  spaceMenuFavourites: false,
  spaceMenuSettings: false,
  spaceMenuHide: false,
  spaceMenuClickApps: false,
  spaceMenuSections: false,
  // The Space's tag library. Tags are created by typing one on a task, which is where people
  // actually reach for them; a separate library to curate first is a second place to keep the
  // same list in step. The dialog and the API behind it are untouched.
  // "Email to this List": forward mail to a List's own address and it becomes a task, with the
  // sender's words as the description and their attachments attached. Unlike the two below, this
  // one is not a bad fit -- it is simply not plugged in. It needs a catch-all mailbox with
  // plus-addressing on the firm's domain and four values in backend/.env (INBOUND_EMAIL_ADDRESS,
  // IMAP_HOST, IMAP_USER, IMAP_PASSWORD). Until then everyone who opens it is told it is not set
  // up, which is a worse answer than not offering it. Set up the mailbox and turn this back on.
  listEmail: false,

  spaceMenuTags: false,
  // Sprint Folders: fixed-length iterations with rollover and burndown. An advisory firm's work
  // is dated by statute and by the client, not by a two-week cadence someone chose, so the whole
  // idea imports a shape this work does not have. The service, the settings dialog and the
  // Sprint dashboard card all still work -- this only takes it off the Folder menu.
  sprintFolders: false,
  spaceMenuStatuses: false,
  spaceMenuArchive: false,

  // --- My Tasks -------------------------------------------------------------------------------
  // The Sort control. Sorting inside a group is by due date; the Table view's column headers
  // still sort, so the toolbar button was a third way to do the same thing.
  myTasksSortButton: false,
  // The Table view. It is the same tasks as the List with the columns laid out flat, and the
  // component is untouched -- a Space, Folder or List still offers it.
  myTasksTableView: false,
  // Group by, inside the Filter dropdown. Filter answers "which tasks"; grouping answers "how
  // are they arranged", which is a different question and was the odd one out in that panel.
  // The setting is still there and still saved -- the List groups by due date, the Board by
  // progress -- it just has no control on the toolbar.
  myTasksGroupBy: false,
  // Separate Group by / Fields / Show closed buttons. All three live inside Filter now, which is
  // the one control that says what you are looking at.
  myTasksViewButtons: false,
  // The all-at-once filter sheet. Replaced on My Tasks by the two-step panel; still what a List
  // and a Table use, where it also carries the advanced AND/OR rules.
  myTasksOldFilterPanel: false,
  // The "Me" toggle. Filter > Assignee > Me does the same thing, and having both meant a task
  // could be hidden by a control you were not looking at.
  myTasksMeButton: false,
  // Due-date grouping in six buckets (Today, Tomorrow, This week, Next week, Later). Off, the
  // groups are Overdue and Upcoming, which is the distinction people actually act on.
  taskDueBucketsDetailed: false,

  // The "To do" task list on the Dashboard. The status pie already says what is still open, and
  // My Tasks is where that list is worked from. Other task-list cards ("Nobody is on these") stay.
  dashboardToDoCard: false,
  // The Over / Under / On target / No estimate chips and the person picker inside the
  // estimate-against-actual card. The card's own Filter button covers who and what; the table
  // underneath is read in full rather than narrowed.
  dashboardVarianceChips: false,
  // The window dropdown beside a chart's Filter button ("All open work", "Due this month"…).
  // The same choices are the Time entry inside the Filter panel, so the dropdown only repeated
  // a control that is already there.
  dashboardCardScopeMenu: false,
  // The "Completed tasks" card. The card type is still built and still renders -- this only keeps
  // it off the Dashboard, on new boards and on ones that already carry one.
  dashboardCompletedCard: false,
  // The "..." actions menu. It is hidden on your own board either way (see DashboardPage); this
  // flag also takes it off Dashboards opened from the Hub, where it is the only route to Rename,
  // Change locations, Arrange cards, Duplicate and Delete.
  dashboardActionsMenu: true,
  // The "· My work" link beside the greeting on your own Dashboard.
  dashboardHomeSubtitle: false,
  // The "Unscheduled" heading in My Tasks. New tasks must carry dates, so it only appears when
  // older undated work is still sitting there.
  unscheduledGroup: false,

  // --- built, but kept out of the sidebar until we bring them in -------------------------------
  goals: false,
  teamWeek: false,
  // The two comment pages in the sidebar. The pages themselves still answer at /replies and
  // /assigned-comments, and comments still reach the Inbox.
  replies: false,
  assignedComments: false,
  // The Personal List row under My Tasks. The List itself still exists and still opens.
  personalList: false,
  // The Inbox and Reminders rows. Both pages still answer at /inbox and /reminders, and
  // notifications are still recorded; they are simply not in the rail.
  inbox: false,
  reminders: false,
  // The separate rows under My Tasks. My Tasks is one page with its own views now.
  myTasksChildren: false,
  plannerRow: false,
  // The separate "All Tasks" row. Everything you can open is a tab inside My Tasks.
  allTasksRow: false,
  // The separate "All Spaces" page. The Spaces tree in the sidebar already shows the Spaces you
  // are in and the ones shared with you, so there is only one place to look.
  allSpacesPage: false,
  compliance: false,
  leavePages: false,
  billing: false,
  archived: false,
  templates: false,
  // The extra view types. Only Dashboard, Table, Team, Calendar and Workload are offered in "+ View";
  // every location keeps its built-in List (and a Folder or Space its Overview).
  extraViewTypes: false,
};

export type FeatureName = keyof typeof DEFAULTS;

/** Anything in localStorage["timetriq.features"] wins, so a hidden module can be switched on to try it. */
function overrides(): Partial<Record<FeatureName, boolean>> {
  try {
    const raw = localStorage.getItem('timetriq.features');
    return raw ? (JSON.parse(raw) as Partial<Record<FeatureName, boolean>>) : {};
  } catch {
    return {};
  }
}

export const FEATURES: Record<FeatureName, boolean> = { ...DEFAULTS, ...overrides() };
