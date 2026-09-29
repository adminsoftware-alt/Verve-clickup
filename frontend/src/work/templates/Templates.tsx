import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, CheckSquare, Folder, LayoutTemplate, List as ListIcon, Lock, Pencil, Search, Trash2, X } from 'lucide-react';
import { workApi, type FolderNode, type Template, type TemplateKind, type TemplateSave } from '../api';
import { Portal } from '../ui';
import { useWork } from '../WorkContext';
import { useWritableLists } from '../task/TaskActions';
import { ask } from '../../components/ask';

const KIND_LABEL: Record<TemplateKind, string> = { task: 'Task', list: 'List', folder: 'Folder', space: 'Space' };
const KIND_ICON: Record<TemplateKind, React.ReactNode> = {
  task: <CheckSquare size={15} />, list: <ListIcon size={15} />, folder: <Folder size={15} />, space: <Boxes size={15} />,
};

const Shell: React.FC<{ title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }> = ({ title, wide, onClose, children }) => (
  <Portal>
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className={`flex max-h-[85vh] ${wide ? 'w-[46rem]' : 'w-[28rem]'} max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white p-5 shadow-xl`}>
        <div className="mb-3 flex items-center gap-2">
          <LayoutTemplate size={17} className="text-brand-600" />
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button type="button" title="Close" onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  </Portal>
);

// --- saving ---------------------------------------------------------------------------------------

export const SaveTemplateDialog: React.FC<{ kind: TemplateKind; id: string; name: string; onClose: () => void; onSaved?: (t: Template) => void }> = ({ kind, id, name, onClose, onSaved }) => {
  const [form, setForm] = useState<TemplateSave>({
    name, description: '', is_private: false, include_tasks: true, include_subtasks: true, include_checklists: true,
    include_fields: true, include_dates: true, include_assignees: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Template | null>(null);
  const set = (patch: Partial<TemplateSave>) => setForm((f) => ({ ...f, ...patch }));
  const save = async () => {
    setError(null);
    try {
      const t = await workApi.saveTemplate(kind, id, { ...form, name: form.name?.trim() || undefined, description: form.description?.trim() || null });
      setDone(t);
      onSaved?.(t);
    } catch (e) { setError((e as Error).message); }
  };
  const box = (key: keyof TemplateSave, label: string, hint?: string) => (
    <label className="flex items-start gap-2 py-1 text-sm text-gray-700">
      <input type="checkbox" className="mt-0.5" checked={!!form[key]} onChange={(e) => set({ [key]: e.target.checked })} />
      <span>{label}{hint && <span className="block text-[11px] text-gray-400">{hint}</span>}</span>
    </label>
  );
  return (
    <Shell title={`Save ${KIND_LABEL[kind]} as template`} onClose={onClose}>
      {done ? (
        <div className="text-sm text-gray-700">
          <p>Saved “{done.name}” to the Template Center{done.task_count ? ` with ${done.task_count} task${done.task_count === 1 ? '' : 's'}` : ''}.</p>
          <p className="mt-1 text-xs text-gray-500">Use it from the sidebar's Templates, or “From template…” when adding a List or Folder.</p>
          <div className="mt-4 flex justify-end"><button type="button" onClick={onClose} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">Done</button></div>
        </div>
      ) : (
        <div className="min-h-0 overflow-auto">
          <label className="block text-xs font-medium text-gray-600">Template name
            <input autoFocus value={form.name ?? ''} onChange={(e) => set({ name: e.target.value })} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal" />
          </label>
          <label className="mt-3 block text-xs font-medium text-gray-600">Description
            <textarea value={form.description ?? ''} onChange={(e) => set({ description: e.target.value })} rows={2} placeholder="What is it for?"
              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal" />
          </label>
          <p className="mb-1 mt-3 text-xs font-medium text-gray-600">Keep</p>
          {kind !== 'task' && box('include_tasks', 'Tasks')}
          {box('include_subtasks', 'Subtasks')}
          {box('include_checklists', 'Checklists')}
          {box('include_fields', 'Custom field values')}
          {box('include_dates', 'Dates and repeat rules', 'Dates move with the day the template is used')}
          {box('include_assignees', 'Assignees')}
          <label className="mt-2 flex items-center gap-2 border-t border-gray-100 pt-2 text-sm text-gray-700">
            <input type="checkbox" checked={!!form.is_private} onChange={(e) => set({ is_private: e.target.checked })} />
            <Lock size={13} className="text-gray-400" /> Only I can use this template
          </label>
          {kind !== 'task' && <p className="mt-2 text-[11px] text-gray-400">Its own statuses, task groups and custom fields are saved too{kind === 'space' ? ', with its tags, ClickApps, Folders and Lists' : ''}.</p>}
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="button" onClick={save} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Save template</button>
          </div>
        </div>
      )}
    </Shell>
  );
};

// --- using ----------------------------------------------------------------------------------------

/** Where a template of each kind can go, as select options. */
function useTargets(kind: TemplateKind): { value: string; label: string }[] {
  const { hierarchy } = useWork();
  const lists = useWritableLists();
  return useMemo(() => {
    if (kind === 'task') return lists.map((l) => ({ value: `l:${l.id}`, label: l.label }));
    if (kind === 'space') return [{ value: 'w:', label: 'This workspace (a new Space)' }];
    const out: { value: string; label: string }[] = [];
    hierarchy?.spaces.forEach((sp) => {
      if (sp.permission_level === 'full') out.push({ value: `s:${sp.id}`, label: sp.name });
      if (kind === 'list') {
        const walk = (f: FolderNode, path: string) => {
          if (f.permission_level === 'full') out.push({ value: `f:${f.id}`, label: `${path} / ${f.name}` });
          f.folders.forEach((sub) => walk(sub, `${path} / ${f.name}`));
        };
        sp.folders.forEach((f) => walk(f, sp.name));
      }
    });
    return out;
  }, [kind, hierarchy, lists]);
}

const UseTemplate: React.FC<{ template: Template; target?: string; onBack: () => void; onDone: () => void }> = ({ template, target, onBack, onDone }) => {
  const targets = useTargets(template.kind);
  const { refresh } = useWork();
  const navigate = useNavigate();
  const [where, setWhere] = useState(target && targets.some((t) => t.value === target) ? target : targets[0]?.value ?? '');
  const [name, setName] = useState(template.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const [k, id] = where.split(':');
    setBusy(true);
    setError(null);
    try {
      const out = await workApi.applyTemplate(template.id, {
        name: name.trim() || undefined,
        ...(k === 'w' ? {} : k === 'l' ? { list_id: id } : k === 's' ? { space_id: id } : { folder_id: id }),
      });
      await refresh();
      onDone();
      if (out.kind === 'task') navigate(`/l/${out.list_id}?task=${out.id}`);
      else navigate(`/${out.kind === 'list' ? 'l' : out.kind === 'space' ? 's' : 'f'}/${out.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-2 text-xs text-brand-600 hover:underline">← All templates</button>
      <p className="text-sm text-gray-700">Create a {KIND_LABEL[template.kind]} from <b>{template.name}</b>.</p>
      <label className="mt-3 block text-xs font-medium text-gray-600">Name
        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal" />
      </label>
      <label className="mt-3 block text-xs font-medium text-gray-600">{template.kind === 'task' ? 'In List' : template.kind === 'list' ? 'In Space or Folder' : template.kind === 'space' ? 'Where' : 'In Space'}
        <select aria-label="Where" value={where} onChange={(e) => setWhere(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal">
          {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      {targets.length === 0 && <p className="mt-2 text-xs text-amber-700">You don't have full access anywhere this template can go.</p>}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onBack} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Back</button>
        <button type="button" disabled={!where || busy} onClick={go} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? 'Creating…' : `Create ${KIND_LABEL[template.kind]}`}
        </button>
      </div>
    </div>
  );
};

/** ClickUp's Template Center: browse, use, rename and delete the workspace's templates. */
export const TemplateCenter: React.FC<{ kind?: TemplateKind; target?: string; onClose: () => void }> = ({ kind, target, onClose }) => {
  const { workspace } = useWork();
  const [tab, setTab] = useState<TemplateKind | 'all'>(kind ?? 'all');
  const [items, setItems] = useState<Template[] | null>(null);
  const [query, setQuery] = useState('');
  const [using, setUsing] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { if (workspace) workApi.templates(workspace.id).then(setItems).catch((e) => setError(e.message)); }, [workspace]);
  useEffect(() => { load(); }, [load]);
  const shown = (items ?? []).filter((t) => (tab === 'all' || t.kind === tab) && t.name.toLowerCase().includes(query.trim().toLowerCase()));
  const rename = async (t: Template) => {
    const next = await ask.prompt('Rename template', t.name);
    if (!next || next.trim() === t.name) return;
    try { await workApi.updateTemplate(t.id, { name: next.trim() }); load(); } catch (e) { setError((e as Error).message); }
  };
  const remove = async (t: Template) => {
    if (!(await ask.confirm({ danger: true, title: `Delete the template “${t.name}”? Things already made from it stay.` }))) return;
    try { await workApi.deleteTemplate(t.id); load(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Shell title="Template Center" wide onClose={onClose}>
      {using ? <UseTemplate template={using} target={target} onBack={() => setUsing(null)} onDone={onClose} /> : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <nav className="flex gap-1 rounded-lg bg-gray-100 p-0.5 text-sm" aria-label="Template types">
              {(['all', 'task', 'list', 'folder', 'space'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-md px-2.5 py-1 ${tab === k ? 'bg-white font-medium shadow-sm' : 'text-gray-500'}`}>
                  {k === 'all' ? 'All' : `${KIND_LABEL[k]}s`}
                </button>
              ))}
            </nav>
            <span className="ml-auto flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1">
              <Search size={13} className="text-gray-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates" aria-label="Search templates" className="w-40 text-sm focus:outline-none" />
            </span>
          </div>
          {error && <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <ul className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto sm:grid-cols-2" aria-label="Templates">
            {items === null ? <li className="text-sm text-gray-400">Loading…</li>
              : shown.length === 0 ? (
                <li className="col-span-full py-8 text-center text-sm text-gray-400">
                  No templates yet. Save a task, List, Folder or Space as a template from its “…” menu.
                </li>
              ) : shown.map((t) => (
                <li key={t.id} className="group flex flex-col rounded-lg border border-gray-200 p-3 hover:border-brand-300">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-brand-500">{KIND_ICON[t.kind]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 truncate text-sm font-medium text-gray-900">{t.name}{t.is_private && <Lock size={12} className="text-gray-400" />}</span>
                      <span className="block text-[11px] text-gray-400">
                        {KIND_LABEL[t.kind]}
                        {t.list_count ? ` · ${t.list_count} List${t.list_count === 1 ? '' : 's'}` : ''}
                        {t.task_count ? ` · ${t.task_count} task${t.task_count === 1 ? '' : 's'}` : ''}
                        {t.field_count ? ` · ${t.field_count} field${t.field_count === 1 ? '' : 's'}` : ''}
                        {t.use_count ? ` · used ${t.use_count}×` : ''}
                      </span>
                    </span>
                    <button type="button" title={`Rename ${t.name}`} onClick={() => rename(t)} className="rounded p-1 text-gray-300 opacity-0 hover:text-gray-700 group-hover:opacity-100"><Pencil size={13} /></button>
                    <button type="button" title={`Delete ${t.name}`} onClick={() => remove(t)} className="rounded p-1 text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100"><Trash2 size={13} /></button>
                  </div>
                  {t.description && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{t.description}</p>}
                  <button type="button" onClick={() => setUsing(t)} className="mt-2 self-start rounded-md border border-brand-200 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
                    Use template
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
    </Shell>
  );
};
