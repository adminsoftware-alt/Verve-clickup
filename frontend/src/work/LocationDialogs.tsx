import React, { useMemo, useState } from 'react';
import { Folder, X } from 'lucide-react';
import { useWork } from './WorkContext';
import { DuplicateLocation } from './DuplicateLocation';
import { collabApi } from './collabApi';
import { type FolderNode, type ListNode, type LocationKind } from './api';
import { Portal } from './ui';

export const Dialog: React.FC<{ title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }> = ({ title, wide, onClose, children }) => (
  <Portal>
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className={`${wide ? 'w-[34rem]' : 'w-[26rem]'} flex max-h-[85vh] max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white p-5 shadow-xl`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button aria-label="Close" type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
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
