// All Spaces, as in ClickUp's "Browse Spaces": join or leave Spaces (show or hide them in your sidebar),
// ask to join private ones that are listed, and let people in to Spaces you manage.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Eye, EyeOff, Lock, Send, X } from 'lucide-react';
import { useWork } from './WorkContext';
import { Avatar } from './ui';
import { spacesApi, type BrowseSpace, type JoinRequest } from './spacesApi';
import { notify } from '../components/notify';

export const AllSpacesPage: React.FC = () => {
  const { workspace, refresh } = useWork();
  const ws = workspace?.id;
  const navigate = useNavigate();
  const [spaces, setSpaces] = useState<BrowseSpace[] | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<BrowseSpace | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!ws) return;
    try {
      const [s, r] = await Promise.all([spacesApi.allSpaces(ws), spacesApi.joinRequests(ws)]);
      setSpaces(s);
      setRequests(r);
    } catch (e) { setError((e as Error).message); }
  }, [ws]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); refresh(); } catch (e) { notify.error(e); }
  };
  const shown = (spaces ?? []).filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-gray-900">All Spaces</h1>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Spaces" aria-label="Search Spaces"
          className="ml-auto w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
      </div>
      <p className="mt-1 text-sm text-gray-500">Join a Space to keep it in your sidebar, or leave it to tidy up. Private Spaces that are listed here can be asked for.</p>
      {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {requests.length > 0 && (
        <section className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4" aria-label="Requests to join">
          <h2 className="text-sm font-semibold text-amber-900">Requests to join</h2>
          <ul className="mt-2 space-y-2">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Avatar user={r.user} size={22} />
                <span className="font-medium">{r.user.display_name || r.user.email}</span>
                <span className="text-gray-600">wants to join <strong>{r.space_name}</strong></span>
                {r.message && <span className="italic text-gray-500">“{r.message}”</span>}
                <span className="ml-auto flex gap-1">
                  <button type="button" onClick={() => act(() => spacesApi.decideJoin(ws!, r.id, true, 'edit'))}
                    className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"><Check size={12} /> Let in</button>
                  <button type="button" onClick={() => act(() => spacesApi.decideJoin(ws!, r.id, false))}
                    className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"><X size={12} /> Decline</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Spaces">
        {shown.map((s) => (
          <li key={s.id} aria-label={s.name} className="flex flex-col rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded text-xs font-semibold text-white" style={{ backgroundColor: s.color || '#6366f1' }}>
                {s.name.slice(0, 1).toUpperCase()}
              </span>
              <button type="button" disabled={!s.permission_level} onClick={() => navigate(`/s/${s.id}`)}
                className="truncate text-left font-medium text-gray-900 enabled:hover:underline">{s.name}</button>
              {s.is_private && <Lock size={12} className="text-gray-400" aria-label="Private" />}
            </div>
            {s.description && <p className="mt-2 line-clamp-2 text-xs text-gray-500">{s.description}</p>}
            <p className="mt-2 text-xs text-gray-400">
              {s.list_count} List{s.list_count === 1 ? '' : 's'}{s.owner ? ` · ${s.owner.display_name || s.owner.email}` : ''}
              {s.permission_level ? ` · ${s.permission_level} access` : ''}
            </p>
            <div className="mt-auto pt-3">
              {!s.permission_level ? (
                s.requested
                  ? <span className="text-xs text-amber-700">Asked to join — waiting</span>
                  : <button type="button" onClick={() => { setAsking(s); setMessage(''); }}
                      className="flex items-center gap-1 rounded-md border border-brand-300 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"><Send size={12} /> Ask to join</button>
              ) : s.joined ? (
                <button type="button" onClick={() => act(() => spacesApi.setJoined(ws!, s.id, false))}
                  className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"><EyeOff size={12} /> Leave (hide)</button>
              ) : (
                <button type="button" onClick={() => act(() => spacesApi.setJoined(ws!, s.id, true))}
                  className="flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700"><Eye size={12} /> Join</button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {spaces && shown.length === 0 && <p className="mt-6 text-center text-sm text-gray-400">No Spaces match.</p>}

      {asking && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onMouseDown={() => setAsking(null)}>
          <form role="dialog" aria-label="Ask to join" onMouseDown={(e) => e.stopPropagation()} className="w-96 rounded-xl bg-white p-5 shadow-xl"
            onSubmit={(e) => { e.preventDefault(); const target = asking; setAsking(null); act(() => spacesApi.requestJoin(ws!, target.id, message)); }}>
            <h3 className="text-base font-semibold text-gray-900">Ask to join {asking.name}</h3>
            <label className="mt-3 block text-sm text-gray-600">Why do you need it? (optional)
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={500}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAsking(null)} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button type="submit" className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Send request</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
