import React, { useState } from 'react';
import {
  ArrowDown, ArrowUp, Archive, CalendarDays, Circle, Clock3, DollarSign, Flag, FolderTree, Hourglass, Tag as TagIcon,
  User,
} from 'lucide-react';
import { FEATURES } from '../../config/features';
import { formatDuration, parseDuration } from '../ui';
import { PROGRESS_COLUMNS } from '../views/grouping';
import { TwoStepFilter, type FilterField } from '../views/TwoStepFilter';
import { TRACKED_OPS, type SheetQuery, type SheetEntry, type SheetRow, type TimeTag, type Timesheet } from './api';
import { EntryDetails, EntryMenu, type EntryActions } from './Grid';
import { Popover, dayLabel, hours } from './pieces';

// --- filters -------------------------------------------------------------------------------------

const chip = (active: boolean) =>
  `flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${active ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`;

export const FilterBar: React.FC<{
  query: SheetQuery; onChange: (q: SheetQuery) => void; tags: TimeTag[];
  /** The rows in the week, which is where the statuses actually in use come from. */
  rows?: SheetRow[];
}> = ({ query, onChange, tags, rows = [] }) => {
  const set = (patch: Partial<SheetQuery>) => onChange({ ...query, ...patch });
  const [amount, setAmount] = useState(query.trackedSeconds != null ? formatDuration(query.trackedSeconds) : '');
  const billableLabel = query.billable === 'billable' ? 'Billable' : query.billable === 'non_billable' ? 'Non-billable' : 'Billable status';
  const selectedTags = new Set(query.tagIds ?? []);
  const sortLabel = 'Task name';
  // What the dropdown can narrow. The people, Lists and tags on offer are read off the week in
  // front of you -- a filter that lists something not on screen is one that cannot change
  // anything. Status, priority and the date shapes are fixed, because they mean the same thing
  // whether or not this particular week happens to contain one.
  const lists = new Map<string, string>();
  const people = new Map<string, string>();
  const onTasks = new Map<string, string>();
  rows.forEach((r) => {
    if (r.task.list_id && r.task.location) lists.set(r.task.list_id, r.task.location.split(' / ').slice(-1)[0]);
    r.task.assignees?.forEach((u) => people.set(u.id, u.display_name || u.email));
    r.task.tags?.forEach((t) => onTasks.set(t.toLowerCase(), t));
  });

  const MULTI = ['statuses', 'lists', 'priorities', 'assignees', 'taskTags'];
  const fields: FilterField[] = [
    {
      key: 'statuses',
      label: 'Status',
      Icon: Circle,
      options: PROGRESS_COLUMNS.map((c) => ({ value: c.key, label: c.name, color: c.color })),
      selected: query.statuses ?? [],
    },
    {
      key: 'priorities',
      label: 'Priority',
      Icon: Flag,
      options: [
        { value: '1', label: 'Urgent', color: '#ef4444' },
        { value: '2', label: 'High', color: '#f97316' },
        { value: '3', label: 'Normal', color: '#0ea5e9' },
        { value: '4', label: 'Low', color: '#9ca3af' },
        { value: '0', label: 'No priority', color: '#d1d5db' },
      ],
      selected: query.priorities ?? [],
    },
    {
      key: 'assignees',
      label: 'Assignee',
      Icon: User,
      options: [{ value: 'none', label: 'Nobody' }, ...[...people].map(([value, label]) => ({ value, label }))],
      selected: query.assignees ?? [],
    },
    {
      key: 'due',
      label: 'Due date',
      Icon: CalendarDays,
      single: true,
      options: [
        { value: 'overdue', label: 'Overdue' },
        { value: 'today', label: 'Due today' },
        { value: 'this_week', label: 'Due in the next 7 days' },
        { value: 'set', label: 'Has a due date' },
        { value: 'none', label: 'No due date' },
      ],
      selected: query.due ? [query.due] : [],
    },
    {
      key: 'estimate',
      label: 'Time estimate',
      Icon: Hourglass,
      single: true,
      options: [{ value: 'set', label: 'Has an estimate' }, { value: 'missing', label: 'No estimate' }],
      selected: query.estimate ? [query.estimate] : [],
    },
    {
      key: 'scheduled',
      label: 'Scheduled',
      Icon: CalendarDays,
      single: true,
      options: [{ value: 'yes', label: 'Has a start or due date' }, { value: 'no', label: 'Unscheduled' }],
      selected: query.scheduled ? [query.scheduled] : [],
    },
    ...(onTasks.size > 0 ? [{
      key: 'taskTags',
      label: 'Tags',
      Icon: TagIcon,
      options: [...onTasks].map(([value, label]) => ({ value, label })),
      selected: query.taskTags ?? [],
    }] : []),
    ...(lists.size > 1 ? [{
      key: 'lists',
      label: 'List',
      Icon: FolderTree,
      options: [...lists].map(([value, label]) => ({ value, label })),
      selected: query.lists ?? [],
    }] : []),
    {
      key: 'includeArchived',
      label: 'Archived tasks',
      Icon: Archive,
      single: true,
      options: [{ value: 'yes', label: 'Include archived tasks' }],
      selected: query.includeArchived ? ['yes'] : [],
    },
  ];

  const pick = (field: FilterField, value: string) => {
    if (field.key === 'includeArchived') { set({ includeArchived: !query.includeArchived }); return; }
    if (!MULTI.includes(field.key)) {
      // Picking the value already set clears it, so one field never needs a Clear of its own.
      const on = (query as Record<string, unknown>)[field.key] === value;
      set({ [field.key]: on ? null : value } as Partial<SheetQuery>);
      return;
    }
    const on = ((query as Record<string, string[] | undefined>)[field.key] ?? []);
    const next = on.includes(value) ? on.filter((x) => x !== value) : [...on, value];
    set({ [field.key]: next.length ? next : undefined } as Partial<SheetQuery>);
  };
  const clear = (field: FilterField) => {
    if (field.key === 'includeArchived') { set({ includeArchived: false }); return; }
    set({ [field.key]: MULTI.includes(field.key) ? undefined : null } as Partial<SheetQuery>);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <TwoStepFilter
        fields={fields}
        onToggle={pick}
        onClear={clear}
        onClearAll={() => set({
          statuses: undefined, lists: undefined, priorities: undefined, assignees: undefined, taskTags: undefined,
          due: null, estimate: null, scheduled: null, includeArchived: false,
        })}
      />

      {FEATURES.timesheetBillableAndTagChips && (
      <Popover width={200} trigger={(open) => <button type="button" onClick={open} className={chip(!!query.billable && query.billable !== 'all')}><DollarSign size={13} /> {billableLabel}</button>}>
        {(close) => (
          <ul className="text-sm">
            {([['all', 'Billable and non-billable'], ['billable', 'Billable'], ['non_billable', 'Non-billable']] as const).map(([v, l]) => (
              <li key={v}><button type="button" onClick={() => { set({ billable: v }); close(); }} className={`w-full rounded px-2 py-1.5 text-left hover:bg-gray-50 ${(query.billable ?? 'all') === v ? 'font-medium text-brand-700' : ''}`}>{l}</button></li>
            ))}
          </ul>
        )}
      </Popover>

      )}

      {FEATURES.timesheetBillableAndTagChips && (
      <Popover width={220} trigger={(open) => <button type="button" onClick={open} className={chip(selectedTags.size > 0)}><TagIcon size={13} /> {selectedTags.size ? `Tag (${selectedTags.size})` : 'Tag'}</button>}>
        {() => (
          <div>
            {tags.length === 0 ? <p className="px-1 py-1 text-xs text-gray-400">No time tags yet. Add them to entries from the grid.</p> : tags.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={selectedTags.has(t.id)}
                  onChange={() => { const n = new Set(selectedTags); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); set({ tagIds: [...n] }); }}
                />
                <span className="rounded px-1.5 py-px text-xs font-medium" style={{ backgroundColor: t.bg_color, color: t.fg_color }}>{t.name}</span>
              </label>
            ))}
          </div>
        )}
      </Popover>

      )}

      <Popover width={280} trigger={(open) => (
        <button type="button" onClick={open} className={chip(!!query.trackedOp)}>
          <Clock3 size={13} /> {query.trackedOp
            ? `Tracked ${TRACKED_OPS.find((o) => o.value === query.trackedOp)?.short ?? ''} ${hours(query.trackedSeconds ?? 0)}`
            : 'Tracked time'}
        </button>
      )}>
        {(close) => (
          <form className="text-sm" onSubmit={(e) => {
            e.preventDefault();
            const secs = parseDuration(amount);
            set(secs == null ? { trackedOp: null, trackedSeconds: null } : { trackedOp: query.trackedOp ?? 'gte', trackedSeconds: secs });
            close();
          }}>
            <p className="mb-1.5 text-xs text-gray-500">Show tasks whose tracked time this week is</p>
            {/* The comparison is named in full rather than as a symbol: "gt" and ">" both need
                decoding, and this control is used once in a while, not every day. */}
            <select
              aria-label="Comparison"
              value={query.trackedOp ?? 'gte'}
              onChange={(e) => set({ trackedOp: e.target.value as SheetQuery['trackedOp'], trackedSeconds: query.trackedSeconds ?? null })}
              className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[13px] text-gray-800"
            >
              {TRACKED_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              aria-label="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0h"
              className="mt-2 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[13px] text-gray-800 placeholder:text-gray-400"
            />
            <p className="mt-1 text-[11px] text-gray-400">Hours and minutes, e.g. 2h, 45m, 1h 30m.</p>
            <div className="mt-2.5 flex items-center justify-between border-t border-gray-100 pt-2">
              <button type="button" onClick={() => { setAmount(''); set({ trackedOp: null, trackedSeconds: null }); close(); }} className="text-xs text-gray-500 hover:text-gray-800">Clear</button>
              <button type="submit" className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700">Apply</button>
            </div>
          </form>
        )}
      </Popover>

      {FEATURES.timesheetSortChip && (
      <Popover width={200} trigger={(open) => (
        <button type="button" onClick={open} className={chip(false)} title="Sort">
          {query.descending ? <ArrowDown size={13} /> : <ArrowUp size={13} />} {sortLabel}
        </button>
      )}>
        {(close) => (
          <ul className="text-sm">
            {([['name', 'Task name']] as const).map(([v, l]) => (
              <li key={v}>
                <button
                  type="button"
                  // Picking the current sort again reverses it, as in ClickUp.
                  onClick={() => { set((query.sort ?? 'name') === v ? { descending: !query.descending } : { sort: v, descending: false }); close(); }}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-gray-50 ${(query.sort ?? 'name') === v ? 'font-medium text-brand-700' : ''}`}
                >
                  {l}{(query.sort ?? 'name') === v && (query.descending ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
      )}
    </div>
  );
};

// --- Time entries view ----------------------------------------------------------------------------

const clock = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const TimeInput: React.FC<{ iso: string; disabled: boolean; label: string; onSave: (iso: string) => void }> = ({ iso, disabled, label, onSave }) => (
  <input
    type="time"
    aria-label={label}
    disabled={disabled}
    defaultValue={clock(iso)}
    key={iso}
    onBlur={(e) => {
      if (!e.target.value || e.target.value === clock(iso)) return;
      const [h, m] = e.target.value.split(':').map(Number);
      const d = new Date(iso);
      d.setHours(h, m, 0, 0);
      onSave(d.toISOString());
    }}
    className="w-[5.5rem] rounded border border-transparent px-1 py-0.5 text-sm hover:border-gray-200 focus:border-brand-400 focus:outline-none disabled:bg-transparent"
  />
);

export const EntriesView: React.FC<{ sheet: Timesheet; editable: boolean; actions: EntryActions; onOpenTask: (id: string) => void }> = ({ sheet, editable, actions, onOpenTask }) => {
  const [openDays, setOpenDays] = useState<Set<number>>(() => new Set(sheet.days.map((_, i) => i)));
  const byDay: { entry: SheetEntry; task: Timesheet['rows'][number]['task'] }[][] = sheet.days.map(() => []);
  for (const row of sheet.rows) for (const entry of row.entries) byDay[entry.day].push({ entry, task: row.task });
  byDay.forEach((list) => list.sort((a, b) => a.entry.started_at.localeCompare(b.entry.started_at)));
  const days = sheet.days.map((d, i) => ({ d, i })).filter(({ i }) => byDay[i].length > 0);

  if (days.length === 0) {
    return <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-400">No time entries this week.</div>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white" role="table" aria-label="Time entries">
      <div className="min-w-[980px]">
        <div className="grid grid-cols-[minmax(240px,1.3fr)_minmax(260px,1.6fr)_100px_100px_110px_40px] border-b border-gray-200 px-4 py-2 text-xs text-gray-500">
          <span>Task / Location</span><span>Description · Billable · Tags</span><span>Start</span><span>End</span><span className="text-right">Tracked</span><span />
        </div>
        {days.map(({ d, i }) => (
          <section key={d} aria-label={dayLabel(d)}>
            <button
              type="button"
              onClick={() => setOpenDays((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
              className="flex w-full items-center justify-between bg-gray-50 px-4 py-1.5 text-sm font-medium text-gray-700"
            >
              <span>{dayLabel(d)}</span><span>{hours(sheet.tracked_per_day[i])}</span>
            </button>
            {openDays.has(i) && byDay[i].map(({ entry, task }) => (
              <div key={entry.id} className="grid grid-cols-[minmax(240px,1.3fr)_minmax(260px,1.6fr)_100px_100px_110px_40px] items-center border-t border-gray-100 px-4 py-2 text-sm">
                <button type="button" disabled={!task.can_open} onClick={() => onOpenTask(task.id)} className="min-w-0 text-left">
                  <span className="block truncate text-gray-900 hover:underline">{task.name}</span>
                  <span className="block truncate text-xs text-gray-400">{task.location}</span>
                </button>
                <EntryDetails entry={entry} editable={editable} actions={actions} />
                <TimeInput iso={entry.started_at} label="Start time" disabled={!editable || entry.running} onSave={(iso) => actions.onUpdate(entry, { started_at: iso })} />
                {entry.ended_at ? (
                  <TimeInput iso={entry.ended_at} label="End time" disabled={!editable} onSave={(iso) => actions.onUpdate(entry, { ended_at: iso })} />
                ) : <span className="text-xs text-red-600">running</span>}
                <DurationInput entry={entry} editable={editable} onSave={(s) => actions.onUpdate(entry, { duration_seconds: s })} />
                <span className="flex justify-end">{editable && !entry.running && <EntryMenu entry={entry} actions={actions} />}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
};

const DurationInput: React.FC<{ entry: SheetEntry; editable: boolean; onSave: (seconds: number) => void }> = ({ entry, editable, onSave }) => {
  const [bad, setBad] = useState(false);
  if (entry.running || !editable) return <span className="text-right text-gray-800">{entry.running ? '—' : formatDuration(entry.duration_seconds)}</span>;
  return (
    <input
      key={entry.duration_seconds}
      aria-label="Tracked time"
      defaultValue={formatDuration(entry.duration_seconds)}
      onBlur={(e) => {
        const secs = parseDuration(e.target.value);
        if (!secs) { setBad(true); return; }
        setBad(false);
        if (secs !== entry.duration_seconds) onSave(secs);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={`w-full rounded border px-1.5 py-0.5 text-right text-sm focus:outline-none ${bad ? 'border-red-400' : 'border-transparent hover:border-gray-200 focus:border-brand-400'}`}
    />
  );
};
