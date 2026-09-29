// Sharing one task with people -- the same task, not a copy of it.
//
// A duplicate would drift: two people tracking against two rows, an estimate compared with half
// the real time, twice, and no way to say how long the work took. This puts the one task on each
// person's desk instead. An hour Harish logs is the hour Anjali sees, because they are looking at
// the same row.
import { Users, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { PeoplePicker } from '../PeoplePicker';
import { useWork } from '../WorkContext';
import { Avatar, Portal } from '../ui';
import { notify } from '../../components/notify';
import { spacesApi, type TaskShared } from '../spacesApi';

export const ShareWithPeople: React.FC<{
  taskId: string;
  taskName: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}> = ({ taskId, taskName, canManage, onClose, onChanged }) => {
  const { members } = useWork();
  const [shared, setShared] = useState<TaskShared | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [assign, setAssign] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { spacesApi.sharedWith(taskId).then(setShared).catch(() => undefined); }, [taskId]);

  const named = (id: string) => {
    const m = members.find((x) => x.user.id === id);
    return m ? (m.user.display_name || m.user.email) : id;
  };

  const run = async (fn: () => Promise<TaskShared>, said: string) => {
    setBusy(true);
    setError(null);
    try {
      setShared(await fn());
      setChosen([]);
      notify.ok(said);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
        <div
          role="dialog"
          aria-label="Share this task with people"
          onMouseDown={(e) => e.stopPropagation()}
          className="flex max-h-[90vh] w-[30rem] max-w-full flex-col rounded-xl bg-white p-5 shadow-xl"
        >
          <div className="mb-1 flex items-start justify-between gap-3">
            <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900"><Users size={17} /> Share this task</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>
          <p className="mb-3 truncate text-xs text-gray-500">{taskName}</p>

          <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-[12px] text-brand-900">
            This is the <b>same task</b>, not a copy. It appears on each person's own list, and time,
            comments and changes from any of them show for all of them.
          </div>

          {shared && shared.people.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Already shared with</p>
              <ul className="flex flex-wrap gap-1.5">
                {shared.people.map((id) => {
                  const m = members.find((x) => x.user.id === id);
                  return (
                    <li key={id} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 py-0.5 pl-0.5 pr-2 text-xs text-gray-700">
                      {m && <Avatar user={m.user} size={18} />}
                      {named(id)}
                      {canManage && (
                        <button
                          type="button"
                          aria-label={`Stop sharing with ${named(id)}`}
                          disabled={busy}
                          onClick={() => run(() => spacesApi.unshareWith(taskId, id), `${named(id)} no longer sees this task.`)}
                          className="text-gray-400 hover:text-red-600"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            <PeoplePicker chosen={chosen} onChange={setChosen} already={shared?.people ?? []} label="Share with" />
          </div>

          <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={assign} onChange={(e) => setAssign(e.target.checked)} className="mt-0.5" />
            <span>
              Assign it to them as well
              <span className="block text-xs text-gray-500">Work on someone's list with nobody's name on it is work nobody has been asked to do.</span>
            </span>
          </label>

          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Close</button>
            <button
              type="button"
              disabled={chosen.length === 0 || busy}
              onClick={() => run(
                () => spacesApi.shareWith(taskId, chosen, assign),
                `Shared with ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}.`,
              )}
              className="btn-accent rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {busy ? 'Sharing…' : `Share with ${chosen.length || ''}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
};
