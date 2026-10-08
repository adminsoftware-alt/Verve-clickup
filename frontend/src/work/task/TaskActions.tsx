import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Bell, Copy, Eye, EyeOff, GitMerge, LayoutTemplate, Link2, ListPlus, MoreHorizontal, MoveRight, Star, Trash2, Users, X } from 'lucide-react';
import { ShareWithPeople } from './ShareWithPeople';
import { spacesApi } from '../spacesApi';
import { FEATURES } from '../../config/features';
import { PeoplePicker } from '../PeoplePicker';
import { ALL_PARTS, PART_LABELS, type CopyParts } from './CopyParts';
import { notify } from '../../components/notify';
import { SaveTemplateDialog } from '../templates/Templates';
import { MergeDialog } from './TaskLinks';
import { ListPicker } from './ListPicker';
import { useFavorites } from '../Favorites';
import { useWork, useMe } from '../WorkContext';
import { collabApi } from '../collabApi';
import { workApi, type FolderNode, type ListNode, type SpaceNode, type TaskDetail } from '../api';
import { Avatar, Menu, Portal } from '../ui';

const Dialog: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <Portal>
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()} className="w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  </Portal>
);

/** Every List you can add tasks to, labelled by its path. */
export function useWritableLists(): { id: string; label: string }[] {
  const { hierarchy } = useWork();
  return useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (node: SpaceNode | FolderNode, path: string[]) => {
      node.folders.forEach((f) => walk(f, [...path, f.name]));
      node.lists.forEach((l: ListNode) => { if (l.permission_level === 'full') out.push({ id: l.id, label: [...path, l.name].join(' / ') }); });
    };
    hierarchy?.spaces.forEach((sp) => walk(sp, [sp.name]));
    if (hierarchy?.personal_list) out.push({ id: hierarchy.personal_list.id, label: 'Personal List' });
    return out;
  }, [hierarchy]);
}

const MoveDialog: React.FC<{ task: TaskDetail; mode: 'move' | 'duplicate'; onClose: () => void; onDone: (id: string) => void }> = ({ task, mode, onClose, onDone }) => {
  const lists = useWritableLists();
  const [target, setTarget] = useState(task.list_id);
  const [name, setName] = useState(`${task.name} (copy)`);
  const [parts, setParts] = useState<CopyParts>(ALL_PARTS);
  const [custom, setCustom] = useState(false);
  // Into a List, or onto people's own lists. The second is how "give everyone their own" works.
  const [where, setWhere] = useState<'list' | 'people'>('list');
  const [people, setPeople] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof CopyParts, on: boolean) => setParts((p) => ({ ...p, [key]: on }));

  const go = async () => {
    setBusy(true);
    setError(null);
    const body = { name, include_subtasks: parts.subtasks, parts };
    try {
      if (mode === 'move') { onDone((await collabApi.moveTask(task.id, target)).id); return; }
      if (where === 'people') {
        const out = await collabApi.duplicateToPeople(task.id, { ...body, user_ids: people });
        notify.ok(`A copy each for ${out.people.length} ${out.people.length === 1 ? 'person' : 'people'}.`);
        onDone(task.id);
        return;
      }
      onDone((await collabApi.duplicateTask(task.id, { ...body, list_id: target })).id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (mode === 'move') {
    return (
      <Dialog title="Move task" onClose={onClose}>
        <ListPicker label="Move to List" lists={lists} value={target} currentId={task.list_id} onChange={setTarget} />
        <p className="mt-2 text-xs text-gray-500">
          Subtasks move with it. A status the new List does not have is matched by name, or by the
          state it is in.
        </p>
        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="button" disabled={target === task.list_id || busy} onClick={go} className="btn-accent rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50">Move</button>
        </div>
      </Dialog>
    );
  }

  const tab = (on: boolean) =>
    `flex-1 rounded-md px-3 py-1.5 text-sm ${on ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`;

  return (
    <Dialog title="Duplicate task" onClose={onClose}>
      <label className="block text-xs font-medium text-gray-600">Name
        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal" />
      </label>

      {/* Two different things wear the word "duplicate": one task somewhere else, or one each for
          a group of people. Asking which is cheaper than guessing. */}
      <div className="mt-3">
        <span className="text-xs font-medium text-gray-600">Where should the copy go?</span>
        <div className="mt-1 flex gap-1 rounded-lg bg-gray-100 p-1">
          <button type="button" onClick={() => setWhere('list')} className={tab(where === 'list')}>Into a List</button>
          <button type="button" onClick={() => setWhere('people')} className={tab(where === 'people')}>A copy each, to people</button>
        </div>
      </div>

      {where === 'list' ? (
        <div className="mt-3"><ListPicker label="Into List" lists={lists} value={target} currentId={task.list_id} onChange={setTarget} /></div>
      ) : (
        <div className="mt-3">
          <PeoplePicker chosen={people} onChange={setPeople} label="A copy each for" maxHeight={180} />
          <p className="mt-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900">
            Separate tasks from here on: what one person does to theirs leaves the rest alone. If
            it is one job several people are on, use <b>Share with people</b> instead, so the hours
            add up to the job rather than to copies of it.
          </p>
        </div>
      )}

      <div className="mt-4">
        <span className="text-xs font-medium text-gray-600">What would you like to copy?</span>
        <div className="mt-1 flex gap-1 rounded-lg bg-gray-100 p-1">
          <button type="button" onClick={() => { setCustom(false); setParts(ALL_PARTS); }} className={tab(!custom)}>Everything</button>
          <button type="button" onClick={() => setCustom(true)} className={tab(custom)}>Customize</button>
        </div>
      </div>

      {custom ? (
        <div className="mt-2 rounded-lg border border-gray-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Customize what is copied</span>
            <button
              type="button"
              onClick={() => setParts(Object.fromEntries(Object.keys(ALL_PARTS).map((k) => [k, false])) as unknown as CopyParts)}
              className="text-xs font-medium text-brand-600 hover:text-brand-800"
            >
              Unselect all
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {PART_LABELS.map((row) => {
              const blocked = row.under ? !parts[row.under] : false;
              return (
                <label key={row.key} className={`flex items-center gap-2 text-sm ${blocked ? 'text-gray-400' : 'text-gray-800'} ${row.under ? 'pl-5' : ''}`}>
                  <input type="checkbox" checked={parts[row.key]} disabled={blocked} onChange={(e) => set(row.key, e.target.checked)} />
                  {row.label}
                </label>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-gray-500">
          Everything except the comments and the ticked checklist items, which belong to the task
          that already happened.
        </p>
      )}

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        <button
          type="button"
          disabled={busy || (where === 'people' && people.length === 0)}
          onClick={go}
          className="btn-accent rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Duplicating\u2026' : where === 'people' ? `Duplicate to ${people.length || ''}`.trim() : 'Duplicate'}
        </button>
      </div>
    </Dialog>
  );
};

/**
 * Put a task in a second List without moving it.
 *
 * It keeps one home List -- its statuses, its custom ID and its fields come from there -- and
 * simply also shows in the other. One task, two places, not a copy.
 */
const AddToListDialog: React.FC<{ task: TaskDetail; onClose: () => void; onDone: () => void }> = ({ task, onClose, onDone }) => {
  const lists = useWritableLists();
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try { await spacesApi.addToList(task.id, target); onDone(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <Dialog title="Also show in another List" onClose={onClose}>
      <p className="mb-3 text-xs text-gray-500">
        The task stays where it is and also appears in the List you pick. Its statuses and custom
        ID keep coming from its home List.
      </p>
      <ListPicker label="Show it in" lists={lists} value={target} currentId={task.list_id} onChange={setTarget} />
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        <button type="button" disabled={!target || busy} onClick={go} className="btn-accent rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
          {busy ? 'Adding…' : 'Add to List'}
        </button>
      </div>
    </Dialog>
  );
};

const QUICK = [
  { label: 'In 1 hour', at: () => new Date(Date.now() + 3600_000) },
  { label: 'Later today (5 pm)', at: () => { const d = new Date(); d.setHours(17, 0, 0, 0); return d; } },
  { label: 'Tomorrow 9 am', at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
  { label: 'Next Monday 9 am', at: () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d; } },
];
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export const ReminderDialog: React.FC<{ taskId?: string; defaultTitle?: string; onClose: () => void; onDone: () => void }> = ({ taskId, defaultTitle, onClose, onDone }) => {
  const { workspace, members } = useWork();
  const [title, setTitle] = useState(defaultTitle ?? '');
  const [at, setAt] = useState(toLocalInput(QUICK[2].at()));
  const [who, setWho] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!workspace) return;
    try {
      await collabApi.addReminder(workspace.id, { title: title || undefined, task_id: taskId, remind_at: new Date(at).toISOString(), user_id: who || undefined });
      onDone();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Dialog title="Set a reminder" onClose={onClose}>
      <label className="block text-xs font-medium text-gray-600">Remind me about
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={taskId ? 'This task' : 'e.g. Call the vendor'} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal" />
      </label>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {QUICK.map((q) => <button key={q.label} type="button" onClick={() => setAt(toLocalInput(q.at()))} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700 hover:bg-gray-200">{q.label}</button>)}
      </div>
      <label className="mt-3 block text-xs font-medium text-gray-600">When
        <input type="datetime-local" aria-label="Remind at" value={at} onChange={(e) => setAt(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal" />
      </label>
      <label className="mt-3 block text-xs font-medium text-gray-600">For
        <select value={who} onChange={(e) => setWho(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal">
          <option value="">Me</option>
          {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.display_name || m.user.email}</option>)}
        </select>
      </label>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        <button type="button" onClick={save} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Set reminder</button>
      </div>
    </Dialog>
  );
};

/** Header controls of the task view: watch, and the "…" menu. */
export const TaskActions: React.FC<{
  task: TaskDetail; onChanged: () => void; onReload: () => void; onOpen: (id: string) => void; onDeleted: () => void;
}> = ({ task, onChanged, onReload, onOpen, onDeleted }) => {
  const [watch, setWatch] = useState<{ watchers: { id: string; email: string; display_name: string | null }[]; watching: boolean } | null>(null);
  const [dialog, setDialog] = useState<'move' | 'duplicate' | 'remind' | 'template' | 'merge' | 'share' | 'add-list' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const favorites = useFavorites();
  const me = useMe();
  useEffect(() => { collabApi.watchers(task.id).then(setWatch).catch(() => undefined); }, [task.id]);
  const editable = task.permission_level === 'edit' || task.permission_level === 'full';
  const full = task.permission_level === 'full';
  const toggleWatch = async () => {
    if (!watch) return;
    const out = watch.watching ? await collabApi.unwatch(task.id, me) : await collabApi.watch(task.id);
    setWatch(out);
  };
  const flash = (text: string) => { setNote(text); setTimeout(() => setNote(null), 2500); };
  return (
    <>
      {note && <span className="mr-1 text-xs text-emerald-700">{note}</span>}
      {FEATURES.taskWatchers && (
        <>
          <button type="button" onClick={toggleWatch} title={watch?.watching ? 'Stop watching' : 'Watch this task'}
            className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs ${watch?.watching ? 'text-brand-600' : 'text-gray-400'} hover:bg-gray-100`}>
            {watch?.watching ? <Eye size={15} /> : <EyeOff size={15} />} {watch?.watchers.length ?? ''}
          </button>
          {watch && watch.watchers.length > 0 && (
            <span className="mr-1 hidden -space-x-1.5 sm:flex" title={watch.watchers.map((w) => w.display_name || w.email).join(', ')}>
              {watch.watchers.slice(0, 3).map((w) => <Avatar key={w.id} user={w} size={20} />)}
            </span>
          )}
        </>
      )}
      <button type="button" title="Set a reminder" onClick={() => setDialog('remind')} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Bell size={15} /></button>
      <Menu align="right" label="Task actions" items={[
        { label: 'Copy link', icon: <Link2 size={14} />, onClick: () => { navigator.clipboard?.writeText(`${window.location.origin}/l/${task.list_id}?task=${task.id}`); flash('Link copied'); } },
        { label: 'Duplicate', icon: <Copy size={14} />, onClick: () => setDialog('duplicate') },
        // Beside Duplicate on purpose: the two are the choice between a copy each and one task
        // between them, and that is a choice best made with both in front of you.
        ...(full ? [{ label: 'Share with people…', icon: <Users size={14} />, onClick: () => setDialog('share') }] : []),
        // The Spaces menu gates its own "Save as template" the same way; this one was missed,
        // which is why it was still on a task while the rest of templates was off.
        ...(FEATURES.templates ? [{ label: 'Save as template', icon: <LayoutTemplate size={14} />, onClick: () => setDialog('template') }] : []),
        { label: favorites.isFavorite('task', task.id) ? 'Remove from Favourites' : 'Add to Favourites', icon: <Star size={14} />, onClick: () => favorites.toggle('task', task.id) },
        // 'Add to my LineUp' was here. The LineUp itself still works from My Tasks.
        ...[],
        ...(editable ? [{ label: 'Move to…', icon: <MoveRight size={14} />, onClick: () => setDialog('move') }] : []),
        // A task can show in more than one List while keeping one home. Rare, so it lives here
        // rather than as a control under every task.
        ...(full && !task.parent_id ? [{ label: 'Also show in another List…', icon: <ListPlus size={14} />, onClick: () => setDialog('add-list') }] : []),
        ...(editable ? [{ label: 'Merge duplicates…', icon: <GitMerge size={14} />, onClick: () => setDialog('merge') }] : []),
        ...(editable ? [{
          label: task.archived ? 'Restore' : 'Archive', icon: task.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />,
          onClick: () => workApi.updateTask(task.id, { archived: !task.archived }).then(() => { onReload(); onChanged(); }),
        }] : []),
        ...(full ? [{ label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: onDeleted }] : []),
      ]} trigger={<span className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><MoreHorizontal size={16} /></span>} />
      {(dialog === 'move' || dialog === 'duplicate') && (
        <MoveDialog task={task} mode={dialog} onClose={() => setDialog(null)} onDone={(id) => { setDialog(null); onChanged(); if (id !== task.id) onOpen(id); else onReload(); }} />
      )}
      {dialog === 'share' && (
        <ShareWithPeople
          taskId={task.id}
          taskName={task.name}
          canManage={full}
          onClose={() => setDialog(null)}
          onChanged={() => { onReload(); onChanged(); }}
        />
      )}
      {dialog === 'add-list' && <AddToListDialog task={task} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onReload(); onChanged(); }} />}
      {dialog === 'merge' && <MergeDialog task={task} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onReload(); onChanged(); }} />}
      {FEATURES.templates && dialog === 'template' && <SaveTemplateDialog kind="task" id={task.id} name={task.name} onClose={() => setDialog(null)} />}
      {dialog === 'remind' && <ReminderDialog taskId={task.id} defaultTitle={task.name} onClose={() => setDialog(null)} onDone={() => { setDialog(null); flash('Reminder set'); }} />}
    </>
  );
};
