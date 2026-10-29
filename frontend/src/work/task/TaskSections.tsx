import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check, CheckSquare, ChevronDown, Download, FileStack, FileText, FolderUp, MoreHorizontal, Paperclip, Plus, RefreshCw,
  Save, Square, Trash2, Upload, UserMinus, UserPlus,
} from 'lucide-react';
import { useWork } from '../WorkContext';
import { collabApi, openAttachment, type Attachment, type Checklist, type ChecklistItem, type ChecklistTemplate } from '../collabApi';
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

/** Pick one person: for one item, or for the whole checklist at once. */
const PersonPick: React.FC<{ title: string; onClose: () => void; onPick: (userId: string) => void; onClear?: () => void }> = ({ title, onClose, onPick, onClear }) => {
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
        <footer className="flex justify-between border-t border-gray-100 px-3 py-2">
          {onClear ? <button type="button" onClick={onClear} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Unassign</button> : <span />}
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        </footer>
      </div>
    </div>
  );
};

/** The round tick ClickUp uses: an outline until done, then filled with a check. */
const Tick: React.FC<{ on: boolean; disabled?: boolean; label: string; onChange: (on: boolean) => void }> = ({ on, disabled, label, onChange }) => (
  <button type="button" role="checkbox" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-default ${
      on ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 bg-white hover:border-emerald-500'}`}>
    {on && <Check size={11} strokeWidth={3} />}
  </button>
);

/** Text that turns into a box when clicked, and saves on Enter or when the box is left. */
const InlineText: React.FC<{ value: string; label: string; editable: boolean; className?: string; onSave: (text: string) => void }> = ({ value, label, editable, className = '', onSave }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => { if (!editing) setText(value); }, [value, editing]);
  const finish = () => { setEditing(false); const t = text.trim(); if (t && t !== value) onSave(t); else setText(value); };
  if (!editable || !editing) {
    return (
      <span role={editable ? 'button' : undefined} tabIndex={editable ? 0 : undefined} aria-label={editable ? 'Click to rename' : undefined}
        onClick={() => editable && setEditing(true)} onKeyDown={(e) => { if (editable && e.key === 'Enter') setEditing(true); }}
        className={`min-w-0 flex-1 truncate ${editable ? 'cursor-text' : ''} ${className}`}>{value}</span>
    );
  }
  return (
    <input autoFocus aria-label={label} value={text} onChange={(e) => setText(e.target.value)} onBlur={finish}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finish(); } if (e.key === 'Escape') { setText(value); setEditing(false); } }}
      className={`min-w-0 flex-1 rounded border border-brand-300 bg-white px-1.5 py-0.5 focus:outline-none ${className}`} />
  );
};

export const Checklists: React.FC<{ taskId: string; editable: boolean; me?: string; onChanged: () => void }> = ({ taskId, editable, me, onChanged }) => {
  const { workspace } = useWork();
  const [lists, setLists] = useState<Checklist[]>([]);
  const [open, setOpen] = useState(true);
  // The checklist whose "Add item" box is open. Enter adds and keeps it open for the next one.
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [assigningAll, setAssigningAll] = useState<Checklist | null>(null);
  const [assigningItem, setAssigningItem] = useState<ChecklistItem | null>(null);
  const [overwriting, setOverwriting] = useState<Checklist | null>(null);
  const load = useCallback(() => collabApi.checklists(taskId).then(setLists).catch((e) => setError(e.message)), [taskId]);
  useEffect(() => { load(); }, [load]);
  const run = async (action: () => Promise<unknown>): Promise<Checklist[] | null> => {
    try {
      setError(null);
      const out = await action();
      const next = Array.isArray(out) ? (out as Checklist[]) : await collabApi.checklists(taskId);
      setLists(next);
      onChanged();
      return next;
    } catch (e) { setError((e as Error).message); return null; }
  };
  /** Several item changes at once, reloaded once at the end rather than after each one. */
  const runAll = async (jobs: Promise<unknown>[]) => {
    if (!jobs.length) return;
    try { setError(null); await Promise.all(jobs); await load(); onChanged(); }
    catch (e) { setError((e as Error).message); await load(); }
  };
  const total = lists.reduce((n, l) => n + l.items.length, 0);
  const done = lists.reduce((n, l) => n + l.items.filter((i) => i.resolved).length, 0);

  /** A new checklist opens straight into "Add item", as in ClickUp: nobody wants an empty one. */
  const newChecklist = async (name = 'Checklist', items: string[] = []) => {
    const next = await run(() => collabApi.addChecklist(taskId, name, items));
    const made = next?.reduce<Checklist | null>((a, b) => (!a || b.orderindex > a.orderindex ? b : a), null);
    if (made) { setOpen(true); setDraft(''); setAdding(made.id); }
  };
  const addFromTemplate = async (template: ChecklistTemplate) => {
    setPicking(false);
    await newChecklist(template.name, template.items);
  };
  const addItem = async (cl: Checklist) => {
    const text = draft.trim();
    if (!text) { setAdding(null); return; }
    setDraft('');
    await run(() => collabApi.addItem(cl.id, text));
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
      { label: 'Add item', icon: <Plus size={14} />, onClick: () => { setDraft(''); setAdding(cl.id); } },
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

  const addMenu = (trigger: React.ReactNode) => (
    <Menu align="right" label="Add a checklist" width={220} items={[
      { label: 'New checklist', icon: <CheckSquare size={14} />, onClick: () => newChecklist() },
      { label: 'Checklist from template', icon: <FileStack size={14} />, onClick: () => setPicking(true) },
    ]} trigger={trigger} />
  );

  return (
    <section className="mt-5" aria-label="Checklists">
      {/* ClickUp's header: a grey bar that folds the section, with the count and a + on it. */}
      <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronDown size={15} className={`shrink-0 text-gray-500 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className="text-sm font-semibold text-gray-800">Checklists</span>
          {total > 0 && <span className="text-xs text-gray-500">{done}/{total}</span>}
        </button>
        {editable && addMenu(
          <span aria-label="Add a checklist" className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-100"><Plus size={14} /></span>,
        )}
      </div>
      {error && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}

      {open && (
        <div className="mt-2 space-y-2 pl-1">
          {lists.length === 0 && !editable && <p className="px-2 text-xs text-gray-400">No checklists. You can tick items assigned to you; adding them needs edit access to the task.</p>}
          {lists.map((cl) => {
            const ticked = cl.items.filter((i) => i.resolved).length;
            const pct = cl.items.length ? (100 * ticked) / cl.items.length : 0;
            return (
              <div key={cl.id} className="rounded-xl border border-gray-200 bg-white">
                <div className="flex items-center gap-2 px-3 pb-1 pt-2">
                  <InlineText value={cl.name} label="Checklist name" editable={editable} className="text-sm font-semibold text-gray-800"
                    onSave={(name) => run(() => collabApi.updateChecklist(cl.id, { name }))} />
                  <span className="text-xs tabular-nums text-gray-400">{ticked}/{cl.items.length}</span>
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100" aria-hidden>
                    <span className="block h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                  </span>
                  {editable && (
                    <Menu align="right" label={`Actions for ${cl.name}`} width={214} items={menuFor(cl)}
                      trigger={<span className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Checklist actions"><MoreHorizontal size={15} /></span>} />
                  )}
                </div>
                <ul className="px-1">
                  {cl.items.map((item) => {
                    const canTick = editable || item.assignee?.id === me;
                    return (
                      <li key={item.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
                        <Tick on={item.resolved} disabled={!canTick} label={item.name} onChange={(resolved) => {
                          setLists((ls) => ls.map((l) => ({ ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, resolved } : i)) })));
                          run(() => collabApi.updateItem(item.id, { resolved }));
                        }} />
                        <InlineText value={item.name} label="Item name" editable={editable}
                          className={item.resolved ? 'text-gray-400 line-through' : 'text-gray-800'}
                          onSave={(name) => run(() => collabApi.updateItem(item.id, { name }))} />
                        {editable ? (
                          <button type="button" onClick={() => setAssigningItem(item)}
                            aria-label={item.assignee ? `Assigned to ${item.assignee.display_name || item.assignee.email}` : 'Assign this item'}
                            className={`shrink-0 rounded-full ${item.assignee ? '' : 'invisible p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 group-hover:visible'}`}>
                            {item.assignee ? <Avatar user={item.assignee} size={20} /> : <UserPlus size={14} />}
                          </button>
                        ) : item.assignee ? <Avatar user={item.assignee} size={20} /> : null}
                        {editable && (
                          <button type="button" aria-label={`Delete ${item.name}`} onClick={() => run(() => collabApi.deleteItem(item.id))}
                            className="invisible shrink-0 rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600 group-hover:visible"><Trash2 size={13} /></button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {editable && (adding === cl.id ? (
                  <form className="flex items-center gap-2 px-3 pb-2 pt-1" onSubmit={(e) => { e.preventDefault(); addItem(cl); }}>
                    <span className="h-[18px] w-[18px] shrink-0 rounded-full border border-dashed border-gray-300" aria-hidden />
                    <input autoFocus aria-label="New checklist item" value={draft} onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(''); setAdding(null); } }}
                      placeholder="Item name, then Enter" className="min-w-0 flex-1 rounded-md border border-brand-300 px-2 py-1 text-sm focus:outline-none" />
                    <button type="submit" className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700">Add</button>
                    <button type="button" onClick={() => { setDraft(''); setAdding(null); }} className="rounded-md px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-100">Cancel</button>
                  </form>
                ) : (
                  <button type="button" onClick={() => { setDraft(''); setAdding(cl.id); }}
                    className="flex w-full items-center gap-2 rounded-b-xl px-3 pb-2 pt-1 text-left text-sm text-gray-500 hover:text-gray-800">
                    <Plus size={15} /> Add item
                  </button>
                ))}
              </div>
            );
          })}
          {editable && addMenu(
            <span className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-gray-500 hover:bg-gray-50 hover:text-gray-800">
              <Plus size={14} /> {lists.length ? 'Add checklist' : 'Add checklist to break the work into steps'}
            </span>,
          )}
        </div>
      )}

      {picking && <TemplatePicker onClose={() => setPicking(false)} onPick={addFromTemplate} />}
      {assigningItem && (
        <PersonPick
          title={`Assign “${assigningItem.name}” to…`}
          onClose={() => setAssigningItem(null)}
          onClear={assigningItem.assignee ? () => { const it = assigningItem; setAssigningItem(null); run(() => collabApi.updateItem(it.id, { assignee_id: null })); } : undefined}
          onPick={(userId) => { const it = assigningItem; setAssigningItem(null); run(() => collabApi.updateItem(it.id, { assignee_id: userId })); }}
        />
      )}
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
              <button type="button" aria-label="Download" onClick={() => openAttachment(a, true).catch((e) => setError(e.message))} className="text-gray-400 hover:text-gray-700"><Download size={14} /></button>
              {(isFull || a.user?.id === me) && (
                <button type="button" aria-label="Delete" onClick={async () => await ask.confirm({ danger: true, title: `Delete ${a.filename}?` }) && collabApi.deleteAttachment(a.id).then(load).then(onChanged).catch((e) => setError(e.message))} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
