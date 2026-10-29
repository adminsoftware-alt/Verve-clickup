import React, { useEffect, useRef, useState } from 'react';
import { Diamond, Pencil, Trash2, X } from 'lucide-react';
import { workApi, type TaskType } from './api';
import { Portal, useEscapeToClose } from './ui';
import { useWork } from './WorkContext';
import { ask } from '../components/ask';

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
            <button aria-label="Close" type="button" onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>
          {children}
        </div>
      </div>
    </Portal>
  );
};

const COLORS = ['#7c3aed', '#0ea5e9', '#16a34a', '#ea580c', '#db2777', '#4f46e5', '#0d9488', '#b45309', '#dc2626', '#64748b'];

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
                <button aria-label={`Rename ${t.name}`} type="button" onClick={async () => { const n = await ask.prompt('Rename type', t.name); if (n && n.trim()) run(() => workApi.updateTaskType(workspace.id, t.id, { name: n.trim() })); }} className="text-gray-300 hover:text-gray-700"><Pencil size={13} /></button>
                <button type="button" aria-label={`Delete ${t.name}`} onClick={async () => await ask.confirm({ danger: true, title: `Delete the type “${t.name}”? Its tasks become plain tasks.` }) && run(() => workApi.deleteTaskType(workspace.id, t.id))} className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>
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
            <button type="submit" disabled={!name.trim()} className="rounded-md bg-brand-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">Add</button>
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
    : <span className="inline-block rounded-full" style={{ width: size - 3, height: size - 3, backgroundColor: type.color }} aria-label={type.name} />
);
