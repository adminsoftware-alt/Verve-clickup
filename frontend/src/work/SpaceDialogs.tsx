// Dialogs for Space-level features: ClickApps (with "listed on All Spaces"), duplicating a Space,
// turning a Folder into a Sprint Folder, and a List's email address.
import React, { useEffect, useState } from 'react';
import { Copy, Mail, RefreshCw } from 'lucide-react';
import { workApi } from './api';
import { Buttons, Dialog } from './LocationDialogs';
import { DuplicateLocation } from './DuplicateLocation';
import { spacesApi, type ClickAppInfo, type ListEmail, type SprintSettings } from './spacesApi';

const HINTS: Record<string, string> = {
  priorities: 'Urgent, High, Normal, Low flags on tasks',
  tags: 'Tags on tasks',
  time_tracking: 'Timers and logged time',
  time_estimates: 'How long tasks should take',
  custom_task_ids: 'Short IDs such as HR-12',
  multiple_assignees: 'More than one person per task',
  custom_fields: 'New custom fields in this Space',
  multiple_lists: 'Add a task to more than one List',
  email_to_list: 'Each List can get an email address',
  sprint_points: 'Story points on tasks, for sprints',
};

export const ClickAppsDialog: React.FC<{ spaceId: string; name: string; canEdit: boolean; onClose: () => void; onSaved: () => void }> = ({ spaceId, name, canEdit, onClose, onSaved }) => {
  const [catalogue, setCatalogue] = useState<ClickAppInfo[]>([]);
  const [apps, setApps] = useState<Record<string, boolean>>({});
  const [discoverable, setDiscoverable] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([spacesApi.clickapps(), workApi.location('space', spaceId)]).then(([cat, sp]) => {
      setCatalogue(cat);
      setApps((sp.clickapps as Record<string, boolean>) ?? {});
      setDiscoverable(!!sp.discoverable);
      setIsPrivate(!!sp.is_private);
    }).catch((e) => setError(e.message));
  }, [spaceId]);
  const save = async () => {
    try {
      await workApi.updateLocation('space', spaceId, { clickapps: apps, ...(isPrivate ? { discoverable } : {}) });
      onSaved();
      onClose();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Dialog title={`ClickApps · ${name}`} onClose={onClose}>
      <p className="mb-2 text-xs text-gray-500">Switch features on or off for everything in this Space.</p>
      <ul className="min-h-0 space-y-1 overflow-auto" aria-label="ClickApps">
        {catalogue.map((c) => (
          <li key={c.name}>
            <label className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-gray-50">
              <input type="checkbox" className="mt-0.5" disabled={!canEdit} checked={apps[c.name] ?? c.default}
                onChange={(e) => setApps((a) => ({ ...a, [c.name]: e.target.checked }))} />
              <span>{c.label}<span className="block text-[11px] text-gray-400">{HINTS[c.name]}</span></span>
            </label>
          </li>
        ))}
      </ul>
      {isPrivate && (
        <label className="mt-2 flex items-start gap-2 border-t border-gray-100 pt-2 text-sm">
          <input type="checkbox" className="mt-0.5" disabled={!canEdit} checked={discoverable} onChange={(e) => setDiscoverable(e.target.checked)} />
          <span>List it on All Spaces<span className="block text-[11px] text-gray-400">People can see its name and ask to join</span></span>
        </label>
      )}
      {canEdit ? <Buttons onClose={onClose} onOk={save} ok="Save" error={error} /> : <p className="mt-3 text-xs text-gray-400">You need full access to change these.</p>}
    </Dialog>
  );
};

export const DuplicateSpaceDialog: React.FC<{ spaceId: string; name: string; onClose: () => void; onDone: (id: string) => void }> = ({ spaceId, name, onClose, onDone }) => (
  <DuplicateLocation
    kind="space"
    id={spaceId}
    name={name}
    onClose={onClose}
    onDone={onDone}
    run={(body) => spacesApi.duplicateSpace(spaceId, body)}
  />
);

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const SprintSettingsDialog: React.FC<{ folderId: string; name: string; onClose: () => void; onSaved: () => void }> = ({ folderId, name, onClose, onSaved }) => {
  const [form, setForm] = useState<SprintSettings>({ weeks: 2, start_weekday: 0, rollover: true, auto_complete: false, first_start: null });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    workApi.location('folder', folderId).then((f) => { if (f.sprint_settings) setForm((x) => ({ ...x, ...(f.sprint_settings as SprintSettings) })); }).catch(() => undefined);
  }, [folderId]);
  const save = async () => {
    try { await spacesApi.enableSprints(folderId, { ...form, first_start: form.first_start || null }); onSaved(); onClose(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Dialog title={`Sprints · ${name}`} onClose={onClose}>
      <p className="mb-3 text-xs text-gray-500">Each List in a Sprint Folder is a sprint with dates. Turn on the Sprint points ClickApp to estimate in points.</p>
      <label className="block text-sm text-gray-700">Sprint length
        <select aria-label="Sprint length" value={form.weeks} onChange={(e) => setForm({ ...form, weeks: Number(e.target.value) })} className="ml-2 rounded border border-gray-300 px-2 py-1 text-sm">
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} week{n > 1 ? 's' : ''}</option>)}
        </select>
      </label>
      <label className="mt-2 block text-sm text-gray-700">Starts on
        <select aria-label="Starts on" value={form.start_weekday} onChange={(e) => setForm({ ...form, start_weekday: Number(e.target.value) })} className="ml-2 rounded border border-gray-300 px-2 py-1 text-sm">
          {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </label>
      <label className="mt-2 block text-sm text-gray-700">First sprint starts
        <input type="date" aria-label="First sprint starts" value={form.first_start ?? ''} onChange={(e) => setForm({ ...form, first_start: e.target.value || null })} className="ml-2 rounded border border-gray-300 px-2 py-1 text-sm" />
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.rollover} onChange={(e) => setForm({ ...form, rollover: e.target.checked })} /> Move unfinished tasks to the next sprint</label>
      <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.auto_complete} onChange={(e) => setForm({ ...form, auto_complete: e.target.checked })} /> Complete sprints automatically when they end</label>
      <Buttons onClose={onClose} onOk={save} ok="Save" error={error} />
    </Dialog>
  );
};

export const ListEmailDialog: React.FC<{ listId: string; name: string; onClose: () => void }> = ({ listId, name, onClose }) => {
  const [info, setInfo] = useState<ListEmail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { spacesApi.listEmail(listId).then(setInfo).catch((e) => setError(e.message)); }, [listId]);
  const run = async (fn: () => Promise<ListEmail | unknown>) => {
    setError(null);
    try { const out = await fn(); setInfo(out && typeof out === 'object' && 'configured' in out ? (out as ListEmail) : await spacesApi.listEmail(listId)); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Dialog title={`Email to ${name}`} onClose={onClose}>
      <p className="text-sm text-gray-600">Emails sent to this address become tasks in the List: the subject is the name, the message the description, and attachments are attached. Only people in the workspace who can add tasks here can use it.</p>
      {info && !info.configured && <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">The server's inbox isn't set up yet (INBOUND_EMAIL_ADDRESS and IMAP settings), so no address can be given out.</p>}
      {info && !info.enabled && <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">Email to List is turned off in this Space's ClickApps.</p>}
      {info?.address ? (
        <div className="mt-3">
          <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5">
            <Mail size={14} className="text-gray-400" />
            <code className="min-w-0 flex-1 truncate text-sm" aria-label="List email address">{info.address}</code>
            <button type="button" title="Copy" onClick={() => { navigator.clipboard?.writeText(info.address!).catch(() => undefined); setCopied(true); }}
              className="rounded p-1 text-gray-500 hover:bg-gray-200"><Copy size={13} /></button>
          </div>
          {copied && <p className="mt-1 text-xs text-emerald-700">Copied</p>}
          <div className="mt-3 flex gap-2 text-xs">
            <button type="button" onClick={() => run(() => spacesApi.makeListEmail(listId, true))} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"><RefreshCw size={12} /> New address</button>
            <button type="button" onClick={() => run(() => spacesApi.removeListEmail(listId))} className="rounded border border-gray-300 px-2 py-1 text-red-600 hover:bg-red-50">Turn off</button>
          </div>
        </div>
      ) : info?.configured && info.enabled && (
        <button type="button" onClick={() => run(() => spacesApi.makeListEmail(listId))} className="mt-3 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Create an address</button>
      )}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Dialog>
  );
};
