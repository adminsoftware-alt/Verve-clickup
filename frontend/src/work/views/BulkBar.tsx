import React, { useState } from 'react';
import { Archive, CalendarDays, CircleDot, Flag, MoveRight, Tag as TagIcon, Trash2, UserPlus, X } from 'lucide-react';
import { workApi, type BulkEdit, type BulkResult, type Status, type Task, type UserRef } from '../api';
import { PRIORITIES, fromDateInput } from '../ui';
import { useWritableLists } from '../task/TaskActions';
import { Popover } from './ViewControls';

/**
 * ClickUp's bulk action toolbar: shown while tasks are selected. Each change is applied to
 * every selected task you're allowed to change; the rest are listed as skipped.
 */
export const BulkBar: React.FC<{
  selected: Task[];
  statuses: Status[] | null; // this List's statuses, or null above a List
  people: UserRef[];
  onClear: () => void;
  onDone: () => void;
}> = ({ selected, statuses, people, onClear, onDone }) => {
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [tag, setTag] = useState('');
  const lists = useWritableLists();
  const ids = selected.map((t) => t.id);
  // Above a List, offer every status name the selected tasks' Lists are known to use.
  const statusNames = statuses
    ? statuses.map((st) => ({ name: st.name, color: st.color }))
    : [...new Map(selected.map((t) => [t.status.name.toLowerCase(), { name: t.status.name, color: t.status.color }])).values()];

  const run = async (change: Omit<BulkEdit, 'task_ids'>, verb: string) => {
    try {
      const out: BulkResult = await workApi.bulkEdit({ task_ids: ids, ...change });
      const n = out.updated.length;
      const skipped = out.skipped.length
        ? ` · skipped ${out.skipped.length}: ${out.skipped.slice(0, 2).map((x) => `${x.name || 'a task'} (${x.reason})`).join('; ')}${out.skipped.length > 2 ? '…' : ''}`
        : '';
      setNote({ text: `${verb} ${n} task${n === 1 ? '' : 's'}${skipped}`, bad: out.skipped.length > 0 });
      if (change.delete || change.archived || change.list_id) onClear();
      onDone();
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true });
    }
  };

  const item = 'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-gray-50';
  return (
    <div role="toolbar" aria-label="Bulk actions" className="pointer-events-none fixed inset-x-0 bottom-5 z-[90] flex flex-col items-center gap-1.5 px-4">
      {note && (
        <p className={`pointer-events-auto rounded-md px-3 py-1 text-xs shadow ${note.bad ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>{note.text}</p>
      )}
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-xl bg-gray-900 px-3 py-2 text-sm text-white shadow-2xl">
        <span className="mr-1 whitespace-nowrap font-medium">{selected.length} selected</span>
        <button type="button" title="Clear selection" aria-label="Clear selection" onClick={onClear} className="mr-2 rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"><X size={14} /></button>

        <Popover label="Set status" icon={<CircleDot size={14} />} text="Status" up dark width={220}>
          {(close) => statusNames.map((st) => (
            <button key={st.name} type="button" className={item} onClick={() => { close(); run({ status: st.name }, 'Updated'); }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: st.color }} /> {st.name}
            </button>
          ))}
        </Popover>

        <Popover label="Assignees" icon={<UserPlus size={14} />} text="Assignees" up dark width={260}>
          {(close) => people.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-1 py-0.5 text-sm text-gray-700">
              <span className="min-w-0 flex-1 truncate">{p.display_name || p.email}</span>
              <button type="button" aria-label={`Add ${p.display_name || p.email}`} onClick={() => { close(); run({ add_assignees: [p.id] }, 'Assigned'); }} className="rounded px-1.5 text-xs text-indigo-600 hover:bg-indigo-50">Add</button>
              <button type="button" aria-label={`Remove ${p.display_name || p.email}`} onClick={() => { close(); run({ remove_assignees: [p.id] }, 'Updated'); }} className="rounded px-1.5 text-xs text-gray-500 hover:bg-gray-100">Remove</button>
            </div>
          ))}
        </Popover>

        <Popover label="Set priority" icon={<Flag size={14} />} text="Priority" up dark width={180}>
          {(close) => (
            <>
              {[1, 2, 3, 4].map((p) => (
                <button key={p} type="button" className={item} onClick={() => { close(); run({ priority: p }, 'Updated'); }}>
                  <Flag size={13} style={{ color: PRIORITIES[p].color }} fill={PRIORITIES[p].color} /> {PRIORITIES[p].label}
                </button>
              ))}
              <button type="button" className={item} onClick={() => { close(); run({ priority: null }, 'Updated'); }}><X size={13} /> Clear</button>
            </>
          )}
        </Popover>

        <Popover label="Set due date" icon={<CalendarDays size={14} />} text="Due date" up dark width={220}>
          {(close) => (
            <>
              <input type="date" aria-label="New due date" className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-800"
                onChange={(e) => { const v = fromDateInput(e.target.value); if (v) { close(); run({ due_date: v }, 'Updated'); } }} />
              <button type="button" className={`${item} mt-1`} onClick={() => { close(); run({ due_date: null }, 'Updated'); }}><X size={13} /> Remove due date</button>
            </>
          )}
        </Popover>

        <Popover label="Tags" icon={<TagIcon size={14} />} text="Tags" up dark width={240}>
          {(close) => (
            <form onSubmit={(e) => { e.preventDefault(); if (tag.trim()) { close(); run({ add_tags: [tag.trim()] }, 'Tagged'); setTag(''); } }}>
              <input autoFocus aria-label="Tag name" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag name" className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-800" />
              <div className="mt-2 flex gap-1">
                <button type="submit" disabled={!tag.trim()} className="flex-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40">Add tag</button>
                <button type="button" disabled={!tag.trim()} onClick={() => { close(); run({ remove_tags: [tag.trim()] }, 'Updated'); setTag(''); }} className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-40">Remove tag</button>
              </div>
            </form>
          )}
        </Popover>

        <Popover label="Move to List" icon={<MoveRight size={14} />} text="Move" up dark width={280}>
          {(close) => lists.map((l) => (
            <button key={l.id} type="button" className={item} onClick={() => { close(); run({ list_id: l.id }, 'Moved'); }}>{l.label}</button>
          ))}
        </Popover>

        <button type="button" onClick={() => run({ archived: true }, 'Archived')} className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-gray-100 hover:bg-white/10"><Archive size={14} /> Archive</button>
        <button type="button" onClick={() => window.confirm(`Delete ${selected.length} task${selected.length === 1 ? '' : 's'} and their subtasks? This cannot be undone.`) && run({ delete: true }, 'Deleted')}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-red-300 hover:bg-white/10"><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  );
};
