import React, { useEffect, useMemo, useState } from 'react';
import { ArchiveRestore, ArrowDown, ArrowUp, Folder, List as ListIcon, Plus, Trash2, X } from 'lucide-react';
import { useWork } from './WorkContext';
import { DuplicateLocation } from './DuplicateLocation';
import { collabApi } from './collabApi';
import { workApi, type FolderNode, type Hierarchy, type ListNode, type LocationKind, type SpaceNode, type StatusGroup } from './api';
import { Portal } from './ui';

export const Dialog: React.FC<{ title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }> = ({ title, wide, onClose, children }) => (
  <Portal>
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className={`${wide ? 'w-[34rem]' : 'w-[26rem]'} flex max-h-[85vh] max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white p-5 shadow-xl`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  </Portal>
);

export const Buttons: React.FC<{ onClose: () => void; onOk: () => void; ok: string; disabled?: boolean; error?: string | null }> = ({ onClose, onOk, ok, disabled, error }) => (
  <>
    {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
      <button type="button" disabled={disabled} onClick={onOk} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{ok}</button>
    </div>
  </>
);

const KIND_LABEL: Record<LocationKind, string> = { space: 'Space', folder: 'Folder', list: 'List' };

// --- statuses ------------------------------------------------------------------------------------

const GROUPS: { key: StatusGroup; label: string; hint: string }[] = [
  { key: 'not_started', label: 'Not started', hint: 'Work that hasn’t begun' },
  { key: 'active', label: 'Active', hint: 'Work in progress' },
  { key: 'done', label: 'Done', hint: 'Finished, but still open (e.g. review)' },
  { key: 'closed', label: 'Closed', hint: 'Exactly one: the final status' },
];
const SWATCHES = ['#87909e', '#5f55ee', '#1090e0', '#0f9d9f', '#008844', '#e16b16', '#ee5e99', '#d33d44', '#b660e0', '#f8ae00'];

interface Row { key: string; id?: string; name: string; color: string; group: StatusGroup }

/** ClickUp's "Edit statuses": the set a Space owns, or a Folder/List's own set, or "inherit from parent". */
export const StatusEditorDialog: React.FC<{ kind: LocationKind; id: string; name: string; onClose: () => void; onSaved: () => void }> = ({ kind, id, name, onClose, onSaved }) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [inherit, setInherit] = useState(false);
  const [source, setSource] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { locate } = useWork();
  useEffect(() => {
    workApi.statuses(kind, id).then((set) => {
      setRows(set.statuses.map((st) => ({ key: st.id, id: set.inherited ? undefined : st.id, name: st.name, color: st.color, group: st.group })));
      setInherit(set.inherited);
      const from = locate(set.source.kind, set.source.id);
      setSource(from ? `${KIND_LABEL[set.source.kind]} “${from.path[from.path.length - 1]?.name ?? ''}”` : KIND_LABEL[set.source.kind]);
    }).catch((e) => setError(e.message));
  }, [kind, id, locate]);

  const edit = (key: string, patch: Partial<Row>) => setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (key: string, delta: number) => setRows((rs) => {
    const list = [...rs!];
    const i = list.findIndex((r) => r.key === key);
    const j = i + delta;
    if (j < 0 || j >= list.length) return list;
    [list[i], list[j]] = [list[j], list[i]];
    return list;
  });
  const add = (group: StatusGroup) => setRows((rs) => [...rs!, { key: `new-${Date.now()}`, name: '', color: SWATCHES[(rs!.length * 3) % SWATCHES.length], group }]);

  const problems = useMemo(() => {
    if (!rows || inherit) return null;
    if (rows.some((r) => !r.name.trim())) return 'Every status needs a name.';
    const names = rows.map((r) => r.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return 'Two statuses have the same name.';
    if (rows.filter((r) => r.group === 'closed').length !== 1) return 'Keep exactly one Closed status.';
    if (!rows.some((r) => r.group === 'not_started' || r.group === 'active')) return 'Add at least one Not started or Active status.';
    return null;
  }, [rows, inherit]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await collabApi.saveStatuses(kind, id, inherit ? { inherit: true } : {
        statuses: rows!.map((r) => ({ id: r.id, name: r.name.trim(), color: r.color, group: r.group })),
      });
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog title={`Statuses of ${name}`} wide onClose={onClose}>
      {!rows ? <p className="text-sm text-gray-400">{error ?? 'Loading…'}</p> : (
        <>
          {kind !== 'space' && (
            <div className="mb-3 flex gap-2 rounded-lg bg-gray-50 p-1 text-sm">
              <button type="button" onClick={() => setInherit(true)} className={`flex-1 rounded-md px-2 py-1 ${inherit ? 'bg-white font-medium shadow-sm' : 'text-gray-500'}`}>Inherit from parent</button>
              <button type="button" onClick={() => setInherit(false)} className={`flex-1 rounded-md px-2 py-1 ${!inherit ? 'bg-white font-medium shadow-sm' : 'text-gray-500'}`}>Use custom statuses</button>
            </div>
          )}
          {inherit ? (
            <div className="text-sm text-gray-600">
              <p className="mb-2">This {KIND_LABEL[kind]} uses the statuses of {source || 'its parent'}:</p>
              <div className="flex flex-wrap gap-1.5">{rows.map((r) => <span key={r.key} className="rounded px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: r.color }}>{r.name}</span>)}</div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto pr-1">
              {GROUPS.map((g) => (
                <section key={g.key} className="mb-3">
                  <div className="mb-1 flex items-center gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{g.label}</h4>
                    <span className="text-[11px] text-gray-400">{g.hint}</span>
                    {g.key !== 'closed' && (
                      <button type="button" onClick={() => add(g.key)} className="ml-auto flex items-center gap-0.5 rounded px-1.5 text-xs text-brand-600 hover:bg-brand-50"><Plus size={12} /> Add status</button>
                    )}
                  </div>
                  {rows.filter((r) => r.group === g.key).map((r) => (
                    <div key={r.key} className="group mb-1 flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1">
                      <label className="relative h-4 w-4 shrink-0 cursor-pointer rounded-full" style={{ backgroundColor: r.color }} title="Colour">
                        <input type="color" value={r.color} onChange={(e) => edit(r.key, { color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`Colour of ${r.name || 'new status'}`} />
                      </label>
                      <input value={r.name} onChange={(e) => edit(r.key, { name: e.target.value })} placeholder="Status name" aria-label="Status name"
                        className="min-w-0 flex-1 bg-transparent text-sm uppercase focus:outline-none" autoFocus={!r.name} />
                      {g.key !== 'closed' && (
                        <select aria-label={`Group of ${r.name}`} value={r.group} onChange={(e) => edit(r.key, { group: e.target.value as StatusGroup })} className="rounded border border-transparent bg-transparent text-xs text-gray-500 hover:border-gray-200">
                          {GROUPS.filter((x) => x.key !== 'closed').map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                        </select>
                      )}
                      <button type="button" title="Move up" onClick={() => move(r.key, -1)} className="text-gray-300 hover:text-gray-600"><ArrowUp size={13} /></button>
                      <button type="button" title="Move down" onClick={() => move(r.key, 1)} className="text-gray-300 hover:text-gray-600"><ArrowDown size={13} /></button>
                      {g.key !== 'closed' && <button type="button" title="Delete status" onClick={() => setRows((rs) => rs!.filter((x) => x.key !== r.key))} className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>}
                    </div>
                  ))}
                </section>
              ))}
              <p className="text-[11px] text-gray-400">Tasks in a deleted status move to a status with the same name, or else one in the same group.</p>
            </div>
          )}
        </>
      )}
      <Buttons onClose={onClose} onOk={save} ok="Save" disabled={!rows || busy || !!problems} error={error ?? problems} />
    </Dialog>
  );
};

// --- move and duplicate ----------------------------------------------------------------------------

interface Target { key: string; label: string; space_id?: string; folder_id?: string; depth: number }

/** Move a List (into a Space or any Folder) or a Folder (into a Space, or a top-level Folder as a Subfolder). */
export const MoveLocationDialog: React.FC<{ kind: 'folder' | 'list'; node: FolderNode | ListNode; onClose: () => void; onDone: () => void }> = ({ kind, node, onClose, onDone }) => {
  const { hierarchy } = useWork();
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hasSub = kind === 'folder' && (node as FolderNode).folders.length > 0;
  const targets = useMemo(() => {
    const out: Target[] = [];
    const canAdd = (lvl: string) => lvl === 'full';
    hierarchy?.spaces.forEach((sp) => {
      if (canAdd(sp.permission_level)) out.push({ key: `s:${sp.id}`, label: sp.name, space_id: sp.id, depth: 0 });
      const walk = (f: FolderNode, depth: number) => {
        if (f.id === node.id) return; // not into itself
        if (canAdd(f.permission_level) && (kind === 'list' || (depth === 1 && !hasSub))) out.push({ key: `f:${f.id}`, label: f.name, folder_id: f.id, depth });
        if (kind === 'list') f.folders.forEach((sub) => walk(sub, depth + 1));
      };
      sp.folders.forEach((f) => walk(f, 1));
    });
    return out;
  }, [hierarchy, kind, node.id, hasSub]);
  const chosen = targets.find((t) => t.key === target);
  const go = async () => {
    if (!chosen) return;
    try {
      await collabApi.moveLocation(kind, node.id, chosen.space_id ? { space_id: chosen.space_id } : { folder_id: chosen.folder_id });
      onDone();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Dialog title={`Move ${KIND_LABEL[kind]} “${node.name}”`} onClose={onClose}>
      <ul className="max-h-72 overflow-auto rounded-lg border border-gray-200 py-1" role="listbox" aria-label="Destination">
        {targets.length === 0 && <li className="px-3 py-2 text-sm text-gray-400">Nowhere else you can move it.</li>}
        {targets.map((t) => (
          <li key={t.key}>
            <button type="button" role="option" aria-selected={t.key === target} onClick={() => setTarget(t.key)}
              className={`flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm ${t.key === target ? 'bg-brand-50 text-brand-700' : 'hover:bg-gray-50'}`}
              style={{ paddingLeft: `${0.75 + t.depth * 1}rem` }}>
              {t.space_id ? <span className="flex h-4 w-4 items-center justify-center rounded bg-brand-600 text-[9px] font-bold text-white">{t.label[0]?.toUpperCase()}</span> : <Folder size={14} className="text-gray-400" />}
              {t.label}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-gray-500">Tasks come along. Statuses the destination doesn't have are matched by name or group; sharing follows the new parent unless the {KIND_LABEL[kind]} is private.</p>
      <Buttons onClose={onClose} onOk={go} ok="Move" disabled={!chosen} error={error} />
    </Dialog>
  );
};

export const DuplicateLocationDialog: React.FC<{ kind: 'folder' | 'list'; node: FolderNode | ListNode; onClose: () => void; onDone: (id: string) => void }> = ({ kind, node, onClose, onDone }) => (
  // One dialog for Spaces, Folders and Lists; this is just the way in for two of them.
  <DuplicateLocation
    kind={kind}
    id={node.id}
    name={node.name}
    onClose={onClose}
    onDone={onDone}
    run={(body) => collabApi.duplicateLocation(kind, node.id, body as unknown as Record<string, unknown>)}
  />
);

// --- archived ---------------------------------------------------------------------------------------

interface ArchivedRow { kind: LocationKind; id: string; name: string; path: string; canRestore: boolean }

/** Everything archived in the workspace that you can see, with Restore — ClickUp's "Show archived". */
export const ArchivedDialog: React.FC<{ onClose: () => void; onRestored: () => void }> = ({ onClose, onRestored }) => {
  const { workspace } = useWork();
  const [rows, setRows] = useState<ArchivedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = React.useCallback(() => {
    if (!workspace) return;
    collabApi.hierarchyWithArchived(workspace.id).then((h: Hierarchy) => {
      const out: ArchivedRow[] = [];
      const push = (kind: LocationKind, n: SpaceNode | FolderNode | ListNode, path: string[]) => {
        if (n.archived) out.push({ kind, id: n.id, name: n.name, path: path.join(' / '), canRestore: n.permission_level === 'full' });
      };
      const walk = (n: SpaceNode | FolderNode, path: string[]) => {
        n.folders.forEach((f) => { push('folder', f, path); if (!f.archived) walk(f, [...path, f.name]); });
        n.lists.forEach((l) => push('list', l, path));
      };
      h.spaces.forEach((sp) => { push('space', sp, []); if (!sp.archived) walk(sp, [sp.name]); });
      setRows(out);
    }).catch((e) => setError(e.message));
  }, [workspace]);
  useEffect(() => { load(); }, [load]);
  const restore = async (r: ArchivedRow) => {
    try { await collabApi.setArchived(r.kind, r.id, false); load(); onRestored(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Dialog title="Archived" onClose={onClose}>
      {error && <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ul className="max-h-80 overflow-auto" aria-label="Archived locations">
        {rows === null ? <li className="text-sm text-gray-400">Loading…</li> : rows.length === 0 ? <li className="py-6 text-center text-sm text-gray-400">Nothing is archived.</li> : rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 border-t border-gray-100 py-2 first:border-t-0">
            {r.kind === 'list' ? <ListIcon size={15} className="text-gray-400" /> : r.kind === 'folder' ? <Folder size={15} className="text-gray-400" /> : <span className="flex h-4 w-4 items-center justify-center rounded bg-gray-400 text-[9px] font-bold text-white">{r.name[0]?.toUpperCase()}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-gray-800">{r.name}</span>
              <span className="block truncate text-[11px] text-gray-400">{KIND_LABEL[r.kind]}{r.path ? ` in ${r.path}` : ''}</span>
            </span>
            {r.canRestore && (
              <button type="button" onClick={() => restore(r)} className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"><ArchiveRestore size={12} /> Restore</button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-gray-500">Archived items and their tasks are hidden from the sidebar, views and My Tasks, but nothing is deleted.</p>
    </Dialog>
  );
};
