import React, { useState } from 'react';
import { CalendarDays, ChevronDown, ChevronRight, DollarSign, ExternalLink, MoreHorizontal, MoveRight, Pencil, Play, Plus, Tag as TagIcon, Trash2 } from 'lucide-react';
import { Menu, StatusDot, formatDuration, parseDuration } from '../ui';
import { isoDay, type EntryUpdate, type SheetEntry, type SheetRow, type TimeTag, type Timesheet } from './api';
import { Popover, TaskPicker, dayLabel, hours } from './pieces';

export interface EntryActions {
  onUpdate: (entry: SheetEntry, body: EntryUpdate) => Promise<void>;
  onDelete: (entry: SheetEntry) => Promise<void>;
  tags: TimeTag[];
  onCreateTag: (name: string) => Promise<TimeTag>;
}

const COLS = 'minmax(340px,2.8fr) repeat(7, minmax(84px,1fr)) minmax(110px,1fr)';

/** The day header: date, total, and tracked-vs-capacity bar with a breakdown on hover. */
const DayHead: React.FC<{ iso: string; tracked: number; billable: number; capacity: number; today: boolean }> = ({ iso, tracked, billable, capacity, today }) => {
  const over = tracked > capacity;
  const pct = capacity ? Math.min(100, (100 * tracked) / capacity) : tracked ? 100 : 0;
  const tip = [
    `Capacity: ${hours(capacity)}`, `Tracked: ${hours(tracked)}`, `Billable: ${hours(billable)}`, `Non-billable: ${hours(tracked - billable)}`,
    over ? `Over capacity: ${hours(tracked - capacity)}` : `Remaining: ${hours(capacity - tracked)}`,
  ].join('\n');
  return (
    <div className={`border-l border-gray-100 px-2.5 py-3 ${today ? 'bg-indigo-50/40' : ''}`} title={tip}>
      <div className={`text-xs ${today ? 'font-medium text-indigo-700' : 'text-gray-500'}`}>{dayLabel(iso)}</div>
      <div className="mt-0.5 text-base text-gray-900">{hours(tracked)}</div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-200">
        <div className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const Cell: React.FC<{ seconds: number; editable: boolean; muted: boolean; onSave: (seconds: number) => Promise<void>; label: string }> = ({ seconds, editable, muted, onSave, label }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const commit = async () => {
    if (draft === null) return;
    const text = draft.trim();
    const value = text === '' || text === '0' ? 0 : parseDuration(text);
    if (value === null) { setError(true); return; }
    setDraft(null);
    setError(false);
    if (value !== seconds) await onSave(value);
  };
  const base = `flex h-full items-center justify-end border-l border-gray-100 px-3 text-sm ${muted ? 'bg-gray-50' : ''}`;
  if (draft !== null) {
    return (
      <div className={base}>
        <input
          autoFocus
          aria-label={label}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(false); }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(null); setError(false); } }}
          placeholder="e.g. 1h 30m"
          className={`w-full rounded border px-1.5 py-1 text-right text-sm focus:outline-none ${error ? 'border-red-400' : 'border-indigo-400'}`}
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      disabled={!editable}
      onClick={() => setDraft(seconds ? formatDuration(seconds) : '')}
      className={`${base} w-full ${editable ? 'hover:bg-indigo-50/60' : 'cursor-default'}`}
    >
      {seconds ? <span className="text-gray-900">{formatDuration(seconds)}</span> : <span className="text-gray-300">—</span>}
    </button>
  );
};

export const Grid: React.FC<{
  sheet: Timesheet;
  editable: boolean;
  onCell: (taskId: string, dayIndex: number, seconds: number) => Promise<void>;
  onDeleteRow: (row: SheetRow) => void;
  onOpenTask: (taskId: string) => void;
  onStartTimer?: (taskId: string) => void;
  onAddTask: (taskId: string) => Promise<void>;
  actions: EntryActions;
}> = ({ sheet, editable, onCell, onDeleteRow, onOpenTask, onStartTimer, onAddTask, actions }) => {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const today = isoDay(new Date());
  const toggle = (id: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <div className="min-w-[1000px]" role="table" aria-label="Timesheet">
        <div className="grid border-b border-gray-200" style={{ gridTemplateColumns: COLS }} role="row">
          <div className="flex items-center px-4 text-sm text-gray-700">Task / Location</div>
          {sheet.days.map((d, i) => (
            <DayHead key={d} iso={d} tracked={sheet.tracked_per_day[i]} billable={sheet.billable_per_day[i]} capacity={sheet.capacity_per_day[i]} today={d === today} />
          ))}
          <div className="border-l border-gray-100 px-2.5 py-3">
            <div className="text-xs text-gray-500">Total</div>
            <div className="mt-0.5 text-base text-gray-900">{hours(sheet.total_seconds)}</div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-200">
              {(() => { const cap = sheet.capacity_per_day.reduce((a, b) => a + b, 0); const over = sheet.total_seconds > cap; return <div className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${cap ? Math.min(100, (100 * sheet.total_seconds) / cap) : 0}%` }} />; })()}
            </div>
          </div>
        </div>

        {sheet.rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">No time tracked this week. Add a task to start filling in your timesheet.</div>
        )}

        {sheet.rows.map((row) => {
          const expanded = open.has(row.task.id);
          const rowMenu = [
            ...(row.task.can_open ? [{ label: 'Open task', icon: <ExternalLink size={14} />, onClick: () => onOpenTask(row.task.id) }] : []),
            ...(onStartTimer && row.task.can_open ? [{ label: 'Start timer', icon: <Play size={14} />, onClick: () => onStartTimer(row.task.id) }] : []),
            ...(editable ? [{ label: 'Delete row', icon: <Trash2 size={14} />, danger: true, onClick: () => onDeleteRow(row) }] : []),
          ];
          return (
            <div key={row.task.id} className="border-b border-gray-100 last:border-b-0" role="rowgroup">
              <div className="grid min-h-[64px]" style={{ gridTemplateColumns: COLS }} role="row">
                <div className="flex min-w-0 items-center gap-2 px-3 py-2">
                  <button type="button" aria-label={expanded ? 'Hide entries' : 'Show entries'} onClick={() => toggle(row.task.id)} className={`text-gray-400 hover:text-gray-700 ${row.entries.length ? '' : 'invisible'}`}>
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <div className="min-w-0">
                    <button type="button" disabled={!row.task.can_open} onClick={() => onOpenTask(row.task.id)} className="block max-w-full truncate text-left text-[15px] font-medium text-gray-900 hover:underline disabled:no-underline">
                      {row.task.name}
                      {row.running && <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500 align-middle" title="Timer running" />}
                    </button>
                    {row.task.status && (
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-gray-500">
                        <StatusDot status={row.task.status} size={13} />
                        <span className="shrink-0">{row.task.status.name}</span>
                        {row.task.location && <span className="truncate">• {row.task.location}</span>}
                        {row.task.archived && <span className="shrink-0 rounded bg-gray-100 px-1 text-[11px]">archived</span>}
                      </div>
                    )}
                  </div>
                </div>
                {row.seconds_per_day.map((sec, i) => (
                  <Cell
                    key={i}
                    seconds={sec}
                    editable={editable && row.task.can_open}
                    muted={sheet.capacity_per_day[i] === 0}
                    label={`${row.task.name} on ${dayLabel(sheet.days[i])}`}
                    onSave={(value) => onCell(row.task.id, i, value)}
                  />
                ))}
                <div className="flex items-center justify-end gap-2 border-l border-gray-100 px-3">
                  <span className="text-[15px] font-medium text-gray-900">{hours(row.total_seconds)}</span>
                  {rowMenu.length > 0 && (
                    <Menu align="right" label={`Actions for ${row.task.name}`} items={rowMenu} trigger={<span className="rounded p-1 text-gray-400 hover:bg-gray-100"><MoreHorizontal size={16} /></span>} />
                  )}
                </div>
              </div>
              {expanded && row.entries.map((entry) => (
                <div key={entry.id} className="grid bg-gray-50/70 text-sm" style={{ gridTemplateColumns: COLS }} role="row">
                  <div className="flex min-w-0 items-center gap-2 py-2 pl-12 pr-3">
                    <EntryDetails entry={entry} editable={editable} actions={actions} />
                  </div>
                  {sheet.days.map((_, i) => (
                    <div key={i} className="flex items-center justify-end border-l border-gray-100 px-3 text-gray-600">
                      {entry.day === i ? (entry.running ? <span className="text-red-600">running</span> : formatDuration(entry.duration_seconds)) : ''}
                    </div>
                  ))}
                  <div className="flex items-center justify-end border-l border-gray-100 px-3">
                    {editable && !entry.running && <EntryMenu entry={entry} actions={actions} />}
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {editable && (
          <div className="px-4 py-3">
            <Popover
              width={340}
              trigger={(openPicker) => (
                <button type="button" onClick={openPicker} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                  <Plus size={15} /> Add task
                </button>
              )}
            >
              {(close) => <TaskPicker exclude={new Set(sheet.rows.map((r) => r.task.id))} onPick={(task) => { close(); onAddTask(task.id); }} />}
            </Popover>
          </div>
        )}
      </div>
    </div>
  );
};

// --- one time entry --------------------------------------------------------------------------------

export const TagChips: React.FC<{ tags: TimeTag[] }> = ({ tags }) => (
  <>{tags.map((t) => <span key={t.id} className="rounded px-1.5 py-px text-[11px] font-medium" style={{ backgroundColor: t.bg_color, color: t.fg_color }}>{t.name}</span>)}</>
);

export const EntryDetails: React.FC<{ entry: SheetEntry; editable: boolean; actions: EntryActions }> = ({ entry, editable, actions }) => {
  const [editing, setEditing] = useState(false);
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <button
        type="button"
        title={entry.billable ? 'Billable' : 'Not billable'}
        disabled={!editable || entry.running}
        onClick={() => actions.onUpdate(entry, { billable: !entry.billable })}
        className={`rounded-full p-0.5 ${entry.billable ? 'bg-emerald-100 text-emerald-700' : 'text-gray-300 hover:text-gray-500'}`}
      >
        <DollarSign size={12} />
      </button>
      {editing ? (
        <input
          autoFocus
          aria-label="Description"
          defaultValue={entry.description ?? ''}
          onBlur={(e) => { setEditing(false); if ((e.target.value || null) !== entry.description) actions.onUpdate(entry, { description: e.target.value || null }); }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="min-w-40 flex-1 rounded border border-indigo-300 px-1.5 py-0.5 text-sm focus:outline-none"
        />
      ) : (
        <button type="button" disabled={!editable || entry.running} onClick={() => setEditing(true)} className="truncate text-left text-gray-700 hover:underline disabled:no-underline">
          {entry.description || <span className="text-gray-400">{editable ? 'Add note' : 'No note'}</span>}
        </button>
      )}
      <span className="text-xs text-gray-400">{time(entry.started_at)}{entry.ended_at ? ` – ${time(entry.ended_at)}` : ''}</span>
      <TagChips tags={entry.tags} />
      {editable && !entry.running && <TagPicker entry={entry} actions={actions} />}
    </div>
  );
};

export const TagPicker: React.FC<{ entry: SheetEntry; actions: EntryActions }> = ({ entry, actions }) => {
  const [name, setName] = useState('');
  const chosen = new Set(entry.tags.map((t) => t.id));
  const toggle = (id: string) => actions.onUpdate(entry, { tag_ids: chosen.has(id) ? [...chosen].filter((x) => x !== id) : [...chosen, id] });
  return (
    <Popover width={220} trigger={(open) => <button type="button" title="Tags" onClick={open} className="rounded p-0.5 text-gray-300 hover:text-gray-600"><TagIcon size={12} /></button>}>
      {() => (
        <div>
          <div className="mb-1 text-xs font-medium text-gray-500">Time tags</div>
          {actions.tags.length === 0 && <p className="px-1 py-1 text-xs text-gray-400">No tags yet.</p>}
          {actions.tags.map((t) => (
            <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-gray-50">
              <input type="checkbox" checked={chosen.has(t.id)} onChange={() => toggle(t.id)} />
              <span className="rounded px-1.5 py-px text-xs font-medium" style={{ backgroundColor: t.bg_color, color: t.fg_color }}>{t.name}</span>
            </label>
          ))}
          <form
            className="mt-1 flex gap-1 border-t border-gray-100 pt-1.5"
            onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; const tag = await actions.onCreateTag(name.trim()); setName(''); await actions.onUpdate(entry, { tag_ids: [...chosen, tag.id] }); }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag" className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-0.5 text-xs" />
            <button type="submit" className="rounded bg-indigo-600 px-2 text-xs text-white">Add</button>
          </form>
        </div>
      )}
    </Popover>
  );
};

export const EntryMenu: React.FC<{ entry: SheetEntry; actions: EntryActions }> = ({ entry, actions }) => {
  const [mode, setMode] = useState<'menu' | 'date' | 'task'>('menu');
  const moveToDay = (value: string) => {
    if (!value) return;
    const old = new Date(entry.started_at);
    const [y, m, d] = value.split('-').map(Number);
    const next = new Date(y, m - 1, d, old.getHours(), old.getMinutes(), old.getSeconds());
    actions.onUpdate(entry, { started_at: next.toISOString() });
  };
  return (
    <Popover
      width={mode === 'task' ? 340 : 200}
      align="right"
      trigger={(open) => <button type="button" aria-label="Entry actions" onClick={() => { setMode('menu'); open(); }} className="rounded p-1 text-gray-400 hover:bg-gray-100"><MoreHorizontal size={15} /></button>}
    >
      {(close) => mode === 'date' ? (
        <label className="block text-xs text-gray-600">Move to date
          <input type="date" autoFocus defaultValue={isoDay(new Date(entry.started_at))} onChange={(e) => { moveToDay(e.target.value); close(); }} className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm" />
        </label>
      ) : mode === 'task' ? (
        <TaskPicker placeholder="Move to task…" exclude={new Set([entry.task_id])} onPick={(task) => { close(); actions.onUpdate(entry, { task_id: task.id }); }} />
      ) : (
        <ul className="text-sm">
          <li><button type="button" onClick={() => setMode('date')} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50"><CalendarDays size={14} /> Change date</button></li>
          <li><button type="button" onClick={() => setMode('task')} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50"><MoveRight size={14} /> Move to task</button></li>
          <li><button type="button" onClick={() => { close(); const v = window.prompt('Duration (e.g. 1h 30m)', formatDuration(entry.duration_seconds)); const s = v ? parseDuration(v) : null; if (s) actions.onUpdate(entry, { duration_seconds: s }); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50"><Pencil size={14} /> Change duration</button></li>
          <li><button type="button" onClick={() => { close(); actions.onDelete(entry); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-red-600 hover:bg-red-50"><Trash2 size={14} /> Delete entry</button></li>
        </ul>
      )}
    </Popover>
  );
};
