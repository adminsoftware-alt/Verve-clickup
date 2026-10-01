// Saved checklists, and the dialog for picking one.
//
// The same list gets typed out again on every task of a kind -- the month-end close, the joiner
// pack, the steps before a filing goes out. Saving one keeps the wording and the order the same
// each time, and means the person doing it for the first time is not guessing what the steps are.
import { CheckSquare, Search, Trash2, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { ask } from '../../components/ask';
import { collabApi, type ChecklistTemplate } from '../collabApi';
import { useWork } from '../WorkContext';
import { useEscapeToClose } from '../ui';

/** Pick a saved checklist to add to this task. */
export const TemplatePicker: React.FC<{
  onClose: () => void;
  onPick: (template: ChecklistTemplate) => void;
}> = ({ onClose, onPick }) => {
  const { workspace } = useWork();
  const [templates, setTemplates] = useState<ChecklistTemplate[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEscapeToClose(panel, onClose);

  useEffect(() => {
    if (!workspace) return;
    collabApi.checklistTemplates(workspace.id).then(setTemplates).catch((e) => { setError(e.message); setTemplates([]); });
  }, [workspace]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (templates ?? []).filter((t) => !q || t.name.toLowerCase().includes(q) || t.items.some((i) => i.toLowerCase().includes(q)));
  }, [templates, query]);

  const remove = async (t: ChecklistTemplate) => {
    if (!workspace || !(await ask.confirm({ danger: true, title: `Delete the template “${t.name}”?`, body: 'Checklists already added to tasks are not affected.' }))) return;
    try {
      await collabApi.deleteChecklistTemplate(workspace.id, t.id);
      setTemplates((ts) => (ts ?? []).filter((x) => x.id !== t.id));
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div
        ref={panel}
        role="dialog" aria-label="Checklist templates" onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-gray-100 px-5 py-3.5">
          <CheckSquare size={16} className="text-brand-600" />
          <h2 className="text-sm font-semibold text-gray-800">Checklist templates</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={16} /></button>
        </header>

        <div className="border-b border-gray-100 px-5 py-3">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-gray-300 px-3 focus-within:border-brand-500">
            <Search size={14} className="text-gray-400" />
            <input
              autoFocus aria-label="Search templates" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates…" className="min-w-0 flex-1 text-sm focus:outline-none"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="mb-3 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
          {templates === null && <p className="text-sm text-gray-400">Loading…</p>}
          {templates !== null && shown.length === 0 && (
            <p className="text-sm text-gray-500">
              {templates.length === 0
                ? 'No templates yet. Build a checklist on a task, then choose “Save as template” from its menu.'
                : 'No template matches that.'}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {shown.map((t) => (
              <div key={t.id} className="group relative rounded-xl border border-gray-200 transition-colors hover:border-brand-300 hover:bg-brand-50/40">
                <button type="button" onClick={() => onPick(t)} className="block w-full px-4 py-3 text-left">
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
                    <CheckSquare size={14} className="text-gray-400" /> {t.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-500">{t.item_count} item{t.item_count === 1 ? '' : 's'}</span>
                  <ul className="mt-2 space-y-0.5">
                    {t.items.slice(0, 4).map((item, i) => (
                      <li key={i} className="truncate text-xs text-gray-500">· {item}</li>
                    ))}
                    {t.items.length > 4 && <li className="text-xs text-gray-400">and {t.items.length - 4} more</li>}
                  </ul>
                </button>
                <button
                  type="button" title="Delete template" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}
                  className="invisible absolute right-2 top-2 rounded p-1 text-gray-400 hover:bg-white hover:text-red-600 group-hover:visible"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Choose which saved checklist this one should overwrite. */
export const TemplateOverwrite: React.FC<{
  checklistName: string;
  onClose: () => void;
  onPick: (template: ChecklistTemplate) => void;
}> = ({ checklistName, onClose, onPick }) => {
  const { workspace } = useWork();
  const [templates, setTemplates] = useState<ChecklistTemplate[] | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEscapeToClose(panel, onClose);

  useEffect(() => {
    if (!workspace) return;
    collabApi.checklistTemplates(workspace.id).then(setTemplates).catch(() => setTemplates([]));
  }, [workspace]);

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div ref={panel} role="dialog" aria-label="Update existing template" onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="border-b border-gray-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-gray-800">Update which template?</h2>
          <p className="mt-0.5 text-xs text-gray-500">“{checklistName}” replaces the items in the template you choose.</p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {templates === null && <p className="px-2 text-sm text-gray-400">Loading…</p>}
          {templates?.length === 0 && <p className="px-2 text-sm text-gray-500">There are no saved templates yet.</p>}
          {(templates ?? []).map((t) => (
            <button key={t.id} type="button" onClick={() => onPick(t)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100">
              <CheckSquare size={14} className="text-gray-400" />
              <span className="flex-1 truncate text-gray-800">{t.name}</span>
              <span className="text-xs text-gray-400">{t.item_count}</span>
            </button>
          ))}
        </div>
        <footer className="flex justify-end border-t border-gray-100 px-4 py-2.5">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        </footer>
      </div>
    </div>
  );
};
