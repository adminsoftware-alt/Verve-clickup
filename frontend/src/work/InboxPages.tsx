import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Bell, BellOff, Check, CheckCheck, Clock, Inbox as InboxIcon, MessageSquare, Plus, Settings, Trash2, UserCheck, X } from 'lucide-react';
import { useWork } from './WorkContext';
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
  const open = (item: InboxItem) => {
    if (!item.read) act(item.id, { read: true });
    if (item.task) setOpenTask(item.task.id);
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
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`-mb-px flex items-center gap-1.5 border-b-2 py-2.5 text-sm ${tab === t.key ? 'border-indigo-600 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t.label}
            {t.key !== 'cleared' && counts[t.key as 'primary'] > 0 && <span className="rounded-full bg-indigo-100 px-1.5 text-[11px] font-semibold text-indigo-700">{counts[t.key as 'primary']}</span>}
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
            <li key={item.id} className={`group relative flex items-start gap-3 px-4 py-3 ${item.read ? '' : 'bg-indigo-50/40'}`}>
              <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${item.read ? 'bg-transparent' : 'bg-indigo-600'}`} />
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
        <div role="dialog" aria-label="Notification settings" onMouseDown={(e) => e.stopPropagation()} className="w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl bg-white p-5 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Notification settings</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>
          <p className="mb-2 text-xs text-gray-500">Choose what reaches your Inbox. You're never notified about your own changes.</p>
          {!rows ? <p className="text-sm text-gray-400">Loading…</p> : rows.map((r) => (
            <label key={r.kind} className="flex items-center justify-between border-t border-gray-100 py-2 text-sm text-gray-800">
              {r.label}
              <input type="checkbox" checked={r.enabled} onChange={(e) => toggle(r.kind, e.target.checked)} aria-label={r.label} />
            </label>
          ))}
        </div>
      </div>
    </Portal>
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
      <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"><Plus size={14} /> Reminder</button>
    }>
      <nav className="flex gap-5 border-b border-gray-200 bg-white px-6">
        {(['upcoming', 'done'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setState(s)} className={`-mb-px border-b-2 py-2.5 text-sm ${state === s ? 'border-indigo-600 font-medium text-gray-900' : 'border-transparent text-gray-500'}`}>{s === 'upcoming' ? 'Upcoming' : 'Done'}</button>
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
                {r.task && <button type="button" onClick={() => setOpenTask(r.task!.id)} className="text-xs text-indigo-600 hover:underline">Open task</button>}
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

export const InboxLink: React.FC<{ className: string }> = ({ className }) => {
  const count = useInboxCount();
  return (
    <Link to="/inbox" className={className}>
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
