import React, { useCallback, useEffect, useState } from 'react';
import { Folder, List as ListIcon, Trash2, X } from 'lucide-react';
import { workApi, type LocationKind, type TaskGroup } from './api';
import { Portal } from './ui';

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b'];
const WHERE: Record<LocationKind, string> = { space: 'Space', folder: 'Folder', list: 'List' };

/** Create and manage task groups ("Meetings", "Client calls") for a location. */
export const GroupsDialog: React.FC<{
  kind: LocationKind; id: string; name: string; canEdit: boolean; onClose: () => void; onChanged: () => void;
}> = ({ kind, id, name, canEdit, onClose, onChanged }) => {
  const [groups, setGroups] = useState<TaskGroup[] | null>(null);
  const [draft, setDraft] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => workApi.groups(kind, id).then(setGroups).catch((e) => setError(e.message)), [kind, id]);
  useEffect(() => { load(); }, [load]);
  const run = async (action: () => Promise<unknown>) => {
    try { setError(null); await action(); await load(); onChanged(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div role="dialog" aria-label="Task groups" onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-[30rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <h3 className="font-semibold text-gray-900">Task groups</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </header>
          <div className="overflow-y-auto px-5 py-4">
            <p className="mb-3 text-xs text-gray-500">
              Group similar tasks under one name, such as “Meetings” or “Client calls”. Groups made here can be used in every List inside “{name}”. Choose “Group by: Task group” to see tasks by group.
            </p>
            {canEdit && (
              <form className="mb-4 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) run(() => workApi.createGroup(kind, id, draft.trim(), color)).then(() => setDraft('')); }}>
                <input aria-label="New group name" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New group, e.g. Meetings" className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                <div className="flex gap-1" role="radiogroup" aria-label="Colour">
                  {COLORS.slice(0, 5).map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
                      className={`h-5 w-5 rounded-full ${color === c ? 'ring-2 ring-gray-900 ring-offset-1' : ''}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
                <button type="submit" disabled={!draft.trim()} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">Add</button>
              </form>
            )}
            {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {!groups ? <p className="text-sm text-gray-400">Loading…</p> : groups.length === 0 ? <p className="text-sm text-gray-400">No groups yet.</p> : (
              <ul className="divide-y divide-gray-100">
                {groups.map((g) => {
                  const own = g.location === kind && g.location_id === id;
                  return (
                    <li key={g.id} className="flex items-center gap-2 py-2">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
                      {own && canEdit ? (
                        <input
                          aria-label={`Rename ${g.name}`}
                          defaultValue={g.name}
                          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== g.name) run(() => workApi.updateGroup(g.id, { name: v })); }}
                          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-sm hover:border-gray-200 focus:border-indigo-400 focus:outline-none"
                        />
                      ) : <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{g.name}</span>}
                      <span className="flex shrink-0 items-center gap-1 text-xs text-gray-400" title={`Defined on this ${WHERE[g.location]}${own ? '' : ' above'}`}>
                        {g.location === 'list' ? <ListIcon size={12} /> : <Folder size={12} />} {own ? 'here' : `from ${WHERE[g.location]}`}
                      </span>
                      {own && canEdit && (
                        <button type="button" title={`Delete ${g.name}`} onClick={() => window.confirm(`Delete the “${g.name}” group? Its tasks are kept, just ungrouped.`) && run(() => workApi.deleteGroup(g.id))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
};
