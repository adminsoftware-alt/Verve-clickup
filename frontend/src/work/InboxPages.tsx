import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, Bell, BellOff, Check, CheckCheck, Clock, Inbox as InboxIcon, MessageSquare, Plus, Settings, Trash2, UserCheck, X } from 'lucide-react';
import { useWork } from './WorkContext';
import { disablePush, enablePush, outboundApi, type Delivery } from './outboundApi';
import { collabApi, type CommentWithTask, type InboxItem, type InboxTab, type NotificationSetting, type Reminder } from './collabApi';
import { Avatar, Portal, StatusDot } from './ui';
import { TaskPanel } from './TaskPanel';
import { ReminderDialog } from './task/TaskActions';

export const INBOX_CHANGED = 'timetriq:inbox';
export const inboxChanged = () => window.dispatchEvent(new Event(INBOX_CHANGED));

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const dayRange = (from: string, to: string) => {
  const f = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return from === to ? f(from) : `${f(from)} – ${f(to)}`;
};

/** What happened, in words: "assigned you", "mentioned you", … */
function describe(item: InboxItem): string {
  const d = item.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (item.kind) {
    case 'assigned': return 'assigned you to this task';
    case 'mentioned': return 'mentioned you';
    case 'reply': return 'replied in a thread';
    case 'comment': return 'commented';
    case 'assigned_comment': return 'assigned you a comment';
    case 'status': return `changed the status from ${d.from ?? '—'} to ${d.to ?? '—'}`;
    case 'due_date': return d.to ? `changed the due date to ${new Date(String(d.to)).toLocaleDateString()}` : 'removed the due date';
    case 'assignees': return 'changed the assignees';
    case 'attachment': return `attached ${d.filename ?? 'a file'}`;
    case 'checklist_item': return `assigned you a checklist item: ${d.item}`;
    case 'custom_field': return d.cleared ? `cleared ${d.field}` : `set ${d.field}`;
    case 'reminder': return 'Reminder';
    case 'automation': return `Automation: ${d.rule ?? 'a rule ran'}`;
    case 'leave_request': return `asked for ${d.type} leave, ${dayRange(d.from, d.to)} (${d.days} day${d.days === 1 ? '' : 's'})`;
    case 'leave_decision': return `${d.status === 'approved' ? 'approved' : 'declined'} your ${d.type} leave, ${dayRange(d.from, d.to)}${d.note ? `: “${d.note}”` : ''}`;
    case 'escalation': return `Escalation: ${d.message || d.rule || 'this task needs attention'}`;
    case 'timesheet_reminder': return `Timesheet reminder: ${Math.round(d.tracked / 360) / 10}h logged so far this week, of ${Math.round(d.expected / 360) / 10}h. Please fill it in.`;
    case 'space_join_request': return `asked to join the ${d.space} Space${d.message ? `: “${d.message}”` : ''}`;
    case 'space_join_decision': return d.status === 'approved' ? `let you into the ${d.space} Space` : `declined your request to join ${d.space}`;
    case 'chat_mention': return `mentioned you in ${d.view ?? 'a chat'}: “${d.body ?? ''}”`;
    case 'shared': {
      const what = d.what === 'list' ? 'List' : d.what === 'space' ? 'Space' : d.what === 'folder' ? 'Folder' : 'task';
      const level = d.level === 'full' ? 'full access' : d.level === 'edit' ? 'edit access' : d.level === 'comment' ? 'comment access' : 'view access';
      return `shared the ${what} “${d.name ?? 'untitled'}” with ${d.team ? `your Team ${d.team}` : 'you'} (${level})`;
    }
    default: return item.kind.replace(/_/g, ' ');
  }
}

const Page: React.FC<{ icon: React.ReactNode; title: string; actions?: React.ReactNode; children: React.ReactNode }> = ({ icon, title, actions, children }) => (
  <div className="flex h-full min-h-0 flex-col bg-white">
    <header className="flex items-center gap-2 border-b border-gray-200 px-6 py-3.5">
      <span className="text-gray-500">{icon}</span>
      <h1 className="text-base font-semibold text-gray-900">{title}</h1>
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </header>
    <main className="min-h-0 flex-1 overflow-auto bg-gray-50/60">{children}</main>
  </div>
);

// --- Inbox -------------------------------------------------------------------------------------

const TABS: { key: InboxTab; label: string }[] = [
  { key: 'primary', label: 'Primary' }, { key: 'other', label: 'Other' }, { key: 'later', label: 'Later' }, { key: 'cleared', label: 'Cleared' },
];
const SNOOZE = [
  { label: 'Later today (3h)', at: () => new Date(Date.now() + 3 * 3600_000) },
  { label: 'Tomorrow 9 am', at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
  { label: 'Next week', at: () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); return d; } },
];

export const InboxPage: React.FC = () => {
  const { workspace } = useWork();
  const [tab, setTab] = useState<InboxTab>('primary');
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [counts, setCounts] = useState({ primary: 0, other: 0, later: 0 });
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [snoozing, setSnoozing] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const load = useCallback(async () => {
    if (!workspace) return;
    const [list, c] = await Promise.all([collabApi.inbox(workspace.id, tab), collabApi.counts(workspace.id)]);
    setItems(list);
    setCounts(c);
  }, [workspace, tab]);
  useEffect(() => { setItems(null); load().catch(() => undefined); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load().catch(() => undefined), 30_000);
    return () => clearInterval(t);
  }, [load]);
  const act = async (id: string, body: Parameters<typeof collabApi.updateNotification>[1]) => {
    await collabApi.updateNotification(id, body);
    await load();
    inboxChanged();
  };
  const navigate = useNavigate();
  const open = (item: InboxItem) => {
    if (!item.read) act(item.id, { read: true });
    if (item.task) setOpenTask(item.task.id);
    else if (item.kind.startsWith('leave_')) navigate('/leave');
    else if (item.kind === 'timesheet_reminder') navigate('/timesheets');
    else if (item.kind === 'space_join_request') navigate('/all-spaces');
    else if (item.kind === 'space_join_decision' && item.data.space_id) navigate(`/s/${item.data.space_id}`);
    else if (item.kind === 'shared' && item.data.id) {
      // Open the very thing that was shared.
      const seg = item.data.what === 'space' ? 's' : item.data.what === 'folder' ? 'f' : 'l';
      navigate(`/${seg}/${item.data.id}`);
    }
    else if (item.kind === 'chat_mention' && item.data.location_id) {
      const seg = item.data.location_kind === 'space' ? 's' : item.data.location_kind === 'folder' ? 'f' : 'l';
      navigate(`/${seg}/${item.data.location_id}?v=${item.data.view_id}`);
    }
  };

  return (
    <Page icon={<InboxIcon size={18} />} title="Inbox" actions={<>
      {workspace && tab !== 'cleared' && (
        <>
          <button type="button" onClick={() => collabApi.readAll(workspace.id, tab).then(load).then(inboxChanged)} className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><CheckCheck size={14} /> Mark all read</button>
          <button type="button" onClick={() => collabApi.clearAll(workspace.id, tab).then(load).then(inboxChanged)} className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><Archive size={14} /> Clear all</button>
        </>
      )}
      <button type="button" title="Notification settings" onClick={() => setSettings(true)} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"><Settings size={16} /></button>
    </>}>
      <nav className="flex gap-5 border-b border-gray-200 bg-white px-6" aria-label="Inbox tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`-mb-px flex items-center gap-1.5 border-b-2 py-2.5 text-sm ${tab === t.key ? 'border-brand-600 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t.label}
            {t.key !== 'cleared' && counts[t.key as 'primary'] > 0 && <span className="rounded-full bg-brand-100 px-1.5 text-[11px] font-semibold text-brand-700">{counts[t.key as 'primary']}</span>}
          </button>
        ))}
      </nav>
      <p className="px-6 pt-3 text-xs text-gray-500">
        {tab === 'primary' ? 'Things that need you: assignments, mentions, replies, assigned comments and reminders.'
          : tab === 'other' ? 'Activity on tasks you watch.' : tab === 'later' ? 'Snoozed and saved items.' : 'Cleared items are kept for 30 days.'}
      </p>
      <ul className="mx-6 my-3 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white" aria-label="Notifications">
        {items === null ? <li className="px-4 py-6 text-center text-sm text-gray-400">Loading…</li>
          : items.length === 0 ? <li className="px-4 py-10 text-center text-sm text-gray-400">{tab === 'primary' ? "You're all caught up." : 'Nothing here.'}</li>
          : items.map((item) => (
            <li key={item.id} className={`group relative flex items-start gap-3 px-4 py-3 ${item.read ? '' : 'bg-brand-50/40'}`}>
              <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${item.read ? 'bg-transparent' : 'bg-brand-600'}`} />
              {item.actor ? <Avatar user={item.actor} size={28} /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Bell size={14} /></span>}
              <button type="button" onClick={() => open(item)} className="min-w-0 flex-1 text-left">
                {item.task && (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                    {item.task.status && <StatusDot status={item.task.status} size={11} />}<span className="truncate">{item.task.name}</span>
                  </span>
                )}
                <span className="block text-sm text-gray-600">
                  <b className="font-medium text-gray-800">{item.actor ? (item.actor.display_name || item.actor.email) : ''}</b> {describe(item)}
                  {item.reminder && <>: <b className="font-medium">{item.reminder.title}</b></>}
                </span>
                {item.comment && <span className="mt-1 block truncate rounded bg-gray-50 px-2 py-1 text-sm text-gray-700">{item.comment.body}</span>}
              </button>
              <span className="shrink-0 text-xs text-gray-400">{ago(item.created_at)}</span>
              <span className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
                <button type="button" title={item.read ? 'Mark unread' : 'Mark read'} onClick={() => act(item.id, { read: !item.read })} className="rounded p-1 text-gray-500 hover:bg-gray-100"><Check size={14} /></button>
                {tab !== 'cleared' && <button type="button" title="Snooze" onClick={() => setSnoozing(snoozing === item.id ? null : item.id)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><Clock size={14} /></button>}
                {tab === 'later' && item.snoozed_until && <button type="button" title="Wake now" onClick={() => act(item.id, { unsnooze: true })} className="rounded p-1 text-gray-500 hover:bg-gray-100"><BellOff size={14} /></button>}
                <button type="button" title={item.cleared ? 'Restore' : 'Clear'} onClick={() => act(item.id, { cleared: !item.cleared })} className="rounded p-1 text-gray-500 hover:bg-gray-100">{item.cleared ? <InboxIcon size={14} /> : <X size={14} />}</button>
              </span>
              {snoozing === item.id && (
                <span className="absolute right-10 mt-8 flex gap-1 rounded-md border border-gray-200 bg-white p-1 shadow" role="menu">
                  {SNOOZE.map((s) => <button key={s.label} type="button" role="menuitem" onClick={() => { setSnoozing(null); act(item.id, { snoozed_until: s.at().toISOString() }); }} className="rounded px-2 py-1 text-xs hover:bg-gray-100">{s.label}</button>)}
                </span>
              )}
            </li>
          ))}
      </ul>
      {settings && <NotificationSettings onClose={() => setSettings(false)} />}
      {openTask && <TaskPanel taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => { load(); inboxChanged(); }} onOpen={setOpenTask} />}
    </Page>
  );
};

const NotificationSettings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { workspace } = useWork();
  const [rows, setRows] = useState<NotificationSetting[] | null>(null);
  useEffect(() => { if (workspace) collabApi.settings(workspace.id).then(setRows); }, [workspace]);
  const toggle = (kind: string, enabled: boolean) => {
    if (!workspace) return;
    setRows((rs) => rs && rs.map((r) => (r.kind === kind ? { ...r, enabled } : r)));
    collabApi.saveSettings(workspace.id, { [kind]: enabled }).then(setRows).catch(() => collabApi.settings(workspace.id).then(setRows));
  };
  return (
    <Portal>
      <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div role="dialog" aria-label="Notification settings" onMouseDown={(e) => e.stopPropagation()} className="max-h-[90vh] w-[30rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Notification settings</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>
          <DeliverySettings />
          <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">What reaches your Inbox</p>
          <div className="max-h-64 overflow-y-auto">
          {!rows ? <p className="text-sm text-gray-400">Loading…</p> : rows.map((r) => (
            <label key={r.kind} className="flex items-center justify-between border-t border-gray-100 py-2 text-sm text-gray-800">
              {r.label}
              <input type="checkbox" checked={r.enabled} onChange={(e) => toggle(r.kind, e.target.checked)} aria-label={r.label} />
            </label>
          ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">You're never notified about your own changes.</p>
        </div>
      </div>
    </Portal>
  );
};

/** How updates reach you outside the app: email, this device, WhatsApp. */
const DeliverySettings: React.FC = () => {
  const { workspace } = useWork();
  const [d, setD] = useState<Delivery | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pushState, setPushState] = useState<string>(() => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'));
  useEffect(() => { if (workspace) outboundApi.delivery(workspace.id).then(setD).catch(() => undefined); }, [workspace]);
  if (!d || !workspace) return null;
  const save = async (body: Parameters<typeof outboundApi.saveDelivery>[1]) => {
    setMsg(null);
    try { setD(await outboundApi.saveDelivery(workspace.id, body)); } catch (e) { setMsg((e as Error).message); }
  };
  const push = async () => {
    setMsg(null);
    try {
      const out = await enablePush(workspace.id);
      setPushState(out === 'on' ? 'granted' : out);
      if (out === 'on') { await outboundApi.pushTest(workspace.id); setD(await outboundApi.delivery(workspace.id)); setMsg('Notifications are on for this device.'); }
      else setMsg(out === 'denied' ? 'The browser blocked notifications. Allow them in the site settings and try again.' : "This browser can't show notifications.");
    } catch (e) { setMsg((e as Error).message); }
  };
  const sel = 'rounded-md border border-gray-300 px-2 py-1 text-sm';
  return (
    <section aria-label="Outside the app" className="space-y-2 rounded-lg bg-gray-50 p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Outside the app</p>
      <label className="flex items-center justify-between gap-2">Email
        <select aria-label="Email notifications" value={d.email_notifications} onChange={(e) => save({ email_notifications: e.target.value as Delivery['email_notifications'] })} className={sel}>
          <option value="daily">A daily summary</option><option value="instant">Each update, right away</option><option value="off">Never</option>
        </select>
      </label>
      {d.email_notifications === 'daily' && (
        <label className="flex items-center justify-between gap-2 text-gray-600">Summary at
          <select aria-label="Summary time" value={d.digest_hour} onChange={(e) => save({ digest_hour: Number(e.target.value) })} className={sel}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </label>
      )}
      <label className="flex items-center justify-between gap-2">Weekly team digest (managers and leads)
        <input type="checkbox" checked={d.weekly_team_digest} onChange={(e) => save({ weekly_team_digest: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between gap-2">WhatsApp{d.phone ? ` (${d.phone})` : ' (add your mobile to your profile)'}
        <input type="checkbox" aria-label="WhatsApp" checked={d.whatsapp_opt_in} disabled={!d.phone} onChange={(e) => save({ whatsapp_opt_in: e.target.checked })} />
      </label>
      <div className="flex items-center justify-between gap-2">
        <span>This device{d.devices ? ` · ${d.devices} device${d.devices === 1 ? '' : 's'} on` : ''}</span>
        {pushState === 'granted' && d.devices
          ? <button type="button" onClick={async () => { await disablePush(workspace.id); setD(await outboundApi.delivery(workspace.id)); }} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-white">Turn off here</button>
          : <button type="button" onClick={push} className="rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700">Turn on notifications</button>}
      </div>
      {!d.channels.email && <p className="text-xs text-amber-700">Email isn't set up on the server yet, so no emails go out.</p>}
      {!d.channels.whatsapp && d.whatsapp_opt_in && <p className="text-xs text-amber-700">WhatsApp isn't connected on the server yet.</p>}
      {msg && <p className="text-xs text-gray-700" role="status">{msg}</p>}
    </section>
  );
};

// --- Replies and Assigned comments ----------------------------------------------------------------

const CommentList: React.FC<{ load: () => Promise<CommentWithTask[]>; empty: string; resolvable?: boolean }> = ({ load, empty, resolvable }) => {
  const [items, setItems] = useState<CommentWithTask[] | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const refresh = useCallback(() => load().then(setItems).catch(() => setItems([])), [load]);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <>
      <ul className="mx-6 my-4 space-y-2" aria-label="Comments">
        {items === null ? <li className="text-sm text-gray-400">Loading…</li> : items.length === 0 ? <li className="py-10 text-center text-sm text-gray-400">{empty}</li> : items.map((c) => (
          <li key={c.id} className="rounded-xl border border-gray-200 bg-white p-3">
            <button type="button" onClick={() => setOpenTask(c.task.id)} className="flex items-center gap-1.5 text-sm font-medium text-gray-900 hover:underline">
              {c.task.status && <StatusDot status={c.task.status} size={11} />} {c.task.name}
            </button>
            <div className="mt-1.5 flex items-start gap-2">
              {c.user && <Avatar user={c.user} size={22} />}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-500"><b className="font-medium text-gray-700">{c.user?.display_name || c.user?.email}</b> · {ago(c.created_at)}</p>
                <p className="whitespace-pre-wrap text-sm text-gray-800">{c.body}</p>
              </div>
              {resolvable && (
                <button type="button" onClick={() => collabApi.updateComment(c.id, { resolved: true }).then(refresh)} className="flex items-center gap-1 rounded-md border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                  <Check size={12} /> Resolve
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {openTask && <TaskPanel taskId={openTask} onClose={() => { setOpenTask(null); refresh(); }} onChanged={refresh} onOpen={setOpenTask} />}
    </>
  );
};

export const RepliesPage: React.FC = () => {
  const { workspace } = useWork();
  const load = useCallback(() => (workspace ? collabApi.replies(workspace.id) : Promise.resolve([])), [workspace]);
  return <Page icon={<MessageSquare size={18} />} title="Replies"><CommentList load={load} empty="No replies to your comments yet." /></Page>;
};

export const AssignedCommentsPage: React.FC = () => {
  const { workspace } = useWork();
  const load = useCallback(() => (workspace ? collabApi.assignedComments(workspace.id) : Promise.resolve([])), [workspace]);
  return <Page icon={<UserCheck size={18} />} title="Assigned comments"><CommentList load={load} resolvable empty="No comments are waiting on you." /></Page>;
};

// --- Reminders ------------------------------------------------------------------------------------

export const RemindersPage: React.FC = () => {
  const { workspace } = useWork();
  const [state, setState] = useState<'upcoming' | 'done'>('upcoming');
  const [items, setItems] = useState<Reminder[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!workspace) return;
    const mine = ++seq.current; // a newer load or edit wins over an older response
    collabApi.reminders(workspace.id, state).then((rs) => { if (mine === seq.current) setItems(rs); });
  }, [workspace, state]);
  useEffect(() => { load(); }, [load]);
  const now = Date.now();
  return (
    <Page icon={<Bell size={18} />} title="Reminders" actions={
      <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"><Plus size={14} /> Reminder</button>
    }>
      <nav className="flex gap-5 border-b border-gray-200 bg-white px-6">
        {(['upcoming', 'done'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setState(s)} className={`-mb-px border-b-2 py-2.5 text-sm ${state === s ? 'border-brand-600 font-medium text-gray-900' : 'border-transparent text-gray-500'}`}>{s === 'upcoming' ? 'Upcoming' : 'Done'}</button>
        ))}
      </nav>
      <ul className="mx-6 my-4 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white" aria-label="Reminders">
        {items === null ? <li className="px-4 py-6 text-sm text-gray-400">Loading…</li> : items.length === 0 ? <li className="px-4 py-10 text-center text-sm text-gray-400">{state === 'upcoming' ? 'No reminders coming up.' : 'Nothing done yet.'}</li> : items.map((r) => {
          const due = new Date(r.remind_at).getTime() <= now;
          return (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <input type="checkbox" aria-label={`Done: ${r.title}`} checked={r.done} onChange={(e) => {
                if (!workspace) return;
                const done = e.target.checked;
                seq.current += 1;
                setItems((xs) => xs && xs.map((x) => (x.id === r.id ? { ...x, done } : x)));
                collabApi.updateReminder(workspace.id, r.id, { done }).then(load);
              }} />
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${r.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{r.title}</p>
                {r.task && <button type="button" onClick={() => setOpenTask(r.task!.id)} className="text-xs text-brand-600 hover:underline">Open task</button>}
              </div>
              <span className={`shrink-0 text-xs ${due && !r.done ? 'font-medium text-red-600' : 'text-gray-500'}`}>
                {new Date(r.remind_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
              <button type="button" title="Delete reminder" onClick={() => workspace && collabApi.deleteReminder(workspace.id, r.id).then(load)} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button>
            </li>
          );
        })}
      </ul>
      {adding && <ReminderDialog onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
      {openTask && <TaskPanel taskId={openTask} onClose={() => setOpenTask(null)} onChanged={load} onOpen={setOpenTask} />}
    </Page>
  );
};

/** Unread Inbox count for the sidebar and header, kept fresh. */
export function useInboxCount(): number {
  const { workspace } = useWork();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!workspace) return;
    const load = () => collabApi.counts(workspace.id).then((c) => setCount(c.primary + c.other)).catch(() => undefined);
    load();
    const timer = setInterval(load, 30_000);
    window.addEventListener(INBOX_CHANGED, load);
    return () => { clearInterval(timer); window.removeEventListener(INBOX_CHANGED, load); };
  }, [workspace]);
  return count;
}

export const InboxLink: React.FC<{ className: string; leading?: React.ReactNode }> = ({ className, leading }) => {
  const count = useInboxCount();
  return (
    <Link to="/inbox" className={className}>
      {leading}
      <InboxIcon size={16} className="shrink-0 text-gray-500" />
      <span className="flex-1 font-medium">Inbox</span>
      {count > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">{count > 99 ? '99+' : count}</span>}
    </Link>
  );
};

/** The header bell: opens the Inbox, with a red dot while anything is unread. */
export const HeaderInboxBell: React.FC = () => {
  const count = useInboxCount();
  return (
    <Link to="/inbox" title={count ? `Inbox: ${count} unread` : 'Inbox'} aria-label="Inbox" className="relative p-1">
      <Bell size={20} color="var(--color-text-secondary)" />
      {count > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white">{count > 99 ? '99+' : count}</span>}
    </Link>
  );
};
