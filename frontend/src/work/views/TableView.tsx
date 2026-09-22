import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Maximize2, Plus } from 'lucide-react';
import { exportTasks, taskRows } from './exportTasks';
import { workApi, type CustomField, type Status, type Task, type TaskInput, type UserRef } from '../api';
import { PRIORITIES, StatusDot, formatDuration, fromDateInput, parseDuration, toDateInput } from '../ui';
import { useWork } from '../WorkContext';
import { FieldEditor, fieldApplies, fieldIcon, valueText } from '../fields/FieldValue';

export const TABLE_COLUMNS: { key: string; label: string; width: number }[] = [
  { key: 'custom_id', label: 'Task ID', width: 90 },
  { key: 'status', label: 'Status', width: 140 },
  { key: 'assignee', label: 'Assignees', width: 150 },
  { key: 'priority', label: 'Priority', width: 110 },
  { key: 'start_date', label: 'Start date', width: 130 },
  { key: 'due_date', label: 'Due date', width: 130 },
  { key: 'time_estimate', label: 'Time estimate', width: 110 },
  { key: 'time_tracked', label: 'Time tracked', width: 110 },
  { key: 'tags', label: 'Tags', width: 150 },
  { key: 'list', label: 'List', width: 150 },
];

// The Assignees column reuses the People field editor.
const ASSIGNEES: CustomField = { id: 'assignees', name: 'Assignees', type: 'people', config: {}, location: 'list', location_id: '', orderindex: 0 };

/**
 * ClickUp's Table view: a spreadsheet of tasks, one row each, where every cell edits in
 * place — core fields and custom fields alike — and the grid can be exported as CSV.
 */
export const TableView: React.FC<{
  tasks: Task[]; // filtered and sorted
  statuses: Status[] | null; // this List's statuses; null above a List
  fields: CustomField[]; // custom fields shown, in order
  hidden: string[];
  people: UserRef[];
  listName: (listId: string) => string | null;
  canCreate: boolean;
  onCreate: (name: string) => Promise<void>;
  onOpenTask: (id: string) => void;
  onChanged: () => void;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
  /** Column calculations, saved with the view: column key -> sum | avg | min | max | count. */
  totals?: Record<string, string>;
  onTotals?: (totals: Record<string, string>) => void;
}> = ({ tasks, statuses, fields, hidden, people, listName, canCreate, onCreate, onOpenTask, onChanged, selected, onSelect, totals = {}, onTotals }) => {
  const { locate } = useWork();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Statuses of other Lists, fetched when a status cell is opened above a List.
  const [listStatuses, setListStatuses] = useState<Record<string, Status[]>>({});
  const [local, setLocal] = useState<Record<string, Partial<Task>>>({});

  const columns = TABLE_COLUMNS.filter((c) => !hidden.includes(c.key) && (c.key !== 'list' || !statuses));
  const shownFields = fields.filter((f) => !hidden.includes(`cf:${f.id}`));
  const rows = useMemo(() => tasks.map((t) => ({ ...t, ...(local[t.id] ?? {}) })), [tasks, local]);
  // Edits show at once; fresh data from the server replaces them.
  useEffect(() => setLocal({}), [tasks]);

  const applies = (f: CustomField, t: Task) => fieldApplies(f, t, locate);
  const canEdit = (t: Task) => t.permission_level === 'edit' || t.permission_level === 'full';

  const update = async (t: Task, input: TaskInput, optimistic?: Partial<Task>) => {
    setError(null);
    if (optimistic) setLocal((l) => ({ ...l, [t.id]: { ...(l[t.id] ?? {}), ...optimistic } }));
    try {
      await workApi.updateTask(t.id, input);
      onChanged();
    } catch (e) {
      setError(`${t.name}: ${(e as Error).message}`);
      setLocal((l) => { const next = { ...l }; delete next[t.id]; return next; });
    }
  };
  const setField = async (t: Task, f: CustomField, value: unknown) => {
    setError(null);
    setLocal((l) => ({ ...l, [t.id]: { ...(l[t.id] ?? {}), custom_fields: { ...(t.custom_fields ?? {}), [f.id]: value } } }));
    try {
      await workApi.setFieldValue(t.id, f.id, value);
      onChanged();
    } catch (e) {
      setError(`${t.name} · ${f.name}: ${(e as Error).message}`);
      setLocal((l) => { const next = { ...l }; delete next[t.id]; return next; });
    }
  };
  const statusesFor = (t: Task): Status[] | null => statuses ?? listStatuses[t.list_id] ?? null;
  const loadStatuses = (t: Task) => {
    if (statuses || listStatuses[t.list_id]) return;
    workApi.statuses('list', t.list_id).then((set) => setListStatuses((m) => ({ ...m, [t.list_id]: set.statuses }))).catch(() => undefined);
  };

  const exportCsv = () => {
    const head = ['Task', ...columns.map((c) => c.label), ...shownFields.map((f) => f.name)];
    const cellText = (t: Task, key: string): string => {
      switch (key) {
        case 'custom_id': return t.custom_id ?? '';
        case 'status': return t.status.name;
        case 'assignee': return t.assignees.map((u) => u.display_name || u.email).join(', ');
        case 'priority': return t.priority ? PRIORITIES[t.priority].label : '';
        case 'start_date': return toDateInput(t.start_date);
        case 'due_date': return toDateInput(t.due_date);
        case 'time_estimate': return formatDuration(t.time_estimate_seconds);
        case 'time_tracked': return formatDuration(t.time_tracked_seconds);
        case 'tags': return t.tags.map((x) => x.name).join(', ');
        case 'list': return listName(t.list_id) ?? '';
        default: return '';
      }
    };
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [head, ...rows.map((t) => [
      t.name, ...columns.map((c) => cellText(t, c.key)),
      ...shownFields.map((f) => (applies(f, t) ? valueText(f, t.custom_fields?.[f.id], people) : '')),
    ])].map((r) => r.map(esc).join(','));
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tasks.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Column calculations (ClickUp's "Calculate"): numbers and times can be summed, averaged…
  const numbersOf = (key: string, f?: CustomField): number[] => rows.flatMap((t) => {
    if (key === 'time_estimate') return t.time_estimate_seconds ? [t.time_estimate_seconds] : [];
    if (key === 'time_tracked') return t.time_tracked_seconds ? [t.time_tracked_seconds] : [];
    if (f && applies(f, t)) { const v = t.custom_fields?.[f.id]; return typeof v === 'number' ? [v] : []; }
    return [];
  });
  const filledCount = (key: string, f?: CustomField) => rows.filter((t) => {
    if (f) { const v = t.custom_fields?.[f.id]; return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length); }
    const map: Record<string, unknown> = { assignee: t.assignees.length || null, priority: t.priority, start_date: t.start_date, due_date: t.due_date, tags: t.tags.length || null, custom_id: t.custom_id };
    return map[key] !== null && map[key] !== undefined;
  }).length;
  const numeric = (key: string, f?: CustomField) => key === 'time_estimate' || key === 'time_tracked' || (!!f && ['number', 'money', 'progress', 'rating'].includes(f.type));
  const calcCell = (key: string, f?: CustomField) => {
    const how = totals[key] ?? '';
    const options = numeric(key, f) ? ['sum', 'avg', 'min', 'max', 'count'] : key === 'status' || key === 'list' ? [] : ['count'];
    if (!options.length) return null;
    let value = '';
    if (how === 'count') value = String(filledCount(key, f));
    else if (how) {
      const nums = numbersOf(key, f);
      const r = !nums.length ? null : how === 'sum' ? nums.reduce((a, b) => a + b, 0) : how === 'avg' ? nums.reduce((a, b) => a + b, 0) / nums.length : how === 'min' ? Math.min(...nums) : Math.max(...nums);
      value = r === null ? '—' : key.startsWith('time_') ? formatDuration(Math.round(r)) : f?.type === 'money' ? valueText(f, Math.round(r * 100) / 100, people) : String(Math.round(r * 100) / 100);
    }
    return (
      <span className="flex items-center gap-1">
        <select aria-label={`Calculate ${key}`} value={how} onChange={(e) => onTotals?.({ ...totals, [key]: e.target.value })} disabled={!onTotals}
          className="max-w-[4.5rem] rounded border border-transparent bg-transparent text-[11px] text-gray-400 hover:border-gray-200">
          <option value="">Calculate</option>
          {options.map((o) => <option key={o} value={o}>{o === 'avg' ? 'Average' : o[0].toUpperCase() + o.slice(1)}</option>)}
        </select>
        {value && <b className="truncate font-semibold text-gray-800">{value}</b>}
      </span>
    );
  };

  const cellBase = 'border-b border-r border-gray-100 px-1.5 py-1 align-middle';
  const input = 'w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-gray-200 focus:border-indigo-400 focus:bg-white focus:outline-none disabled:hover:border-transparent';

  const cell = (t: Task, key: string): React.ReactNode => {
    const ok = canEdit(t);
    switch (key) {
      case 'status': {
        const options = statusesFor(t);
        return (
          <span className="flex items-center gap-1.5">
            <StatusDot status={t.status} size={12} />
            <select aria-label={`Status of ${t.name}`} disabled={!ok && t.permission_level !== 'comment'} value={t.status.id}
              onFocus={() => loadStatuses(t)} onMouseDown={() => loadStatuses(t)}
              onChange={(e) => { const st = options?.find((x) => x.id === e.target.value); update(t, { status_id: e.target.value }, st ? { status: st } : undefined); }}
              className={`${input} uppercase`}>
              {(options ?? [t.status]).map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          </span>
        );
      }
      case 'assignee':
        return <FieldEditor compact field={{ ...ASSIGNEES, name: `Assignees of ${t.name}` }} value={t.assignees.map((u) => u.id)} people={people} disabled={!ok}
          onChange={(v) => update(t, { assignees: (v as string[] | null) ?? [] })} />;
      case 'priority':
        return (
          <select aria-label={`Priority of ${t.name}`} disabled={!ok} value={t.priority ?? ''} onChange={(e) => {
            const p = e.target.value ? Number(e.target.value) : null;
            update(t, { priority: p }, { priority: p });
          }} className={input} style={{ color: t.priority ? PRIORITIES[t.priority].color : undefined }}>
            <option value="">—</option>
            {[1, 2, 3, 4].map((p) => <option key={p} value={p}>{PRIORITIES[p].label}</option>)}
          </select>
        );
      case 'start_date':
      case 'due_date': {
        const v = key === 'start_date' ? t.start_date : t.due_date;
        return (
          <input type="date" aria-label={`${key === 'start_date' ? 'Start' : 'Due'} date of ${t.name}`} disabled={!ok} key={v ?? ''} defaultValue={toDateInput(v)}
            onChange={(e) => update(t, { [key]: fromDateInput(e.target.value) })}
            className={`${input} ${key === 'due_date' && t.is_overdue ? 'text-red-600' : ''}`} />
        );
      }
      case 'time_estimate':
        return (
          <input aria-label={`Time estimate of ${t.name}`} disabled={!ok} key={t.time_estimate_seconds ?? ''} defaultValue={formatDuration(t.time_estimate_seconds)} placeholder=""
            onBlur={(e) => {
              const secs = e.target.value.trim() ? parseDuration(e.target.value) : null;
              if (e.target.value.trim() && secs === null) { setError(`${t.name}: write estimates like 1h 30m`); return; }
              if (secs !== (t.time_estimate_seconds ?? null)) update(t, { time_estimate_seconds: secs });
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className={input} />
        );
      case 'time_tracked':
        return <span className="px-1 text-sm text-gray-600">{formatDuration(t.time_tracked_seconds)}</span>;
      case 'custom_id':
        return <span className="px-1 font-mono text-xs text-gray-500">{t.custom_id ?? ''}</span>;
      case 'tags':
        return (
          <span className="flex flex-wrap gap-1 px-1">
            {t.tags.map((tag) => <span key={tag.id} className="rounded px-1.5 py-px text-[11px] font-medium" style={{ backgroundColor: tag.bg_color, color: tag.fg_color }}>{tag.name}</span>)}
          </span>
        );
      case 'list':
        return <span className="truncate px-1 text-xs text-gray-500">{listName(t.list_id)}</span>;
      default:
        return null;
    }
  };

  const width = 44 + 300 + columns.reduce((n, c) => n + c.width, 0) + shownFields.length * 160;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-6 py-2">
        {error && <p role="alert" className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
        <button type="button" onClick={exportCsv} className="ml-auto flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50">
          <Download size={14} /> Export CSV
        </button>
        <button type="button" onClick={() => exportTasks('xlsx', 'tasks', taskRows(rows, shownFields, people, listName))} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50">
          <FileSpreadsheet size={14} /> Excel
        </button>
      </div>
      <div className="mx-6 min-h-0 flex-1 overflow-auto pb-16">
        <table className="border-separate border-spacing-0 text-sm" style={{ width, tableLayout: 'fixed' }} aria-label="Table">
          <colgroup>
            <col style={{ width: 44 }} /><col style={{ width: 300 }} />
            {columns.map((c) => <col key={c.key} style={{ width: c.width }} />)}
            {shownFields.map((f) => <col key={f.id} style={{ width: 160 }} />)}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs font-medium text-gray-500">
            <tr>
              <th className="sticky left-0 z-20 border-b border-r border-gray-200 bg-gray-50 px-2 py-2 text-center">
                <input type="checkbox" aria-label="Select all rows" checked={rows.length > 0 && rows.every((t) => selected.has(t.id))}
                  onChange={(e) => onSelect(rows.map((t) => t.id), e.target.checked)} />
              </th>
              <th className="sticky left-[44px] z-20 border-b border-r border-gray-200 bg-gray-50 px-2 py-2">Task name</th>
              {columns.map((c) => <th key={c.key} className="border-b border-r border-gray-200 px-2 py-2">{c.label}</th>)}
              {shownFields.map((f) => (
                <th key={f.id} className="border-b border-r border-gray-200 px-2 py-2">
                  <span className="flex items-center gap-1 truncate"><span className="text-gray-400">{fieldIcon(f.type)}</span>{f.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={t.id} className={`group ${selected.has(t.id) ? 'bg-indigo-50' : 'bg-white hover:bg-gray-50'}`}>
                <td className={`${cellBase} sticky left-0 z-[1] bg-inherit text-center text-xs text-gray-400`}>
                  <span className={selected.size > 0 || selected.has(t.id) ? 'hidden' : 'group-hover:hidden'}>{i + 1}</span>
                  <input type="checkbox" aria-label={`Select ${t.name}`} checked={selected.has(t.id)} onChange={(e) => onSelect([t.id], e.target.checked)}
                    className={selected.size > 0 || selected.has(t.id) ? '' : 'hidden group-hover:inline'} />
                </td>
                <td className={`${cellBase} sticky left-[44px] z-[1] bg-inherit`}>
                  <span className="flex items-center gap-1">
                    <input aria-label={`Name of ${t.name}`} disabled={!canEdit(t)} key={t.name} defaultValue={t.name}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) update(t, { name: v }); else e.target.value = t.name; }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      className={`${input} ${t.status.group === 'closed' ? 'text-gray-400 line-through' : 'text-gray-800'}`} />
                    <button type="button" title="Open task" aria-label={`Open ${t.name}`} onClick={() => onOpenTask(t.id)}
                      className="shrink-0 rounded p-1 text-gray-300 opacity-0 hover:bg-gray-100 hover:text-gray-700 group-hover:opacity-100 focus:opacity-100">
                      <Maximize2 size={13} />
                    </button>
                  </span>
                </td>
                {columns.map((c) => <td key={c.key} className={cellBase}>{cell(t, c.key)}</td>)}
                {shownFields.map((f) => (
                  <td key={f.id} className={cellBase}>
                    {applies(f, t)
                      ? <FieldEditor compact field={{ ...f, name: `${f.name} of ${t.name}` }} value={t.custom_fields?.[f.id]} people={people} disabled={!canEdit(t)} onChange={(v) => setField(t, f, v)} />
                      : <span className="block px-1 text-xs text-gray-300" title="This field isn't used in this task's List">n/a</span>}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={2 + columns.length + shownFields.length} className="px-3 py-10 text-center text-sm text-gray-400">No tasks match.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="sticky bottom-0 z-10 bg-gray-50 text-xs text-gray-600" aria-label="Column totals">
              <tr>
                <td className="sticky left-0 z-10 border-t border-gray-200 bg-gray-50" />
                <td className="sticky left-[44px] z-10 border-t border-r border-gray-200 bg-gray-50 px-2 py-1.5 font-medium">{rows.length} task{rows.length === 1 ? '' : 's'}</td>
                {columns.map((c) => <td key={c.key} className="border-t border-r border-gray-200 px-1.5 py-1">{calcCell(c.key)}</td>)}
                {shownFields.map((f) => <td key={f.id} className="border-t border-r border-gray-200 px-1.5 py-1">{calcCell(`cf:${f.id}`, f)}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
        {canCreate && (
          <form className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50" style={{ width }}
            onSubmit={async (e) => { e.preventDefault(); if (draft.trim()) { await onCreate(draft.trim()); setDraft(''); } }}>
            <Plus size={14} className="text-gray-400" />
            <input aria-label="New task name" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New task — press Enter" className="flex-1 bg-transparent focus:outline-none" />
          </form>
        )}
      </div>
    </div>
  );
};
