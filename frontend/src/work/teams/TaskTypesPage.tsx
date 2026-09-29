// Settings → Task Types.
//
// The types themselves have worked for a while, but the only way in was a dropdown on one task,
// which is a strange place to run a workspace's vocabulary from. This is the page: what types
// exist, what each is for, how many tasks wear it, and who may change it.
//
// Applying a type to a lot of tasks at once is not done here -- it is done where the tasks are.
// Select them in a List and the bulk bar sets the type, the same way it sets a status.
import { Diamond, Pencil, Plus, Shapes, Trash2, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { ask } from '../../components/ask';
import { notify } from '../../components/notify';
import { workApi, type TaskType } from '../api';
import { useHub } from './TeamsHub';

const COLORS = ['#6366f1', '#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#64748b'];
const input = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none';

const Icon: React.FC<{ type: Pick<TaskType, 'color' | 'is_milestone'>; size?: number }> = ({ type, size = 15 }) =>
  type.is_milestone
    ? <Diamond size={size} style={{ color: type.color }} fill={type.color} />
    : <span className="inline-block rounded-full" style={{ width: size - 3, height: size - 3, backgroundColor: type.color }} />;

interface Draft {
  id?: string;
  name: string;
  name_plural: string;
  description: string;
  color: string;
  is_milestone: boolean;
}

const EMPTY: Draft = { name: '', name_plural: '', description: '', color: COLORS[0], is_milestone: false };

const TypeForm: React.FC<{ draft: Draft; onSave: (d: Draft) => Promise<void>; onCancel: () => void }> = ({ draft, onSave, onCancel }) => {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  return (
    <form
      className="rounded-lg border border-gray-200 bg-gray-50/70 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!d.name.trim() || busy) return;
        setBusy(true);
        try { await onSave(d); } finally { setBusy(false); }
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-gray-600">
          Name
          <input autoFocus value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Client Request" className={`mt-1 ${input} font-normal`} />
        </label>
        <label className="text-xs font-medium text-gray-600">
          Plural <span className="font-normal text-gray-400">optional</span>
          <input value={d.name_plural} onChange={(e) => set({ name_plural: e.target.value })} placeholder="e.g. Client Requests" className={`mt-1 ${input} font-normal`} />
        </label>
      </div>
      <label className="mt-3 block text-xs font-medium text-gray-600">
        What it is for <span className="font-normal text-gray-400">optional</span>
        <input
          value={d.description}
          onChange={(e) => set({ description: e.target.value })}
          maxLength={200}
          placeholder="One line, for whoever meets this type in three months"
          className={`mt-1 ${input} font-normal`}
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600">Colour</span>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              onClick={() => set({ color: c })}
              className={`h-5 w-5 rounded-full ring-offset-1 ${d.color === c ? 'ring-2 ring-gray-500' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </span>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={d.is_milestone} onChange={(e) => set({ is_milestone: e.target.checked })} />
          Milestone <span className="text-xs text-gray-500">(a key date, shown as a diamond)</span>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="mr-auto flex items-center gap-1.5 text-sm text-gray-500">
          Preview <Icon type={d} /> <span className="text-gray-900">{d.name.trim() || 'Untitled'}</span>
        </span>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        <button type="submit" disabled={!d.name.trim() || busy} className="btn-accent rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
          {busy ? 'Saving…' : d.id ? 'Save changes' : 'Add type'}
        </button>
      </div>
    </form>
  );
};

export const TaskTypesPage: React.FC = () => {
  const { ws, isAdmin } = useHub();
  const [types, setTypes] = useState<TaskType[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    workApi.taskTypes(ws).then(setTypes).catch((e) => setError((e as Error).message));
  }, [ws]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, said: string) => {
    setError(null);
    try { await fn(); load(); setEditing(null); notify.ok(said); }
    catch (e) { setError((e as Error).message); }
  };

  const save = (d: Draft) => run(
    () => {
      const body = {
        name: d.name.trim(),
        name_plural: d.name_plural.trim() || null,
        description: d.description.trim() || null,
        color: d.color,
        is_milestone: d.is_milestone,
        icon: d.is_milestone ? 'diamond' : 'circle',
      };
      return d.id ? workApi.updateTaskType(ws, d.id, body) : workApi.createTaskType(ws, body);
    },
    d.id ? `“${d.name.trim()}” saved.` : `“${d.name.trim()}” added.`,
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><Shapes size={18} /> Task types</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          A task is a task by default. Types give the other shapes of work their own name and mark —
          a Milestone, a Client Request, a Monthly Filing — so a List can be read at a glance and
          filtered by what kind of thing each row is.
        </p>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            {types ? `${types.length + 1} types` : 'Loading…'}
          </span>
          {isAdmin && !editing && (
            <button type="button" onClick={() => setEditing({ ...EMPTY })} className="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-brand-600 hover:bg-brand-50">
              <Plus size={14} /> Create type
            </button>
          )}
        </div>

        <ul className="divide-y divide-gray-100" aria-label="Task types">
          {/* "Task" is not a row in the table; it is what a task is when nobody said otherwise. */}
          <li className="flex items-center gap-3 px-4 py-2.5">
            <span className="inline-block h-3 w-3 rounded-full border border-gray-300" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-gray-900">Task <span className="font-normal text-gray-400">default</span></span>
              <span className="block truncate text-xs text-gray-500">What a task is unless it is given another type. Built in, and not editable.</span>
            </span>
          </li>
          {(types ?? []).map((t) => (
            <li key={t.id} className="group flex items-center gap-3 px-4 py-2.5">
              <Icon type={t} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900">
                  {t.name}
                  {t.name_plural && <span className="ml-1.5 font-normal text-gray-400">/ {t.name_plural}</span>}
                  {t.is_milestone && <span className="ml-2 rounded bg-violet-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-violet-700">milestone</span>}
                </span>
                <span className="block truncate text-xs text-gray-500">{t.description || <span className="text-gray-400">No description.</span>}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-gray-500">
                {t.task_count === 0 ? <span className="text-gray-400">unused</span> : `${t.task_count} task${t.task_count === 1 ? '' : 's'}`}
              </span>
              {isAdmin && (
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    title={`Edit ${t.name}`}
                    onClick={() => setEditing({
                      id: t.id, name: t.name, name_plural: t.name_plural ?? '',
                      description: t.description ?? '', color: t.color, is_milestone: t.is_milestone,
                    })}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    title={`Delete ${t.name}`}
                    onClick={async () => await ask.confirm({
                      danger: true,
                      title: `Delete the type “${t.name}”?`,
                      body: t.task_count
                        ? `${t.task_count} task${t.task_count === 1 ? '' : 's'} use it. They stay, as plain tasks.`
                        : 'Nothing uses it.',
                    }) && run(() => workApi.deleteTaskType(ws, t.id), `“${t.name}” deleted.`)}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>

        {editing && (
          <div className="border-t border-gray-100 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {editing.id ? 'Edit type' : 'New type'}
              </span>
              <button type="button" title="Close" onClick={() => setEditing(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={14} /></button>
            </div>
            <TypeForm key={editing.id ?? 'new'} draft={editing} onSave={save} onCancel={() => setEditing(null)} />
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        To put a type on work that already exists, open a List, tick the tasks and use <b>Task type</b>
        {' '}in the bar at the bottom. {isAdmin ? '' : 'Only owners and admins can add or change types.'}
      </p>
    </div>
  );
};
