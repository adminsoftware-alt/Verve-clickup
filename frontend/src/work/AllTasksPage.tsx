import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Search } from 'lucide-react';
import { FEATURES } from '../config/features';
import { workApi, type CustomField, type Task } from './api';
import { useMe, useWork } from './WorkContext';
import { ListView } from './views/ListView';
import { BoardView } from './views/BoardView';
import { TableView } from './views/TableView';
import { NO_GROUP, buildGroups, progressOf } from './views/grouping';
import { COLUMNS, applyFilters, readSettings, sortTasks, type ViewSettings } from './views/viewSettings';
import { ColumnsButton, FilterButton, GroupByButton, MeButton, SortButton } from './views/ViewControls';
import { FilterPanel } from './views/FilterPanel';
import { ViewTabs, type ViewKey } from './views/ViewTabs';
import { CalendarView } from './views/CalendarView';
import { PlannerPage } from './planner/PlannerPage';
import { TaskRowsSkeleton } from './Skeleton';
import { MyWorkloadView } from './views/MyWorkloadView';
import { BulkBar } from './views/BulkBar';
import { taskRows } from './views/exportTasks';
import { ExportMenu } from './views/ExportMenu';

type Layout = ViewKey;

const KEY = 'timetriq.allTasks';
/** The views this page offers. */
const OFFERED: Layout[] = ['list', 'board', 'workload', 'calendar', 'planner'];

/** Views that read the filtered task list, and so deserve the toolbar above them. */
const SHOWS_TOOLBAR: Layout[] = ['list', 'board', 'table', 'calendar'];
/** Views that scroll their own insides, so the page must not scroll them a second time. */
const SCROLLS_ITSELF: Layout[] = ['planner'];

/** Midnight tonight, for "due today or already late". */
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };

/** What the page is showing: your own work, what needs doing now, or everything you can open. */
type Scope = 'mine' | 'now' | 'all';
// The scope labels, from when this page had a tab strip. My Tasks and All Tasks are one page
// now and the scope comes from the route, so nothing renders these -- kept for reference.
// const SCOPES: [Scope, string, string][] = [
//   ['mine', 'Assigned to me', 'Tasks with your name on them'],
//   ['now', 'Today & overdue', 'Yours, due today or already late'],
//   ['all', 'Everything', 'Every task you can open, in every Space'],
// ];

/**
 * One page for a person's work: their own tasks, what is due now, or everything they can open --
 * with the same filters, columns, grouping, layouts and export across all three.
 */
export const AllTasksPage: React.FC<{ initialScope?: Scope }> = ({ initialScope = 'all' }) => {
  const { workspace, members, locate, listName } = useWork();
  const me = useMe();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [q, setQ] = useState('');
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      const saved = localStorage.getItem(`${KEY}.layout`) as Layout | null;
      return saved && OFFERED.includes(saved) ? saved : 'list';
    } catch { return 'list'; }
  });
  const [settings, setSettings] = useState<ViewSettings>(() => {
    try { return readSettings(JSON.parse(localStorage.getItem(KEY) || 'null') ?? { groupBy: 'none' }); } catch { return readSettings({ groupBy: 'none' }); }
  });
  const [scope] = useState<Scope>(() => {
    try { return (localStorage.getItem(`${KEY}.scope`) as Scope) || initialScope; } catch { return initialScope; }
  });
  const [meMode, setMeMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fields] = useState<CustomField[]>([]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
      localStorage.setItem(`${KEY}.layout`, layout);
      localStorage.setItem(`${KEY}.scope`, scope);
    } catch { /* ignore */ }
  }, [settings, layout, scope]);
  const load = useCallback(() => {
    // Finished work is always fetched: the Board needs a Completed column to put it in, and the
    // Status filter decides what is shown. Asking the server again on every tick bought nothing.
    if (workspace) workApi.allTasks(workspace.id, true).then((p) => setTasks(p.tasks)).catch(() => setTasks([]));
  }, [workspace]);
  useEffect(() => { load(); }, [load]);
  const update = <K extends keyof ViewSettings>(k: K, v: ViewSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const people = useMemo(() => members.map((m) => m.user), [members]);
  const where = useCallback((listId: string) => locate('list', listId)?.path.map((c) => c.name).join(' / ') ?? listName(listId), [locate, listName]);
  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    const mine = (t: Task) => t.assignees.some((a) => a.id === me);
    const soon = (t: Task) => !!t.due_date && new Date(t.due_date) <= endOfToday();
    // Progress filter: which of the three states a task is in, rather than its status name.
    //
    // With nothing picked, a list shows what is left to do -- finished work would bury it. A
    // Board is the other way round: its whole point is the flow across the three columns, so
    // Completed is shown there until you say otherwise.
    const states = settings.filters.statuses;
    const openOnly = (t: Task) => t.status.group !== 'closed' && t.status.group !== 'done';
    const found = (tasks ?? [])
      .filter((t) => (states.length ? states.includes(progressOf(t)) : layout === 'board' || openOnly(t)))
      .filter((t) => (scope === 'now' ? mine(t) && soon(t) && t.status.group !== 'closed' && t.status.group !== 'done' : true))
      .filter((t) => !text || t.name.toLowerCase().includes(text) || (t.custom_id ?? '').toLowerCase() === text);
    return sortTasks(applyFilters(found, settings.filters, me, meMode), settings.sort);
  }, [tasks, q, settings.filters, settings.sort, me, meMode, scope, layout]);
  const makeGroups = useCallback((roots: Task[]) => buildGroups(settings.groupBy, roots, null, [], people), [settings.groupBy, people]);
  // The Board reads its own setting, so a List grouped by due date does not leave the Board
  // with Overdue and Upcoming columns and nowhere to put finished work.
  const boardBy = settings.boardGroupBy;
  const boardGroups = useCallback((roots: Task[]) => buildGroups(boardBy, roots, null, [], people), [boardBy, people]);
  /**
   * Which groupings a card can be dragged between here.
   *
   * Above a List, statuses belong to their own List: one List's "In review" is a different row in
   * the database from another's, so a card dragged into that column would have to be given a
   * status its List may not have. Priority and assignee are the same everywhere, so those columns
   * can take a drop.
   */
  const boardCanDrag = boardBy === 'priority' || boardBy === 'assignee';
  const moveCard = async (taskId: string, from: string, to: string) => {
    const task = tasks?.find((t) => t.id === taskId);
    if (!task) return;
    const input = boardBy === 'priority'
      ? { priority: to === NO_GROUP ? null : Number(to.slice(1)) }
      : {
        // Dragging from one person's column to another's hands the task over, as in ClickUp.
        assignees: to === NO_GROUP
          ? task.assignees.map((u) => u.id).filter((u) => u !== from)
          : [...new Set([...task.assignees.map((u) => u.id).filter((u) => u !== from), to])],
      };
    await workApi.updateTask(taskId, input);
    load();
  };
  const openTask = (id: string) => { const t = tasks?.find((x) => x.id === id); if (t) navigate(`/l/${t.list_id}?task=${id}`); };
  const select = (ids: string[], on: boolean) => setSelected((prev) => { const n = new Set(prev); ids.forEach((x) => (on ? n.add(x) : n.delete(x))); return n; });
  const selectedTasks = filtered.filter((t) => selected.has(t.id));
  // The numbers on the two personal tabs, so the page says how much is waiting.
  const counts = useMemo(() => {
    const open = (tasks ?? []).filter((t) => t.status.group !== 'closed' && t.status.group !== 'done');
    const mine = open.filter((t) => t.assignees.some((a) => a.id === me));
    return { mine: mine.length, now: mine.filter((t) => !!t.due_date && new Date(t.due_date) <= endOfToday()).length };
  }, [tasks, me]);
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="border-b border-gray-200 px-6 pb-2 pt-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><Layers size={18} className="text-brand-600" /> My Tasks</h1>
        <p className="text-xs text-gray-500">
          {counts.mine} assigned to you · {counts.now} due today or overdue · everything you can open is here.
        </p>
      </header>
      <ViewTabs value={layout} onChange={setLayout} only={OFFERED} />
      {/* The Planner and the Calendar answer their own question and carry their own controls, so
          the filter toolbar would only be furniture above them. */}
      {SHOWS_TOOLBAR.includes(layout) && (
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-6 py-2">
        <span className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1">
          <Search size={14} className="text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks or IDs" aria-label="Search all tasks" className="w-40 text-sm focus:outline-none" />
        </span>
        {/* Two steps -- what to filter by, then its values -- as on the Dashboard. The old
            all-at-once panel is still built and still used inside a List. */}
        {FEATURES.myTasksOldFilterPanel
          ? <FilterButton filters={settings.filters} onChange={(f) => update('filters', f)} tasks={tasks ?? []} statuses={null} groups={[]} people={people} />
          : (
            <FilterPanel
              filters={settings.filters}
              onChange={(f) => update('filters', f)}
              tasks={tasks ?? []}
              statuses={null}
              people={people}
              view={FEATURES.myTasksGroupBy && (layout === 'list' || layout === 'board') ? {
                groupBy: layout === 'board' ? settings.boardGroupBy : settings.groupBy,
                groupOptions: layout === 'board'
                  ? ['progress', 'status', 'assignee', 'priority', 'due', 'tags']
                  : ['none', 'progress', 'status', 'assignee', 'priority', 'due', 'tags'],
                onGroupBy: (g) => update(layout === 'board' ? 'boardGroupBy' : 'groupBy', g),
                hidden: settings.hidden,
                onHidden: (h) => update('hidden', h),
                showClosed: settings.showClosed,
                onShowClosed: (on) => update('showClosed', on),
              } : undefined}
            />
          )}
          {/* Which columns a row shows is not a filter, so it stands on its own beside one. */}
          {(layout === 'list' || layout === 'table') && (
            <ColumnsButton hidden={settings.hidden} onChange={(h) => update('hidden', h)} label="Fields" />
          )}
        {FEATURES.myTasksSortButton && <SortButton sort={settings.sort} onChange={(v) => update('sort', v)} />}
        {FEATURES.myTasksViewButtons && (layout === 'list' || layout === 'board') && <GroupByButton value={settings.groupBy} onChange={(g) => update('groupBy', g)} options={['none', 'progress', 'status', 'assignee', 'priority', 'due', 'tags']} />}
        {FEATURES.myTasksMeButton && <MeButton on={meMode} onChange={setMeMode} />}
        {FEATURES.myTasksViewButtons && (
          <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-gray-600"><input type="checkbox" checked={settings.showClosed} onChange={(e) => update('showClosed', e.target.checked)} /> Show closed</label>
        )}
        <ExportMenu
          filename="my-tasks"
          title="My tasks"
          rows={() => taskRows(filtered, fields, people, where)}
        />
        <span className="ml-auto text-xs text-gray-400">{filtered.length} shown</span>
      </div>
      )}
      <main className={`min-h-0 flex-1 ${SCROLLS_ITSELF.includes(layout) ? 'overflow-hidden' : 'overflow-auto'}`}>
        {/* Workload reads from its own endpoint -- it needs every task spread across days, which
            is a different question from the filtered list above it. */}
        {layout === 'workload' ? (
          <MyWorkloadView onOpenTask={openTask} listName={where} />
        ) : layout === 'planner' ? (
          <PlannerPage embedded />
        ) : tasks === null ? <TaskRowsSkeleton rows={8} /> : layout === 'calendar' ? (
          <CalendarView tasks={filtered} canCreate={false} onCreate={async () => undefined}
            onUpdate={async (id, input) => { await workApi.updateTask(id, input); load(); }} onOpenTask={openTask} />
        ) : layout === 'board' ? (
          <BoardView
            tasks={filtered}
            statuses={null}
            listName={where}
            // A board with a single "Tasks" column says nothing, so it falls back to status.
            groupBy={boardBy}
            makeGroups={boardGroups}
            canAddIn={() => false}
            canDrag={boardCanDrag}
            onCreate={async () => undefined}
            onMove={moveCard}
            onOpenTask={openTask}
          />
        ) : layout === 'list' ? (
          <ListView tasks={filtered} statuses={null} listName={where} groupBy={settings.groupBy} makeGroups={makeGroups}
            canAddIn={() => false} onCreate={async () => undefined} onOpenTask={openTask}
            columns={COLUMNS.map((c) => c.key).filter((k) => !settings.hidden.includes(k))} fields={[]} people={people}
            onSetField={() => undefined} selected={selected} onSelect={select} />
        ) : (
          <TableView tasks={filtered} statuses={null} fields={[]} hidden={settings.hidden} people={people} listName={where}
            canCreate={false} onCreate={async () => undefined} onOpenTask={openTask} onChanged={load} selected={selected} onSelect={select}
            totals={settings.totals} onTotals={(t) => update('totals', t)} />
        )}
      </main>
      {selectedTasks.length > 0 && <BulkBar selected={selectedTasks} statuses={null} people={people} onClear={() => setSelected(new Set())} onDone={load} />}
    </div>
  );
};
