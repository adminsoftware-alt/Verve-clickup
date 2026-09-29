// Embed view: another site (a Google Sheet, a YouTube video, a Figma file…) shown inside the location.
import React, { useState } from 'react';
import { ExternalLink, Globe } from 'lucide-react';
import type { View } from '../api';
import { spacesApi } from '../spacesApi';

export const EmbedView: React.FC<{ view: View; canEdit: boolean; onSaved: (v: View) => void }> = ({ view, canEdit, onSaved }) => {
  const url = typeof view.settings.url === 'string' ? view.settings.url : '';
  const source = typeof view.settings.source_url === 'string' ? view.settings.source_url : url;
  const [draft, setDraft] = useState(source);
  const [editing, setEditing] = useState(!url);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try { onSaved(await spacesApi.setEmbed(view.id, draft.trim())); setEditing(false); } catch (err) { setError((err as Error).message); }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      {(editing || !url) && canEdit ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-6 py-3" aria-label="Embed address">
          <Globe size={15} className="text-gray-400" />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://docs.google.com/spreadsheets/…" aria-label="Address to embed"
            className="min-w-[20rem] flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          <button type="submit" disabled={!draft.trim().startsWith('https://')} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">Embed</button>
          {url && <button type="button" onClick={() => setEditing(false)} className="text-sm text-gray-500">Cancel</button>}
          {error && <span className="w-full text-xs text-red-600">{error}</span>}
          <span className="w-full text-[11px] text-gray-400">Google Docs and Sheets, YouTube, Figma, Loom and most https pages that allow embedding. Some sites refuse to be shown inside other apps.</span>
        </form>
      ) : url ? (
        <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-1.5 text-xs text-gray-500">
          <span className="min-w-0 flex-1 truncate">{source}</span>
          <a href={source} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-brand-600 hover:underline"><ExternalLink size={12} /> Open</a>
          {canEdit && <button type="button" onClick={() => { setDraft(source); setEditing(true); }} className="text-brand-600 hover:underline">Change</button>}
        </div>
      ) : null}
      {url ? (
        <iframe title={view.name} src={url} className="min-h-0 w-full flex-1 border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation" referrerPolicy="no-referrer" />
      ) : !canEdit ? <p className="p-10 text-center text-sm text-gray-400">Nothing embedded yet.</p> : null}
    </div>
  );
};
