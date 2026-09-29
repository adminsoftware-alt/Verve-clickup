import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, Calendar, CalendarRange, ChevronRight, ClipboardList, Columns3, FileSpreadsheet, FileText, Folder, GanttChart, Globe, History, Home, Layers, LayoutDashboard, List as ListIcon, ListPlus, Lock, Map as MapIcon, MessagesSquare, MoreHorizontal, Network, Pencil, Plus, PenTool, Search, Share2, Shield, Star, Table2, Upload, UserPlus, Users, X } from 'lucide-react';
import { useWork, useMe } from './WorkContext';
import { workApi, type CustomField, type Dependency, type FolderNode, type ListNode, type LocationKind, type Recurrence, type SpaceNode, type Status, type Task, type TaskGroup, type TaskInput, type UserRef, type View, type ViewType } from './api';
import { DateField } from './DateField';
import { FieldEditor } from './fields/FieldValue';
import { TaskRowsSkeleton } from './Skeleton';
import { Menu, NameDialog, PRIORITIES, Portal, StatusDot, formatDue, fromDateInput } from './ui';
import { DurationInput } from './DurationInput';
import { Select } from './Select';
import { FavoriteStar, useFavorites } from './Favorites';
import { TaskPanel } from './TaskPanel';
import { ListView } from './views/ListView';
import { CalendarView } from './views/CalendarView';
import { DashboardView } from './views/DashboardView';
import { LocationDashboard } from './views/LocationDashboard';
import { WorkloadView } from './views/WorkloadView';
import { BoardView } from './views/BoardView';
import { OverviewView } from './views/OverviewView';
import { useRunningTimer } from './RunningTimer';
import { rememberList } from './recent';
import { ShareDialog } from './ShareDialog';
import { useLeadership } from './dashboards/dialogs';
import { GroupsDialog } from './GroupsDialog';
import { AssignListDialog } from './AssignListDialog';
import { AssigneePicker } from './task/AssigneePicker';
import { RecurrenceEditor } from './RecurrenceEditor';
import { NO_GROUP, buildGroups, type GroupBy } from './views/grouping';
import { applyFilters, readSettings, sameSettings, sortTasks, COLUMNS, type ViewSettings } from './views/viewSettings';
import { ColumnsButton, FilterButton, GroupByButton, MeButton, SortButton } from './views/ViewControls';
import { BulkBar } from './views/BulkBar';
import { TABLE_COLUMNS, TableView } from './views/TableView';
import { TeamView } from './views/TeamView';
import { GanttView } from './views/GanttView';
import { exportTasks, taskRows } from './views/exportTasks';
import { ActivityView } from './views/ActivityView';
import { FormBuilder } from './views/FormView';
import { FieldsDialog } from './fields/FieldsDialog';
import { ImportDialog } from './templates/ImportDialog';
import { TemplateCenter } from './templates/Templates';
import { Avatar, AvatarStack } from './ui';
import { FEATURES } from '../config/features';
import { notify } from '../components/notify';
import { DocView } from './views/DocView';
import { WhiteboardView } from './views/WhiteboardView';
import { MindMapView } from './views/MindMapView';
import { MapView } from './views/MapView';
import { ask } from '../components/ask';
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
// The views offered in "+ View". The rest are built and still open where they already exist;
// they come back to this menu with FEATURES.extraViewTypes.
const CORE_VIEWS: ViewType[] = ['dashboard', 'table', 'team', 'calendar', 'workload'];
const EXTRA_VIEWS: ViewType[] = ['list', 'board', 'gantt', 'timeline', 'activity', 'form', 'doc', 'whiteboard', 'mind_map', 'map', 'chat', 'embed'];
const ADDABLE: ViewType[] = FEATURES.extraViewTypes ? [...CORE_VIEWS, ...EXTRA_VIEWS] : CORE_VIEWS;
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
  const { hierarchy, members, locate, listName, taskTypes, refresh: refreshTree, loading: treeLoading, error: treeError } = useWork();
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
  const [search, setSearch] = useState('');
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [newTaskList, setNewTaskList] = useState<string | null>(null);
  const [creatingList, setCreatingList] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [managingGroups, setManagingGroups] = useState(false);
  const [viewFields, setViewFields] = useState<CustomField[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [managingFields, setManagingFields] = useState(false);
  const [importing, setImporting] = useState(false);
  const [templatesFor, setTemplatesFor] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
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

  // The view's saved setup (filters, sort, group by, columns). Changes apply at once; as in
  // ClickUp they stay unsaved until someone who can edit the view saves them.
  const savedSettings = useMemo(() => readSettings(activeView?.settings, activeView?.type), [activeView]);
  const [settings, setSettings] = useState<ViewSettings>(savedSettings);
  useEffect(() => { setSettings(savedSettings); setSelected(new Set()); }, [savedSettings]);
  const dirty = !sameSettings(settings, savedSettings);
  const update = <K extends keyof ViewSettings>(key: K, value: ViewSettings[K]) => setSettings((prev) => ({ ...prev, [key]: value }));
  const groupBy: GroupBy = settings.groupBy;
  // Me mode is personal: remembered per view in this browser, never saved into the view.
  const meKey = `timetriq.me.${activeView?.id ?? ''}`;
  const [meMode, setMeModeState] = useState(false);
  useEffect(() => { try { setMeModeState(localStorage.getItem(meKey) === '1'); } catch { setMeModeState(false); } }, [meKey]);
  const setMeMode = (on: boolean) => { setMeModeState(on); try { localStorage.setItem(meKey, on ? '1' : '0'); } catch { /* ignore */ } };
  const saveView = async () => {
    if (!activeView) return;
    try {
      const saved = await workApi.updateView(activeView.id, { settings: settings as unknown as Record<string, unknown> });
      setViews((prev) => prev.map((v) => (v.id === saved.id ? saved : v)));
    } catch (e) {
      notify.error(e);
    }
  };

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
      const [page, set] = await Promise.all([
        workApi.tasks(kind, id, { include_closed: includeClosed }),
        kind === 'list' ? workApi.statuses('list', id) : Promise.resolve(null),
      ]);
      if (seq !== loadSeq.current) return;
      setTasks(page.tasks);
      setLoadingTasks(false);
      setStatuses(set ? set.statuses : null);
      workApi.groups(kind, id).then((g) => { if (seq === loadSeq.current) setGroups(g); }).catch(() => undefined);
      workApi.fields(kind, id, true).then((f) => { if (seq === loadSeq.current) setViewFields(f); }).catch(() => undefined);
      workApi.dependencies(kind, id).then((d) => { if (seq === loadSeq.current) setDependencies(d); }).catch(() => undefined);
    } catch (e) {
      if (seq === loadSeq.current) { setError((e as Error).message); setLoadingTasks(false); }
    }
  }, [kind, id, includeClosed]);
  // Moving to another List starts the wait again.
  useEffect(() => { setLoadingTasks(true); }, [kind, id]);

  // Only fetch once the location is in the (permission-filtered) tree: otherwise the
  // caller cannot open it and every request would just be refused.
  const reachable = !!located;
  useEffect(() => { if (reachable) loadViews(); }, [loadViews, reachable]);
  useEffect(() => { if (reachable) loadTasks(); }, [loadTasks, reachable]);
  // Starting or stopping a timer changes the Time tracked totals on screen.
  useEffect(() => { if (reachable && timerVersion > 0) loadTasks(); }, [timerVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (reachable && kind === 'list') rememberList(id); }, [reachable, kind, id]);
  // Statuses edited from the sidebar: re-read them (tasks may have been remapped too).
  useEffect(() => {
    const again = () => { if (reachable) loadTasks(); };
    window.addEventListener('timetriq:statuses', again);
    return () => window.removeEventListener('timetriq:statuses', again);
  }, [reachable, loadTasks]);
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

  const addView = async (type: ViewType, isPrivate = false) => {
    try {
      const view = await workApi.createView(kind, id, type, isPrivate);
      setViews((prev) => [...prev, view]);
      selectView(view);
    } catch (e) {
      notify.error(e);
    }
  };

  const favorites = useFavorites();
  const isWorkspaceAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
  const canEditHere = located?.node.permission_level === 'edit' || located?.node.permission_level === 'full';
  const patchView = async (view: View, body: Parameters<typeof workApi.updateView>[1]) => {
    try {
      const saved = await workApi.updateView(view.id, body);
      if (body.is_default) await loadViews();
      else setViews((prev) => prev.map((v) => (v.id === saved.id ? saved : v)));
    } catch (e) {
      notify.error(e);
    }
  };
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

  const removeView = async (view: View) => {
    if (!(await ask.confirm({ danger: true, title: `Delete the "${view.name}" view?` }))) return;
    await workApi.deleteView(view.id);
    setViews((prev) => prev.filter((v) => v.id !== view.id));
    if (activeView?.id === view.id) setSearchParams({});
  };

  const people = useMemo(() => members.map((m) => m.user), [members]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const searched = q ? tasks.filter((t) => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)) : tasks;
    return sortTasks(applyFilters(searched, settings.filters, me, meMode), settings.sort);
  }, [tasks, search, settings.filters, settings.sort, me, meMode]);
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
  const visibleIds = useMemo(() => new Set(filtered.map((t) => t.id)), [filtered]);
  const subtaskCount = filtered.filter((t) => t.parent_id && visibleIds.has(t.parent_id)).length;
  const taskCount = filtered.length - subtaskCount;

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
    const task = await workApi.createTask(listId, input);
    changed();
    setOpenTask(task.id);
  };

  const createInList = async (listId: string, input: TaskInput & { name: string }) => {
    try {
      await workApi.createTask(listId, input);
      changed();
    } catch (e) {
      notify.error(e);
    }
  };

  if (!located) {
    return (
      <div className="p-10 text-center text-sm text-gray-500">
        {treeLoading ? <TaskRowsSkeleton rows={6} label="Loading" /> : treeError ?? 'This location does not exist, or you do not have access to it.'}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Breadcrumb */}
      <header className="border-b border-gray-200 px-6 pt-4">
        <nav className="flex items-center gap-1.5 text-sm">
          {located.path.map((crumb, i) => (
            <React.Fragment key={crumb.id}>
              {i > 0 && <ChevronRight size={14} className="text-gray-300" />}
              <span className={`flex items-center gap-1.5 ${i === located.path.length - 1 ? 'text-lg font-semibold text-gray-900' : 'text-gray-500'}`}>
                {crumb.kind === 'folder' && <Folder size={14} />}
                {crumb.kind === 'list' && i === located.path.length - 1 && <ListIcon size={16} />}
                {crumb.name}
              </span>
            </React.Fragment>
          ))}
          {located.node.is_private && <Lock size={14} className="ml-1 text-gray-400" />}
          <FavoriteStar kind={kind} id={id} size={14} />
          {kind === 'list' && (() => {
            const lst = located.node as ListNode;
            return (lst.start_date || lst.due_date) ? (
              <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600" title="List dates">
                {lst.start_date ? formatDue(lst.start_date) : '…'} → {lst.due_date ? formatDue(lst.due_date) : '…'}
              </span>
            ) : null;
          })()}
          {kind === 'list' && !isPersonal && (() => {
            const node = located.node as ListNode;
            const ids = node.assignee_ids ?? (node.assignee_id ? [node.assignee_id] : []);
            const people = ids.map((uid) => members.find((m) => m.user.id === uid)?.user).filter((u): u is UserRef => !!u);
            const canAssign = located.node.permission_level === 'full';
            return (
              <button
                type="button"
                disabled={!canAssign}
                onClick={() => setAssigning(true)}
                title={canAssign ? 'Assign this List to one or more people' : undefined}
                className="ml-auto flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-default disabled:hover:bg-transparent"
              >
                {people.length === 0 ? <><UserPlus size={14} /> Assign</>
                  : people.length === 1 ? <><Avatar user={people[0]} size={18} /> {people[0].display_name || people[0].email}</>
                  : <><AvatarStack users={people} max={4} /> {people.length} people</>}
              </button>
            );
          })()}
          {isPersonal ? (
            <span className="ml-auto text-xs text-gray-400">Only you can see this List</span>
          ) : (
            <button
              type="button"
              onClick={() => setSharing(true)}
              className={`${kind === 'list' ? '' : 'ml-auto '}flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50`}
            >
              <Share2 size={14} /> Share
            </button>
          )}
        </nav>

        {/* Views bar */}
        <div className="mt-3 flex items-center gap-1">
          {views.map((view) => {
            const mine = view.created_by === me;
            const canLock = mine || isWorkspaceAdmin;
            const items = [
              { label: 'Rename', icon: <Pencil size={14} />, onClick: async () => { const n = await ask.prompt('Rename view', view.name); if (n && n.trim() && n.trim() !== view.name) patchView(view, { name: n.trim() }); } },
              { label: favorites.isFavorite('view', view.id) ? 'Remove from Favourites' : 'Add to Favourites', icon: <Star size={14} />, onClick: () => favorites.toggle('view', view.id) },
              ...(!view.private && canEditHere ? [{ label: view.is_default ? 'Default view ✓' : 'Set as default view', icon: <Home size={14} />, onClick: () => patchView(view, { is_default: !view.is_default }) }] : []),
              ...(!view.is_required && mine ? [{ label: view.private ? 'Share with everyone' : 'Make private (only you)', icon: <Lock size={14} />, onClick: () => patchView(view, { private: !view.private }) }] : []),
              ...(canLock ? [{ label: view.protected ? 'Unprotect view' : 'Protect view', icon: <Shield size={14} />, onClick: () => patchView(view, { protected: !view.protected }) }] : []),
              ...(!view.private && hierarchy?.role !== 'guest' ? [{ label: 'Share publicly…', icon: <Globe size={14} />, onClick: () => setPublicView(view) }] : []),
              ...(!view.is_required ? [{ label: 'Delete view', icon: <X size={14} />, danger: true, onClick: () => removeView(view) }] : []),
            ];
            return (
              <div
                key={view.id}
                draggable
                onDragStart={() => { draggingView.current = view.id; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropView(view)}
                className={`group flex items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-sm ${activeView?.id === view.id ? 'border-brand-600 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                <button type="button" onClick={() => selectView(view)} className="flex items-center gap-1.5">
                  {VIEW_META[view.type].icon}
                  {view.name}
                  {view.private && <Lock size={11} className="text-gray-400" aria-label="Private view" />}
                  {view.protected && <Shield size={11} className="text-gray-400" aria-label="Protected view" />}
                </button>
                <Menu label={`View options for ${view.name}`} align="left" items={items}
                  trigger={<span className={`${activeView?.id === view.id ? 'inline' : 'hidden group-hover:inline'} rounded text-gray-400 hover:text-gray-700`}><MoreHorizontal size={13} /></span>} />
              </div>
            );
          })}
          <Menu
            items={[
              ...ADDABLE.map((type) => ({ label: VIEW_META[type].label, icon: VIEW_META[type].icon, onClick: () => addView(type) })),
              { label: 'Private view (only you)…', icon: <Lock size={14} />, onClick: async () => { const t = await ask.prompt(`Which view? ${ADDABLE.join(', ')}`, ADDABLE[0]); if (t && (ADDABLE as string[]).includes(t)) addView(t as ViewType, true); } },
            ]}
            trigger={
              <span className="ml-1 flex cursor-pointer items-center gap-1 rounded px-2 pb-2 pt-1 text-sm text-gray-500 hover:text-gray-800">
                <Plus size={14} /> View
              </span>
            }
          />
        </div>
      </header>

      {/* Toolbar */}
      {activeView && !SELF_CONTAINED.includes(activeView.type) && (
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-6 py-1.5">
          {/* Left, as in ClickUp: how the tasks are laid out. */}
          {(activeView.type === 'list' || activeView.type === 'board') && (
            <GroupByButton value={groupBy} onChange={(g) => update('groupBy', g)}
              options={['status', 'assignee', 'priority', 'due', 'tags', 'group', 'type', 'none']}
              onManageGroups={canCreate ? () => setManagingGroups(true) : undefined} />
          )}
          {(activeView.type === 'list' || activeView.type === 'table') && (
            <ColumnsButton hidden={settings.hidden} onChange={(h) => update('hidden', h)} fields={viewFields}
              columns={activeView.type === 'table' ? TABLE_COLUMNS.filter((c) => c.key !== 'list' || kind !== 'list') : undefined} />
          )}
          {dirty && (
            <span className="ml-1 flex items-center gap-1.5 whitespace-nowrap rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800" role="status">
              View changed
              {(located.node.permission_level === 'edit' || located.node.permission_level === 'full') && (
                <button type="button" onClick={saveView} className="rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700">Save view</button>
              )}
              <button type="button" onClick={() => setSettings(savedSettings)} className="rounded px-1.5 py-0.5 hover:bg-amber-100">Revert</button>
            </span>
          )}
          {/* Right: narrowing down, then everything else under "…". */}
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 whitespace-nowrap text-xs text-gray-400">
              {taskCount} task{taskCount === 1 ? '' : 's'}
              {subtaskCount > 0 && ` · ${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'}`}
            </span>
            <FilterButton filters={settings.filters} onChange={(f) => update('filters', f)} tasks={tasks} statuses={statuses} groups={groups} people={people} fields={viewFields} />
            {(activeView.type === 'list' || activeView.type === 'table') && <SortButton sort={settings.sort} onChange={(v) => update('sort', v)} />}
            {activeView.type !== 'board' && activeView.type !== 'team' && (
              <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100">
                <input type="checkbox" checked={settings.showClosed} onChange={(e) => update('showClosed', e.target.checked)} />
                Show closed
              </label>
            )}
            <MeButton on={meMode} onChange={setMeMode} />
            <div className="flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 focus-within:border-brand-300 hover:border-gray-200">
              <Search size={14} className="text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks" className="w-28 bg-transparent text-sm focus:w-40 focus:outline-none" />
            </div>
            <Menu
              label="More view options"
              items={[
                { label: `Task groups${groups.length ? ` (${groups.length})` : ''}`, icon: <Layers size={14} />, onClick: () => setManagingGroups(true) },
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
              trigger={<span className="flex rounded-md p-1.5 text-gray-500 hover:bg-gray-100"><MoreHorizontal size={16} /></span>}
            />
            {writableLists.length > 0 && (
              <button
                type="button"
                onClick={() => setNewTaskList(kind === 'list' ? id : writableLists[0].id)}
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

      <main className="min-h-0 flex-1 overflow-auto">
        {loadingTasks && activeView?.type !== 'overview' ? (
          <TaskRowsSkeleton rows={8} />
        ) : activeView?.type === 'overview' && kind !== 'list' ? (
          <OverviewView
            kind={kind}
            node={located.node as SpaceNode | FolderNode}
            canCreate={canShapeIt && located.node.permission_level === 'full'}
            onAddList={() => setCreatingList(true)}
            onAddFolder={() => setCreatingFolder(true)}
          />
        ) : needsAList && activeView && !SELF_CONTAINED.includes(activeView.type) ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <ListIcon size={32} className="mx-auto text-gray-300" />
            <h3 className="mt-3 text-base font-semibold text-gray-800">No Lists in this {kind === 'space' ? 'Space' : 'Folder'} yet</h3>
            <p className="mt-1 text-sm text-gray-500">Tasks live inside Lists. Create a List to start adding tasks.</p>
            {canShapeIt && located.node.permission_level === 'full' && (
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
            onCreate={(name, key) => createInList(id, { name, ...inputForGroup(key) })}
            onOpenTask={setOpenTask}
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
          />
        )}
      </main>

      {newTaskList && (
        <NewTaskDialog
          lists={kind === 'list' ? [] : listChoices}
          listId={newTaskList}
          onClose={() => setNewTaskList(null)}
          onCreate={async (listId, input) => { await createAndOpen(listId, input); setNewTaskList(null); }}
          onTemplate={(listId) => { setNewTaskList(null); setTemplatesFor(listId); }}
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
      {templatesFor && <TemplateCenter kind="task" target={`l:${templatesFor}`} onClose={() => setTemplatesFor(null)} />}
      {FEATURES.listCustomFields && managingFields && (
        <FieldsDialog kind={kind} id={id} name={located.node.name} canEdit={located.node.permission_level === 'edit' || located.node.permission_level === 'full'}
          onClose={() => setManagingFields(false)} onChanged={() => { loadTasks(); }} />
      )}
      {managingGroups && (
        <GroupsDialog kind={kind} id={id} name={located.node.name} canEdit={located.node.permission_level === 'edit' || located.node.permission_level === 'full'}
          onClose={() => setManagingGroups(false)} onChanged={() => { workApi.groups(kind, id).then(setGroups).catch(() => undefined); loadTasks(); }} />
      )}
      {assigning && kind === 'list' && (
        <AssignListDialog
          listId={id}
          name={located.node.name}
          current={(located.node as ListNode).assignee_ids ?? [(located.node as ListNode).assignee_id].filter((x): x is string => !!x)}
          onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); refreshTree(); }} />
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

/** Today in the viewer's own calendar, as the date inputs write it. */
const isoDayOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** ClickUp's "+ Task". A task has to carry an owner, dates, a size and a priority before the
 *  Dashboards can say anything true about it -- so the dialog asks for all of them, and answers
 *  as many as it can from what this List has done before. The person corrects what is wrong
 *  rather than filling in a blank form. */
const NewTaskDialog: React.FC<{
  lists: { id: string; label: string }[];
  listId: string;
  onClose: () => void;
  onCreate: (listId: string, input: TaskInput & { name: string }) => Promise<void>;
  onTemplate: (listId: string) => void;
}> = ({ lists, listId, onClose, onCreate, onTemplate }) => {
  const meId = useMe();
  const { members: people, locate, taskTypes, hierarchy } = useWork();
  const [name, setName] = useState('');
  const [target, setTarget] = useState(listId);
  const [start, setStart] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [estimateSeconds, setEstimateSeconds] = useState<number | null>(null);
  const [priority, setPriority] = useState<number>(3);
  const [assignees, setAssignees] = useState<string[]>([meId]);
  const [repeat, setRepeat] = useState<Recurrence | null>(null);
  const [description, setDescription] = useState('');
  const [statusId, setStatusId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Status[] | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [points, setPoints] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [more, setMore] = useState(false);
  const [again, setAgain] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [touched, setTouched] = useState({ dates: false, estimate: false, priority: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What this List usually does. Anything the person has already edited is left alone.
  useEffect(() => {
    let live = true;
    workApi.taskDefaults(target, name.trim() || undefined)
      .then((d) => {
        if (!live) return;
        const day = 86_400_000;
        setStart((prev) => (touched.dates || prev ? prev : fromDateInput(isoDayOf(new Date()))));
        setDue((prev) => (touched.dates || prev ? prev : fromDateInput(isoDayOf(new Date(Date.now() + d.days_to_due * day)))));
        if (!touched.priority && d.priority) setPriority(d.priority);
        if (!touched.estimate && d.time_estimate_seconds) {
          setEstimateSeconds(d.time_estimate_seconds);
          setHint(d.estimate_basis === 'similar'
            ? `Suggested from ${d.estimate_from} similar task${d.estimate_from === 1 ? '' : 's'} in this List.`
            : `Suggested from the ${d.estimate_from} sized tasks in this List.`);
        } else if (!touched.estimate) {
          setHint(null);
        }
      })
      .catch(() => undefined);
    return () => { live = false; };
    // Re-asks once the name settles, so "File GSTR-3B" can find its own history.
  }, [target, name.trim()]);

  // What the List it is going into brings with it: its statuses, its Space's tags and fields.
  useEffect(() => {
    let live = true;
    workApi.statuses('list', target)
      .then((set) => { if (live) { setStatuses(set.statuses); setStatusId((prev) => prev ?? set.statuses[0]?.id ?? null); } })
      .catch(() => undefined);
    workApi.fields('list', target)
      .then((f) => { if (live) setFields(f); })
      .catch(() => undefined);
    const space = locate('list', target)?.path?.[0];
    if (space) workApi.spaceTags(space.id).then((t) => { if (live) setKnownTags(t.map((x) => x.name)); }).catch(() => undefined);
    return () => { live = false; };
  }, [target, locate]);

  // The Space's ClickApps decide which fields it uses; a missing one is the ClickUp default.
  const apps = hierarchy?.spaces.find((sp) => sp.id === locate('list', target)?.path?.[0]?.id)?.clickapps ?? {};
  const uses = (name: keyof typeof apps, fallback = true) => apps[name] ?? fallback;

  const backwards = !!start && !!due && new Date(due) < new Date(start);
  const ready = !!name.trim() && !!start && !!due && !backwards
    && estimateSeconds !== null && estimateSeconds > 0 && assignees.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(target, {
        name: name.trim(), start_date: start, due_date: due, time_estimate_seconds: estimateSeconds,
        priority, assignees,
        ...(repeat ? { recurrence: repeat } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(statusId ? { status_id: statusId } : {}),
        ...(tags.length && uses('tags') ? { tags } : {}),
        ...(typeId ? { type_id: typeId } : {}),
        ...(points.trim() && uses('sprint_points', false) ? { points: Number(points) } : {}),
        ...(isPrivate ? { is_private: true } : {}),
        ...(Object.keys(fieldValues).length && uses('custom_fields') ? { custom_fields: fieldValues } : {}),
      });
      if (again) {
        // Keep the List, the dates, the people and the shape of the work; clear what is about
        // this one task. Five near-identical tasks is the common case, not the exception.
        setName('');
        setDescription('');
        setTags([]);
        setFieldValues({});
        setBusy(false);
        return;
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const label = 'block text-sm font-medium text-gray-700';
  const box = 'mt-1 rounded-md border border-gray-300 px-2 py-1.5 focus-within:border-brand-500';
  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
        <form
          role="dialog"
          aria-label="New task"
          onMouseDown={(e) => e.stopPropagation()}
          onSubmit={submit}
          className="w-[32rem] max-w-full rounded-xl bg-white p-5 shadow-xl"
        >
          <h3 className="text-base font-semibold text-gray-900">New task</h3>
          <p className="mb-3 text-xs text-gray-500">Filled in from what this List usually does — change whatever is wrong.</p>

          <label className={label}>
            Task name
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aditi Jain Monthly Review"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </label>

          {/* From here the fields run in the order the task panel shows them, so what someone
              fills in now is where they will look for it afterwards. */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <span className={label}>Status</span>
              <div className="mt-1">
                <Select
                  label="Status"
                  value={statusId ?? ''}
                  onChange={(v) => setStatusId(v || null)}
                  choices={(statuses ?? []).map((st) => ({
                    value: st.id,
                    label: st.name,
                    icon: <StatusDot status={st} size={11} />,
                    display: (
                      <>
                        <StatusDot status={st} size={11} />
                        <span className="truncate text-xs font-semibold uppercase tracking-wide">{st.name}</span>
                      </>
                    ),
                  }))}
                />
              </div>
            </div>
            <div hidden={!uses('priorities')}>
              <span className={label}>Priority</span>
              <div className="mt-1">
                <Select
                  label="Priority"
                  value={String(priority)}
                  onChange={(v) => { setPriority(Number(v)); setTouched((t) => ({ ...t, priority: true })); }}
                  choices={Object.entries(PRIORITIES).map(([value, p]) => ({
                    value,
                    label: p.label,
                    icon: <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />,
                    display: (
                      <>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="truncate" style={{ color: p.color }}>{p.label}</span>
                      </>
                    ),
                  }))}
                />
              </div>
            </div>
          </div>

          <div className="mt-3">
            <span className={label}>Who is doing it</span>
            <div className="mt-1 rounded-md border border-gray-300 py-1.5">
              <AssigneePicker
                listId={target}
                assignees={people.filter((m) => assignees.includes(m.user.id)).map((m) => m.user)}
                assignable={null}
                editable
                canShare
                multiple
                onChange={setAssignees}
                onShared={() => undefined}
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <span className={label}>Start date</span>
              <div className={box}><DateField value={start} onChange={setStart} label="Start date" /></div>
            </div>
            <div>
              <span className={label}>Due date</span>
              <div className={box}><DateField value={due} onChange={setDue} label="Due date" overdue={backwards} /></div>
            </div>
            <div hidden={!uses('time_estimates')}>
              <span className={label}>Time estimate</span>
              {/* The same input as the task panel, so "3" offers 3h and 3m here too rather than
                  silently picking one of them. */}
              <div className="mt-1">
                <DurationInput
                  label="Time estimate"
                  value={estimateSeconds}
                  placeholder="3, 2.30, 45m"
                  onChange={(seconds) => { setEstimateSeconds(seconds); setTouched((t) => ({ ...t, estimate: true })); setHint(null); }}
                  className="h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
          {hint && <p className="mt-1.5 text-xs text-gray-500">{hint}</p>}
          {backwards && <p className="mt-2 text-xs text-red-600">The due date is before the start date.</p>}

          <div className="mt-3">
            <span className={label}>Repeat</span>
            <div className="mt-1">
              <RecurrenceEditor value={repeat} dueDate={due} disabled={false} onSave={async (value) => { setRepeat(value); }} />
            </div>
          </div>

          <div className="mt-3" hidden={!uses('tags')}>
            <span className={label}>Tags <span className="font-normal text-gray-400">optional</span></span>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-800">
                  {t}
                  <button type="button" aria-label={`Remove ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))} className="text-teal-600 hover:text-teal-900">&times;</button>
                </span>
              ))}
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter adds the tag rather than submitting the form, which would create the
                  // task while someone was still typing its tags.
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    const t = tagDraft.trim();
                    if (t && !tags.includes(t)) setTags([...tags, t]);
                    setTagDraft('');
                  }
                }}
                list="new-task-tags"
                placeholder={tags.length ? 'Add another…' : 'Type a tag and press Enter'}
                className="min-w-32 flex-1 bg-transparent text-sm focus:outline-none"
              />
              <datalist id="new-task-tags">
                {knownTags.filter((t) => !tags.includes(t)).map((t) => <option key={t} value={t} />)}
              </datalist>
            </div>
          </div>

          {/* Last, as it is in the panel: the long one, and the one nobody is blocked on. */}
          <label className={`${label} mt-3`}>
            Description <span className="font-normal text-gray-400">optional</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What actually needs doing, and anything whoever picks it up will need."
              className="mt-1 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </label>

          {/* Everything else a task can carry. Behind a disclosure, because asking eleven
              questions at once is how a create dialog becomes a form nobody finishes. */}
          <button
            type="button"
            onClick={() => setMore(!more)}
            className="mt-3 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800"
          >
            {more ? 'Fewer fields' : 'More fields'}
            <span className="text-gray-400">
              {more ? '' : `— private${uses('custom_fields') && fields.length ? `, ${fields.length} of this Space's own fields` : ''}`}
            </span>
          </button>

          {more && (
            <div className="mt-2 space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
              <div className="grid grid-cols-2 gap-3">
                {taskTypes.length > 0 && (
                  <div>
                    <span className={label}>Task type</span>
                    <div className="mt-1">
                      <Select
                        label="Task type"
                        value={typeId ?? ''}
                        onChange={(v) => setTypeId(v || null)}
                        choices={[{ value: '', label: 'Task' }, ...taskTypes.map((t) => ({ value: t.id, label: t.name }))]}
                      />
                    </div>
                  </div>
                )}
                {uses('sprint_points', false) && (
                <label className={label}>
                  Sprint points <span className="font-normal text-gray-400">optional</span>
                  <input
                    value={points}
                    onChange={(e) => setPoints(e.target.value.replace(/[^0-9]/g, ''))}
                    inputMode="numeric"
                    placeholder="—"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                )}
              </div>

              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="mt-0.5" />
                <span>
                  Private
                  <span className="block text-xs text-gray-500">Only you and the people on it will see this task.</span>
                </span>
              </label>

              {fields.length > 0 && uses('custom_fields') && (
                <div>
                  <span className={label}>This Space's own fields</span>
                  <div className="mt-1 space-y-2">
                    {fields.map((f) => (
                      <label key={f.id} className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-2 text-xs text-gray-600">
                        <span className="truncate">{f.name}</span>
                        <span className="rounded-md border border-gray-300 bg-white px-1.5 py-1">
                          <FieldEditor
                            field={f}
                            value={fieldValues[f.id]}
                            people={people.map((m) => m.user)}
                            onChange={(v: unknown) => setFieldValues((prev) => ({ ...prev, [f.id]: v }))}
                          />
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {lists.length > 1 && (
            <div className="mt-3">
              <span className={label}>In List</span>
              <div className="mt-1">
                <Select label="In List" value={target} onChange={setTarget}
                  choices={lists.map((l) => ({ value: l.id, label: l.label }))} />
              </div>
            </div>
          )}
          {lists.length === 1 && <p className="mt-2 text-xs text-gray-500">In {lists[0].label}</p>}
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="mt-5 flex items-center justify-end gap-2">
            {FEATURES.templates && <button type="button" onClick={() => onTemplate(target)} className="mr-auto rounded-md px-2 py-1.5 text-sm text-brand-600 hover:bg-brand-50">Use a template</button>}
            {/* Keeps the List, dates, people and priority; clears the name, description, tags
                and fields. Five near-identical tasks is the common case here. */}
            <label className={`${FEATURES.templates ? '' : 'mr-auto '}flex items-center gap-1.5 text-xs text-gray-600`}>
              <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} />
              Create another
            </label>
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={!ready || busy} className="btn-accent rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
              {busy ? 'Creating…' : 'Create task'}
            </button>
          </div>
        </form>
      </div>
    </Portal>
  );
};
