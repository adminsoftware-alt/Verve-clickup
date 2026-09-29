import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, CheckCircle2, Copy, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { workApi, type CustomField, type FormDef, type View } from '../api';
import { PRIORITIES } from '../ui';
import { useWork } from '../WorkContext';
import { FieldEditor } from '../fields/FieldValue';

interface FormFieldSetting { key: string; label?: string; required?: boolean; help?: string }
interface FormSettings { title?: string; description?: string; fields?: FormFieldSetting[]; assignee_ids?: string[]; active?: boolean; success?: string }

const CORE: { key: string; label: string }[] = [
  { key: 'name', label: 'Task name' }, { key: 'description', label: 'Description' }, { key: 'due_date', label: 'Due date' },
  { key: 'start_date', label: 'Start date' }, { key: 'priority', label: 'Priority' }, { key: 'time_estimate', label: 'Time estimate (hours)' },
];
const input = 'mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal';

/** Fill in a form; used on the shareable form page and as the builder's preview. */
export const FormFill: React.FC<{ viewId: string; preview?: boolean; refreshKey?: number }> = ({ viewId, preview, refreshKey }) => {
  const { members } = useWork();
  const [form, setForm] = useState<FormDef | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { workApi.form(viewId).then(setForm).catch((e) => setError(e.message)); }, [viewId, refreshKey]);
  const set = (key: string, value: unknown) => setAnswers((a) => ({ ...a, [key]: value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preview) return;
    setError(null);
    try { setDone((await workApi.submitForm(viewId, answers)).message); setAnswers({}); } catch (err) { setError((err as Error).message); }
  };
  if (!form) return <p className="p-6 text-sm text-gray-400">{error ?? 'Loading…'}</p>;
  if (done) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center" role="status">
        <CheckCircle2 size={36} className="mx-auto text-emerald-500" />
        <p className="mt-3 text-base font-medium text-gray-900">{done}</p>
        <button type="button" onClick={() => setDone(null)} className="mt-4 text-sm text-brand-600 hover:underline">Submit another response</button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-white p-6" aria-label={form.title}>
      <h2 className="text-xl font-semibold text-gray-900">{form.title}</h2>
      {form.description && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{form.description}</p>}
      {!form.active && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">This form isn't taking responses right now.</p>}
      <div className="mt-5 space-y-4">
        {form.fields.map((f) => (
          <div key={f.key}>
            <label className="block text-sm font-medium text-gray-800" htmlFor={`f-${f.key}`}>{f.label}{f.required && <span className="text-red-500"> *</span>}</label>
            {f.help && <p className="text-xs text-gray-500">{f.help}</p>}
            {f.field ? (
              <div className="mt-1 rounded-md border border-gray-300 px-1 py-1">
                <FieldEditor field={{ ...f.field, name: f.label }} value={answers[f.key]} people={members.map((m) => m.user)} onChange={(v) => set(f.key, v)} />
              </div>
            ) : f.type === 'long_text' ? (
              <textarea id={`f-${f.key}`} aria-label={f.label} rows={3} value={(answers[f.key] as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} className={input} />
            ) : f.type === 'date' ? (
              <input id={`f-${f.key}`} aria-label={f.label} type="date" value={(answers[f.key] as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} className={input} />
            ) : f.type === 'priority' ? (
              <select id={`f-${f.key}`} aria-label={f.label} value={(answers[f.key] as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} className={input}>
                <option value="">—</option>{[1, 2, 3, 4].map((p) => <option key={p} value={p}>{PRIORITIES[p].label}</option>)}
              </select>
            ) : f.type === 'number' ? (
              <input id={`f-${f.key}`} aria-label={f.label} type="number" min={0} step="0.25" value={(answers[f.key] as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} className={input} />
            ) : (
              <input id={`f-${f.key}`} aria-label={f.label} value={(answers[f.key] as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} className={input} />
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={preview || !form.active} className="mt-5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {preview ? 'Submit (preview)' : 'Submit'}
      </button>
    </form>
  );
};

/** ClickUp's Form view: build a form that creates tasks in this List. */
export const FormBuilder: React.FC<{ view: View; listId: string; canEdit: boolean; onSaved: (v: View) => void }> = ({ view, listId, canEdit, onSaved }) => {
  const { members } = useWork();
  const [fields, setFields] = useState<CustomField[]>([]);
  const saved = ((view.settings?.form as FormSettings) ?? {});
  const [form, setForm] = useState<FormSettings>(saved);
  const [previewKey, setPreviewKey] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { workApi.fields('list', listId).then(setFields).catch(() => setFields([])); }, [listId]);
  useEffect(() => { setForm(((view.settings?.form as FormSettings) ?? {})); }, [view]);
  const list: FormFieldSetting[] = form.fields?.length ? form.fields : [{ key: 'name', required: true }];
  const choices = useMemo(() => [
    ...CORE.filter((c) => !list.some((f) => f.key === c.key)),
    ...fields.filter((f) => !list.some((x) => x.key === `cf:${f.id}`)).map((f) => ({ key: `cf:${f.id}`, label: f.name })),
  ], [list, fields]);
  const labelOf = (key: string) => CORE.find((c) => c.key === key)?.label ?? fields.find((f) => `cf:${f.id}` === key)?.name ?? key;
  const setFieldAt = (i: number, patch: Partial<FormFieldSetting>) => setForm((f) => ({ ...f, fields: list.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const moveField = (i: number, d: number) => {
    const next = [...list];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setForm((f) => ({ ...f, fields: next }));
  };
  const save = async () => {
    try {
      const out = await workApi.updateView(view.id, { settings: { ...(view.settings ?? {}), form: { ...form, fields: list } } });
      onSaved(out);
      setPreviewKey((k) => k + 1);
      setNote('Form saved');
      setTimeout(() => setNote(null), 2000);
    } catch (e) { setNote((e as Error).message); }
  };
  const link = `${window.location.origin}/forms/${view.id}`;
  return (
    <div className="grid grid-cols-1 gap-6 px-6 py-4 lg:grid-cols-2">
      <section aria-label="Form builder" className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-600">{link}</span>
          <button type="button" onClick={() => { navigator.clipboard?.writeText(link); setNote('Link copied'); setTimeout(() => setNote(null), 2000); }} className="flex items-center gap-1 rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"><Copy size={12} /> Copy link</button>
          <a href={`/forms/${view.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700 no-underline hover:bg-gray-50"><ExternalLink size={12} /> Open</a>
        </div>
        <p className="text-xs text-gray-500">Anyone in the workspace can fill this in; each response becomes a task in this List.</p>
        {!canEdit ? <p className="text-sm text-gray-500">You need edit access to change this form.</p> : (
          <>
            <label className="block text-xs font-medium text-gray-600">Form title<input aria-label="Form title" value={form.title ?? ''} placeholder={view.name} onChange={(e) => setForm({ ...form, title: e.target.value })} className={input} /></label>
            <label className="block text-xs font-medium text-gray-600">Description<textarea aria-label="Form description" rows={2} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} className={input} /></label>
            <div>
              <p className="mb-1 text-xs font-medium text-gray-600">Questions</p>
              <ul className="space-y-1.5" aria-label="Questions">
                {list.map((f, i) => (
                  <li key={f.key} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5">
                    <input aria-label={`Question label for ${labelOf(f.key)}`} value={f.label ?? ''} placeholder={labelOf(f.key)} onChange={(e) => setFieldAt(i, { label: e.target.value })} className="min-w-0 flex-1 text-sm focus:outline-none" />
                    <label className="flex items-center gap-1 text-xs text-gray-500"><input type="checkbox" checked={f.key === 'name' || !!f.required} disabled={f.key === 'name'} onChange={(e) => setFieldAt(i, { required: e.target.checked })} /> Required</label>
                    <button type="button" title="Move up" onClick={() => moveField(i, -1)} className="text-gray-300 hover:text-gray-600"><ArrowUp size={13} /></button>
                    <button type="button" title="Move down" onClick={() => moveField(i, 1)} className="text-gray-300 hover:text-gray-600"><ArrowDown size={13} /></button>
                    {f.key !== 'name' && <button type="button" title="Remove question" onClick={() => setForm({ ...form, fields: list.filter((_, j) => j !== i) })} className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>}
                  </li>
                ))}
              </ul>
              {choices.length > 0 && (
                <select aria-label="Add a question" value="" onChange={(e) => e.target.value && setForm({ ...form, fields: [...list, { key: e.target.value }] })} className="mt-2 rounded-md border border-dashed border-gray-300 px-2 py-1 text-sm text-gray-600">
                  <option value="">+ Add a question…</option>
                  {choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              )}
            </div>
            <label className="block text-xs font-medium text-gray-600">Assign new tasks to
              <select aria-label="Assign responses to" multiple value={form.assignee_ids ?? []} onChange={(e) => setForm({ ...form, assignee_ids: [...e.target.selectedOptions].map((o) => o.value) })} className={`${input} h-24`}>
                {members.filter((m) => m.role !== 'guest').map((m) => <option key={m.user.id} value={m.user.id}>{m.user.display_name || m.user.email}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-gray-600">Thank-you message<input aria-label="Thank-you message" value={form.success ?? ''} placeholder="Thanks! Your request has been received." onChange={(e) => setForm({ ...form, success: e.target.value })} className={input} /></label>
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Taking responses</label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={save} className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"><Plus size={14} className="hidden" /> Save form</button>
              {note && <span className="text-xs text-emerald-700" role="status">{note}</span>}
            </div>
          </>
        )}
      </section>
      <section aria-label="Form preview">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Preview</p>
        <FormFill viewId={view.id} preview refreshKey={previewKey} />
      </section>
    </div>
  );
};

/** The shareable page: /forms/:viewId. */
export const FormPage: React.FC = () => {
  const { viewId = '' } = useParams();
  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <FormFill viewId={viewId} />
    </div>
  );
};
