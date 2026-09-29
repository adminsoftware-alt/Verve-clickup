// "Share publicly": secret read-only links to a task, List or view, with who-sees-what options.
import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Globe, Trash2 } from 'lucide-react';
import { Dialog } from './LocationDialogs';
import { publicUrl, spacesApi, type PublicLink } from './spacesApi';

export const PublicLinks: React.FC<{ kind: PublicLink['kind']; id: string; canCreate: boolean }> = ({ kind, id, canCreate }) => {
  const [links, setLinks] = useState<PublicLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState(true);
  const [assignees, setAssignees] = useState(false);
  const [expires, setExpires] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const load = useCallback(() => { spacesApi.publicLinks(kind, id).then(setLinks).catch((e) => setError(e.message)); }, [kind, id]);
  useEffect(() => { load(); }, [load]);
  const create = async () => {
    setError(null);
    try {
      await spacesApi.createLink({ kind, target_id: id, show_description: description, show_assignees: assignees, expires_on: expires || null });
      load();
    } catch (e) { setError((e as Error).message); }
  };
  const copy = (link: PublicLink) => {
    navigator.clipboard?.writeText(publicUrl(link.token)).catch(() => undefined);
    setCopied(link.id);
  };
  return (
    <section className="mt-4 border-t border-gray-100 pt-3" aria-label="Public links">
      <h4 className="flex items-center gap-1.5 text-sm font-medium text-gray-800"><Globe size={14} /> Share publicly</h4>
      <p className="mt-0.5 text-xs text-gray-500">Anyone with the link can read it without signing in. Private tasks are never shown.</p>
      <ul className="mt-2 space-y-1.5">
        {links.map((l) => (
          <li key={l.id} className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1 text-xs">
            <a href={publicUrl(l.token)} target="_blank" rel="noreferrer" aria-label="Public link" className="min-w-0 flex-1 truncate text-brand-700 hover:underline">{publicUrl(l.token)}</a>
            <span className="shrink-0 text-gray-400">{l.views_count} view{l.views_count === 1 ? '' : 's'}{l.expires_at ? ` · until ${new Date(l.expires_at).toLocaleDateString()}` : ''}</span>
            <button type="button" title="Copy link" onClick={() => copy(l)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><Copy size={12} /></button>
            <button type="button" title="Turn off this link" onClick={() => spacesApi.revokeLink(l.id).then(load).catch((e) => setError(e.message))}
              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={12} /></button>
          </li>
        ))}
      </ul>
      {copied && <p className="mt-1 text-xs text-emerald-700">Link copied</p>}
      {canCreate && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
          <label className="flex items-center gap-1"><input type="checkbox" checked={description} onChange={(e) => setDescription(e.target.checked)} /> Descriptions</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={assignees} onChange={(e) => setAssignees(e.target.checked)} /> Assignee names</label>
          <label className="flex items-center gap-1">Expires <input type="date" aria-label="Link expires" value={expires} onChange={(e) => setExpires(e.target.value)} className="rounded border border-gray-300 px-1 py-0.5" /></label>
          <button type="button" onClick={create} className="ml-auto rounded-md bg-brand-600 px-2.5 py-1 font-medium text-white hover:bg-brand-700">Create public link</button>
        </div>
      )}
      {error && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
    </section>
  );
};

export const PublicLinksDialog: React.FC<{ kind: PublicLink['kind']; id: string; name: string; canCreate: boolean; onClose: () => void }> = ({ kind, id, name, canCreate, onClose }) => (
  <Dialog title={`Share “${name}” publicly`} wide onClose={onClose}>
    <PublicLinks kind={kind} id={id} canCreate={canCreate} />
  </Dialog>
);
