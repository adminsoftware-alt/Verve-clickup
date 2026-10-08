import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckSquare, Download, FileStack, FileText, FolderUp, MoreHorizontal, Paperclip, Pencil, Plus, RefreshCw,
  Save, Square, Trash2, Upload, UserMinus, UserPlus,
} from 'lucide-react';
import { useWork } from '../WorkContext';
import { collabApi, openAttachment, type Attachment, type Checklist, type ChecklistTemplate } from '../collabApi';
import { Avatar, Menu, type MenuItem } from '../ui';
import { ask } from '../../components/ask';
import { notify } from '../../components/notify';
import { TemplateOverwrite, TemplatePicker } from './ChecklistTemplates';

const Heading: React.FC<{ icon: React.ReactNode; title: string; extra?: React.ReactNode; action?: React.ReactNode }> = ({ icon, title, extra, action }) => (
  <div className="mb-2 flex items-center gap-2">
    <span className="text-gray-400">{icon}</span>
    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{title}</h4>
    {extra}
    <span className="ml-auto">{action}</span>
  </div>
);

// --- checklists -------------------------------------------------------------------------------

/** Pick one person, for the whole checklist at once. */
const PersonPick: React.FC<{ title: string; onClose: () => void; onPick: (userId: string) => void }> = ({ title, onClose, onPick }) => {
  const { members } = useWork();
  const [query, setQuery] = useState('');
  const shown = members.filter((m) => {
    const label = (m.user.display_name || m.user.email || '').toLowerCase();
    return label.includes(query.trim().toLowerCase());
  });
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        </header>
        <div className="border-b border-gray-100 px-4 py-2.5">
          <input autoFocus aria-label="Search people" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people…"
            className="h-8 w-full rounded-lg border border-gray-300 px-2.5 text-sm focus:border-brand-500 focus:outline-none" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {shown.map((m) => (
            <button key={m.user.id} type="button" onClick={() => onPick(m.user.id)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-gray-100">
              <Avatar user={m.user} size={22} />
              <span className="truncate text-gray-800">{m.user.display_name || m.user.email}</span>
            </button>
          ))}
          {shown.length === 0 && <p className="px-2 py-1 text-sm text-gray-500">Nobody matches that.</p>}
        </div>
        <footer className="flex justify-end border-t border-gray-100 px-3 py-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        </footer>
      </div>
    </div>
  );
};

export const Checklists: React.FC<{ taskId: string; editable: boolean; me?: string; onChanged: () => void }> = ({ taskId, editable, me, onChanged }) => {
  const { members, workspace } = useWork();
  const [lists, setLists] = useState<Checklist[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Which checklist's "add an item" box should take the caret, after "Add item" on its menu.
  const [focusOn, setFocusOn] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [assigningAll, setAssigningAll] = useState<Checklist | null>(null);
  const [overwriting, setOverwriting] = useState<Checklist | null>(null);
  const load = useCallback(() => collabApi.checklists(taskId).then(setLists).catch((e) => setError(e.message)), [taskId]);
  useEffect(() => { load(); }, [load]);
  const run = async (action: () => Promise<unknown>) => {
    try { setError(null); const out = await action(); if (Array.isArray(out)) setLists(out as Checklist[]); else await load(); onChanged(); }
    catch (e) { setError((e as Error).message); }
  };
  /** Several item changes at once, reloaded once at the end rather than after each one. */
  const runAll = async (jobs: Promise<unknown>[]) => {
    if (!jobs.length) return;
    try { setError(null); await Promise.all(jobs); await load(); onChanged(); }
    catch (e) { setError((e as Error).message); await load(); }
  };
  const total = lists.reduce((n, l) => n + l.items.length, 0);
  const done = lists.reduce((n, l) => n + l.items.filter((i) => i.resolved).length, 0);

  const addFromTemplate = async (template: ChecklistTemplate) => {
    setPicking(false);
    await run(() => collabApi.addChecklist(taskId, template.name, template.items));
  };

  const saveAsTemplate = async (cl: Checklist) => {
    if (!workspace) return;
    const name = await ask.prompt({ title: 'Save as template', label: 'Template name', initial: cl.name, confirmLabel: 'Save' });
    if (!name?.trim()) return;
    try {
      setError(null);
      await collabApi.saveChecklistTemplate(workspace.id, name.trim(), cl.items.map((i) => i.name));
      notify.ok(`Saved “${name.trim()}” as a template.`);
    } catch (e) { setError((e as Error).message); }
  };

  const menuFor = (cl: Checklist): MenuItem[] => {
    const unticked = cl.items.filter((i) => !i.resolved);
    const ticked = cl.items.filter((i) => i.resolved);
    return [
      { label: 'Add item', icon: <Plus size={14} />, onClick: () => setFocusOn(cl.id) },
      {
        label: 'Rename checklist', icon: <Pencil size={14} />, onClick: async () => {
          const name = await ask.prompt({ title: 'Rename checklist', label: 'Name', initial: cl.name, confirmLabel: 'Rename' });
          if (name?.trim() && name.trim() !== cl.name) run(() => collabApi.updateChecklist(cl.id, { name: name.trim() }));
        },
      },
      { label: 'Assign all to…', icon: <UserPlus size={14} />, onClick: () => setAssigningAll(cl) },
      { label: 'Unassign all', icon: <UserMinus size={14} />, onClick: () => runAll(cl.items.filter((i) => i.assignee).map((i) => collabApi.updateItem(i.id, { assignee_id: null }))) },
      { label: 'Check all', icon: <CheckSquare size={14} />, onClick: () => runAll(unticked.map((i) => collabApi.updateItem(i.id, { resolved: true }))) },
      { label: 'Uncheck all', icon: <Square size={14} />, onClick: () => runAll(ticked.map((i) => collabApi.updateItem(i.id, { resolved: false }))) },
      { label: 'Save as template', icon: <Save size={14} />, onClick: () => saveAsTemplate(cl) },
      { label: 'Update existing template', icon: <RefreshCw size={14} />, onClick: () => setOverwriting(cl) },
      {
        label: 'Delete checklist', icon: <Trash2 size={14} />, danger: true, onClick: async () => {
          if (await ask.confirm({ danger: true, title: `Delete “${cl.name}”?` })) run(() => collabApi.deleteChecklist(cl.id));
        },
      },
    ];
  };

  return (
    <section className="mt-5" aria-label="Checklists">
      <Heading icon={<CheckSquare size={15} />} title="Checklists" extra={total > 0 ? <span className="text-xs text-gray-400">{done}/{total}</span> : null}
        action={editable && (
          <Menu align="right" label="Add a checklist" width={210} items={[
            { label: 'Checklist', icon: <CheckSquare size={14} />, onClick: () => run(() => collabApi.addChecklist(taskId, 'Checklist')) },
            { label: 'Checklist from Template', icon: <FileStack size={14} />, onClick: () => setPicking(true) },
          ]} trigger={
            <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-brand-600 hover:bg-brand-50"><Plus size={12} /> Checklist</span>
          } />
        )} />
      {error && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      {lists.length === 0 && <p className="text-xs text-gray-400">{editable ? 'Break the work into steps with a checklist, or start from a saved one.' : 'No checklists.'}</p>}
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
              {editable && (
                <Menu align="right" label={`Actions for ${cl.name}`} width={214} items={menuFor(cl)}
                  trigger={<span className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="Checklist actions"><MoreHorizontal size={14} /></span>} />
              )}
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
                <input
                  aria-label="New checklist item"
                  ref={(el) => { if (el && focusOn === cl.id) { el.focus(); setFocusOn(null); } }}
                  value={drafts[cl.id] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [cl.id]: e.target.value }))}
                  placeholder="Add an item" className="flex-1 text-sm focus:outline-none" />
              </form>
            )}
          </div>
        );
      })}

      {picking && <TemplatePicker onClose={() => setPicking(false)} onPick={addFromTemplate} />}
      {assigningAll && (
        <PersonPick
          title={`Assign every item in “${assigningAll.name}” to…`}
          onClose={() => setAssigningAll(null)}
          onPick={(userId) => {
            const cl = assigningAll;
            setAssigningAll(null);
            runAll(cl.items.filter((i) => i.assignee?.id !== userId).map((i) => collabApi.updateItem(i.id, { assignee_id: userId })));
          }}
        />
      )}
      {overwriting && (
        <TemplateOverwrite
          checklistName={overwriting.name}
          onClose={() => setOverwriting(null)}
          onPick={async (tpl) => {
            const cl = overwriting;
            setOverwriting(null);
            if (!workspace) return;
            try {
              setError(null);
              await collabApi.updateChecklistTemplate(workspace.id, tpl.id, tpl.name, cl.items.map((i) => i.name));
              notify.ok(`“${tpl.name}” now holds these ${cl.items.length} items.`);
            } catch (e) { setError((e as Error).message); }
          }}
        />
      )}
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
  const folder = useRef<HTMLInputElement>(null);
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
            {/* accept="*&#47;*" on purpose: a spreadsheet, a signed PDF, a photo of a receipt and a
                .zip of workings are all things people attach, and nothing here reads the file. */}
            <input ref={input} type="file" multiple hidden accept="*/*" aria-label="Upload files" onChange={(e) => { if (e.target.files) send(e.target.files); e.target.value = ''; }} />
            <input
              ref={folder} type="file" multiple hidden aria-label="Upload a folder"
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => { if (e.target.files) send(e.target.files); e.target.value = ''; }}
            />
            {busy ? (
              <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-gray-500"><Upload size={12} /> Uploading…</span>
            ) : (
              <Menu align="right" label="Attach a file" width={200} items={[
                { label: 'Upload file', icon: <Upload size={14} />, onClick: () => input.current?.click() },
                { label: 'Upload a folder', icon: <FolderUp size={14} />, onClick: () => folder.current?.click() },
              ]} trigger={
                <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-brand-600 hover:bg-brand-50"><Plus size={12} /> Attach file</span>
              } />
            )}
          </>
        )} />
      {error && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      {items.length === 0 ? (
        canAttach ? (
          // The dashed box is the obvious place to click, so it is a button, not a caption.
          <button
            type="button" disabled={busy} onClick={() => input.current?.click()}
            className={`flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-5 text-center transition-colors ${
              dragging ? 'border-brand-400 bg-brand-50/60' : 'border-gray-200 hover:border-brand-300 hover:bg-gray-50'}`}
          >
            <Upload size={18} className="text-gray-400" />
            <span className="text-xs font-medium text-gray-600">Drop a file here, or click to choose one</span>
            <span className="text-[11px] text-gray-400">Any kind of file, up to 25 MB each</span>
          </button>
        ) : (
          <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-center text-xs text-gray-400">No attachments.</p>
        )
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
