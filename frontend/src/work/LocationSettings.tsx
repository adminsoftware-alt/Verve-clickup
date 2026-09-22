import React, { useEffect, useRef, useState } from 'react';
import { Diamond, Pencil, Plus, Trash2, X } from 'lucide-react';
import { workApi, type LocationKind, type TagUsage, type TaskType } from './api';
import { Portal, fromDateInput, toDateInput, useEscapeToClose } from './ui';
import { useWork } from './WorkContext';

const Shell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEscapeToClose(ref, onClose);
  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div ref={ref} role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
          className={`flex max-h-[88vh] ${wide ? 'w-[34rem]' : 'w-[28rem]'} max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white p-5 shadow-xl`}>
          <div className="mb-3 flex items-center">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <button type="button" title="Close" onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>
          {children}
        </div>
      </div>
    </Portal>
  );
};

const COLORS = ['#7c3aed', '#0ea5e9', '#16a34a', '#ea580c', '#db2777', '#4f46e5', '#0d9488', '#b45309', '#dc2626', '#64748b'];
const ICONS = ['', '📁', '🧑‍💼', '💼', '📊', '💰', '🧾', '🏢', '⚙️', '🚀', '📣', '🎯', '📚', '🛠️', '🤝'];
const input = 'mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal';

/** Space, Folder or List settings: name, colour, icon, description; the task ID prefix; List dates. */
export const LocationSettingsDialog: React.FC<{ kind: LocationKind; id: string; onClose: () => void }> = ({ kind, id, onClose }) => {
  const { refresh } = useWork();
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { workApi.location(kind, id).then(setForm).catch((e) => setError(e.message)); }, [kind, id]);
  const set = (patch: Record<string, unknown>) => setForm((f) => ({ ...(f ?? {}), ...patch }));
  const save = async () => {
    if (!form) return;
    const body: Record<string, unknown> = { name: form.name, color: form.color ?? null };
    if (kind !== 'folder') body.description = (form.description as string) || null;
    if (kind === 'space') { body.icon = (form.icon as string) || null; if (form.task_prefix) body.task_prefix = form.task_prefix; }
    if (kind === 'list') { body.start_date = form.start_date ?? null; body.due_date = form.due_date ?? null; }
    try {
      await workApi.updateLocation(kind, id, body);
      await refresh();
      // Open pages re-read their tasks (a new prefix changes every task's ID).
      window.dispatchEvent(new Event('timetriq:statuses'));
      onClose();
    } catch (e) { setError((e as Error).message); }
  };
  const label = kind === 'space' ? 'Space' : kind === 'folder' ? 'Folder' : 'List';
  return (
    <Shell title={`${label} settings`} onClose={onClose}>
      {!form ? <p className="text-sm text-gray-400">{error ?? 'Loading…'}</p> : (
        <div className="min-h-0 space-y-3 overflow-auto">
          <label className="block text-xs font-medium text-gray-600">Name
            <input aria-label="Name" value={(form.name as string) ?? ''} onChange={(e) => set({ name: e.target.value })} className={input} />
          </label>
          <div>
            <p className="text-xs font-medium text-gray-600">Colour</p>
            <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
              {COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={form.color === c} aria-label={c} onClick={() => set({ color: c })}
                  className={`h-6 w-6 rounded-full ${form.color === c ? 'ring-2 ring-gray-400 ring-offset-2' : ''}`} style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          {kind === 'space' && (
            <div>
              <p className="text-xs font-medium text-gray-600">Icon</p>
              <div className="mt-1 flex flex-wrap gap-1" role="radiogroup" aria-label="Icon">
                {ICONS.map((ic) => (
                  <button key={ic || 'letter'} type="button" role="radio" aria-checked={(form.icon ?? '') === ic} aria-label={ic || 'First letter'} onClick={() => set({ icon: ic || null })}
                    className={`flex h-8 w-8 items-center justify-center rounded-md border text-base ${(form.icon ?? '') === ic ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    {ic || <span className="text-xs font-bold text-gray-500">Aa</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {kind !== 'folder' && (
            <label className="block text-xs font-medium text-gray-600">Description
              <textarea aria-label="Description" rows={3} value={(form.description as string) ?? ''} onChange={(e) => set({ description: e.target.value })} className={input}
                placeholder={kind === 'space' ? 'What is this Space for?' : 'What is this List for?'} />
            </label>
          )}
          {kind === 'space' && (
            <label className="block text-xs font-medium text-gray-600">Task ID prefix
              <input aria-label="Task ID prefix" value={(form.task_prefix as string) ?? ''} onChange={(e) => set({ task_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) })} className={`${input} w-32 uppercase`} />
              <span className="mt-1 block font-normal text-gray-400">Tasks here get short IDs like {(form.task_prefix as string) || 'HR'}-12. Changing it updates every task.</span>
            </label>
          )}
          {kind === 'list' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-gray-600">Start date
                <input aria-label="List start date" type="date" value={toDateInput((form.start_date as string) ?? null)} onChange={(e) => set({ start_date: fromDateInput(e.target.value) })} className={input} />
              </label>
              <label className="block text-xs font-medium text-gray-600">Due date
                <input aria-label="List due date" type="date" value={toDateInput((form.due_date as string) ?? null)} onChange={(e) => set({ due_date: fromDateInput(e.target.value) })} className={input} />
              </label>
            </div>
          )}
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="button" onClick={save} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Save</button>
          </div>
        </div>
      )}
    </Shell>
  );
};

/** ClickUp's Tag Manager for a Space: rename (renaming onto another tag merges them), recolour, delete. */
export const TagManagerDialog: React.FC<{ spaceId: string; spaceName: string; canEdit: boolean; onClose: () => void }> = ({ spaceId, spaceName, canEdit, onClose }) => {
  const [tags, setTags] = useState<TagUsage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = () => workApi.spaceTags(spaceId).then(setTags).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [spaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (action: () => Promise<unknown>) => { setError(null); try { await action(); await load(); } catch (e) { setError((e as Error).message); } };
  return (
    <Shell title={`Tags in ${spaceName}`} onClose={onClose}>
      {error && <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ul className="min-h-0 flex-1 overflow-auto" aria-label="Tags">
        {tags === null ? <li className="text-sm text-gray-400">Loading…</li> : tags.length === 0 ? <li className="py-6 text-center text-sm text-gray-400">No tags yet.</li> : tags.map((t) => (
          <li key={t.id} className="group flex items-center gap-2 border-t border-gray-100 py-1.5 first:border-t-0">
            <label className="relative h-5 w-5 shrink-0 cursor-pointer rounded" style={{ backgroundColor: t.bg_color }} title="Colour">
              {canEdit && <input type="color" aria-label={`Colour of ${t.name}`} value={t.bg_color} onChange={(e) => run(() => workApi.updateTag(t.id, { bg_color: e.target.value }))} className="absolute inset-0 opacity-0" />}
            </label>
            <span className="rounded px-1.5 py-px text-xs font-medium" style={{ backgroundColor: t.bg_color, color: t.fg_color }}>{t.name}</span>
            <span className="text-xs text-gray-400">{t.task_count} task{t.task_count === 1 ? '' : 's'}</span>
            {canEdit && (
              <span className="ml-auto flex gap-1 opacity-60 group-hover:opacity-100">
                <button type="button" title={`Rename ${t.name}`} onClick={() => { const n = window.prompt('Rename tag (use another tag’s name to merge them)', t.name); if (n && n.trim() && n.trim() !== t.name) run(() => workApi.updateTag(t.id, { name: n.trim() })); }} className="rounded p-1 text-gray-400 hover:text-gray-700"><Pencil size={13} /></button>
                <button type="button" title={`Delete ${t.name}`} onClick={() => window.confirm(`Delete the tag “${t.name}” from every task in ${spaceName}?`) && run(() => workApi.deleteTag(t.id))} className="rounded p-1 text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) run(() => workApi.createTag(spaceId, { name: draft.trim() })).then(() => setDraft('')); }}>
          <input aria-label="New tag" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New tag" className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm" />
          <button type="submit" disabled={!draft.trim()} className="flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"><Plus size={13} /> Add</button>
        </form>
      )}
    </Shell>
  );
};

/** Workspace task types (ClickUp's "Task Types"): Task is built in; others get an icon; milestones show as diamonds. */
export const TaskTypesDialog: React.FC<{ onClose: () => void; onChanged: () => void }> = ({ onClose, onChanged }) => {
  const { workspace, hierarchy } = useWork();
  const isAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
  const [types, setTypes] = useState<TaskType[]>([]);
  const [name, setName] = useState('');
  const [milestone, setMilestone] = useState(false);
  const [color, setColor] = useState(COLORS[1]);
  const [error, setError] = useState<string | null>(null);
  const load = () => workspace && workApi.taskTypes(workspace.id).then(setTypes).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [workspace]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (action: () => Promise<unknown>) => { setError(null); try { await action(); await load(); onChanged(); } catch (e) { setError((e as Error).message); } };
  if (!workspace) return null;
  return (
    <Shell title="Task types" onClose={onClose}>
      <p className="mb-2 text-xs text-gray-500">“Task” is the default. Add types such as Milestone, Request or Bug to label work; milestones show as a diamond.</p>
      {error && <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ul className="space-y-1" aria-label="Task types">
        {types.map((t) => (
          <li key={t.id} className="group flex items-center gap-2 rounded-md border border-gray-100 px-2 py-1.5">
            <TypeIcon type={t} />
            <span className="flex-1 text-sm text-gray-800">{t.name}{t.is_milestone && <span className="ml-2 text-xs text-gray-400">milestone</span>}</span>
            {isAdmin && (
              <>
                <button type="button" title={`Rename ${t.name}`} onClick={() => { const n = window.prompt('Rename type', t.name); if (n && n.trim()) run(() => workApi.updateTaskType(workspace.id, t.id, { name: n.trim() })); }} className="text-gray-300 hover:text-gray-700"><Pencil size={13} /></button>
                <button type="button" title={`Delete ${t.name}`} onClick={() => window.confirm(`Delete the type “${t.name}”? Its tasks become plain tasks.`) && run(() => workApi.deleteTaskType(workspace.id, t.id))} className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>
              </>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(() => workApi.createTaskType(workspace.id, { name: name.trim(), color, is_milestone: milestone, icon: milestone ? 'diamond' : 'circle' })).then(() => { setName(''); setMilestone(false); }); }}>
          <div className="flex gap-2">
            <input aria-label="New task type" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Request" className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm" />
            <input type="color" aria-label="Type colour" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 rounded border border-gray-300" />
            <button type="submit" disabled={!name.trim()} className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">Add</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={milestone} onChange={(e) => setMilestone(e.target.checked)} /> Milestone (a key date, shown as a diamond)</label>
        </form>
      )}
    </Shell>
  );
};

export const TypeIcon: React.FC<{ type: TaskType; size?: number }> = ({ type, size = 13 }) => (
  type.is_milestone
    ? <Diamond size={size} style={{ color: type.color }} fill={type.color} aria-label={type.name} />
    : <span className="inline-block rounded-full" style={{ width: size - 3, height: size - 3, backgroundColor: type.color }} title={type.name} aria-label={type.name} />
);
