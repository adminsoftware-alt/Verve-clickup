import React, { useMemo, useState } from 'react';
import { Archive, CalendarClock, CalendarDays, CalendarRange, CircleDot, Download, FileSpreadsheet, FileText, Diamond, Flag, MoveRight, Shapes, Tag as TagIcon, Timer, Trash2, UserPlus, X } from 'lucide-react';
import { workApi, type BulkEdit, type BulkResult, type Status, type Task, type UserRef } from '../api';
import { NoMatch, PRIORITIES, SearchBox, fromDateInput, matchesSearch, parseDuration } from '../ui';
import { PeopleTeamsSwitch, useAssignTeams, type PickMode } from '../task/PeopleTeams';
import { useWritableLists } from '../task/TaskActions';
import { useWork } from '../WorkContext';
import { Popover } from './ViewControls';
import { ask } from '../../components/ask';
import { planningApi } from '../planningApi';
import { exportTasks, taskRows } from './exportTasks';

/** Who to add to or take off every selected task, searchable; Enter adds the first match. */
const BulkPeople: React.FC<{ people: UserRef[]; onAdd: (ids: string[], who: string) => void; onRemove: (ids: string[]) => void }> = ({ people, onAdd, onRemove }) => {
  const [q, setQ] = useState('');
  // People one at a time, or a whole Team: everyone in it is added to (or taken off) every task.
  const [mode, setMode] = useState<PickMode>('people');
  const teams = useAssignTeams(mode === 'teams' ? q : '');
  const shown = people.filter((p) => matchesSearch(q, p.display_name, p.email));
  const row = (key: string, name: React.ReactNode, ids: string[], who: string) => (
    <div key={key} className="flex items-center gap-2 px-1 py-0.5 text-sm text-gray-700">
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <button type="button" aria-label={`Add ${who}`} onClick={() => onAdd(ids, who)} className="rounded px-1.5 text-xs text-brand-600 hover:bg-brand-50">Add</button>
      <button type="button" aria-label={`Remove ${who}`} onClick={() => onRemove(ids)} className="rounded px-1.5 text-xs text-gray-500 hover:bg-gray-100">Remove</button>
    </div>
  );
  return (
    <>
      <div className="mb-1.5"><PeopleTeamsSwitch mode={mode} onChange={setMode} /></div>
      <SearchBox value={q} onChange={setQ} label={mode === 'people' ? 'Search people' : 'Search Teams'} placeholder={mode === 'people' ? 'Search people…' : 'Search Teams…'} inset="lg"
        onEnter={mode === 'people' && shown[0] ? () => onAdd([shown[0].id], shown[0].display_name || shown[0].email) : undefined} />
      {mode === 'people' ? (
        <>
          {shown.map((p) => row(p.id, p.display_name || p.email, [p.id], p.display_name || p.email))}
          {shown.length === 0 && <NoMatch query={q} />}
        </>
      ) : (
        <>
          {teams.map((t) => row(t.id, <>{t.name} <span className="text-xs text-gray-400">{t.members.length}</span></>, t.members.map((u) => u.id), t.name))}
          {teams.length === 0 && <p className="px-1 py-2 text-xs text-gray-400">No Teams to pick from.</p>}
        </>
      )}
    </>
  );
};

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
  const [moveQ, setMoveQ] = useState('');
  const [estimate, setEstimate] = useState('');
  const lists = useWritableLists();
  const { taskTypes, workspace, listName } = useWork();
  // Add to Planner: the day and the hour to start, then each task in turn for its estimate (an
  // hour when it has none), back to back.
  const [planDay, setPlanDay] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [planAt, setPlanAt] = useState('09:00');
  const plan = async () => {
    if (!workspace) return;
    const [h, m] = planAt.split(':').map(Number);
    const [y, mo, d] = planDay.split('-').map(Number);
    let at = new Date(y, mo - 1, d, h, m);
    let made = 0;
    try {
      for (const t of selected) {
        const end = new Date(at.getTime() + (t.time_estimate_seconds || 3600) * 1000);
        await planningApi.addBlock(workspace.id, { task_id: t.id, start_at: at.toISOString(), end_at: end.toISOString() });
        at = end;
        made += 1;
      }
      setNote({ text: `Added ${made} to your Planner`, bad: false });
    } catch (e) {
      setNote({ text: made ? `Added ${made}; then: ${(e as Error).message}` : (e as Error).message, bad: true });
    }
  };
  const exportSelected = (format: 'xlsx' | 'csv' | 'pdf') =>
    exportTasks(format, `Selected tasks (${selected.length})`, taskRows(selected, [], people, listName), `Selected tasks (${selected.length})`);
  // Every word has to appear in the path, so "dev pms" finds "PMS - Dev" under a Dev Space.
  const matchingLists = useMemo(() => {
    const words = moveQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? lists.filter((l) => words.every((w) => l.label.toLowerCase().includes(w))) : lists;
  }, [lists, moveQ]);
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
      {/* The app's navy, so it stands apart from the white list it floats over. */}
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-0.5 rounded-2xl bg-[#1B2A4A] py-1.5 pl-1.5 pr-2 text-sm text-white shadow-[0_16px_40px_-10px_rgba(16,24,40,0.45),0_2px_6px_rgba(16,24,40,0.15)] ring-1 ring-white/10">
        <span className="mr-2 flex items-center gap-1 whitespace-nowrap rounded-xl bg-white py-1 pl-3 pr-1 font-semibold text-[#1B2A4A]">
          {selected.length} selected
          <button type="button" aria-label="Clear selection" onClick={onClear} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={13} /></button>
        </span>

        <Popover label="Set status" icon={<CircleDot size={14} />} text="Status" up dark width={220}>
          {(close) => statusNames.map((st) => (
            <button key={st.name} type="button" className={item} onClick={() => { close(); run({ status: st.name }, 'Updated'); }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: st.color }} /> {st.name}
            </button>
          ))}
        </Popover>

        <Popover label="Assignees" icon={<UserPlus size={14} />} text="Assignees" up dark width={260}>
          {(close) => (
            <BulkPeople people={people}
              onAdd={(ids) => { close(); run({ add_assignees: ids }, 'Assigned'); }}
              onRemove={(ids) => { close(); run({ remove_assignees: ids }, 'Updated'); }} />
          )}
        </Popover>

        {/* The reason a type exists is that a lot of tasks share one, so this is where it is
            really set: pick the rows, say what kind of thing they are. */}
        {taskTypes.length > 0 && (
          <Popover label="Set task type" icon={<Shapes size={14} />} text="Task type" up dark width={220}>
            {(close) => (
              <>
                {taskTypes.map((t) => (
                  <button key={t.id} type="button" className={item} onClick={() => { close(); run({ type_id: t.id }, 'Updated'); }}>
                    {t.is_milestone
                      ? <Diamond size={13} style={{ color: t.color }} fill={t.color} />
                      : <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />}
                    {t.name}
                  </button>
                ))}
                <button type="button" className={item} onClick={() => { close(); run({ type_id: null }, 'Updated'); }}>
                  <span className="inline-block h-2.5 w-2.5 rounded-full border border-gray-300" /> Task <span className="text-xs text-gray-400">default</span>
                </button>
              </>
            )}
          </Popover>
        )}

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

        <Popover label="Set start date" icon={<CalendarRange size={14} />} text="Start date" up dark width={220}>
          {(close) => (
            <>
              <input type="date" aria-label="New start date" className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-800"
                onChange={(e) => { const v = fromDateInput(e.target.value); if (v) { close(); run({ start_date: v }, 'Updated'); } }} />
              <button type="button" className={`${item} mt-1`} onClick={() => { close(); run({ start_date: null }, 'Updated'); }}><X size={13} /> Remove start date</button>
            </>
          )}
        </Popover>

        {/* Every new task needs an estimate now, so older work often has to be sized in batches. */}
        <Popover label="Set time estimate" icon={<Timer size={14} />} text="Estimate" up dark width={220}>
          {(close) => (
            <form onSubmit={(e) => {
              e.preventDefault();
              const seconds = parseDuration(estimate);
              if (seconds !== null && seconds > 0) { close(); run({ time_estimate_seconds: seconds }, 'Sized'); setEstimate(''); }
            }}>
              <input
                autoFocus aria-label="Time estimate" value={estimate} onChange={(e) => setEstimate(e.target.value)}
                placeholder="e.g. 2h 30m"
                className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-800"
              />
              <p className="mt-1 text-[11px] text-gray-400">Applied to every selected task.</p>
              <button type="submit" disabled={!parseDuration(estimate)} className="mt-2 w-full rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40">
                Set estimate
              </button>
            </form>
          )}
        </Popover>

        <Popover label="Tags" icon={<TagIcon size={14} />} text="Tags" up dark width={240}>
          {(close) => (
            <form onSubmit={(e) => { e.preventDefault(); if (tag.trim()) { close(); run({ add_tags: [tag.trim()] }, 'Tagged'); setTag(''); } }}>
              <input autoFocus aria-label="Tag name" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag name" className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-800" />
              <div className="mt-2 flex gap-1">
                <button type="submit" disabled={!tag.trim()} className="flex-1 rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40">Add tag</button>
                <button type="button" disabled={!tag.trim()} onClick={() => { close(); run({ remove_tags: [tag.trim()] }, 'Updated'); setTag(''); }} className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-40">Remove tag</button>
              </div>
            </form>
          )}
        </Popover>

        {/* Searchable, because a workspace with two hundred Lists makes a flat list of them
            a worse way to find one than scrolling the sidebar. */}
        <Popover label="Move to List" icon={<MoveRight size={14} />} text="Move" up dark width={300}>
          {(close) => (
            <div className="-m-1">
              <input
                autoFocus
                value={moveQ}
                onChange={(e) => setMoveQ(e.target.value)}
                placeholder="Search Lists…"
                aria-label="Search Lists"
                className="mb-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-800"
              />
              <div className="max-h-56 overflow-y-auto">
                {matchingLists.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-gray-400">No List matches.</p>
                ) : matchingLists.map((l) => {
                  const parts = l.label.split(' / ');
                  return (
                    <button
                      key={l.id}
                      type="button"
                      className={`${item} flex-col !items-start gap-0`}
                      onClick={() => { close(); setMoveQ(''); run({ list_id: l.id }, 'Moved'); }}
                    >
                      <span className="w-full truncate">{parts[parts.length - 1]}</span>
                      {parts.length > 1 && (
                        <span className="w-full truncate text-[11px] text-gray-400">{parts.slice(0, -1).join(' / ')}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Popover>

        <Popover label="Add to Planner" icon={<CalendarClock size={14} />} text="Planner" up dark width={230}>
          {(close) => (
            <form onSubmit={(e) => { e.preventDefault(); close(); plan(); }} className="space-y-2">
              <p className="text-xs text-gray-500">Blocks out each task for its estimate, one after another.</p>
              <div className="flex gap-1.5">
                <input type="date" aria-label="Day" value={planDay} onChange={(e) => setPlanDay(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-800" />
                <input type="time" aria-label="Starting at" value={planAt} onChange={(e) => setPlanAt(e.target.value)}
                  className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-800" />
              </div>
              <button type="submit" className="w-full rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white">Add {selected.length} to Planner</button>
            </form>
          )}
        </Popover>

        <Popover label="Export selected" icon={<Download size={14} />} text="Export" up dark width={190}>
          {(close) => (
            <>
              <button type="button" className={item} onClick={() => { close(); exportSelected('xlsx'); }}><FileSpreadsheet size={13} /> Excel</button>
              <button type="button" className={item} onClick={() => { close(); exportSelected('csv'); }}><FileSpreadsheet size={13} /> CSV</button>
              <button type="button" className={item} onClick={() => { close(); exportSelected('pdf'); }}><FileText size={13} /> PDF</button>
            </>
          )}
        </Popover>

        <span className="mx-1 h-5 w-px bg-white/15" aria-hidden />
        <button type="button" onClick={() => run({ archived: true }, 'Archived')} className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-gray-100 hover:bg-white/10"><Archive size={14} /> Archive</button>
        <button type="button" onClick={async () => await ask.confirm({ danger: true, title: `Delete ${selected.length} task${selected.length === 1 ? '' : 's'} and their subtasks? This cannot be undone.` }) && run({ delete: true }, 'Deleted')}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-red-300 hover:bg-white/10 hover:text-red-200"><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  );
};
