import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../components/AuthContext';
import { useWork, useMe } from './WorkContext';
import { workApi } from './api';
import { Avatar, Portal } from './ui';

/**
 * Hand a List to one person. Managers (Team leads) can pick people in the Teams they
 * lead; owners and admins anyone. The List becomes theirs to fill and work through.
 */
export const AssignListDialog: React.FC<{ listId: string; name: string; current: string | null; onClose: () => void; onDone: () => void }> = ({
  listId, name, current, onClose, onDone,
}) => {
  const { members, teams, hierarchy } = useWork();
  const { user } = useAuth();
  const meId = useMe();
  const isAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
  const ledPeople = new Set(teams.filter((t) => user && t.lead_ids.includes(meId)).flatMap((t) => t.members.map((m) => m.id)));
  const choices = members.filter((m) => m.role !== 'guest' && (isAdmin || m.user.id === meId || ledPeople.has(m.user.id)));
  const [picked, setPicked] = useState(current ?? '');
  const [isPrivate, setIsPrivate] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const save = (userId: string | null) => workApi.assignList(listId, userId, isPrivate).then(onDone).catch((e) => setError(e.message));

  return (
    <Portal>
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div role="dialog" aria-label="Assign List" onMouseDown={(e) => e.stopPropagation()} className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <h3 className="truncate font-semibold text-gray-900">Assign “{name}”</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </header>
          <div className="px-5 py-4">
            <p className="mb-3 text-xs text-gray-500">
              The person you pick gets full access: they can add tasks, assign themselves, track time and complete them. You keep access.
              {!isAdmin && ' You can assign to people in the Teams you lead.'}
            </p>
            <div className="max-h-60 overflow-y-auto rounded-md border border-gray-200" role="radiogroup" aria-label="Assign to">
              {choices.length === 0 && <p className="px-3 py-3 text-sm text-gray-400">No one you can assign to. Team leads can assign to their Team members.</p>}
              {choices.map((m) => (
                <label key={m.user.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
                  <input type="radio" name="assignee" checked={picked === m.user.id} onChange={() => setPicked(m.user.id)} />
                  <Avatar user={m.user} size={24} />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{m.user.display_name || m.user.email}</span>
                  {m.user.id === meId && <span className="text-xs text-gray-400">you</span>}
                </label>
              ))}
            </div>
            <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="mt-0.5" />
              <span>Only they (and you) can see this List<span className="block text-xs text-gray-500">Makes the List private. Untick to keep it visible to everyone who can see the Space.</span></span>
            </label>
            {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
          <footer className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            {current ? <button type="button" onClick={() => save(null)} className="text-sm text-red-600 hover:underline">Unassign</button> : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button type="button" disabled={!picked || picked === current} onClick={() => save(picked)} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">Assign</button>
            </div>
          </footer>
        </div>
      </div>
    </Portal>
  );
};
