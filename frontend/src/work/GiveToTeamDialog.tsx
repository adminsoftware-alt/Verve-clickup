// Hand a Space, Folder or List to a Team, so it is theirs to work in.
import React, { useState } from 'react';
import { Users, X } from 'lucide-react';

import { useWork, useMe } from './WorkContext';
import { workApi, type LocationKind } from './api';
import { Portal } from './ui';

export const GiveToTeamDialog: React.FC<{
  kind: LocationKind;
  id: string;
  name: string;
  /** The Team it belongs to now, if any. */
  current: string | null;
  onClose: () => void;
  onDone: () => void;
}> = ({ kind, id, name, current, onClose, onDone }) => {
  const { teams, hierarchy } = useWork();
  const meId = useMe();
  const isAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
  const choices = teams.filter((t) => isAdmin || t.lead_ids.includes(meId));
  const [picked, setPicked] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (teamId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await workApi.giveToTeam(kind, id, teamId);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const what = kind === 'space' ? 'Space' : kind === 'folder' ? 'Folder' : 'List';

  return (
    <Portal>
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
        <div role="dialog" aria-label="Give to a Team" onMouseDown={(e) => e.stopPropagation()} className="w-[28rem] max-w-full rounded-xl bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <h3 className="truncate font-semibold text-gray-900">Give “{name}” to a Team</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </header>
          <div className="px-5 py-4">
            <p className="mb-3 text-xs text-gray-500">
              Only that Team's people will see this {what} — sub-teams count, and owners and admins keep
              seeing everything. Anyone it was shared with by name keeps their access.
              {!isAdmin && ' You can give work to the Teams you lead.'}
            </p>
            <div className="max-h-60 overflow-y-auto rounded-md border border-gray-200" role="radiogroup" aria-label="Teams">
              {choices.length === 0 && <p className="px-3 py-3 text-sm text-gray-400">You don't lead a Team yet.</p>}
              {choices.map((team) => (
                <label key={team.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
                  <input type="radio" name="team" checked={picked === team.id} onChange={() => setPicked(team.id)} />
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gray-100 text-gray-500"><Users size={13} /></span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{team.name}</span>
                  <span className="text-xs text-gray-400">{team.members.length}</span>
                </label>
              ))}
            </div>
            {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
          <footer className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            {current ? (
              <button type="button" disabled={busy} onClick={() => save(null)} className="text-sm text-red-600 hover:underline">
                Give back to everyone
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button
                type="button"
                disabled={!picked || picked === current || busy}
                onClick={() => save(picked)}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Give to Team
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Portal>
  );
};
