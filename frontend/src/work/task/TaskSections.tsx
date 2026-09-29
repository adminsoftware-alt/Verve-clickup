import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckSquare, Download, FileText, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import { useWork } from '../WorkContext';
import { collabApi, openAttachment, type Attachment, type Checklist } from '../collabApi';
import { Avatar } from '../ui';
import { ask } from '../../components/ask';

const Heading: React.FC<{ icon: React.ReactNode; title: string; extra?: React.ReactNode; action?: React.ReactNode }> = ({ icon, title, extra, action }) => (
  <div className="mb-2 flex items-center gap-2">
    <span className="text-gray-400">{icon}</span>
    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{title}</h4>
    {extra}
    <span className="ml-auto">{action}</span>
  </div>
);

// --- checklists -------------------------------------------------------------------------------

export const Checklists: React.FC<{ taskId: string; editable: boolean; me?: string; onChanged: () => void }> = ({ taskId, editable, me, onChanged }) => {
  const { members } = useWork();
  const [lists, setLists] = useState<Checklist[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => collabApi.checklists(taskId).then(setLists).catch((e) => setError(e.message)), [taskId]);
  useEffect(() => { load(); }, [load]);
  const run = async (action: () => Promise<unknown>) => {
    try { setError(null); const out = await action(); if (Array.isArray(out)) setLists(out as Checklist[]); else await load(); onChanged(); }
    catch (e) { setError((e as Error).message); }
  };
  const total = lists.reduce((n, l) => n + l.items.length, 0);
  const done = lists.reduce((n, l) => n + l.items.filter((i) => i.resolved).length, 0);

  return (
    <section className="mt-5" aria-label="Checklists">
      <Heading icon={<CheckSquare size={15} />} title="Checklists" extra={total > 0 ? <span className="text-xs text-gray-400">{done}/{total}</span> : null}
        action={editable && <button type="button" onClick={() => run(() => collabApi.addChecklist(taskId, 'Checklist'))} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-brand-600 hover:bg-brand-50"><Plus size={12} /> Checklist</button>} />
      {error && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      {lists.length === 0 && <p className="text-xs text-gray-400">{editable ? 'Break the work into steps with a checklist.' : 'No checklists.'}</p>}
      {lists.map((cl) => {
        const ticked = cl.items.filter((i) => i.resolved).length;
        return (
          <div key={cl.id} className="mb-3 rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-1.5">
              {editable ? (
                <input aria-label="Checklist name" defaultValue={cl.name} key={cl.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== cl.name && run(() => collabApi.updateChecklist(cl.id, { name: e.target.value.trim() }))}
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium text-gray-800 focus:outline-none" />
              ) : <span className="flex-1 text-sm font-medium text-gray-800">{cl.name}</span>}
              <span className="text-xs text-gray-400">{ticked}/{cl.items.length}</span>
              <span className="h-1.5 w-16 overflow-hidden rounded bg-gray-100"><span className="block h-full bg-emerald-500" style={{ width: `${cl.items.length ? (100 * ticked) / cl.items.length : 0}%` }} /></span>
              {editable && <button type="button" title="Delete checklist" onClick={async () => await ask.confirm({ danger: true, title: `Delete “${cl.name}”?` }) && run(() => collabApi.deleteChecklist(cl.id))} className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>}
            </div>
            <ul>
              {cl.items.map((item) => {
                const canTick = editable || item.assignee?.id === me;
                return (
                  <li key={item.id} className="group flex items-center gap-2 px-3 py-1 text-sm">
                    <input type="checkbox" aria-label={item.name} checked={item.resolved} disabled={!canTick} onChange={(e) => {
                      const resolved = e.target.checked;
                      setLists((ls) => ls.map((l) => ({ ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, resolved } : i)) })));
                      run(() => collabApi.updateItem(item.id, { resolved }));
                    }} />
                    <span className={`min-w-0 flex-1 truncate ${item.resolved ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{item.name}</span>
                    {editable ? (
                      <select aria-label={`Assignee of ${item.name}`} value={item.assignee?.id ?? ''} onChange={(e) => run(() => collabApi.updateItem(item.id, { assignee_id: e.target.value || null }))}
                        className="max-w-28 rounded border border-transparent bg-transparent px-1 text-xs text-gray-500 hover:border-gray-200">
                        <option value="">Unassigned</option>
                        {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.display_name || m.user.email}</option>)}
                      </select>
                    ) : item.assignee ? <Avatar user={item.assignee} size={18} /> : null}
                    {editable && <button type="button" title="Delete item" onClick={() => run(() => collabApi.deleteItem(item.id))} className="invisible text-gray-300 hover:text-red-600 group-hover:visible"><Trash2 size={12} /></button>}
                  </li>
                );
              })}
            </ul>
            {editable && (
              <form className="flex items-center gap-2 px-3 py-1.5" onSubmit={(e) => {
                e.preventDefault();
                const text = (drafts[cl.id] ?? '').trim();
                if (text) run(() => collabApi.addItem(cl.id, text)).then(() => setDrafts((d) => ({ ...d, [cl.id]: '' })));
              }}>
                <Plus size={13} className="text-gray-400" />
                <input aria-label="New checklist item" value={drafts[cl.id] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [cl.id]: e.target.value }))} placeholder="Add an item" className="flex-1 text-sm focus:outline-none" />
              </form>
            )}
          </div>
        );
      })}
    </section>
  );
};

// --- attachments ------------------------------------------------------------------------------

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export const Attachments: React.FC<{ taskId: string; canAttach: boolean; isFull: boolean; me?: string; onChanged: () => void }> = ({ taskId, canAttach, isFull, me, onChanged }) => {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(() => collabApi.attachments(taskId).then(setItems).catch((e) => setError(e.message)), [taskId]);
  useEffect(() => { load(); }, [load]);
  const send = async (files: FileList | File[]) => {
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(files)) await collabApi.upload(taskId, f);
      await load();
      onChanged();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section
      className={`mt-5 rounded-lg ${dragging ? 'ring-2 ring-brand-300' : ''}`}
      aria-label="Attachments"
      onDragOver={(e) => { if (canAttach) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (canAttach && e.dataTransfer.files.length) send(e.dataTransfer.files); }}
    >
      <Heading icon={<Paperclip size={15} />} title="Attachments" extra={items.length ? <span className="text-xs text-gray-400">{items.length}</span> : null}
        action={canAttach && (
          <>
            <input ref={input} type="file" multiple hidden aria-label="Upload files" onChange={(e) => e.target.files && send(e.target.files)} />
            <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-brand-600 hover:bg-brand-50 disabled:opacity-50">
              <Upload size={12} /> {busy ? 'Uploading…' : 'Upload'}
            </button>
          </>
        )} />
      {error && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-center text-xs text-gray-400">{canAttach ? 'Drop files here or click Upload (up to 25 MB each).' : 'No attachments.'}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((a) => (
            <li key={a.id} className="group flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-2">
              <FileText size={18} className="shrink-0 text-gray-400" />
              <button type="button" onClick={() => openAttachment(a).catch((e) => setError(e.message))} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm text-gray-800 hover:underline">{a.filename}</span>
                <span className="block text-[11px] text-gray-400">{size(a.size)} · {a.user?.display_name || a.user?.email || ''}</span>
              </button>
              <button type="button" title="Download" onClick={() => openAttachment(a, true).catch((e) => setError(e.message))} className="text-gray-400 hover:text-gray-700"><Download size={14} /></button>
              {(isFull || a.user?.id === me) && (
                <button type="button" title="Delete" onClick={async () => await ask.confirm({ danger: true, title: `Delete ${a.filename}?` }) && collabApi.deleteAttachment(a.id).then(load).then(onChanged).catch((e) => setError(e.message))} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
