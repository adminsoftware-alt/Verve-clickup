import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Pencil, Plus, Trash2, X } from 'lucide-react';
import { workApi, type CustomField, type FieldConfig, type FieldOption, type FieldType, type LocationKind } from '../api';
import { Portal } from '../ui';
import { useWork } from '../WorkContext';
import { FIELD_TYPES, fieldIcon } from './FieldValue';
import { ask } from '../../components/ask';

const KIND = { space: 'Space', folder: 'Folder', list: 'List' } as const;
const SWATCHES = ['#7c3aed', '#0ea5e9', '#16a34a', '#ea580c', '#db2777', '#4f46e5', '#0d9488', '#b45309', '#dc2626', '#64748b'];

type Draft = { id?: string; name: string; type: FieldType; config: FieldConfig };

const OptionsEditor: React.FC<{ options: FieldOption[]; onChange: (o: FieldOption[]) => void }> = ({ options, onChange }) => (
  <div className="mt-3">
    <p className="mb-1 text-xs font-medium text-gray-600">Options</p>
    {options.map((o, i) => (
      <div key={o.id || i} className="mb-1 flex items-center gap-2">
        <label className="relative h-4 w-4 shrink-0 cursor-pointer rounded-full" style={{ backgroundColor: o.color }} title="Colour">
          <input type="color" value={o.color} onChange={(e) => onChange(options.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} className="absolute inset-0 opacity-0" aria-label={`Colour of ${o.name || 'option'}`} />
        </label>
        <input value={o.name} placeholder={`Option ${i + 1}`} aria-label="Option name" autoFocus={!o.name}
          onChange={(e) => onChange(options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm" />
        <button type="button" title="Remove option" onClick={() => onChange(options.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>
      </div>
    ))}
    <button type="button" onClick={() => onChange([...options, { id: '', name: '', color: SWATCHES[options.length % SWATCHES.length] }])}
      className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-brand-600 hover:bg-brand-50"><Plus size={12} /> Add option</button>
  </div>
);

/** ClickUp's custom field manager for a Space, Folder or List. */
export const FieldsDialog: React.FC<{
  kind: LocationKind; id: string; name: string; canEdit: boolean; startCreating?: boolean;
  onClose: () => void; onChanged: () => void;
}> = ({ kind, id, name, canEdit, startCreating, onClose, onChanged }) => {
  const { locate } = useWork();
  const [fields, setFields] = useState<CustomField[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(startCreating && canEdit ? { name: '', type: 'dropdown', config: { options: [] } } : null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => workApi.fields(kind, id).then(setFields).catch((e) => setError(e.message)), [kind, id]);
  useEffect(() => { load(); }, [load]);

  const where = (f: CustomField) => {
    if (f.location === kind && f.location_id === id) return null;
    const node = locate(f.location, f.location_id);
    return `From ${KIND[f.location]} ${node ? `“${node.path[node.path.length - 1]?.name}”` : ''}`;
  };
  const pickType = (type: FieldType) => setDraft((d) => d && ({
    ...d, type,
    config: type === 'dropdown' || type === 'labels' ? { options: d.config.options ?? [] }
      : type === 'money' ? { currency: 'INR' } : type === 'rating' ? { max: 5 } : type === 'number' ? { precision: 0 } : type === 'date' ? { include_time: false } : {},
  }));
  const save = async () => {
    if (!draft) return;
    setError(null);
    const config = draft.config.options ? { ...draft.config, options: draft.config.options.filter((o) => o.name.trim()) } : draft.config;
    try {
      if (draft.id) await workApi.updateField(draft.id, { name: draft.name.trim(), config });
      else await workApi.createField(kind, id, { name: draft.name.trim(), type: draft.type, config });
      setDraft(null);
      await load();
      onChanged();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async (f: CustomField) => {
    if (!(await ask.confirm({ danger: true, title: `Delete the field “${f.name}”? Its value is removed from every task.` }))) return;
    try { await workApi.deleteField(f.id); await load(); onChanged(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div role="dialog" aria-label="Custom fields" onMouseDown={(e) => e.stopPropagation()}
          className="flex max-h-[85vh] w-[34rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white p-5 shadow-xl">
          <div className="mb-3 flex items-center gap-2">
            {draft && <button type="button" title="Back" onClick={() => setDraft(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100"><ArrowLeft size={16} /></button>}
            <h3 className="font-semibold text-gray-900">{draft ? (draft.id ? `Edit ${draft.name}` : 'New custom field') : `Custom fields · ${name}`}</h3>
            <button type="button" title="Close" onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>
          {error && <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {draft ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <label className="block text-xs font-medium text-gray-600">Field name
                <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Client tier"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal" />
              </label>
              {!draft.id && (
                <>
                  <p className="mb-1 mt-3 text-xs font-medium text-gray-600">Type</p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label="Field type">
                    {FIELD_TYPES.map((t) => (
                      <button key={t.type} type="button" role="radio" aria-checked={draft.type === t.type} onClick={() => pickType(t.type)}
                        className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 text-left ${draft.type === t.type ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <span className="mt-0.5 text-gray-500">{t.icon}</span>
                        <span><span className="block text-sm text-gray-800">{t.label}</span><span className="block text-[11px] text-gray-400">{t.hint}</span></span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {(draft.type === 'dropdown' || draft.type === 'labels') && (
                <OptionsEditor options={draft.config.options ?? []} onChange={(options) => setDraft({ ...draft, config: { ...draft.config, options } })} />
              )}
              {draft.type === 'money' && (
                <label className="mt-3 block text-xs font-medium text-gray-600">Currency
                  <select value={draft.config.currency ?? 'INR'} onChange={(e) => setDraft({ ...draft, config: { currency: e.target.value } })} className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-sm font-normal">
                    {['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD'].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
              )}
              {draft.type === 'rating' && (
                <label className="mt-3 block text-xs font-medium text-gray-600">Number of stars
                  <input type="number" min={1} max={10} value={draft.config.max ?? 5} onChange={(e) => setDraft({ ...draft, config: { max: Math.max(1, Math.min(10, Number(e.target.value) || 5)) } })}
                    className="mt-1 block w-20 rounded-md border border-gray-300 px-2 py-1 text-sm font-normal" />
                </label>
              )}
              {draft.type === 'number' && (
                <label className="mt-3 block text-xs font-medium text-gray-600">Decimal places
                  <input type="number" min={0} max={4} value={draft.config.precision ?? 0} onChange={(e) => setDraft({ ...draft, config: { precision: Math.max(0, Math.min(4, Number(e.target.value) || 0)) } })}
                    className="mt-1 block w-20 rounded-md border border-gray-300 px-2 py-1 text-sm font-normal" />
                </label>
              )}
              {draft.type === 'date' && (
                <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={!!draft.config.include_time} onChange={(e) => setDraft({ ...draft, config: { include_time: e.target.checked } })} /> Include a time
                </label>
              )}
              {!draft.id && <p className="mt-3 text-xs text-gray-500">Every task in this {KIND[kind]}{kind !== 'list' ? ' and the Lists inside it' : ''} can use this field. A field's type can't be changed later.</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setDraft(null)} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
                <button type="button" disabled={!draft.name.trim()} onClick={save} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                  {draft.id ? 'Save' : 'Create field'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <ul className="min-h-0 flex-1 overflow-auto" aria-label="Fields">
                {fields === null ? <li className="text-sm text-gray-400">Loading…</li>
                  : fields.length === 0 ? <li className="py-6 text-center text-sm text-gray-400">No custom fields yet. Add one to track things like client tier, fee or KYC status on every task.</li>
                  : fields.map((f) => (
                    <li key={f.id} className="group flex items-center gap-2 border-t border-gray-100 py-2 first:border-t-0">
                      <span className="text-gray-400">{fieldIcon(f.type)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-gray-800">{f.name}</span>
                        <span className="block text-[11px] text-gray-400">{FIELD_TYPES.find((t) => t.type === f.type)?.label}{where(f) ? ` · ${where(f)}` : ''}</span>
                      </span>
                      {canEdit && (
                        <>
                          <button type="button" title={`Edit ${f.name}`} onClick={() => setDraft({ id: f.id, name: f.name, type: f.type, config: f.config })} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Pencil size={13} /></button>
                          <button type="button" title={`Delete ${f.name}`} onClick={() => remove(f)} className="rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-red-600"><Trash2 size={13} /></button>
                        </>
                      )}
                    </li>
                  ))}
              </ul>
              {canEdit && (
                <button type="button" onClick={() => setDraft({ name: '', type: 'dropdown', config: { options: [] } })}
                  className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 py-2 text-sm text-gray-600 hover:bg-gray-50">
                  <Plus size={14} /> New field
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Portal>
  );
};
