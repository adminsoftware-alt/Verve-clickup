import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, Calendar, CalendarRange, ChevronRight, ClipboardList, Columns3, FileSpreadsheet, Folder, GanttChart, History, Home, Layers, LayoutDashboard, List as ListIcon, ListPlus, Lock, MoreHorizontal, Pencil, Plus, Search, Share2, Shield, Star, Table2, Upload, UserPlus, Users, X } from 'lucide-react';
import { useWork, useMe } from './WorkContext';
import { workApi, type CustomField, type Dependency, type FolderNode, type ListNode, type LocationKind, type SpaceNode, type Status, type Task, type TaskGroup, type TaskInput, type View, type ViewType } from './api';
import { Menu, NameDialog, Portal, formatDue } from './ui';
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
import { GroupsDialog } from './GroupsDialog';
import { AssignListDialog } from './AssignListDialog';
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
import { Avatar } from './ui';

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
};
// The views offered in "+ View": every task view works at every level, as in ClickUp.
const ADDABLE: ViewType[] = ['list', 'board', 'table', 'team', 'gantt', 'timeline', 'calendar', 'workload', 'activity', 'dashboard', 'form'];
// Views that bring their own data and controls instead of the shared task toolbar.
const SELF_CONTAINED: ViewType[] = ['overview', 'dashboard', 'workload', 'activity', 'form'];

function listsUnder(node: SpaceNode | FolderNode | ListNode, kind: LocationKind): ListNode[] {
  if (kind === 'list') return [node as ListNode];
  const container = node as SpaceNode | FolderNode;
  return [...container.folders.flatMap((f) => listsUnder(f, 'folder')), ...container.lists];
}

export const LocationPage: React.FC = () => {
  const { id = '' } = useParams();
  const { pathname } = useLocation();
  const kind: LocationKind = pathname.startsWith('/s/') ? 'space' : pathname.startsWith('/f/') ? 'folder' : 'list';
  const { hierarchy, members, locate, listName, refresh: refreshTree, loading: treeLoading, error: treeError } = useWork();
  // Your Personal List is private to you, so it has no Share button.
  const isPersonal = kind === 'list' && hierarchy?.personal_list?.id === id;
  const located = locate(kind, id);

  const [searchParams, setSearchParams] = useSearchParams();
  const [views, setViews] = useState<View[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
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
  const me = useMe();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creatingFolder, setCreatingFolder] = useState(false);
  const navigate = useNavigate();
  const { version: timerVersion } = useRunningTimer();

  const loadViews = useCallback(async () => {
    try { setViews(await workApi.views(kind, id)); } catch (e) { setError((e as Error).message); }
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
      window.alert((e as Error).message);
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
      setStatuses(set ? set.statuses : null);
      workApi.groups(kind, id).then((g) => { if (seq === loadSeq.current) setGroups(g); }).catch(() => undefined);
      workApi.fields(kind, id, true).then((f) => { if (seq === loadSeq.current) setViewFields(f); }).catch(() => undefined);
      workApi.dependencies(kind, id).then((d) => { if (seq === loadSeq.current) setDependencies(d); }).catch(() => undefined);
    } catch (e) {
      if (seq === loadSeq.current) setError((e as Error).message);
    }
  }, [kind, id, includeClosed]);

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
      window.alert((e as Error).message);
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
      window.alert((e as Error).message);
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
    if (!window.confirm(`Delete the "${view.name}" view?`)) return;
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
    (roots: Task[]) => buildGroups(groupBy, roots, statuses, groups, people),
    [groupBy, statuses, groups, people],
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
  const boardCanDrag = groupBy === 'status' ? !!statuses : ['group', 'priority', 'assignee'].includes(groupBy);
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
    await workApi.updateTask(taskId, input).catch((e) => window.alert(e.message));
    changed();
  };

  const createInList = async (listId: string, input: TaskInput & { name: string }) => {
    try {
      await workApi.createTask(listId, input);
      changed();
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  if (!located) {
    return (
      <div className="p-10 text-center text-sm text-gray-500">
        {treeLoading ? 'Loading…' : treeError ?? 'This location does not exist, or you do not have access to it.'}
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
            const assigneeId = (located.node as ListNode).assignee_id;
            const assignee = members.find((m) => m.user.id === assigneeId)?.user;
            const canAssign = located.node.permission_level === 'full';
            return (
              <button
                type="button"
                disabled={!canAssign}
                onClick={() => setAssigning(true)}
                title={canAssign ? 'Assign this List to someone' : undefined}
                className="ml-auto flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-default disabled:hover:bg-transparent"
              >
                {assignee ? <><Avatar user={assignee} size={18} /> {assignee.display_name || assignee.email}</> : <><UserPlus size={14} /> Assign</>}
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
              { label: 'Rename', icon: <Pencil size={14} />, onClick: () => { const n = window.prompt('Rename view', view.name); if (n && n.trim() && n.trim() !== view.name) patchView(view, { name: n.trim() }); } },
              { label: favorites.isFavorite('view', view.id) ? 'Remove from Favourites' : 'Add to Favourites', icon: <Star size={14} />, onClick: () => favorites.toggle('view', view.id) },
              ...(!view.private && canEditHere ? [{ label: view.is_default ? 'Default view ✓' : 'Set as default view', icon: <Home size={14} />, onClick: () => patchView(view, { is_default: !view.is_default }) }] : []),
              ...(!view.is_required && mine ? [{ label: view.private ? 'Share with everyone' : 'Make private (only you)', icon: <Lock size={14} />, onClick: () => patchView(view, { private: !view.private }) }] : []),
              ...(canLock ? [{ label: view.protected ? 'Unprotect view' : 'Protect view', icon: <Shield size={14} />, onClick: () => patchView(view, { protected: !view.protected }) }] : []),
              ...(!view.is_required ? [{ label: 'Delete view', icon: <X size={14} />, danger: true, onClick: () => removeView(view) }] : []),
            ];
            return (
              <div
                key={view.id}
                draggable
                onDragStart={() => { draggingView.current = view.id; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropView(view)}
                className={`group flex items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-sm ${activeView?.id === view.id ? 'border-indigo-600 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                <button type="button" onClick={() => selectView(view)} className="flex items-center gap-1.5">
                  {VIEW_META[view.type].icon}
                  {view.name}
                  {view.private && <Lock size={11} className="text-gray-400" aria-label="Private view" />}
                  {view.protected && <Shield size={11} className="text-gray-400" aria-label="Protected view" />}
                </button>
                <Menu label={`View options for ${view.name}`} align="left" items={items}
                  trigger={<span className="hidden rounded text-gray-400 hover:text-gray-700 group-hover:inline"><MoreHorizontal size={13} /></span>} />
              </div>
            );
          })}
          <Menu
            items={[
              ...ADDABLE.map((type) => ({ label: VIEW_META[type].label, icon: VIEW_META[type].icon, onClick: () => addView(type) })),
              { label: 'Private view (only you)…', icon: <Lock size={14} />, onClick: () => { const t = window.prompt('Which view? list, board, table, team, calendar, workload or dashboard', 'list'); if (t && (ADDABLE as string[]).includes(t)) addView(t as ViewType, true); } },
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
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-6 py-2">
          <div className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1">
            <Search size={14} className="text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks" className="w-36 text-sm focus:outline-none" />
          </div>
          <FilterButton filters={settings.filters} onChange={(f) => update('filters', f)} tasks={tasks} statuses={statuses} groups={groups} people={people} />
          {(activeView.type === 'list' || activeView.type === 'table') && <SortButton sort={settings.sort} onChange={(v) => update('sort', v)} />}
          {(activeView.type === 'list' || activeView.type === 'board') && (
            <GroupByButton value={groupBy} onChange={(g) => update('groupBy', g)}
              options={['status', 'assignee', 'priority', 'due', 'tags', 'group', 'none']} />
          )}
          {(activeView.type === 'list' || activeView.type === 'table') && (
            <ColumnsButton hidden={settings.hidden} onChange={(h) => update('hidden', h)} fields={viewFields}
              columns={activeView.type === 'table' ? TABLE_COLUMNS.filter((c) => c.key !== 'list' || kind !== 'list') : undefined} />
          )}
          <MeButton on={meMode} onChange={setMeMode} />
          {activeView.type !== 'board' && activeView.type !== 'team' && (
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-gray-600">
              <input type="checkbox" checked={settings.showClosed} onChange={(e) => update('showClosed', e.target.checked)} />
              Show closed
            </label>
          )}
          <button type="button" onClick={() => setManagingGroups(true)} className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50">
            <Layers size={14} /> Groups{groups.length ? ` (${groups.length})` : ''}
          </button>
          <button type="button" onClick={() => setManagingFields(true)} className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50">
            <ListPlus size={14} /> Fields{viewFields.length ? ` (${viewFields.length})` : ''}
          </button>
          <span className="whitespace-nowrap text-xs text-gray-400">
            {taskCount} task{taskCount === 1 ? '' : 's'}
            {subtaskCount > 0 && ` · ${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'}`}
          </span>
          {activeView.type !== 'table' && (
            <button type="button" title="Download these tasks as an Excel file" onClick={() => exportTasks('xlsx', located.node.name, taskRows(filtered, viewFields, people, locationLabel))}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50">
              <FileSpreadsheet size={14} /> Export
            </button>
          )}
          {canCreate && (
            <button type="button" onClick={() => setImporting(true)} className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50">
              <Upload size={14} /> Import
            </button>
          )}
          {dirty && (
            <span className="flex items-center gap-1.5 whitespace-nowrap rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800" role="status">
              View changed
              {(located.node.permission_level === 'edit' || located.node.permission_level === 'full') && (
                <button type="button" onClick={saveView} className="rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700">Save view</button>
              )}
              <button type="button" onClick={() => setSettings(savedSettings)} className="rounded px-1.5 py-0.5 hover:bg-amber-100">Revert</button>
            </span>
          )}
          {writableLists.length > 0 && (
            <button
              type="button"
              onClick={() => setNewTaskList(kind === 'list' ? id : writableLists[0].id)}
              className="ml-auto flex items-center gap-1.5 whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              <Plus size={14} /> Task
            </button>
          )}
        </div>
      )}

      {error && <div className="mx-6 mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <main className="min-h-0 flex-1 overflow-auto">
        {activeView?.type === 'overview' && kind !== 'list' ? (
          <OverviewView
            kind={kind}
            node={located.node as SpaceNode | FolderNode}
            canCreate={located.node.permission_level === 'full'}
            onAddList={() => setCreatingList(true)}
            onAddFolder={() => setCreatingFolder(true)}
          />
        ) : needsAList && activeView && !SELF_CONTAINED.includes(activeView.type) ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <ListIcon size={32} className="mx-auto text-gray-300" />
            <h3 className="mt-3 text-base font-semibold text-gray-800">No Lists in this {kind === 'space' ? 'Space' : 'Folder'} yet</h3>
            <p className="mt-1 text-sm text-gray-500">Tasks live inside Lists. Create a List to start adding tasks.</p>
            {located.node.permission_level === 'full' && (
              <button
                type="button"
                onClick={() => setCreatingList(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
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
            onUpdate={async (taskId, input) => { await workApi.updateTask(taskId, input).catch((e) => window.alert(e.message)); changed(); }}
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
            onUpdate={async (taskId, input) => { await workApi.updateTask(taskId, input).catch((e) => window.alert(e.message)); changed(); }}
          />
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
            columns={COLUMNS.map((c) => c.key).filter((k) => !settings.hidden.includes(k))}
            fields={viewFields.filter((f) => !settings.hidden.includes(`cf:${f.id}`))}
            people={people}
            onSetField={async (taskId, fieldId, value) => {
              try { await workApi.setFieldValue(taskId, fieldId, value); } catch (e) { window.alert((e as Error).message); }
              changed();
            }}
            selected={selected}
            onSelect={select}
          />
        )}
      </main>

      {newTaskList && (
        <NewTaskDialog
          lists={kind === 'list' ? [] : listChoices}
          listId={newTaskList}
          onClose={() => setNewTaskList(null)}
          onCreate={async (listId, name) => { await createInList(listId, { name }); setNewTaskList(null); }}
          onTemplate={(listId) => { setNewTaskList(null); setTemplatesFor(listId); }}
        />
      )}
      {creatingList && (
        <NameDialog
          title={`New List in ${located.node.name}`}
          onClose={() => setCreatingList(false)}
          onSubmit={async (name, isPrivate) => {
            const created = await workApi.createList({ kind: kind as 'space' | 'folder', id }, name, isPrivate);
            await refreshTree();
            navigate(`/l/${created.id}`);
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
      {managingFields && (
        <FieldsDialog kind={kind} id={id} name={located.node.name} canEdit={located.node.permission_level === 'edit' || located.node.permission_level === 'full'}
          onClose={() => setManagingFields(false)} onChanged={() => { loadTasks(); }} />
      )}
      {managingGroups && (
        <GroupsDialog kind={kind} id={id} name={located.node.name} canEdit={located.node.permission_level === 'edit' || located.node.permission_level === 'full'}
          onClose={() => setManagingGroups(false)} onChanged={() => { workApi.groups(kind, id).then(setGroups).catch(() => undefined); loadTasks(); }} />
      )}
      {assigning && kind === 'list' && (
        <AssignListDialog listId={id} name={located.node.name} current={(located.node as ListNode).assignee_id}
          onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); refreshTree(); }} />
      )}
      {sharing && (
        <ShareDialog kind={kind} id={id} name={located.node.name} onClose={() => setSharing(false)} onChanged={refreshTree} />
      )}
      {(activeView?.type === 'list' || activeView?.type === 'table') && selectedTasks.length > 0 && (
        <BulkBar selected={selectedTasks} statuses={statuses} people={people} onClear={() => setSelected(new Set())} onDone={changed} />
      )}
      {openTask && <TaskPanel taskId={openTask} onClose={closeTask} onChanged={changed} onOpen={setOpenTask} />}
    </div>
  );
};

const NewTaskDialog: React.FC<{
  lists: { id: string; label: string }[];
  listId: string;
  onClose: () => void;
  onCreate: (listId: string, name: string) => Promise<void>;
  onTemplate: (listId: string) => void;
}> = ({ lists, listId, onClose, onCreate, onTemplate }) => {
  const [name, setName] = useState('');
  const [target, setTarget] = useState(listId);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await onCreate(target, name.trim()); } finally { setBusy(false); }
  };
  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <form
          role="dialog"
          aria-label="New task"
          onMouseDown={(e) => e.stopPropagation()}
          onSubmit={submit}
          className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl bg-white p-5 shadow-xl"
        >
          <h3 className="mb-3 text-base font-semibold text-gray-900">New task</h3>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Task name" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
          {lists.length > 1 && (
            <label className="mt-3 block text-sm text-gray-600">
              In List
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                {lists.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </label>
          )}
          {lists.length === 1 && <p className="mt-2 text-xs text-gray-500">In {lists[0].label}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => onTemplate(target)} className="mr-auto rounded-md px-2 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50">Use a template</button>
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={!name.trim() || busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">Create task</button>
          </div>
        </form>
      </div>
    </Portal>
  );
};
