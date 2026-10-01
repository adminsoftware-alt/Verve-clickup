// Duplicating a Space, a Folder or a List.
//
// One dialog for all three, and the same shape as the task one: a name, where it goes, and what
// comes with it. The destination matters most -- the old dialog had none, and the server took a
// destination and then copied beside the original anyway, so the only possible outcome was a
// second Folder sitting next to the first.
import { Copy, X } from 'lucide-react';
import React, { useMemo, useState } from 'react';

import { ALL_PARTS, PART_LABELS, type CopyParts } from './task/CopyParts';
import { PeoplePicker } from './PeoplePicker';
import { FEATURES } from '../config/features';
import { useWork } from './WorkContext';
import { Portal } from './ui';

export type LocationKind = 'space' | 'folder' | 'list';
const LABEL: Record<LocationKind, string> = { space: 'Space', folder: 'Folder', list: 'List' };

/** What the request carries. The server fills in the rest from its own defaults. */
export interface DuplicateRequest extends Record<string, unknown> {
  name: string;
  include_tasks: boolean;
  include_archived: boolean;
  statuses: boolean;
  views: boolean;
  automations: boolean;
  parts: CopyParts;
  space_id?: string;
  folder_id?: string;
  /** Empty means everyone who can already reach it. Naming people makes the copy theirs alone. */
  share_with: string[];
  share_level: 'view' | 'comment' | 'edit' | 'full';
}

/** The task-level parts that mean something inside a Space, Folder or List copy. */
const TASK_PARTS = PART_LABELS.filter((r) => r.key !== 'subtasks');

/** Everything the place itself carries, as against the tasks inside it. */
const PLACE_PARTS: { key: 'statuses' | 'views' | 'automations'; label: string; hint: string }[] = [
  { key: 'statuses', label: 'Its own statuses', hint: 'Only where it overrides the ones above it.' },
  { key: 'views', label: 'Saved views', hint: 'The groupings, filters and columns people settled on.' },
  // Automations are off the menus, so there is nothing here to tick. Copies still carry any
  // rule that exists, which is why the request still sends the flag.
  ...(FEATURES.automations
    ? [{ key: 'automations' as const, label: 'Automations', hint: 'The rules that run on this place.' }]
    : []),
];

export const DuplicateLocation: React.FC<{
  kind: LocationKind;
  id: string;
  name: string;
  onClose: () => void;
  onDone: (id: string) => void;
  run: (body: DuplicateRequest) => Promise<{ id: string }>;
}> = ({ kind, name, onClose, onDone, run }) => {
  const { hierarchy } = useWork();
  const [newName, setNewName] = useState(`${name} (copy)`);
  const [mode, setMode] = useState<'everything' | 'tasks' | 'custom'>('everything');
  const [parts, setParts] = useState<CopyParts>(ALL_PARTS);
  const [place, setPlace] = useState({ statuses: true, views: true, automations: true });
  const [tasks, setTasks] = useState(true);
  const [archived, setArchived] = useState(false);
  const [where, setWhere] = useState<string>('');
  const [audience, setAudience] = useState<'everyone' | 'people'>('everyone');
  const [people, setPeople] = useState<string[]>([]);
  const [level, setLevel] = useState<DuplicateRequest['share_level']>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Where it can go: a List into any Space or Folder, a Folder into any Space. A Space stays put,
  // since there is nothing above it to go into.
  const places = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (const sp of hierarchy?.spaces ?? []) {
      out.push({ value: `s:${sp.id}`, label: sp.name });
      const walk = (folders: { id: string; name: string; folders?: unknown[] }[], path: string) => {
        for (const f of folders) {
          out.push({ value: `f:${f.id}`, label: `${path} / ${f.name}` });
          walk((f.folders ?? []) as typeof folders, `${path} / ${f.name}`);
        }
      };
      walk((sp.folders ?? []) as { id: string; name: string }[], sp.name);
    }
    return out;
  }, [hierarchy]);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: DuplicateRequest = {
        name: newName.trim(),
        include_tasks: mode === 'everything' ? true : mode === 'tasks' ? true : tasks,
        include_archived: mode === 'custom' ? archived : false,
        statuses: mode === 'custom' ? place.statuses : mode === 'everything',
        views: mode === 'custom' ? place.views : mode === 'everything',
        automations: mode === 'custom' ? place.automations : mode === 'everything',
        parts: mode === 'custom' ? parts : ALL_PARTS,
        share_with: audience === 'people' ? people : [],
        share_level: level,
      };
      if (where.startsWith('s:')) body.space_id = where.slice(2);
      if (where.startsWith('f:')) body.folder_id = where.slice(2);
      onDone((await run(body)).id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const tab = (on: boolean) =>
    `flex-1 rounded-md px-3 py-1.5 text-sm ${on ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`;
  const field = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none';

  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
        <div
          role="dialog"
          aria-label={`Duplicate ${LABEL[kind]}`}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex max-h-[90vh] w-[32rem] max-w-full flex-col rounded-xl bg-white p-5 shadow-xl"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900"><Copy size={17} /> Duplicate {LABEL[kind]}</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
            <label className="block text-xs font-medium text-gray-600">
              New {LABEL[kind]} name
              <input value={newName} onChange={(e) => setNewName(e.target.value)} className={`mt-1 ${field} font-normal`} />
            </label>

            {kind !== 'space' && (
              <label className="mt-3 block text-xs font-medium text-gray-600">
                Where should this {LABEL[kind]} be created?
                <select value={where} onChange={(e) => setWhere(e.target.value)} className={`mt-1 ${field} font-normal`}>
                  <option value="">Beside the original</option>
                  {places
                    .filter((p) => kind === 'folder' ? p.value.startsWith('s:') : true)
                    .map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </label>
            )}

            {/* Duplicating something for one person used to mean duplicating it for the whole
                firm and then telling them where to look. */}
            <div className="mt-4">
              <span className="text-xs font-medium text-gray-600">Who is the copy for?</span>
              <div className="mt-1 flex gap-1 rounded-lg bg-gray-100 p-1">
                <button type="button" onClick={() => setAudience('everyone')} className={tab(audience === 'everyone')}>Everyone</button>
                <button type="button" onClick={() => setAudience('people')} className={tab(audience === 'people')}>Only these people</button>
              </div>
              {audience === 'everyone' ? (
                <p className="mt-2 text-xs text-gray-500">
                  Open to everyone who can already reach where it lands, like any other {LABEL[kind]}.
                </p>
              ) : (
                <div className="mt-2">
                  <PeoplePicker chosen={people} onChange={setPeople} label="Give the copy to" maxHeight={170} />
                  <label className="mt-2 flex items-center gap-2 text-xs font-medium text-gray-600">
                    They can
                    <select value={level} onChange={(e) => setLevel(e.target.value as DuplicateRequest['share_level'])} className="rounded-md border border-gray-300 px-2 py-1 text-sm font-normal">
                      <option value="view">look at it</option>
                      <option value="comment">comment on it</option>
                      <option value="edit">work in it</option>
                      <option value="full">run it</option>
                    </select>
                  </label>
                  <p className="mt-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900">
                    The copy becomes private and goes to just these people. Nobody else sees it —
                    not even people who can see the original.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4">
              <span className="text-xs font-medium text-gray-600">What would you like to copy?</span>
              <div className="mt-1 flex gap-1 rounded-lg bg-gray-100 p-1">
                <button type="button" onClick={() => setMode('everything')} className={tab(mode === 'everything')}>Everything</button>
                <button type="button" onClick={() => setMode('tasks')} className={tab(mode === 'tasks')}>Tasks only</button>
                <button type="button" onClick={() => setMode('custom')} className={tab(mode === 'custom')}>Customize</button>
              </div>
            </div>

            {mode === 'everything' && (
              <p className="mt-2 text-xs text-gray-500">
                {kind === 'space' ? 'Statuses, tags, ClickApps, custom fields, Folders and Lists' : 'Statuses, task groups, saved views, automations'}
                {kind === 'folder' ? ', its Lists' : ''} and every live task inside, with its dates, people,
                tags, checklists, attachments and relationships. Time already logged and the
                conversation are not copied — the copy is new work.
              </p>
            )}
            {mode === 'tasks' && (
              <p className="mt-2 text-xs text-gray-500">
                The tasks and nothing else: no saved views, no automations, no status set of its own.
              </p>
            )}

            {mode === 'custom' && (
              <div className="mt-2 space-y-3">
                <div className="rounded-lg border border-gray-200 p-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">The {LABEL[kind]} itself</span>
                  <div className="mt-1.5 space-y-1">
                    {PLACE_PARTS.map((row) => (
                      <label key={row.key} className="flex items-start gap-2 text-sm text-gray-800">
                        <input type="checkbox" checked={place[row.key]} onChange={(e) => setPlace((p) => ({ ...p, [row.key]: e.target.checked }))} className="mt-0.5" />
                        <span>{row.label}<span className="block text-[11px] text-gray-500">{row.hint}</span></span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">The tasks inside</span>
                    <button
                      type="button"
                      onClick={() => setParts(Object.fromEntries(Object.keys(ALL_PARTS).map((k) => [k, false])) as unknown as CopyParts)}
                      className="text-xs font-medium text-brand-600 hover:text-brand-800"
                    >
                      Unselect all
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-800">
                    <input type="checkbox" checked={tasks} onChange={(e) => setTasks(e.target.checked)} />
                    Copy the tasks at all
                  </label>
                  <div className={`mt-1 grid grid-cols-2 gap-x-4 gap-y-1 ${tasks ? '' : 'pointer-events-none opacity-40'}`}>
                    {TASK_PARTS.map((row) => {
                      const blocked = row.under ? !parts[row.under] : false;
                      return (
                        <label key={row.key} className={`flex items-center gap-2 text-sm ${blocked ? 'text-gray-400' : 'text-gray-800'} ${row.under ? 'pl-5' : ''}`}>
                          <input
                            type="checkbox"
                            checked={parts[row.key]}
                            disabled={blocked || !tasks}
                            onChange={(e) => setParts((p) => ({ ...p, [row.key]: e.target.checked }))}
                          />
                          {row.label}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 p-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Archived tasks</span>
                  <div className="mt-1.5 space-y-1">
                    <label className="flex items-center gap-2 text-sm text-gray-800">
                      <input type="radio" checked={!archived} onChange={() => setArchived(false)} name="archived" /> No
                    </label>
                    <label className="flex items-start gap-2 text-sm text-gray-800">
                      <input type="radio" checked={archived} onChange={() => setArchived(true)} name="archived" className="mt-0.5" />
                      <span>Yes, include them<span className="block text-[11px] text-gray-500">Finished work someone put away. A copy meant to be done again rarely wants it.</span></span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="button" disabled={!newName.trim() || busy} onClick={go} className="btn-accent rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
              {busy ? 'Duplicating…'
                : audience === 'people' && people.length ? `Duplicate for ${people.length}`
                : 'Duplicate'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
};
