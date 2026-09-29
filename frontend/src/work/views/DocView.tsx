// Doc view: pages of formatted text that live next to a location's tasks (SOPs, meeting notes, briefs).
// Saved with a version number, so two people editing at once never silently overwrite each other.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { RichTextEditor } from '../task/RichText';
import { spacesApi, type ViewContent } from '../spacesApi';
import { ask } from '../../components/ask';

interface Page { id: string; title: string; body: string }
interface Doc { pages: Page[] }

const newId = () => Math.random().toString(36).slice(2, 10);
const readDoc = (raw: unknown): Doc => {
  const pages = (raw as { pages?: unknown })?.pages;
  const ok = Array.isArray(pages) ? pages.filter((p): p is Page => !!p && typeof p === 'object' && typeof (p as Page).id === 'string') : [];
  return { pages: ok.map((p) => ({ id: p.id, title: String(p.title ?? ''), body: String(p.body ?? '') })) };
};

export const DocView: React.FC<{ viewId: string; canEdit: boolean }> = ({ viewId, canEdit }) => {
  const [data, setData] = useState<ViewContent<Doc> | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const got = await spacesApi.content<Doc>(viewId);
      const doc = readDoc(got.content);
      setData({ ...got, content: doc });
      setPageId((cur) => (cur && doc.pages.some((p) => p.id === cur) ? cur : doc.pages[0]?.id ?? null));
    } catch (e) { setError((e as Error).message); }
  }, [viewId]);
  useEffect(() => { load(); }, [load]);

  // Saves go one at a time, each on top of the version the previous one produced.
  const current = useRef<ViewContent<Doc> | null>(null);
  useEffect(() => { current.current = data; }, [data]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const save = (edit: (doc: Doc) => Doc) => {
    if (!current.current) return;
    const next = { ...current.current, content: edit(current.current.content) };
    current.current = next;
    setData(next);
    setSaving(true);
    setError(null);
    queue.current = queue.current.then(async () => {
      const base = current.current!;
      try {
        const saved = await spacesApi.saveContent<Doc>(viewId, base.content, base.version);
        const merged = { ...saved, content: current.current!.content };
        current.current = merged;
        setData(merged);
      } catch (e) {
        setError(`${(e as Error).message}. Your last change wasn't saved.`);
        await load();
      } finally { setSaving(false); }
    });
  };

  if (!data) return <p className="p-10 text-center text-sm text-gray-400">{error ?? 'Loading…'}</p>;
  const doc = data.content;
  const page = doc.pages.find((p) => p.id === pageId) ?? null;
  const addPage = () => {
    const p = { id: newId(), title: doc.pages.length ? 'Untitled' : 'Overview', body: '' };
    save((d) => ({ pages: [...d.pages, p] }));
    setPageId(p.id);
  };
  const updatePage = (patch: Partial<Page>) => page && save((d) => ({ pages: d.pages.map((p) => (p.id === page.id ? { ...p, ...patch } : p)) }));

  return (
    <div className="flex h-full min-h-0">
      <nav className="w-56 shrink-0 overflow-auto border-r border-gray-100 p-3" aria-label="Pages">
        <ul className="space-y-0.5">
          {doc.pages.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setPageId(p.id)}
                className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm ${p.id === pageId ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-50'}`}>
                <FileText size={13} className="shrink-0" /> <span className="truncate">{p.title || 'Untitled'}</span>
              </button>
            </li>
          ))}
        </ul>
        {canEdit && (
          <button type="button" onClick={addPage} className="mt-2 flex items-center gap-1 px-2 text-xs text-brand-600 hover:underline"><Plus size={12} /> Add page</button>
        )}
      </nav>
      <article className="min-w-0 flex-1 overflow-auto px-10 py-6">
        {error && <p role="alert" className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>}
        {page ? (
          <>
            <input key={page.id + page.title} defaultValue={page.title} disabled={!canEdit} aria-label="Page title" placeholder="Untitled"
              onBlur={(e) => { if (e.target.value !== page.title) updatePage({ title: e.target.value.slice(0, 200) }); }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="w-full border-none text-3xl font-bold text-gray-900 placeholder:text-gray-300 focus:outline-none" />
            <div className="mt-4">
              <RichTextEditor key={page.id} value={page.body} disabled={!canEdit} placeholder="Write here — Markdown works" onSave={(body) => updatePage({ body })} />
            </div>
            <div className="mt-6 flex items-center gap-3 text-xs text-gray-400">
              {saving ? 'Saving…' : data.updated_at ? `Saved ${new Date(data.updated_at).toLocaleString()}${data.updated_by ? ` by ${data.updated_by.display_name || data.updated_by.email}` : ''}` : ''}
              {canEdit && doc.pages.length > 1 && (
                <button type="button" onClick={async () => { if (await ask.confirm({ danger: true, title: `Delete the page “${page.title || 'Untitled'}”?` })) save((d) => ({ pages: d.pages.filter((p) => p.id !== page.id) })); }}
                  className="ml-auto flex items-center gap-1 text-red-500 hover:underline"><Trash2 size={12} /> Delete page</button>
              )}
            </div>
          </>
        ) : (
          <div className="mx-auto mt-16 max-w-sm text-center">
            <FileText size={32} className="mx-auto text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">Write SOPs, notes and briefs right beside the work.</p>
            {canEdit && <button type="button" onClick={addPage} className="mt-4 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Start writing</button>}
          </div>
        )}
      </article>
    </div>
  );
};
