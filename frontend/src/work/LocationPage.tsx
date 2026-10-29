import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, Calendar, CalendarRange, ChevronRight, ClipboardList, Columns3, FileSpreadsheet, FileText, Folder, GanttChart, Globe, History, Home, LayoutDashboard, List as ListIcon, ListPlus, Lock, Map as MapIcon, MessagesSquare, Network, PenTool, Plus, Share2, Table2, Upload, Users } from 'lucide-react';
import { useWork, useMe } from './WorkContext';
import { pathFor } from './SpacesSidebar';
import { peek, workApi, type CustomField, type Dependency, type FolderNode, type ListNode, type LocationKind, type SpaceNode, type Status, type Task, type TaskGroup, type TaskInput, type View, type ViewType } from './api';
import { TaskRowsSkeleton } from './Skeleton';
import { DownloadIcon, Menu, NameDialog, formatDue } from './ui';
import { TaskPanel } from './TaskPanel';
import { ListView } from './views/ListView';
import { CalendarView } from './views/CalendarView';
import { DashboardView } from './views/DashboardView';
import { LocationDashboard } from './views/LocationDashboard';
import { WorkloadView } from './views/WorkloadView';
import { BoardView } from './views/BoardView';
import { OverviewView } from './views/OverviewView';
import { useRunningTimer } from './RunningTimer';
import { rememberPlace } from './recent';
import { ShareDialog } from './ShareDialog';
import { useLeadership } from './dashboards/dialogs';
import { GroupsDialog } from './GroupsDialog';
import { NewTaskDialog } from './task/NewTaskDialog';
import { NO_GROUP, buildGroups, type GroupBy } from './views/grouping';
import { applyFilters, readSettings, sortTasks, COLUMNS, type ViewSettings } from './views/viewSettings';
import { FilterPanel } from './views/FilterPanel';
import { FieldsButton, ShowButton } from './views/QuickControls';
import { GroupByButton, MeButton, TeamButton } from './views/ViewControls';
import { BulkBar } from './views/BulkBar';
import { TableView } from './views/TableView';
import { TeamView } from './views/TeamView';
import { GanttView } from './views/GanttView';
import { exportTasks, taskRows } from './views/exportTasks';
import { ActivityView } from './views/ActivityView';
import { FormBuilder } from './views/FormView';
import { FieldsDialog } from './fields/FieldsDialog';
import { ImportDialog } from './templates/ImportDialog';
import { FEATURES } from '../config/features';
import { notify } from '../components/notify';
import { DocView } from './views/DocView';
import { WhiteboardView } from './views/WhiteboardView';
import { MindMapView } from './views/MindMapView';
import { MapView } from './views/MapView';
import { ChatView } from './views/ChatView';
import { EmbedView } from './views/EmbedView';
import { SprintBar } from './views/SprintBar';
import { PublicLinksDialog } from './PublicLinks';

const VIEW_META: Record<ViewType, { label: string; icon: React.ReactNode }> = {
  overview: { label: 'Overview', icon: <Home size={14} /> },
  list: { label: 'List', icon: <ListIcon size={14} /> },
  board: { label: 'Board', icon: <Columns3 size={14} /> },
  calendar: { label: 'Calendar', icon: <Calendar size={14} /> },
  dashboard: { label: 'Dashboard', icon: <LayoutDashboard size={14} /> },
  workload: { label: 'Workload', icon: <Activity size={14} /> },
  table: { label: 'Table', icon: <Table2 size={14} /> },
  team: { label: 'Team', icon: <Users size={14} /> },
  gantt: { label: 'Gantt', icon: <GanttChart size={14} /> },
  timeline: { label: 'Timeline', icon: <CalendarRange size={14} /> },
  activity: { label: 'Activity', icon: <History size={14} /> },
  form: { label: 'Form', icon: <ClipboardList size={14} /> },
  doc: { label: 'Doc', icon: <FileText size={14} /> },
  whiteboard: { label: 'Whiteboard', icon: <PenTool size={14} /> },
  mind_map: { label: 'Mind map', icon: <Network size={14} /> },
  map: { label: 'Map', icon: <MapIcon size={14} /> },
  chat: { label: 'Chat', icon: <MessagesSquare size={14} /> },
  embed: { label: 'Embed', icon: <Globe size={14} /> },
};
// Views that bring their own data and controls instead of the shared task toolbar.
const SELF_CONTAINED: ViewType[] = ['overview', 'dashboard', 'workload', 'activity', 'form', 'doc', 'whiteboard', 'chat', 'embed'];

function listsUnder(node: SpaceNode | FolderNode | ListNode, kind: LocationKind): ListNode[] {
  if (kind === 'list') return [node as ListNode];
  const container = node as SpaceNode | FolderNode;
  return [...container.folders.flatMap((f) => listsUnder(f, 'folder')), ...container.lists];
}

export const LocationPage: React.FC = () => {
  const { id = '' } = useParams();
  const { pathname } = useLocation();
  const kind: LocationKind = pathname.startsWith('/s/') ? 'space' : pathname.startsWith('/f/') ? 'folder' : 'list';
  const { hierarchy, members, locate, listName, taskTypes, teams, refresh: refreshTree, loading: treeLoading, error: treeError } = useWork();
  // Lists and Folders are a manager's to make. An employee with full access to a Space still
  // works inside it rather than reshaping it, so the buttons are not offered.
  const { isAdmin, led } = useLeadership();
  const canShapeIt = isAdmin || led.length > 0;
  // Your Personal List is private to you, so it has no Share button.
  const isPersonal = kind === 'list' && hierarchy?.personal_list?.id === id;
  const located = locate(kind, id);

  const [searchParams, setSearchParams] = useSearchParams();
  const [loadedViews, setViews] = useState<View[]>([]);
  // Which location those views belong to: after moving to another Space, Folder or List, the old
  // tabs must not linger (a click on one would open a view of the previous page).
  const [viewsOf, setViewsOf] = useState('');
  const views = useMemo(() => (viewsOf === `${kind}:${id}` ? loadedViews : []), [viewsOf, kind, id, loadedViews]);
  const [tasks, setTasks] = useState<Task[]>([]);
  // True until this location's tasks have arrived once, so the rows can be sketched in meanwhile.
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [statuses, setStatuses] = useState<Status[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [newTaskList, setNewTaskList] = useState<string | null>(null);
  // What a quick-add row typed, to start the New task dialog from.
  const [newTaskStart, setNewTaskStart] = useState<(TaskInput & { name: string }) | null>(null);
  const [creatingList, setCreatingList] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [managingGroups, setManagingGroups] = useState(false);
  const [viewFields, setViewFields] = useState<CustomField[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [managingFields, setManagingFields] = useState(false);
  const [importing, setImporting] = useState(false);
  const [publicView, setPublicView] = useState<View | null>(null);
  const me = useMe();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creatingFolder, setCreatingFolder] = useState(false);
  const navigate = useNavigate();
  const { version: timerVersion } = useRunningTimer();

  const loadViews = useCallback(async () => {
    try { setViews(await workApi.views(kind, id)); setViewsOf(`${kind}:${id}`); } catch (e) { setError((e as Error).message); }
  }, [kind, id]);

  const activeView = views.find((v) => v.id === searchParams.get('v')) ?? views[0];

  // The view's setup (filters, sort, group by, columns). Changes apply at once and are kept for
  // you, in this browser, per view -- the "View changed / Save view" bar is gone, so one person's
  // filter no longer has to be saved over everyone's.
  const savedSettings = useMemo(() => readSettings(activeView?.settings, activeView?.type), [activeView]);
  const mineKey = `timetriq.view.${activeView?.id ?? ''}`;
  const [settings, setSettings] = useState<ViewSettings>(savedSettings);
  useEffect(() => {
    let mine: ViewSettings | null = null;
    try { const raw = localStorage.getItem(mineKey); if (raw) mine = readSettings(JSON.parse(raw), activeView?.type); } catch { mine = null; }
    setSettings(mine ?? savedSettings);
    setSelected(new Set());
  }, [savedSettings, mineKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = <K extends keyof ViewSettings>(key: K, value: ViewSettings[K]) => setSettings((prev) => {
    const next = { ...prev, [key]: value };
    try { localStorage.setItem(mineKey, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  // Me mode, as in ClickUp: only your tasks, and every task you add here is put in your name.
  const [meMode, setMeModeState] = useState(() => { try { return localStorage.getItem('timetriq.meMode') === '1'; } catch { return false; } });
  const setMeMode = (on: boolean) => {
    setMeModeState(on);
    if (on) setTeamMode(false);
    try { localStorage.setItem('timetriq.meMode', on ? '1' : '0'); } catch { /* ignore */ }
  };
  // My team, for Managers: the tasks of everyone in the Teams they lead. One or the other with Me.
  const myPeople = useMemo(() => new Set(teams.filter((t) => t.lead_ids.includes(me)).flatMap((t) => t.members.map((u) => u.id)).filter((x) => x !== me)), [teams, me]);
  const [teamMode, setTeamModeState] = useState(false);
  const setTeamMode = (on: boolean) => { setTeamModeState(on); if (on) setMeModeState(false); };
  // Who a new task here is given to: you in Me mode, plus anyone picked in Filter -> Assignee.
  // Filter by two people and add five tasks, and all five go to those two.
  const autoAssignees = useMemo(() => {
    const picked = settings.filters.assignees.filter((a) => a !== 'none').map((a) => (a === 'me' ? me : a));
    return [...new Set([...(meMode ? [me] : []), ...picked])].filter(Boolean) as string[];
  }, [settings.filters.assignees, meMode, me]);
  // Lists no longer offer "Group by"; one saved with another grouping goes back to status.
  const groupBy: GroupBy = activeView?.type === 'list' ? 'status' : settings.groupBy;
  // Subtasks on or off, per view in this browser.
  const subKey = `timetriq.subtasks.${activeView?.id ?? ''}`;
  const [showSubtasks, setShowSubtasksState] = useState(true);
  useEffect(() => { try { setShowSubtasksState(localStorage.getItem(subKey) !== '0'); } catch { setShowSubtasksState(true); } }, [subKey]);
  const setShowSubtasks = (on: boolean) => { setShowSubtasksState(on); try { localStorage.setItem(subKey, on ? '1' : '0'); } catch { /* ignore */ } };

  // A Board shows its closed column's cards, as ClickUp does; List and Calendar hide them unless asked.
  // The Team view shows what each person finished this week, so it needs closed tasks too.
  const includeClosed = settings.showClosed || ['board', 'team', 'gantt', 'timeline'].includes(activeView?.type ?? '');

  // Loads can overlap (page open, task created, timer stopped); only the latest may land,
  // or a slow earlier response would overwrite newer data.
  const loadSeq = useRef(0);
  const loadTasks = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      setError(null);
      // Everything the page needs is asked for at once rather than one after another.
      workApi.groups(kind, id).then((g) => { if (seq === loadSeq.current) setGroups(g); }).catch(() => undefined);
      workApi.fields(kind, id, true).then((f) => { if (seq === loadSeq.current) setViewFields(f); }).catch(() => undefined);
      workApi.dependencies(kind, id).then((d) => { if (seq === loadSeq.current) setDependencies(d); }).catch(() => undefined);
      const [page, set] = await Promise.all([
        workApi.tasks(kind, id, { include_closed: includeClosed }),
        kind === 'list' ? workApi.statuses('list', id) : Promise.resolve(null),
      ]);
      if (seq !== loadSeq.current) return;
      setTasks(page.tasks);
      setLoadingTasks(false);
      setStatuses(set ? set.statuses : null);
    } catch (e) {
      if (seq === loadSeq.current) { setError((e as Error).message); setLoadingTasks(false); }
    }
  }, [kind, id, includeClosed]);
  // Moving to another List starts the wait again, unless it was open a moment ago: then it is
  // drawn as it was while the fresh copy loads.
  useEffect(() => {
    const lastViews = peek(() => workApi.views(kind, id));
    if (lastViews) { setViews(lastViews); setViewsOf(`${kind}:${id}`); }
    const last = peek(() => workApi.tasks(kind, id, { include_closed: includeClosed }));
    const lastStatuses = kind === 'list' ? peek(() => workApi.statuses('list', id)) : null;
    if (last && (kind !== 'list' || lastStatuses)) {
      setTasks(last.tasks);
      setStatuses(lastStatuses ? lastStatuses.statuses : null);
      setLoadingTasks(false);
    } else {
      setLoadingTasks(true);
    }
  }, [kind, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only fetch once the location is in the (permission-filtered) tree: otherwise the caller
  // cannot open it and every request would just be refused. While the tree is still loading,
  // start anyway: a place the caller can't open shows its own message whatever these return.
  const reachable = !!located || !hierarchy;
  useEffect(() => { if (reachable) loadViews(); }, [loadViews, reachable]);
  useEffect(() => { if (reachable) loadTasks(); }, [loadTasks, reachable]);
  // Starting or stopping a timer changes the Time tracked totals on screen.
  useEffect(() => { if (reachable && timerVersion > 0) loadTasks(); }, [timerVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every Space, Folder and List page counts as visited, whether it was opened from the sidebar,
  // a link in a message or a bookmark -- the place shows up under Recent in search either way.
  useEffect(() => { if (reachable) rememberPlace(kind, id); }, [reachable, kind, id]);
  // "?task=<id>" (from Home's Recents) opens that task over the List.
  const linkedTask = searchParams.get('task');
  // Closing a task opened by link drops ?task= from the address, so the same link works again.
  const closeTask = useCallback(() => {
    setOpenTask(null);
    if (searchParams.get('task')) {
      const next = new URLSearchParams(searchParams);
      next.delete('task');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  useEffect(() => { if (linkedTask) setOpenTask(linkedTask); }, [linkedTask]);

  const changed = useCallback(() => {
    loadTasks();
    refreshTree();
    setRefreshKey((k) => k + 1);
  }, [loadTasks, refreshTree]);

  const selectView = (view: View) => setSearchParams({ v: view.id });

  const canEditHere = located?.node.permission_level === 'edit' || located?.node.permission_level === 'full';
  // Drag a view tab onto another to put it there.
  const draggingView = useRef<string | null>(null);
  const dropView = async (target: View) => {
    const from = draggingView.current;
    draggingView.current = null;
    if (!from || from === target.id) return;
    const order = views.map((v) => v.id).filter((x) => x !== from);
    order.splice(order.indexOf(target.id), 0, from);
    setViews((prev) => order.map((x) => prev.find((v) => v.id === x)!));
    await Promise.all(order.map((vid, i) => workApi.updateView(vid, { orderindex: i + 1 }).catch(() => undefined)));
  };

  const people = useMemo(() => members.map((m) => m.user), [members]);
  const filtered = useMemo(() => {
    const shown = showSubtasks ? tasks : tasks.filter((t) => !t.parent_id);
    return sortTasks(applyFilters(teamMode ? shown.filter((t) => t.assignees.some((u) => myPeople.has(u.id))) : shown, settings.filters, me, meMode), settings.sort);
  }, [tasks, settings.filters, settings.sort, me, showSubtasks]);
  const makeGroups = useCallback(
    (roots: Task[]) => buildGroups(groupBy, roots, statuses, groups, people, taskTypes),
    [groupBy, statuses, groups, people, taskTypes],
  );
  // Selected tasks still on screen (a filter can hide some).
  const selectedTasks = useMemo(() => filtered.filter((t) => selected.has(t.id)), [filtered, selected]);
  const select = (ids: string[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    ids.forEach((x) => (on ? next.add(x) : next.delete(x)));
    return next;
  });

  const writableLists = useMemo(
    () => (located ? listsUnder(located.node, kind).filter((l) => l.permission_level === 'full') : []),
    [located, kind],
  );
  const canCreate = kind === 'list' && located?.node.permission_level === 'full';
  // Folders all start with a List called "List", so label choices by their path.
  const listChoices = useMemo(
    () => writableLists.map((l) => ({
      id: l.id,
      label: (locate('list', l.id)?.path ?? []).slice(1).map((c) => c.name).join(' / ') || l.name,
    })),
    [writableLists, locate],
  );
  const needsAList = kind !== 'list' && !!located && listsUnder(located.node, kind).length === 0;
  // Where a task lives, relative to this page: "Learning / List" on a Space, "List" on a Folder.
  const depth = located?.path.length ?? 0;
  const locationLabel = useCallback(
    (listId: string) => (locate('list', listId)?.path.slice(depth).map((c) => c.name).join(' / ') || listName(listId)),
    [locate, listName, depth],
  );

  // What a new task gets from the group it's added in, e.g. "+ Add Task" under "High" sets High.
  const inputForGroup = (key: string): TaskInput => {
    switch (groupBy) {
      case 'status': return { status_id: key };
      case 'group': return { group_id: key === NO_GROUP ? null : key };
      case 'type': return { type_id: key === NO_GROUP ? null : key };
      case 'priority': return { priority: key === NO_GROUP ? null : Number(key.slice(1)) };
      case 'assignee': return { assignees: key === NO_GROUP ? [] : [key] };
      case 'tags': {
        const tag = tasks.flatMap((t) => t.tags).find((x) => x.name.toLowerCase() === key);
        return key === NO_GROUP || !tag ? {} : { tags: [tag.name] };
      }
      default: return {};
    }
  };
  const canAddIn = () => canCreate && (groupBy === 'status' ? !!statuses : groupBy !== 'due');
  const boardCanDrag = groupBy === 'status' ? !!statuses : ['group', 'type', 'priority', 'assignee'].includes(groupBy);
  const moveCard = async (taskId: string, from: string, to: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    let input: TaskInput;
    if (groupBy === 'group') {
      const group = groups.find((g) => g.id === to) ?? null;
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, group } : t)));
      input = { group_id: group?.id ?? null };
    } else if (groupBy === 'priority') {
      const priority = to === NO_GROUP ? null : Number(to.slice(1));
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, priority } : t)));
      input = { priority };
    } else if (groupBy === 'assignee') {
      // Dragging from one person's column to another's hands the task over, as in ClickUp.
      const kept = task.assignees.map((u) => u.id).filter((u) => u !== from);
      input = { assignees: to === NO_GROUP ? kept : [...new Set([...kept, to])] };
    } else {
      // Move the card straight away; the reload confirms (or undoes) it.
      const status = statuses?.find((st) => st.id === to);
      if (status) setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
      input = { status_id: to };
    }
    await workApi.updateTask(taskId, input).catch((e) => notify.error(e));
    changed();
  };

  /** Make the task, then open it: everything else is set on the task itself, as in ClickUp. */
  const createAndOpen = async (listId: string, input: TaskInput & { name: string }) => {
    const task = await workApi.createTask(listId, input.assignees || !autoAssignees.length ? input : { ...input, assignees: autoAssignees });
    changed();
    setOpenTask(task.id);
  };

  /** A quick-add row (List, Board, Calendar, Table). A task needs its who, when, how big and how
   *  urgent before it is made: when the row brought all of them (the List's own inline row
   *  does), it is made here; otherwise what was typed opens the New task dialog, filled in. */
  const createInList = async (listId: string, input: TaskInput & { name: string }) => {
    const complete = !!input.assignees?.length && !!input.start_date && !!input.due_date && !!input.time_estimate_seconds && !!input.priority;
    if (complete && kind === 'list') {
      await workApi.createTask(listId, input);
      changed();
      return;
    }
    setNewTaskStart(input);
    setNewTaskList(listId);
  };

  if (!located) {
    return (
      <div className="p-10 text-center text-sm text-gray-500">
        {treeLoading ? <TaskRowsSkeleton rows={6} label="Loading" /> : treeError ?? 'This location does not exist, or you do not have access to it.'}
      </div>
    );
  }

  // Where you are, on the page itself rather than squeezed into the top bar: the path above
  // (Space, Folder), each a link back up, and this place's own name large beneath it with Share
  // on the right. On a phone the path is left out; the name is enough there.
  const parents = located.path.slice(0, -1);
  const here = located.path[located.path.length - 1];
  const HereIcon = kind === 'list' ? ListIcon : kind === 'folder' ? Folder : LayoutDashboard;
  const breadcrumb = (
    <div className="loc-head min-w-0">
      {parents.length > 0 && (
        <nav aria-label="Location" className="hidden min-w-0 items-center gap-1 text-[12.5px] text-gray-500 sm:flex">
          {parents.map((crumb, i) => (
            <React.Fragment key={crumb.id}>
              {i > 0 && <ChevronRight size={13} className="shrink-0 text-gray-300" />}
              <Link to={pathFor(crumb.kind, crumb.id)} title={crumb.name}
                className="flex min-w-0 max-w-[20rem] items-center gap-1 rounded px-1 py-0.5 hover:bg-gray-100 hover:text-gray-800">
                {crumb.kind === 'folder' && <Folder size={13} className="shrink-0" />}
                <span className="truncate">{crumb.name}</span>
              </Link>
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="mt-0.5 flex min-w-0 items-center gap-2.5">
        <span className="loc-head-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"><HereIcon size={16} /></span>
        <h1 aria-label={here.name} className="min-w-0 truncate text-xl font-semibold tracking-tight text-gray-900">{here.name}</h1>
        {located.node.is_private && <Lock size={14} className="shrink-0 text-gray-400" aria-label="Private" />}
        {kind === 'list' && (() => {
          const lst = located.node as ListNode;
          return (lst.start_date || lst.due_date) ? (
            <span className="hidden shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 sm:inline" aria-label="List dates">
              {lst.start_date ? formatDue(lst.start_date) : '…'} → {lst.due_date ? formatDue(lst.due_date) : '…'}
            </span>
          ) : null;
        })()}
        {isPersonal ? (
          <span className="ml-auto hidden shrink-0 text-xs text-gray-400 sm:inline">Only you can see this List</span>
        ) : (
          <button
            type="button"
            onClick={() => setSharing(true)}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Share2 size={14} /> Share
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="ui-clean location-ui flex h-full min-h-0 flex-col bg-white">
      <header className="border-b border-gray-200 px-4 pt-3 sm:px-6">
        {breadcrumb}

        {/* Views bar */}
        <div className="mt-2.5 flex items-center gap-1">
          {/* One tab per kind of view: a second Calendar or Team tab made earlier is left out. The
              tab menu (rename, favourite, default, share publicly) is gone; a tab is a tab. */}
          {views.filter((view, i) => views.findIndex((v) => v.type === view.type && v.private === view.private) === i).map((view) => (
            <div
              key={view.id}
              draggable
              onDragStart={() => { draggingView.current = view.id; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropView(view)}
              className={`flex items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-sm ${activeView?.id === view.id ? 'border-brand-600 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            >
              <button type="button" onClick={() => selectView(view)} className="flex items-center gap-1.5">
                {view.type !== 'list' && VIEW_META[view.type].icon}
                {view.name}
                {view.private && <Lock size={11} className="text-gray-400" aria-label="Private view" />}
              </button>
            </div>
          ))}
          {/* "+ View" is gone: a List is a List. Tabs made earlier still open. */}
        </div>
      </header>

      {/* Toolbar */}
      {activeView && !SELF_CONTAINED.includes(activeView.type) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-6 py-2">
          {/* Left: how the list is laid out -- grouping, what is shown, which fields. ClickUp keeps
              these on the bar rather than inside Filter, and so does this. */}
          {/* A List is always grouped by status, so "Group by" is offered on a Board only. */}
          {activeView.type === 'board' && (
            <GroupByButton value={groupBy} onChange={(g) => update('groupBy', g)}
              options={['status', 'assignee', 'priority', 'due', 'tags', 'group', 'type', 'none'] as GroupBy[]} />
          )}
          <ShowButton closed={settings.showClosed} onClosed={(on) => update('showClosed', on)} subtasks={showSubtasks} onSubtasks={setShowSubtasks} />
          {(activeView.type === 'list' || activeView.type === 'table') && (
            <FieldsButton hidden={settings.hidden} onChange={(h) => update('hidden', h)} fields={viewFields} />
          )}
          <MeButton on={meMode} onChange={setMeMode} />
          {myPeople.size > 0 && <TeamButton on={teamMode} onChange={setTeamMode} />}
          {/* Right: narrowing down, then everything else under "…". */}
          <div className="ml-auto flex items-center gap-1.5">
            {/* One panel, as on My Tasks: what to show, and how to lay it out. It replaced a row
                of five controls -- Filter, Sort, Show closed, Me, Group by, Columns -- that were
                six separate answers to one question. */}
            <FilterPanel
              filters={settings.filters}
              onChange={(f) => update('filters', f)}
              tasks={tasks}
              statuses={statuses}
              people={people}
            />
            {/* The Assignees and "Me" buttons beside it are gone: Filter → Assignee does both. */}
            <Menu
              label="Export or import tasks"
              items={[
                // Custom fields are set up per Space, in its own settings, rather than from
                // every view that happens to show them.
                ...(FEATURES.listCustomFields
                  ? [{ label: 'Custom fields', icon: <ListPlus size={14} />, onClick: () => setManagingFields(true) }]
                  : []),
                ...(activeView.type !== 'table' ? [
                  { label: 'Export to Excel', icon: <FileSpreadsheet size={14} />, onClick: () => exportTasks('xlsx', located.node.name, taskRows(filtered, viewFields, people, locationLabel)) },
                  { label: 'Export to CSV', icon: <FileSpreadsheet size={14} />, onClick: () => exportTasks('csv', located.node.name, taskRows(filtered, viewFields, people, locationLabel)) },
                  { label: 'Export to PDF', icon: <FileText size={14} />, onClick: () => exportTasks('pdf', located.node.name, taskRows(filtered, viewFields, people, locationLabel), located.node.name) },
                ] : []),
                ...(canCreate ? [{ label: 'Import tasks', icon: <Upload size={14} />, onClick: () => setImporting(true) }] : []),
              ]}
              trigger={<span className="dash-dl flex rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-brand-700"><DownloadIcon /></span>}
            />
            {writableLists.length > 0 && (
              <button
                type="button"
                onClick={() => { setNewTaskStart(null); setNewTaskList(kind === 'list' ? id : writableLists[0].id); }}
                className="btn-accent ml-1 flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold shadow-sm"
              >
                <Plus size={14} /> Task
              </button>
            )}
          </div>
        </div>
      )}

      {error && <div className="mx-6 mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {kind === 'list' && located.path.some((c) => c.kind === 'folder' && (locate('folder', c.id)?.node as FolderNode | undefined)?.is_sprint) && (
        <SprintBar listId={id} canManage={located.node.permission_level === 'full'} refreshKey={refreshKey} onChanged={changed} />
      )}

      <main data-layout={activeView?.type} className="min-h-0 flex-1 overflow-auto">
        {loadingTasks && activeView?.type !== 'overview' ? (
          <TaskRowsSkeleton rows={8} />
        ) : activeView?.type === 'overview' && kind !== 'list' ? (
          <OverviewView
            kind={kind}
            node={located.node as SpaceNode | FolderNode}
            canCreate={located.node.permission_level === 'full'}
            canAddFolder={canShapeIt && located.node.permission_level === 'full'}
            onAddList={() => setCreatingList(true)}
            onAddFolder={() => setCreatingFolder(true)}
          />
        ) : needsAList && activeView && !SELF_CONTAINED.includes(activeView.type) ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <ListIcon size={32} className="mx-auto text-gray-300" />
            <h3 className="mt-3 text-base font-semibold text-gray-800">No Lists in this {kind === 'space' ? 'Space' : 'Folder'} yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              {located.node.permission_level === 'full'
                ? 'Tasks live inside Lists. Create a List to start adding tasks.'
                : 'Tasks live inside Lists. Ask an admin or your manager to add one here.'}
            </p>
            {located.node.permission_level === 'full' && (
              <button
                type="button"
                onClick={() => setCreatingList(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
              >
                <Plus size={14} /> Create List
              </button>
            )}
          </div>
        ) : activeView?.type === 'calendar' ? (
          <CalendarView
            tasks={filtered}
            canCreate={canCreate}
            onCreate={(name, due) => createInList(id, { name, due_date: due })}
            onUpdate={async (taskId, input) => { await workApi.updateTask(taskId, input).catch((e) => notify.error(e)); changed(); }}
            onOpenTask={setOpenTask}
          />
        ) : activeView?.type === 'board' ? (
          <BoardView
            tasks={filtered}
            statuses={statuses}
            listName={locationLabel}
            groupBy={groupBy}
            makeGroups={makeGroups}
            canAddIn={canAddIn}
            canDrag={boardCanDrag}
            onCreate={(name, key) => createInList(id, { name, ...inputForGroup(key) })}
            onMove={moveCard}
            onOpenTask={setOpenTask}
            onChanged={changed}
            onReorder={kind === 'list' && settings.sort.field === 'manual' ? async (taskId, orderindex) => {
              await workApi.updateTask(taskId, { orderindex });
              changed();
            } : undefined}
          />
        ) : activeView?.type === 'gantt' || activeView?.type === 'timeline' ? (
          <GanttView
            mode={activeView.type}
            tasks={filtered}
            dependencies={dependencies}
            people={people}
            listName={locationLabel}
            groupByList={kind !== 'list'}
            onOpenTask={setOpenTask}
            onUpdate={async (taskId, input) => { await workApi.updateTask(taskId, input).catch((e) => notify.error(e)); changed(); }}
          />
        ) : activeView?.type === 'doc' ? (
          <DocView key={activeView.id} viewId={activeView.id} canEdit={canEditHere || activeView.private === true} />
        ) : activeView?.type === 'whiteboard' ? (
          <WhiteboardView key={activeView.id} viewId={activeView.id} canEdit={canEditHere || activeView.private === true}
            listId={kind === 'list' && canCreate ? id : writableLists[0]?.id ?? null} onOpenTask={setOpenTask} onTaskCreated={changed} />
        ) : activeView?.type === 'mind_map' ? (
          <MindMapView key={activeView.id} viewId={activeView.id} title={located.node.name} tasks={filtered} canEdit={canEditHere || activeView.private === true}
            lists={listsUnder(located.node, kind).map((l) => ({ id: l.id, name: l.name, canCreate: l.permission_level === 'full' }))}
            defaultListId={kind === 'list' && canCreate ? id : writableLists[0]?.id ?? null}
            onCreate={async (listId, name, parentId) => { await workApi.createTask(listId, { name, parent_id: parentId }); changed(); }}
            onOpenTask={setOpenTask} />
        ) : activeView?.type === 'map' ? (
          <MapView tasks={filtered} fields={viewFields} onOpenTask={setOpenTask} onAddField={() => setManagingFields(true)} />
        ) : activeView?.type === 'chat' ? (
          <ChatView key={activeView.id} viewId={activeView.id} people={people} canPost={located.node.permission_level !== 'view'} canManage={located.node.permission_level === 'full'}
            listId={kind === 'list' ? id : null} lists={listChoices} onOpenTask={setOpenTask} onTaskCreated={changed} />
        ) : activeView?.type === 'embed' ? (
          <EmbedView key={activeView.id} view={activeView} canEdit={canEditHere || activeView.private === true}
            onSaved={(v) => setViews((prev) => prev.map((x) => (x.id === v.id ? v : x)))} />
        ) : activeView?.type === 'activity' ? (
          <ActivityView kind={kind} id={id} refreshKey={refreshKey} onOpenTask={setOpenTask} />
        ) : activeView?.type === 'form' ? (
          kind === 'list'
            ? <FormBuilder view={activeView} listId={id} canEdit={canEditHere} onSaved={(v) => setViews((prev) => prev.map((x) => (x.id === v.id ? v : x)))} />
            : <p className="p-10 text-center text-sm text-gray-400">Forms live in a List.</p>
        ) : activeView?.type === 'team' ? (
          <TeamView tasks={filtered} people={people} listName={locationLabel} onOpenTask={setOpenTask} />
        ) : activeView?.type === 'table' ? (
          <TableView
            tasks={filtered}
            statuses={statuses}
            fields={viewFields}
            hidden={settings.hidden}
            people={people}
            listName={locationLabel}
            canCreate={canCreate}
            onCreate={(name) => createInList(id, { name })}
            onOpenTask={setOpenTask}
            onChanged={changed}
            selected={selected}
            onSelect={select}
            totals={settings.totals}
            onTotals={(t) => update('totals', t)}
          />
        ) : activeView?.type === 'workload' ? (
          <WorkloadView kind={kind} id={id} refreshKey={refreshKey} listName={locationLabel} onOpenTask={setOpenTask} />
        ) : activeView?.type === 'dashboard' ? (
          <LocationDashboard key={activeView.id} view={activeView} canEdit={canEditHere}
            standard={<DashboardView kind={kind} id={id} refreshKey={refreshKey} listName={locationLabel} onOpenTask={setOpenTask} />} />
        ) : (
          <ListView
            tasks={filtered}
            statuses={statuses}
            listName={locationLabel}
            groupBy={groupBy}
            makeGroups={makeGroups}
            canAddIn={canAddIn}
            inlineAdd={kind === 'list'}
            onCreate={(name, key, extra) => createInList(id, { name, ...inputForGroup(key), ...extra })}
            onOpenTask={setOpenTask}
            // Rows are dragged into place only where place means something: one List, in its own order.
            onMoveRow={kind === 'list' && settings.sort.field === 'manual' ? async (taskId, orderindex, toGroupKey) => {
              const moved = toGroupKey ? inputForGroup(toGroupKey) : {};
              const status = moved.status_id ? statuses?.find((st) => st.id === moved.status_id) : undefined;
              // Into its new place at once; the reload confirms it.
              setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, orderindex, ...(status ? { status } : {}) } : t))
                .sort((x, y) => x.orderindex - y.orderindex));
              await workApi.updateTask(taskId, { orderindex, ...moved });
              changed();
            } : undefined}
            onAddColumn={FEATURES.listCustomFields ? () => setManagingFields(true) : undefined}
            columns={COLUMNS.map((c) => c.key).filter((k) => !settings.hidden.includes(k))}
            fields={viewFields.filter((f) => !settings.hidden.includes(`cf:${f.id}`))}
            people={people}
            onSetField={async (taskId, fieldId, value) => {
              try { await workApi.setFieldValue(taskId, fieldId, value); } catch (e) { notify.error(e); }
              changed();
            }}
            selected={selected}
            onSelect={select}
            onManageGroups={canCreate ? () => setManagingGroups(true) : undefined}
            onChanged={changed}
          />
        )}
      </main>

      {newTaskList && (
        <NewTaskDialog
          lists={kind === 'list' ? [] : listChoices}
          listId={newTaskList}
          startAssignees={autoAssignees}
          initial={newTaskStart ?? undefined}
          onClose={() => { setNewTaskList(null); setNewTaskStart(null); }}
          onCreate={async (listId, input) => {
            await createAndOpen(listId, input);
            setNewTaskList(null);
            setNewTaskStart(null);
          }}
        />
      )}
      {creatingList && (
        <NameDialog
          title={`New List in ${located.node.name}`}
          onClose={() => setCreatingList(false)}
          onSubmit={async (name, isPrivate, assignees) => {
            const created = await workApi.createList({ kind: kind as 'space' | 'folder', id }, name, isPrivate, assignees);
            await refreshTree();
            navigate(`/l/${created.id}`);
          }}
          assignTo={{
            people: members.map((m) => ({ id: m.user.id, name: m.user.display_name || m.user.email })),
            note: 'They get full access to the List, so it turns up in their own sidebar.',
          }}
          withPrivate
        />
      )}
      {creatingFolder && kind === 'space' && (
        <NameDialog
          title={`New Folder in ${located.node.name}`}
          onClose={() => setCreatingFolder(false)}
          onSubmit={async (name, isPrivate) => {
            const created = await workApi.createFolder({ kind: 'space', id }, name, isPrivate);
            await refreshTree();
            navigate(`/f/${created.id}`);
          }}
          withPrivate
        />
      )}
      {importing && kind === 'list' && (
        <ImportDialog listId={id} listName={located.node.name} fields={viewFields} onClose={() => setImporting(false)} onDone={changed} />
      )}
      {FEATURES.listCustomFields && managingFields && (
        <FieldsDialog kind={kind} id={id} name={located.node.name} canEdit={located.node.permission_level === 'edit' || located.node.permission_level === 'full'}
          onClose={() => setManagingFields(false)} onChanged={() => { loadTasks(); }} />
      )}
      {managingGroups && (
        <GroupsDialog kind={kind} id={id} name={located.node.name} canEdit={located.node.permission_level === 'edit' || located.node.permission_level === 'full'}
          onClose={() => setManagingGroups(false)} onChanged={() => { workApi.groups(kind, id).then(setGroups).catch(() => undefined); loadTasks(); }} />
      )}
      {sharing && (
        <ShareDialog kind={kind} id={id} name={located.node.name} onClose={() => setSharing(false)} onChanged={refreshTree} />
      )}
      {publicView && (
        <PublicLinksDialog kind="view" id={publicView.id} name={`${located.node.name} – ${publicView.name}`} canCreate={canEditHere} onClose={() => setPublicView(null)} />
      )}
      {(activeView?.type === 'list' || activeView?.type === 'table') && selectedTasks.length > 0 && (
        <BulkBar selected={selectedTasks} statuses={statuses} people={people} onClear={() => setSelected(new Set())} onDone={changed} />
      )}
      {openTask && <TaskPanel taskId={openTask} onClose={closeTask} onChanged={changed} onOpen={setOpenTask} />}
    </div>
  );
};

