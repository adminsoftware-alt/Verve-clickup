// Two-way sync with Google Calendar and Outlook: sign in once; tasks and time blocks go to the calendar,
// its meetings come to the Planner, and moving one of our events there moves it here too.
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { request } from '../api';
import { useWork } from '../WorkContext';
import { ask } from '../../components/ask';

export interface CalendarConnection {
  id: string; provider: 'google' | 'microsoft'; account_email: string | null; push_tasks: boolean; push_blocks: boolean;
  pull_events: boolean; color: string; event_count: number; synced_at: string | null; error: string | null;
}
const NAMES = { google: 'Google Calendar', microsoft: 'Outlook / Microsoft 365' } as const;

export const syncApi = {
  providers: () => request<{ google: boolean; microsoft: boolean }>('GET', '/calendar-sync/providers'),
  list: (ws: string) => request<CalendarConnection[]>('GET', `/workspaces/${ws}/calendar-connections`),
  start: (ws: string, provider: 'google' | 'microsoft') => request<{ url: string }>('POST', `/workspaces/${ws}/calendar-connections/${provider}/start`),
  update: (id: string, body: Partial<Pick<CalendarConnection, 'push_tasks' | 'push_blocks' | 'pull_events' | 'color'>>) =>
    request<CalendarConnection>('PATCH', `/calendar-connections/${id}`, body),
  sync: (id: string) => request<{ created: number; updated: number; deleted: number; pulled: number; connection: CalendarConnection }>('POST', `/calendar-connections/${id}/sync`),
  remove: (id: string, removeEvents: boolean) => request('DELETE', `/calendar-connections/${id}`, undefined, { remove_events: removeEvents }),
};

export const CalendarConnections: React.FC = () => {
  const { workspace } = useWork();
  const [providers, setProviders] = useState<{ google: boolean; microsoft: boolean } | null>(null);
  const [conns, setConns] = useState<CalendarConnection[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!workspace) return;
    const [p, c] = await Promise.all([syncApi.providers(), syncApi.list(workspace.id)]);
    setProviders(p);
    setConns(c);
  }, [workspace]);
  useEffect(() => { load().catch((e) => setNote(e.message)); }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setNote(null);
    try { await fn(); await load(); } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };
  // Toggles change at once; the save follows (and a failure puts them back on reload).
  const toggle = (c: CalendarConnection, key: 'push_tasks' | 'push_blocks' | 'pull_events', value: boolean) => {
    setConns((prev) => prev.map((x) => (x.id === c.id ? { ...x, [key]: value } : x)));
    run(() => syncApi.update(c.id, { [key]: value }));
  };
  const connect = async (provider: 'google' | 'microsoft') => {
    if (!workspace) return;
    try { window.location.assign((await syncApi.start(workspace.id, provider)).url); } catch (e) { setNote((e as Error).message); }
  };
  return (
    <section aria-label="Two-way sync" className="mb-5 border-b border-gray-100 pb-4">
      <h4 className="text-sm font-semibold text-gray-800">Two-way sync with Google or Outlook</h4>
      <p className="mb-2 text-xs text-gray-500">Your tasks with due dates and your time blocks appear in your calendar; your meetings appear here. Move one of them in the calendar and it moves here too.</p>
      <ul className="space-y-2">
        {conns.map((c) => (
          <li key={c.id} aria-label={`${NAMES[c.provider]} connection`} className="rounded-md border border-gray-200 px-2.5 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
              <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{NAMES[c.provider]} <span className="font-normal text-gray-400">· {c.account_email}</span></span>
              <button type="button" title="Sync now" disabled={busy} onClick={() => run(async () => {
                const r = await syncApi.sync(c.id);
                setNote(r.connection.error ?? `Synced: ${r.created} added, ${r.updated} updated, ${r.deleted} removed, ${r.pulled} brought back`);
              })} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><RefreshCw size={14} /></button>
              <button type="button" title={`Disconnect ${NAMES[c.provider]}`} disabled={busy}
                onClick={async () => await ask.confirm({ danger: true, title: `Disconnect ${NAMES[c.provider]}? Verve Workflow's events will be taken off the calendar.` }) && run(() => syncApi.remove(c.id, true))}
                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
            </div>
            <div className="mt-1 flex flex-wrap gap-3 pl-5 text-xs text-gray-600">
              <label className="flex items-center gap-1"><input type="checkbox" checked={c.push_tasks} onChange={(e) => toggle(c, 'push_tasks', e.target.checked)} /> My tasks</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={c.push_blocks} onChange={(e) => toggle(c, 'push_blocks', e.target.checked)} /> Time blocks</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={c.pull_events} onChange={(e) => toggle(c, 'pull_events', e.target.checked)} /> Show my meetings</label>
            </div>
            <p className={`mt-1 pl-5 text-xs ${c.error ? 'text-red-600' : 'text-gray-400'}`}>
              {c.error ?? (c.synced_at ? `Synced ${new Date(c.synced_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${c.event_count} meetings · syncs every 5 minutes` : 'Not synced yet')}
            </p>
          </li>
        ))}
      </ul>
      {providers && (
        <div className="mt-2 flex flex-wrap gap-2">
          {(['google', 'microsoft'] as const).filter((p) => !conns.some((c) => c.provider === p)).map((p) => (
            <button key={p} type="button" disabled={!providers[p]} onClick={() => connect(p)} title={providers[p] ? undefined : 'Not set up on the server yet'}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
              Connect {NAMES[p]}
            </button>
          ))}
          {!providers.google && !providers.microsoft && (
            <span className="text-xs text-gray-400">An admin needs to add the Google or Microsoft app keys on the server first. Until then, use the iCal addresses below.</span>
          )}
        </div>
      )}
      {note && <p role="status" className="mt-2 text-xs text-gray-600">{note}</p>}
    </section>
  );
};
