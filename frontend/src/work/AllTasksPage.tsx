import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { FEATURES } from '../config/features';
import { workApi, type Task } from './api';
import { useMe, useWork } from './WorkContext';
import { ListView } from './views/ListView';
import { BoardView } from './views/BoardView';
import { TableView } from './views/TableView';
import { NO_GROUP, buildGroups, progressOf } from './views/grouping';
import { COLUMNS, applyFilters, readSettings, sortTasks, type ViewSettings } from './views/viewSettings';
import { ColumnsButton, FilterButton, GroupByButton, MeButton, SortButton } from './views/ViewControls';
import { FilterPanel } from './views/FilterPanel';
import { ViewTabs, type ViewKey } from './views/ViewTabs';
import { PlannerPage } from './planner/PlannerPage';
import { TaskRowsSkeleton } from './Skeleton';
import { MyWorkloadView } from './views/MyWorkloadView';
import { BulkBar } from './views/BulkBar';

type Layout = ViewKey;

const KEY = 'timetriq.allTasks';
/** The views this page offers. */
// The Calendar tab is gone: the Planner already shows the week by day and is the one that syncs
// with Google Calendar, so a second calendar here was the same page twice.
const OFFERED: Layout[] = ['list', 'board', 'workload', 'planner'];

/** Views that read the filtered task list, and so deserve the toolbar above them. */
const SHOWS_TOOLBAR: Layout[] = ['list', 'board', 'table'];
/** Views that scroll their own insides, so the page must not scroll them a second time. */
const SCROLLS_ITSELF: Layout[] = ['planner'];

/** Midnight tonight, for "due today or already late". */
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };

/** What the page is showing: your own work, what needs doing now, or everything you can open. */
type Scope = 'mine' | 'now' | 'all' | 'team';
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
  const { workspace, members, locate, listName, teams } = useWork();
  const me = useMe();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      const saved = localStorage.getItem(`${KEY}.layout`) as Layout | null;
      // Someone who left this on the old Calendar tab comes back to the Planner that replaced it.
      if (saved === 'calendar') return 'planner';
      return saved && OFFERED.includes(saved) ? saved : 'list';
    } catch { return 'list'; }
  });
  const [settings, setSettings] = useState<ViewSettings>(() => {
    try { return readSettings(JSON.parse(localStorage.getItem(KEY) || 'null') ?? { groupBy: 'none' }); } catch { return readSettings({ groupBy: 'none' }); }
  });
  // Which page you opened is the answer to "whose tasks", so it comes from the route. It used
  // to come from storage, which meant one visit to All Tasks quietly changed My Tasks for good.
  const [scope, setScope] = useState<Scope>(initialScope);
  useEffect(() => { setScope(initialScope); }, [initialScope]);
  const [meMode, setMeMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
      localStorage.setItem(`${KEY}.layout`, layout);
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
  // A manager's Team: everyone in the Teams they lead, themselves left out ("Mine" is next to it).
  const myPeople = useMemo(() => new Set(teams.filter((t) => t.lead_ids.includes(me)).flatMap((t) => t.members.map((u) => u.id)).filter((id) => id !== me)), [teams, me]);
  const filtered = useMemo(() => {
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
      .filter((t) => (scope === 'mine' ? mine(t) : true))
      .filter((t) => (scope === 'team' ? t.assignees.some((a) => myPeople.has(a.id)) : true))
      .filter((t) => (scope === 'now' ? mine(t) && soon(t) && t.status.group !== 'closed' && t.status.group !== 'done' : true))
      ;
    return sortTasks(applyFilters(found, settings.filters, me, meMode), settings.sort);
  }, [tasks, settings.filters, settings.sort, me, meMode, scope, layout, myPeople]);
  // Whether an empty list means "nothing is yours" or "your filters hide it" -- a different
  // sentence belongs on each, and only this page knows which.
  const hasFilters = Object.values(settings.filters).some((v) => (Array.isArray(v) ? v.length > 0 : !!v));
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
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="border-b border-gray-200 px-6 pb-2 pt-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Layers size={18} className="text-brand-600" /> {scope === 'all' ? 'All Tasks' : scope === 'team' ? 'My Team’s Tasks' : 'My Tasks'}
          {/* The Mine / Everyone switch used to sit here. Two controls were saying the same thing:
              the line underneath already gives both numbers, and narrowing to your own work is
              what Filter -> Assignee is for. One list, and the subtitle says what is in it. */}
        </h1>
      </header>
      <ViewTabs value={layout} onChange={setLayout} only={OFFERED} />
      {/* The Planner answers its own question and carry their own controls, so
          the filter toolbar would only be furniture above them. */}
      {SHOWS_TOOLBAR.includes(layout) && (
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-6 py-2">
        {/* The search box that stood here is gone: the search bar in the top bar finds tasks
            across everything, and a second one over this list was the same job twice. */}
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
      </div>
      )}
      <main className={`min-h-0 flex-1 ${SCROLLS_ITSELF.includes(layout) ? 'overflow-hidden' : 'overflow-auto'}`}>
        {/* Workload reads from its own endpoint -- it needs every task spread across days, which
            is a different question from the filtered list above it. */}
        {layout === 'workload' ? (
          <MyWorkloadView onOpenTask={openTask} listName={where} />
        ) : layout === 'planner' ? (
          <PlannerPage embedded />
        ) : tasks === null ? <TaskRowsSkeleton rows={8} /> : layout === 'board' ? (
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
            onSetField={() => undefined} selected={selected} onSelect={select}
            emptyBecause={hasFilters ? 'filters' : scope === 'mine' ? 'none-assigned' : 'nothing-here'} />
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
