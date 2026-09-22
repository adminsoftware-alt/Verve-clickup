import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, Layers, List as ListIcon, Search, Table2 } from 'lucide-react';
import { workApi, type CustomField, type Task } from './api';
import { useMe, useWork } from './WorkContext';
import { ListView } from './views/ListView';
import { TableView } from './views/TableView';
import { buildGroups } from './views/grouping';
import { COLUMNS, applyFilters, readSettings, sortTasks, type ViewSettings } from './views/viewSettings';
import { ColumnsButton, FilterButton, GroupByButton, MeButton, SortButton } from './views/ViewControls';
import { BulkBar } from './views/BulkBar';
import { exportTasks, taskRows } from './views/exportTasks';

const KEY = 'timetriq.allTasks';

/** ClickUp's "Everything": every task you can open, across all Spaces, with the usual view tools. */
export const AllTasksPage: React.FC = () => {
  const { workspace, members, locate, listName } = useWork();
  const me = useMe();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [q, setQ] = useState('');
  const [layout, setLayout] = useState<'list' | 'table'>(() => { try { return (localStorage.getItem(`${KEY}.layout`) as 'list' | 'table') || 'list'; } catch { return 'list'; } });
  const [settings, setSettings] = useState<ViewSettings>(() => {
    try { return readSettings(JSON.parse(localStorage.getItem(KEY) || 'null') ?? { groupBy: 'none' }); } catch { return readSettings({ groupBy: 'none' }); }
  });
  const [meMode, setMeMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fields] = useState<CustomField[]>([]);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(settings)); localStorage.setItem(`${KEY}.layout`, layout); } catch { /* ignore */ } }, [settings, layout]);
  const load = useCallback(() => {
    if (workspace) workApi.allTasks(workspace.id, settings.showClosed).then((p) => setTasks(p.tasks)).catch(() => setTasks([]));
  }, [workspace, settings.showClosed]);
  useEffect(() => { load(); }, [load]);
  const update = <K extends keyof ViewSettings>(k: K, v: ViewSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const people = useMemo(() => members.map((m) => m.user), [members]);
  const where = useCallback((listId: string) => locate('list', listId)?.path.map((c) => c.name).join(' / ') ?? listName(listId), [locate, listName]);
  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    const found = (tasks ?? []).filter((t) => !text || t.name.toLowerCase().includes(text) || (t.custom_id ?? '').toLowerCase() === text);
    return sortTasks(applyFilters(found, settings.filters, me, meMode), settings.sort);
  }, [tasks, q, settings.filters, settings.sort, me, meMode]);
  const makeGroups = useCallback((roots: Task[]) => buildGroups(settings.groupBy, roots, null, [], people), [settings.groupBy, people]);
  const openTask = (id: string) => { const t = tasks?.find((x) => x.id === id); if (t) navigate(`/l/${t.list_id}?task=${id}`); };
  const select = (ids: string[], on: boolean) => setSelected((prev) => { const n = new Set(prev); ids.forEach((x) => (on ? n.add(x) : n.delete(x))); return n; });
  const selectedTasks = filtered.filter((t) => selected.has(t.id));
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="border-b border-gray-200 px-6 pb-2 pt-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><Layers size={18} className="text-indigo-600" /> All Tasks</h1>
        <p className="text-xs text-gray-500">Every task you can open, in every Space.</p>
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-6 py-2">
        <span className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1">
          <Search size={14} className="text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks or IDs" aria-label="Search all tasks" className="w-40 text-sm focus:outline-none" />
        </span>
        <FilterButton filters={settings.filters} onChange={(f) => update('filters', f)} tasks={tasks ?? []} statuses={null} groups={[]} people={people} />
        <SortButton sort={settings.sort} onChange={(v) => update('sort', v)} />
        {layout === 'list' && <GroupByButton value={settings.groupBy} onChange={(g) => update('groupBy', g)} options={['none', 'status', 'assignee', 'priority', 'due', 'tags']} />}
        <ColumnsButton hidden={settings.hidden} onChange={(h) => update('hidden', h)} />
        <MeButton on={meMode} onChange={setMeMode} />
        <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-gray-600"><input type="checkbox" checked={settings.showClosed} onChange={(e) => update('showClosed', e.target.checked)} /> Show closed</label>
        <span className="whitespace-nowrap text-xs text-gray-400">{filtered.length} tasks</span>
        <button type="button" onClick={() => exportTasks('xlsx', 'all-tasks', taskRows(filtered, fields, people, where))} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"><FileSpreadsheet size={14} /> Export</button>
        <span className="ml-auto flex rounded-md border border-gray-200 p-0.5">
          <button type="button" aria-pressed={layout === 'list'} title="List" onClick={() => setLayout('list')} className={`rounded p-1 ${layout === 'list' ? 'bg-gray-100' : 'text-gray-400'}`}><ListIcon size={15} /></button>
          <button type="button" aria-pressed={layout === 'table'} title="Table" onClick={() => setLayout('table')} className={`rounded p-1 ${layout === 'table' ? 'bg-gray-100' : 'text-gray-400'}`}><Table2 size={15} /></button>
        </span>
      </div>
      <main className="min-h-0 flex-1 overflow-auto">
        {tasks === null ? <p className="p-10 text-center text-sm text-gray-400">Loading…</p> : layout === 'list' ? (
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
