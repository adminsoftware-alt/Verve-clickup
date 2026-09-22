import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Bell, Copy, Eye, EyeOff, GitMerge, LayoutTemplate, Link2, ListOrdered, MoreHorizontal, MoveRight, Star, Trash2, X } from 'lucide-react';
import { SaveTemplateDialog } from '../templates/Templates';
import { MergeDialog } from './TaskLinks';
import { useFavorites } from '../Favorites';
import { useWork, useMe } from '../WorkContext';
import { collabApi } from '../collabApi';
import { planningApi } from '../planningApi';
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
  const [subtasks, setSubtasks] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    try {
      const out = mode === 'move'
        ? await collabApi.moveTask(task.id, target)
        : await collabApi.duplicateTask(task.id, { name, include_subtasks: subtasks, list_id: target });
      onDone(out.id);
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Dialog title={mode === 'move' ? 'Move task' : 'Duplicate task'} onClose={onClose}>
      {mode === 'duplicate' && (
        <label className="mb-3 block text-xs font-medium text-gray-600">Name
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal" />
        </label>
      )}
      <label className="block text-xs font-medium text-gray-600">{mode === 'move' ? 'Move to List' : 'Into List'}
        <select aria-label="List" value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal">
          {lists.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>
      {mode === 'duplicate' && (
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={subtasks} onChange={(e) => setSubtasks(e.target.checked)} /> Include subtasks</label>
      )}
      {mode === 'move' && <p className="mt-2 text-xs text-gray-500">Subtasks move with it. Statuses the new List doesn't have are matched by name or type.</p>}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        <button type="button" disabled={mode === 'move' && target === task.list_id} onClick={go} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {mode === 'move' ? 'Move' : 'Duplicate'}
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
        <button type="button" onClick={save} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Set reminder</button>
      </div>
    </Dialog>
  );
};

/** Header controls of the task view: watch, and the "…" menu. */
export const TaskActions: React.FC<{
  task: TaskDetail; onChanged: () => void; onReload: () => void; onOpen: (id: string) => void; onDeleted: () => void;
}> = ({ task, onChanged, onReload, onOpen, onDeleted }) => {
  const [watch, setWatch] = useState<{ watchers: { id: string; email: string; display_name: string | null }[]; watching: boolean } | null>(null);
  const [dialog, setDialog] = useState<'move' | 'duplicate' | 'remind' | 'template' | 'merge' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const favorites = useFavorites();
  const { workspace } = useWork();
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
      <button type="button" onClick={toggleWatch} title={watch?.watching ? 'Stop watching' : 'Watch this task'}
        className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs ${watch?.watching ? 'text-indigo-600' : 'text-gray-400'} hover:bg-gray-100`}>
        {watch?.watching ? <Eye size={15} /> : <EyeOff size={15} />} {watch?.watchers.length ?? ''}
      </button>
      {watch && watch.watchers.length > 0 && (
        <span className="mr-1 hidden -space-x-1.5 sm:flex" title={watch.watchers.map((w) => w.display_name || w.email).join(', ')}>
          {watch.watchers.slice(0, 3).map((w) => <Avatar key={w.id} user={w} size={20} />)}
        </span>
      )}
      <button type="button" title="Set a reminder" onClick={() => setDialog('remind')} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Bell size={15} /></button>
      <Menu align="right" label="Task actions" items={[
        { label: 'Copy link', icon: <Link2 size={14} />, onClick: () => { navigator.clipboard?.writeText(`${window.location.origin}/l/${task.list_id}?task=${task.id}`); flash('Link copied'); } },
        { label: 'Duplicate', icon: <Copy size={14} />, onClick: () => setDialog('duplicate') },
        { label: 'Save as template', icon: <LayoutTemplate size={14} />, onClick: () => setDialog('template') },
        { label: favorites.isFavorite('task', task.id) ? 'Remove from Favourites' : 'Add to Favourites', icon: <Star size={14} />, onClick: () => favorites.toggle('task', task.id) },
        ...(workspace ? [{ label: 'Add to my LineUp', icon: <ListOrdered size={14} />, onClick: () => planningApi.addToLineup(workspace.id, task.id)
          .then(() => { flash('Added to your LineUp'); window.dispatchEvent(new Event('timetriq:lineup')); }).catch((e: Error) => flash(e.message)) }] : []),
        ...(editable ? [{ label: 'Move to…', icon: <MoveRight size={14} />, onClick: () => setDialog('move') }] : []),
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
      {dialog === 'merge' && <MergeDialog task={task} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onReload(); onChanged(); }} />}
      {dialog === 'template' && <SaveTemplateDialog kind="task" id={task.id} name={task.name} onClose={() => setDialog(null)} />}
      {dialog === 'remind' && <ReminderDialog taskId={task.id} defaultTitle={task.name} onClose={() => setDialog(null)} onDone={() => { setDialog(null); flash('Reminder set'); }} />}
    </>
  );
};
