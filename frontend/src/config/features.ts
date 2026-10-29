// Feature flags: toggle modules without removing their code.
const DEFAULTS = {
  // Sidebar extra: the workspace card at the bottom.
  sidebarWorkspaceCard: false,
  // The header bell's old v1 notification popover. The bell now opens the v2 Inbox.
  legacyNotifications: false,
  // The header's bell -- the way into the Inbox, and where the unread count lives -- and the
  // "Available" status picker.
  headerBell: true,
  availabilityStatus: false,

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
  // The joiner checklist editor in Admin. The engine behind it stays on: it is what creates a
  // joiner'"'"'s recurring tasks and HR reminders, and -- more importantly -- what offboarding reads
  // to know which of a leaver'"'"'s tasks to delete and which to keep as "Ex - Name". Only the
  // editor is off; the plan runs on its SOP defaults and the person-level button still works.
  joinerChecklistSection: false,

  // The "Shared with me" tab on the Dashboards hub. All Dashboards already lists everything you
  // can open, shared ones included, and each row says whose it is -- so the tab was a filtered
  // view of a list you are already looking at. Sharing is untouched.
  dashboardsSharedTab: false,

  // The All / Team Dashboards / Company scopes above the Dashboards list. With a handful of
  // boards they narrowed a list that already fits on one screen, and each row names whose it
  // is. The filtering still works from a ?tab= link; only the control is gone.
  dashboardScopeTabs: false,

  // The "Task types" entry in the People & Teams rail. A task type is a workspace setting, not a
  // page about people, and it is already reachable from "Manage task types…" inside a task'"'"'s own
  // Type field -- which is where someone is standing when they want one. The page is untouched.
  taskTypesPage: false,
  taskTagsField: false,
  taskCustomFields: false,
  taskTimeInStatus: false,

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
  // The Personal List row under My Tasks. The List itself still exists and still opens.
  personalList: false,
  // The Inbox is the notifications, not a page beside them: the header bell carries the unread
  // count and opens it, and that is the only way in. A sidebar row as well would be two doors
  // into one room. Both pages still answer at /inbox and /reminders.
  inbox: false,
  reminders: false,
  plannerRow: false,
  // The separate "All Tasks" row. Everything you can open is a tab inside My Tasks.
  allTasksRow: false,
  compliance: false,

  // The "Blocked addresses" list in Admin, and the "Offboard and block" option it existed to undo.
  // Off: barring an email was a second way of saying somebody had left, and offboarding already
  // says it. The endpoints are untouched.
  blockedAddresses: false,

  // "Arrange cards" on a Dashboard's menu. Off: every standard board is built from one template
  // and kept to it, so dragging cards about on one puts it out of step with the other fifteen.
  // The edit mode it opened is untouched and still reachable via dashboardEditButton.
  dashboardArrangeCards: false,

  // The Timesheets tab strip: "My timesheet | All timesheets | Approvals", under a heading that
  // already said Timesheets. Off -- the page is one page now, and approvals went with the middle
  // tier of staff that would have done the approving. Every route still answers.
  timesheetTabs: false,

  // Email that arrives on a timer: the daily summary, the week ahead, the month just gone, the
  // Friday recap, the overdue chase, the manager's Monday heads-up and the team digest. Off on
  // the server too (SCHEDULED_EMAIL_ENABLED in backend/.env), and this is the matching half --
  // a settings page offering a daily summary that the server will not send is worse than one
  // that does not offer it. The jobs and this UI both still exist; turn the pair back on
  // together. Email triggered by something a person did -- an invitation, "each update, right
  // away" -- is unaffected.
  emailDigests: false,

  // Any email that is not an invitation.
  //
  // Off, and this is the one that takes the whole "Email" control off the notification settings
  // with it. While email was still doing updates there was something to choose between -- a daily
  // summary, each update, never -- and the control was worth its space even with the summaries
  // switched off. With email down to getting new people into the workspace there is nothing left
  // for a person to decide, and a dropdown whose every option does the same thing is worse than no
  // dropdown. Notifications still arrive in the app and on the device; those controls stay.
  //
  // The server has the matching switch: UPDATE_EMAIL_ENABLED in backend/.env.
  emailUpdates: false,
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
