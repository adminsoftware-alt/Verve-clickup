import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Link2, RefreshCw, Trash2 } from 'lucide-react';
import { useWork } from '../WorkContext';
import { Modal } from '../dashboards/dialogs';
import { planningApi, type CalendarFeed } from '../planningApi';

const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];
const input = 'w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none';

/** Calendar sync both ways: see your meetings in the Planner, and your tasks in Google or Outlook. */
export const CalendarsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { workspace } = useWork();
  const [feeds, setFeeds] = useState<CalendarFeed[] | null>(null);
  const [form, setForm] = useState({ name: '', url: '', color: COLORS[0] });
  const [link, setLink] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!workspace) return;
    const [f, l] = await Promise.all([planningApi.calendars(workspace.id), planningApi.calendarLink(workspace.id)]);
    setFeeds(f);
    setLink(l.url);
  }, [workspace]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace || !form.name.trim() || !form.url.trim()) return;
    act(async () => { await planningApi.addCalendar(workspace.id, { name: form.name.trim(), url: form.url.trim(), color: form.color }); setForm({ name: '', url: '', color: COLORS[(feeds?.length ?? 0) % COLORS.length] }); });
  };
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the address is selectable */ }
  };

  return (
    <Modal label="Calendars" title="Calendars" onClose={onClose} width="w-[38rem]">
      <section aria-label="Your calendars">
        <h4 className="text-sm font-semibold text-gray-800">See your meetings in the Planner</h4>
        <p className="mb-2 text-xs text-gray-500">
          Paste your calendar's secret iCal address. In Google Calendar: Settings → your calendar → “Secret address in iCal format”.
          In Outlook: Settings → Calendar → Shared calendars → Publish a calendar → ICS link. Timetriq reads it every 30 minutes.
        </p>
        <ul className="mb-3 space-y-1.5">
          {feeds === null ? <li className="text-xs text-gray-400">Loading…</li> : feeds.length === 0 ? <li className="text-xs text-gray-400">No calendars connected yet.</li> : feeds.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm" aria-label={`Calendar ${f.name}`}>
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: f.color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-gray-800">{f.name} <span className="font-normal text-gray-400">· {f.host}</span></div>
                <div className={`text-xs ${f.error ? 'text-red-600' : 'text-gray-400'}`}>{f.error ?? `${f.event_count} events${f.fetched_at ? ` · read ${new Date(f.fetched_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}`}</div>
              </div>
              <button type="button" title="Read it again now" disabled={busy} onClick={() => workspace && act(() => planningApi.syncCalendar(workspace.id, f.id))} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><RefreshCw size={14} /></button>
              <button type="button" title={`Disconnect ${f.name}`} disabled={busy} onClick={() => workspace && window.confirm(`Disconnect “${f.name}”?`) && act(() => planningApi.removeCalendar(workspace.id, f.id))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="grid grid-cols-[1fr_2fr_auto] items-end gap-2" aria-label="Connect a calendar">
          <label className="text-xs text-gray-600">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} placeholder="Work" className={`${input} mt-1`} /></label>
          <label className="text-xs text-gray-600">iCal address<input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" className={`${input} mt-1`} /></label>
          <button type="submit" disabled={busy || !form.name.trim() || !form.url.trim()} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">Connect</button>
          <div className="col-span-3 flex items-center gap-1.5" role="radiogroup" aria-label="Colour">
            {COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={form.color === c} aria-label={c} onClick={() => setForm({ ...form, color: c })}
                className={`h-5 w-5 rounded-full ${form.color === c ? 'ring-2 ring-gray-400 ring-offset-1' : ''}`} style={{ backgroundColor: c }} />
            ))}
          </div>
        </form>
      </section>

      <section aria-label="Your tasks in other calendars" className="mt-5 border-t border-gray-100 pt-4">
        <h4 className="text-sm font-semibold text-gray-800">See your tasks in Google or Outlook</h4>
        <p className="mb-2 text-xs text-gray-500">
          A private address with your open tasks (at their due time) and your time blocks. Add it in Google Calendar under “Other calendars → From URL”,
          or in Outlook under “Add calendar → Subscribe from web”. Anyone with the address can see these tasks, so keep it to yourself.
        </p>
        {link === undefined ? null : link ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input readOnly value={link} aria-label="Your tasks calendar address" onFocus={(e) => e.target.select()} className={`${input} font-mono text-xs`} />
              <button type="button" onClick={copy} className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 text-sm text-gray-700 hover:bg-gray-50"><Copy size={13} /> {copied ? 'Copied' : 'Copy'}</button>
            </div>
            <div className="flex gap-3 text-xs">
              <button type="button" disabled={busy} onClick={() => workspace && window.confirm('Make a new address? The old one stops working.') && act(() => planningApi.makeCalendarLink(workspace.id, true))} className="text-gray-600 hover:underline">Make a new address</button>
              <button type="button" disabled={busy} onClick={() => workspace && act(() => planningApi.stopCalendarLink(workspace.id))} className="text-red-600 hover:underline">Stop sharing</button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => workspace && act(() => planningApi.makeCalendarLink(workspace.id))} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><Link2 size={14} /> Get my calendar address</button>
        )}
      </section>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
    </Modal>
  );
};
