import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, Bell, BellOff, BellRing, Check, CheckCheck, Clock, CornerDownRight, Flag, Inbox as InboxIcon, MoreHorizontal, Plus, Settings, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useMe, useWork } from './WorkContext';
import { disablePush, enablePush, outboundApi, type Delivery } from './outboundApi';
import {
  collabApi, inboxFilterCount, NO_INBOX_FILTERS,
  type InboxDue, type InboxFilters, type InboxItem, type InboxTab, type NotificationSetting, type Reminder,
} from './collabApi';
import { Avatar, formatDue, Menu, Portal, PriorityFlag, PRIORITIES, StatusDot } from './ui';
import { usePhone } from './useBreakpoint';
import { TaskPanel } from './TaskPanel';
import { ReminderDialog } from './task/TaskActions';
import { Composer, sendCommentFiles, type ComposerOutput } from './task/TaskFeed';
import { notify } from '../components/notify';
import { useBellStyle } from '../components/bellStyle';
import { TwoStepFilter, type FilterField } from './views/TwoStepFilter';
import { FEATURES } from '../config/features';
import { LinesSkeleton } from './Skeleton';

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
    case 'comment': return Number(d.count ?? 1) > 1 ? `commented (${d.count} new comments)` : 'commented';
    case 'assigned_comment': return 'assigned you a comment';
    case 'reaction': {
      const others = Number(d.count ?? 1) - 1;
      return `reacted ${d.emoji ?? ''} to your comment${others > 0 ? ` (and ${others} ${others === 1 ? 'other' : 'others'})` : ''}`;
    }
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
    case 'leave_cover': return `asked you to cover ${d.who}'s work while they are away, ${dayRange(d.from, d.to)} (${d.days} day${d.days === 1 ? '' : 's'})`;
    case 'leave_escalated': return `${d.who}'s ${d.type} leave for ${dayRange(d.from, d.to)} has been waiting ${d.waited_days} day${d.waited_days === 1 ? '' : 's'} with no decision`;
    case 'escalation': return `Escalation: ${d.message || d.rule || 'this task needs attention'}`;
    case 'timesheet_reminder': return `Timesheet reminder: ${Math.round(d.tracked / 360) / 10}h logged so far this week, of ${Math.round(d.expected / 360) / 10}h. Please fill it in.`;
    case 'time_changed': {
      const h = (s: number | null | undefined) => `${Math.round((s ?? 0) / 36) / 100}h`;
      const day = d.day ? new Date(String(d.day).slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
      if (d.action === 'logged') return `logged ${h(d.seconds)} for you on ${day}`;
      if (d.action === 'deleted') return `removed ${h(d.before)} of your time on ${day}`;
      if (d.before != null && d.before !== d.seconds) return `changed your time on ${day} from ${h(d.before)} to ${h(d.seconds)}`;
      return `edited your time entry on ${day}`;
    }
    case 'team_change':
      return d.action === 'joined' ? `${d.person} joined your team ${d.team}`
        : d.action === 'offboarded' ? `${d.person} left the firm and your team ${d.team}`
        : `${d.person} left your team ${d.team}`;
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
/** The groups the backend knows, in the order someone scans them. */
const GROUPS: { key: string; label: string }[] = [
  { key: 'assigned', label: 'Assigned to me' },
  { key: 'mentions', label: 'Mentions' },
  { key: 'comments', label: 'Comments & replies' },
  { key: 'comment_todos', label: 'Comments assigned to me' },
  { key: 'status', label: 'Status changes' },
  { key: 'dates', label: 'Date changes' },
  { key: 'shared', label: 'Shared with me' },
  { key: 'reminders', label: 'Reminders & timesheets' },
  { key: 'leave', label: 'Leave' },
  { key: 'task_detail', label: 'Files & checklists' },
  { key: 'team', label: 'Team changes' },
];
const DUE: { key: InboxDue; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'Due in 7 days' },
  { key: 'none', label: 'No due date' },
];

const InboxFilterBar: React.FC<{ value: InboxFilters; onChange: (f: InboxFilters) => void }> = ({ value, onChange }) => {
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  // The same control the timesheet, the workload and every task view use.
  //
  // This was three pills of its own design -- round where the others are square, brand blue where
  // the others are teal, and three buttons where everywhere else has one. Nothing about the Inbox
  // needs a filter of its own shape; it just grew one. Now there is a single "Filter" carrying a
  // count, and opening it says which filters those are.
  const fields: FilterField[] = [
    {
      key: 'groups',
      label: 'Activity',
      Icon: SlidersHorizontal,
      options: GROUPS.map((g) => ({ value: g.key, label: g.label })),
      selected: value.groups,
    },
    {
      key: 'priority',
      label: 'Priority',
      Icon: Flag,
      options: [1, 2, 3, 4].map((n) => ({ value: String(n), label: PRIORITIES[n].label, color: PRIORITIES[n].color })),
      selected: value.priority.map(String),
    },
    {
      key: 'due',
      label: 'Due',
      Icon: Clock,
      single: true,
      options: DUE.map((d) => ({ value: d.key, label: d.label })),
      selected: value.due ? [value.due] : [],
    },
  ];

  const pick = (field: FilterField, picked: string) => {
    if (field.key === 'groups') onChange({ ...value, groups: toggle(value.groups, picked) });
    else if (field.key === 'priority') onChange({ ...value, priority: toggle(value.priority, Number(picked)) });
    // One at a time: "overdue and due today" is just "due in 7 days".
    else onChange({ ...value, due: value.due === picked ? null : (picked as InboxDue) });
  };

  const clear = (field: FilterField) => {
    if (field.key === 'groups') onChange({ ...value, groups: [] });
    else if (field.key === 'priority') onChange({ ...value, priority: [] });
    else onChange({ ...value, due: null });
  };

  return (
    // Right-aligned, like the period control on a Dashboard and the filter on a List. A control
    // that narrows what is below it belongs at the end of the row, not in front of the first thing
    // somebody reads.
    <div className="flex flex-wrap items-center justify-end gap-2 border-b border-gray-200 bg-white px-4 py-2 sm:px-6">
      <TwoStepFilter fields={fields} onToggle={pick} onClear={clear} onClearAll={() => onChange(NO_INBOX_FILTERS)} />
    </div>
  );
};

const SNOOZE = [
  { label: 'Later today (3h)', at: () => new Date(Date.now() + 3 * 3600_000) },
  { label: 'Tomorrow 9 am', at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
  { label: 'Next week', at: () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); return d; } },
];

export const InboxPage: React.FC = () => {
  const { workspace } = useWork();
  const [tab, setTab] = useState<InboxTab>('primary');
  const [filters, setFilters] = useState<InboxFilters>(NO_INBOX_FILTERS);
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [counts, setCounts] = useState({ primary: 0, other: 0, later: 0 });
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [focusComment, setFocusComment] = useState<string | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const me = useMe();
  const [snoozing, setSnoozing] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const phone = usePhone();
  const load = useCallback(async () => {
    if (!workspace) return;
    const [list, c] = await Promise.all([collabApi.inbox(workspace.id, tab, filters), collabApi.counts(workspace.id)]);
    setItems(list);
    setCounts(c);
  }, [workspace, tab, filters]);
  useEffect(() => { setItems(null); load().catch(() => undefined); }, [load]);
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') load().catch(() => undefined); };
    const t = setInterval(again, 30_000);
    document.addEventListener('visibilitychange', again);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', again); };
  }, [load]);
  const act = async (id: string, body: Parameters<typeof collabApi.updateNotification>[1]) => {
    await collabApi.updateNotification(id, body);
    await load();
    inboxChanged();
  };
  const navigate = useNavigate();
  // A push notification about a task arrives as /inbox?task=…&n=…: open that task, ready to edit,
  // and count the notification as read, as if it had been clicked here.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const task = params.get('task');
    if (!task) return;
    setOpenTask(task);
    setFocusComment(params.get('comment'));
    const n = params.get('n');
    if (n) collabApi.updateNotification(n, { read: true }).then(inboxChanged).catch(() => undefined);
    setParams({}, { replace: true });
  }, [params, setParams]);
  const open = (item: InboxItem) => {
    if (!item.read) act(item.id, { read: true });
    if (item.kind === 'time_changed') navigate('/timesheets');
    else if (item.kind === 'team_change' && item.data.team_id) navigate(`/people/teams/${item.data.team_id}`);
    else if (item.task) { setFocusComment(item.comment?.id ?? null); setOpenTask(item.task.id); }
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

  // Answering without opening the task: a reply in the item's thread, or ticking off a comment
  // that was assigned to you.
  const canReply = (item: InboxItem) => !!item.comment && !!item.task && tab !== 'cleared';
  const reply = async (item: InboxItem, body: ComposerOutput) => {
    try {
      const sent = await collabApi.replyFromInbox(item.id, { body: body.body, mention_user_ids: body.mention_user_ids, mention_team_ids: body.mention_team_ids });
      await sendCommentFiles(sent.id, body.files);
      setReplying(null);
      notify.ok('Reply sent');
      await load();
      inboxChanged();
    } catch (e) {
      notify.error(e);
    }
  };
  const resolve = (item: InboxItem) => item.comment && collabApi.updateComment(item.comment.id, { resolved: true })
    .then(() => (item.read ? load() : act(item.id, { read: true }))).catch((e) => notify.error(e));

  return (
    <Page icon={<InboxIcon size={18} />} title="Inbox" actions={<>
      {workspace && tab !== 'cleared' && (
        // On a phone the two bulk actions are icons: their labels are half the header.
        <>
          <button type="button" title="Mark all read" aria-label="Mark all read" onClick={() => collabApi.readAll(workspace.id, tab).then(load).then(inboxChanged)} className="tap flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><CheckCheck size={14} /> <span className="hidden sm:inline">Mark all read</span></button>
          <button type="button" title="Clear all" aria-label="Clear all" onClick={() => collabApi.clearAll(workspace.id, tab).then(load).then(inboxChanged)} className="tap flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><Archive size={14} /> <span className="hidden sm:inline">Clear all</span></button>
        </>
      )}
      <button aria-label="Notification settings" type="button" title="Notification settings" onClick={() => setSettings(true)} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"><Settings size={16} /></button>
    </>}>
      <nav className="scroll-x flex gap-5 border-b border-gray-200 bg-white px-4 sm:px-6" aria-label="Inbox tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`-mb-px flex min-h-[2.75rem] shrink-0 items-center gap-1.5 border-b-2 py-2.5 text-sm ${tab === t.key ? 'border-brand-600 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t.label}
            {t.key !== 'cleared' && counts[t.key as 'primary'] > 0 && <span className="rounded-full bg-brand-100 px-1.5 text-[11px] font-semibold text-brand-700">{counts[t.key as 'primary']}</span>}
          </button>
        ))}
      </nav>
      <InboxFilterBar value={filters} onChange={setFilters} />
      <p className="px-4 pt-3 text-xs text-gray-500 sm:px-6">
        {inboxFilterCount(filters) > 0 ? 'Narrowed by the filters above.'
          : tab === 'primary' ? 'Things that need you: assignments, mentions, replies, assigned comments and reminders.'
          : tab === 'other' ? 'Activity on tasks you watch.' : tab === 'later' ? 'Snoozed and saved items.' : 'Cleared items are kept for 30 days.'}
      </p>
      <ul className="mx-3 my-3 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white sm:mx-6" aria-label="Notifications">
        {items === null ? <li className="px-4 py-6 text-center text-sm text-gray-400"><LinesSkeleton rows={5} label="Loading inbox" /></li>
          : items.length === 0 ? (
            <li className="px-4 py-10 text-center text-sm text-gray-400">
              {inboxFilterCount(filters) > 0 ? (
                <>Nothing matches these filters. <button type="button" onClick={() => setFilters(NO_INBOX_FILTERS)} className="text-brand-700 underline">Clear them</button></>
              ) : tab === 'primary' ? "You're all caught up." : 'Nothing here.'}
            </li>
          )
          : items.map((item) => (
            <li key={item.id} className={`group relative flex flex-wrap items-start gap-3 px-4 py-3 sm:flex-nowrap ${item.read ? '' : 'bg-brand-50/40'}`}>
              <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${item.read ? 'bg-transparent' : 'bg-brand-600'}`} />
              {item.actor ? <Avatar user={item.actor} size={28} /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Bell size={14} /></span>}
              <div className="min-w-0 flex-1">
              <button type="button" onClick={() => open(item)} className="w-full text-left">
                {item.task && (
                  // On a phone the name wraps rather than truncating: "Up..." is not a task.
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-medium text-gray-900">
                    {item.task.status && <StatusDot status={item.task.status} size={11} />}
                    <span className="min-w-0 break-words sm:truncate">{item.task.name}</span>
                    {item.task.priority ? (
                      <span title={PRIORITIES[item.task.priority]?.label} className="shrink-0"><PriorityFlag priority={item.task.priority} withLabel={false} /></span>
                    ) : null}
                    {item.task.due_date && (
                      <span className={`shrink-0 rounded px-1.5 text-[11px] font-normal ${new Date(item.task.due_date) < new Date() ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                        {formatDue(item.task.due_date)}
                      </span>
                    )}
                  </span>
                )}
                <span className="block text-sm text-gray-600">
                  <b className="font-medium text-gray-800">{item.actor ? (item.actor.display_name || item.actor.email) : ''}</b> {describe(item)}
                  {item.reminder && <>: <b className="font-medium">{item.reminder.title}</b></>}
                </span>
                {item.comment && <span className="mt-1 block truncate rounded bg-gray-50 px-2 py-1 text-sm text-gray-700">{item.comment.body}</span>}
                {phone && <span className="mt-0.5 block text-[11px] text-gray-400">{ago(item.created_at)}</span>}
              </button>
              {(canReply(item) || (item.kind === 'assigned_comment' && item.comment?.assignee_id === me)) && replying !== item.id && (
                <span className="mt-1.5 flex items-center gap-2">
                  {canReply(item) && (
                    <button type="button" onClick={() => setReplying(item.id)} className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:border-brand-300 hover:text-brand-700">
                      <CornerDownRight size={12} /> Reply
                    </button>
                  )}
                  {item.kind === 'assigned_comment' && item.comment?.assignee_id === me && (
                    item.comment.resolved
                      ? <span className="flex items-center gap-1 text-xs font-medium text-emerald-700"><Check size={12} /> Resolved</span>
                      : (
                        <button type="button" onClick={() => resolve(item)} className="flex items-center gap-1 rounded-md border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                          <Check size={12} /> Resolve
                        </button>
                      )
                  )}
                </span>
              )}
              {replying === item.id && (
                <div className="mt-2">
                  <Composer autoFocus placeholder="Reply in the thread…" onCancel={() => setReplying(null)} onSend={(body) => reply(item, body)} />
                </div>
              )}
              </div>
              {/* On a desktop the date sits in its own column; on a phone it rides with the text. */}
              {!phone && <span className="shrink-0 text-xs text-gray-400">{ago(item.created_at)}</span>}
              {phone ? (
                <Menu
                  align="right" label={`Actions for this notification`}
                  items={[
                    { label: item.read ? 'Mark unread' : 'Mark read', icon: <Check size={14} />, onClick: () => act(item.id, { read: !item.read }) },
                    ...(tab !== 'cleared'
                      ? SNOOZE.map((sn) => ({ label: `Snooze: ${sn.label}`, icon: <Clock size={14} />, onClick: () => act(item.id, { snoozed_until: sn.at().toISOString() }) }))
                      : []),
                    ...(tab === 'later' && item.snoozed_until
                      ? [{ label: 'Wake now', icon: <BellOff size={14} />, onClick: () => act(item.id, { unsnooze: true }) }]
                      : []),
                    { label: item.cleared ? 'Restore' : 'Clear', icon: item.cleared ? <InboxIcon size={14} /> : <X size={14} />, onClick: () => act(item.id, { cleared: !item.cleared }) },
                  ]}
                  trigger={<span className="tap shrink-0 rounded-lg text-gray-400"><MoreHorizontal size={18} /></span>}
                />
              ) : (
                <span className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
                  <button aria-label={item.read ? 'Mark unread' : 'Mark read'} type="button" title={item.read ? 'Mark unread' : 'Mark read'} onClick={() => act(item.id, { read: !item.read })} className="rounded p-1 text-gray-500 hover:bg-gray-100"><Check size={14} /></button>
                  {tab !== 'cleared' && <button aria-label="Snooze" type="button" title="Snooze" onClick={() => setSnoozing(snoozing === item.id ? null : item.id)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><Clock size={14} /></button>}
                  {tab === 'later' && item.snoozed_until && <button aria-label="Wake now" type="button" title="Wake now" onClick={() => act(item.id, { unsnooze: true })} className="rounded p-1 text-gray-500 hover:bg-gray-100"><BellOff size={14} /></button>}
                  <button type="button" title={item.cleared ? 'Restore' : 'Clear'} onClick={() => act(item.id, { cleared: !item.cleared })} className="rounded p-1 text-gray-500 hover:bg-gray-100">{item.cleared ? <InboxIcon size={14} /> : <X size={14} />}</button>
                </span>
              )}
              {snoozing === item.id && (
                <span className="absolute right-10 mt-8 flex gap-1 rounded-md border border-gray-200 bg-white p-1 shadow" role="menu">
                  {SNOOZE.map((s) => <button key={s.label} type="button" role="menuitem" onClick={() => { setSnoozing(null); act(item.id, { snoozed_until: s.at().toISOString() }); }} className="rounded px-2 py-1 text-xs hover:bg-gray-100">{s.label}</button>)}
                </span>
              )}
            </li>
          ))}
      </ul>
      {settings && <NotificationSettings onClose={() => setSettings(false)} />}
      {openTask && (
        <TaskPanel taskId={openTask} focusCommentId={focusComment} onClose={() => { setOpenTask(null); setFocusComment(null); }}
          onChanged={() => { load(); inboxChanged(); }} onOpen={(id) => { setFocusComment(null); setOpenTask(id); }} />
      )}
    </Page>
  );
};

const NotificationSettings: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <Portal>
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div role="dialog" aria-label="Notification settings" onMouseDown={(e) => e.stopPropagation()} className="max-h-[90vh] w-[30rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Notification settings</h3>
          <button aria-label="Close" type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
        </div>
        <NotificationSettingsPanel />
      </div>
    </div>
  </Portal>
);

/** How updates reach you and which ones reach your Inbox. In the Inbox's settings dialog and on
 *  the Notifications tab of Settings. */
export const NotificationSettingsPanel: React.FC = () => {
  const { workspace } = useWork();
  const [rows, setRows] = useState<NotificationSetting[] | null>(null);
  useEffect(() => { if (workspace) collabApi.settings(workspace.id).then(setRows); }, [workspace]);
  const toggle = (kind: string, enabled: boolean) => {
    if (!workspace) return;
    setRows((rs) => rs && rs.map((r) => (r.kind === kind ? { ...r, enabled } : r)));
    collabApi.saveSettings(workspace.id, { [kind]: enabled }).then(setRows).catch(() => collabApi.settings(workspace.id).then(setRows));
  };
  return (
        <div>
          <DeliverySettings />
          <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">What reaches your Inbox</p>
          <div className="max-h-64 overflow-y-auto">
          {!rows ? <p className="text-sm text-gray-400"><LinesSkeleton /></p> : rows.map((r) => (
            <label key={r.kind} className="flex items-center justify-between border-t border-gray-100 py-2 text-sm text-gray-800">
              {r.label}
              <input type="checkbox" checked={r.enabled} onChange={(e) => toggle(r.kind, e.target.checked)} aria-label={r.label} />
            </label>
          ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">You're never notified about your own changes.</p>
        </div>
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
      {/* The Email control, while email still had something to decide. */}
      {FEATURES.emailUpdates && (
        <>
          <label className="flex items-center justify-between gap-2">Email
            <select aria-label="Email notifications" value={d.email_notifications} onChange={(e) => save({ email_notifications: e.target.value as Delivery['email_notifications'] })} className={sel}>
              <option value="daily">{FEATURES.emailDigests ? 'A daily summary' : 'A daily summary — turned off'}</option>
              <option value="instant">Each update, right away</option><option value="off">Never</option>
            </select>
          </label>
          {FEATURES.emailDigests && d.email_notifications === 'daily' && (
            <label className="flex items-center justify-between gap-2 text-gray-600">Summary at
              <select aria-label="Summary time" value={d.digest_hour} onChange={(e) => save({ digest_hour: Number(e.target.value) })} className={sel}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
          )}
          {FEATURES.emailDigests && (
            <label className="flex items-center justify-between gap-2">Weekly team digest (managers and leads)
              <input type="checkbox" checked={d.weekly_team_digest} onChange={(e) => save({ weekly_team_digest: e.target.checked })} />
            </label>
          )}
        </>
      )}
      {!FEATURES.emailUpdates && (
        <p className="text-xs text-gray-500">
          Email is used to invite people to the workspace, and for nothing else. Notifications reach you
          here and, if you turn them on below, on this device.
        </p>
      )}
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
        {items === null ? <li className="px-4 py-6 text-sm text-gray-400"><LinesSkeleton /></li> : items.length === 0 ? <li className="px-4 py-10 text-center text-sm text-gray-400">{state === 'upcoming' ? 'No reminders coming up.' : 'Nothing done yet.'}</li> : items.map((r) => {
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
/** How many Inbox items are unread, kept fresh. `onNew` is called when a later count is higher
 *  than the one before -- something new came in -- but never for the first count on load. */
export function useInboxCount(onNew?: () => void): number {
  const { workspace } = useWork();
  const [count, setCount] = useState(0);
  const last = useRef<number | null>(null);
  const announce = useRef(onNew);
  announce.current = onNew;
  useEffect(() => {
    if (!workspace) return;
    last.current = null;
    const load = () => collabApi.counts(workspace.id).then((c) => {
      const next = c.primary + c.other;
      if (last.current !== null && next > last.current) announce.current?.();
      last.current = next;
      setCount(next);
    }).catch(() => undefined);
    load();
    const timer = setInterval(load, 30_000);
    // Back on the tab: count again now, rather than up to 30 s later.
    const back = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', back);
    window.addEventListener(INBOX_CHANGED, load);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', back); window.removeEventListener(INBOX_CHANGED, load); };
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

/** The header bell: opens the Inbox, with the unread count. It rings when something new arrives. */
export const HeaderInboxBell: React.FC = () => {
  const style = useBellStyle();
  const [ringing, setRinging] = useState(false);
  const stop = useRef<number | undefined>(undefined);
  const count = useInboxCount(() => {
    // Off and on again, so a second arrival while it is still ringing rings it afresh.
    setRinging(false);
    window.clearTimeout(stop.current);
    requestAnimationFrame(() => setRinging(true));
    stop.current = window.setTimeout(() => setRinging(false), 2000);
  });
  useEffect(() => () => window.clearTimeout(stop.current), []);
  return (
    <Link to="/inbox" title={count ? `Inbox: ${count} unread` : 'Inbox'} aria-label="Inbox" className={`header-bell bell-${style}${ringing ? ' is-ringing' : ''}`}>
      <BellIcon />
      {count > 0 && <span className="bell-count">{count > 99 ? '99+' : count}</span>}
    </Link>
  );
};

/** The bell as drawn in the top bar, for the bell-style picker on Settings. */
export const BellIcon: React.FC = () => <BellRing size={19} className="header-bell-icon" />;
