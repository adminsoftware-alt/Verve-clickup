import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Check, CornerDownRight, MessageSquare, MoreHorizontal, Pencil, SmilePlus, Trash2, UserCheck, Users } from 'lucide-react';
import { useWork, useMe } from '../WorkContext';
import { collabApi, type Activity, type Comment } from '../collabApi';
import { Avatar, Menu, formatDuration, useClickAway } from '../ui';
import { notify } from '../../components/notify';
import { ask } from '../../components/ask';

const EMOJIS = ['👍', '✅', '🎉', '❤️', '😄', '👀'];

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** One line of history, e.g. "changed status from To do to Complete". */
export function describeActivity(a: Activity, name: (id: string) => string): string {
  const d = a.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const date = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'none');
  switch (a.kind) {
    case 'created': return d.copied_from ? `duplicated this task from “${d.copied_from}”` : 'created this task';
    case 'status': return `changed status from ${d.from ?? '—'} to ${d.to ?? '—'}`;
    case 'name': return `renamed the task to “${d.to}”`;
    case 'description': return 'updated the description';
    case 'priority': return d.to ? `set priority to ${['', 'Urgent', 'High', 'Normal', 'Low'][d.to as number]}` : 'removed the priority';
    case 'due_date': return d.to ? `changed the due date to ${date(d.to)}` : 'removed the due date';
    case 'start_date': return d.to ? `changed the start date to ${date(d.to)}` : 'removed the start date';
    case 'time_estimate_seconds': return d.to ? `set the estimate to ${formatDuration(d.to as number)}` : 'removed the estimate';
    case 'assignees': {
      const parts = [];
      if ((d.added ?? []).length) parts.push(`assigned ${(d.added as string[]).map(name).join(', ')}`);
      if ((d.removed ?? []).length) parts.push(`unassigned ${(d.removed as string[]).map(name).join(', ')}`);
      return parts.join(' and ');
    }
    case 'tags': return [(d.added ?? []).length ? `added tag ${(d.added as string[]).join(', ')}` : '', (d.removed ?? []).length ? `removed tag ${(d.removed as string[]).join(', ')}` : ''].filter(Boolean).join(' and ');
    case 'group': return d.to ? `moved it to group ${d.to}` : 'removed it from its group';
    case 'recurrence': return d.on ? 'set it to repeat' : 'stopped it repeating';
    case 'custom_field': return d.cleared ? `cleared ${d.field}` : `set ${d.field}`;
    case 'archived': return d.to ? 'archived this task' : 'restored this task';
    case 'parent_id': return d.to ? 'made it a subtask' : 'made it a standalone task';
    case 'moved': return `moved it from ${d.from} to ${d.to}`;
    case 'points': return d.to != null ? `set sprint points to ${d.to}` : 'removed the sprint points';
    case 'list_added': return `also added it to ${d.list}`;
    case 'list_removed': return `took it out of ${d.list}`;
    case 'sprint_rollover': return `rolled it over from ${d.from} to ${d.to}`;
    case 'checklist': return `added checklist “${d.name}”`;
    case 'attachment': return `attached ${d.filename}`;
    default: return a.kind.replace(/_/g, ' ');
  }
}

/** Show @Name mentions highlighted. */
const Body: React.FC<{ comment: Comment }> = ({ comment }) => {
  const names = [...comment.mentions.map((m) => m.display_name || m.email), ...comment.mention_teams.map((t) => t.name)].filter(Boolean) as string[];
  if (!names.length) return <p className="whitespace-pre-wrap break-words text-sm text-gray-800">{comment.body}</p>;
  const pattern = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
  return (
    <p className="whitespace-pre-wrap break-words text-sm text-gray-800">
      {comment.body.split(pattern).map((part, i) => (names.some((n) => part === `@${n}`)
        ? <span key={i} className="rounded bg-brand-50 px-0.5 font-medium text-brand-700">{part}</span>
        : <React.Fragment key={i}>{part}</React.Fragment>))}
    </p>
  );
};

/**
 * The composer: plain text with @mentions picked from a list (people and Teams), and an
 * optional assignee that turns the comment into a to-do.
 */
const Composer: React.FC<{
  placeholder: string; autoFocus?: boolean; allowAssign?: boolean; onCancel?: () => void;
  onSend: (body: { body: string; mention_user_ids: string[]; mention_team_ids: string[]; assignee_id: string | null }) => Promise<void>;
}> = ({ placeholder, autoFocus, allowAssign, onCancel, onSend }) => {
  const { members, teams } = useWork();
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<{ users: Set<string>; teams: Set<string> }>({ users: new Set(), teams: new Set() });
  const [query, setQuery] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useClickAway(list, () => setQuery(null), query !== null, box);

  const onChange = (value: string) => {
    setText(value);
    const caret = box.current?.selectionStart ?? value.length;
    const match = /(^|\s)@([\w.-]*)$/.exec(value.slice(0, caret));
    setQuery(match ? match[2].toLowerCase() : null);
  };
  const options = useMemo(() => {
    if (query === null) return [];
    const people = members.map((m) => ({ kind: 'user' as const, id: m.user.id, label: m.user.display_name || m.user.email }));
    const groups = teams.map((t) => ({ kind: 'team' as const, id: t.id, label: t.name }));
    return [...people, ...groups].filter((o) => o.label.toLowerCase().includes(query)).slice(0, 8);
  }, [query, members, teams]);
  const pick = (o: { kind: 'user' | 'team'; id: string; label: string }) => {
    const caret = box.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([\w.-]*)$/, `@${o.label} `);
    setText(before + text.slice(caret));
    setMentions((m) => ({ users: o.kind === 'user' ? new Set(m.users).add(o.id) : m.users, teams: o.kind === 'team' ? new Set(m.teams).add(o.id) : m.teams }));
    setQuery(null);
    box.current?.focus();
  };
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      // Keep only mentions still present in the text.
      const users = [...mentions.users].filter((id) => { const m = members.find((x) => x.user.id === id); return m && text.includes(`@${m.user.display_name || m.user.email}`); });
      const tms = [...mentions.teams].filter((id) => { const t = teams.find((x) => x.id === id); return t && text.includes(`@${t.name}`); });
      await onSend({ body: text.trim(), mention_user_ids: users, mention_team_ids: tms, assignee_id: assignee || null });
      setText(''); setMentions({ users: new Set(), teams: new Set() }); setAssignee('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative rounded-lg border border-gray-200 bg-white focus-within:border-brand-400">
      <textarea
        ref={box}
        autoFocus={autoFocus}
        aria-label={placeholder}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (options.length && e.key === 'Enter') { e.preventDefault(); pick(options[0]); return; }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
        rows={2}
        placeholder={placeholder}
        className="block w-full resize-none rounded-lg px-3 py-2 text-sm focus:outline-none"
      />
      {options.length > 0 && (
        <ul ref={list} className="absolute bottom-full left-2 z-10 mb-1 w-60 rounded-md border border-gray-200 bg-white py-1 shadow-lg" role="listbox" aria-label="Mention">
          {options.map((o) => (
            <li key={`${o.kind}:${o.id}`}>
              <button type="button" role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); pick(o); }} className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-gray-50">
                {o.kind === 'team' ? <Users size={13} className="text-gray-400" /> : <AtSign size={13} className="text-gray-400" />} {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 border-t border-gray-100 px-2 py-1.5">
        <span className="text-[11px] text-gray-400">@ to mention · Ctrl+Enter to send</span>
        {allowAssign && (
          <label className="ml-auto flex items-center gap-1 text-xs text-gray-500">
            <UserCheck size={13} />
            <select aria-label="Assign comment" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded border border-gray-200 px-1 py-0.5 text-xs">
              <option value="">Assign to…</option>
              {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.display_name || m.user.email}</option>)}
            </select>
          </label>
        )}
        {onCancel && <button type="button" onClick={onCancel} className={`${allowAssign ? '' : 'ml-auto '}rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100`}>Cancel</button>}
        <button type="button" onClick={send} disabled={!text.trim() || busy} className={`${allowAssign || onCancel ? '' : 'ml-auto '}rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40`}>
          {assignee ? 'Assign comment' : 'Comment'}
        </button>
      </div>
    </div>
  );
};

const CommentCard: React.FC<{
  comment: Comment; replies: Comment[]; me: string | undefined; canComment: boolean; onChanged: () => void;
}> = ({ comment, replies, me, canComment, onChanged }) => {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const run = (action: Promise<unknown>) => action.then(onChanged).catch((e) => notify.error(e));
  const one = (c: Comment, isReply: boolean) => (
    <div key={c.id} className={`group ${isReply ? 'ml-7 mt-2' : ''}`} aria-label={isReply ? 'Reply' : 'Comment'}>
      <div className="flex items-center gap-2">
        {c.user ? <Avatar user={c.user} size={22} /> : <span className="h-[22px] w-[22px] rounded-full bg-gray-200" />}
        <span className="text-sm font-medium text-gray-900">{c.user?.display_name || c.user?.email || 'Someone'}</span>
        <span className="text-xs text-gray-400">{when(c.created_at)}{c.edited_at ? ' · edited' : ''}</span>
        {(c.user?.id === me || c.can_edit) && (
          <span className="ml-auto hidden group-hover:inline">
            <Menu align="right" label="Comment actions" items={[
              ...(c.user?.id === me ? [{ label: 'Edit', icon: <Pencil size={14} />, onClick: () => { setDraft(c.body); setEditing(true); } }] : []),
              { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: async () => await ask.confirm({ danger: true, title: 'Delete this comment?' }) && run(collabApi.deleteComment(c.id)) },
            ]} trigger={<span className="rounded p-0.5 text-gray-400 hover:bg-gray-100"><MoreHorizontal size={14} /></span>} />
          </span>
        )}
      </div>
      {editing && c.id === comment.id ? (
        <div className="mt-1 pl-7">
          <textarea aria-label="Edit comment" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="w-full rounded border border-brand-300 px-2 py-1 text-sm" />
          <div className="mt-1 flex gap-2">
            <button type="button" onClick={() => { run(collabApi.updateComment(c.id, { body: draft })); setEditing(false); }} className="rounded bg-brand-600 px-2 py-0.5 text-xs text-white">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500">Cancel</button>
          </div>
        </div>
      ) : <div className="mt-0.5 pl-7"><Body comment={c} /></div>}
      {c.assignee && (
        <div className={`mt-1 ml-7 flex items-center gap-2 rounded-md px-2 py-1 text-xs ${c.resolved_at ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
          <UserCheck size={13} /> Assigned to {c.assignee.display_name || c.assignee.email}
          <button type="button" onClick={() => run(collabApi.updateComment(c.id, { resolved: !c.resolved_at }))} className="ml-auto flex items-center gap-1 rounded border border-current px-1.5 py-px font-medium">
            <Check size={11} /> {c.resolved_at ? 'Resolved' : 'Resolve'}
          </button>
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1 pl-7">
        {c.reactions.map((r) => (
          <button key={r.emoji} type="button" title={r.users.join(', ')} onClick={() => run(collabApi.react(c.id, r.emoji))}
            className={`rounded-full border px-1.5 py-px text-xs ${r.mine ? 'border-brand-300 bg-brand-50' : 'border-gray-200'}`}>{r.emoji} {r.count}</button>
        ))}
        {canComment && (
          <span className="hidden gap-0.5 group-hover:inline-flex">
            <Menu label="Add reaction" items={EMOJIS.map((e) => ({ label: e, onClick: () => run(collabApi.react(c.id, e)) }))}
              trigger={<span className="rounded p-0.5 text-gray-400 hover:bg-gray-100" title="React"><SmilePlus size={13} /></span>} />
          </span>
        )}
        {!isReply && canComment && (
          <button type="button" onClick={() => setReplying(true)} className="rounded px-1 text-xs text-gray-500 hover:text-brand-600">Reply</button>
        )}
      </div>
    </div>
  );
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      {one(comment, false)}
      {replies.map((r) => one(r, true))}
      {replying && (
        <div className="ml-7 mt-2">
          <Composer autoFocus placeholder="Reply…" onCancel={() => setReplying(false)}
            onSend={async (body) => { await collabApi.addComment(comment.task_id, { ...body, parent_id: comment.id }); setReplying(false); onChanged(); }} />
        </div>
      )}
      {replies.length > 0 && !replying && canComment && (
        <button type="button" onClick={() => setReplying(true)} className="ml-7 mt-1 flex items-center gap-1 text-xs text-gray-500 hover:text-brand-600"><CornerDownRight size={12} /> Reply in thread</button>
      )}
    </div>
  );
};

type Period = 'all' | 'today' | 'yesterday' | 'week' | 'custom';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This week' },
  { value: 'custom', label: 'Custom range…' },
];

/** The window a period covers, as [from, to). `null` means everything. */
function windowFor(period: Period, from: string, to: string): [Date, Date] | null {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = midnight(new Date());
  const days = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  if (period === 'today') return [today, days(today, 1)];
  if (period === 'yesterday') return [days(today, -1), today];
  // The week runs from Monday, which is how the timesheets and the workload read it.
  if (period === 'week') return [days(today, -((today.getDay() + 6) % 7)), days(today, 1)];
  if (period === 'custom') {
    if (!from && !to) return null;
    return [from ? new Date(`${from}T00:00:00`) : new Date(0), to ? days(new Date(`${to}T00:00:00`), 1) : days(today, 1)];
  }
  return null;
}

/** The right-hand column of a task: comments and history, oldest first, as in ClickUp. */
export const TaskFeed: React.FC<{ taskId: string; canComment: boolean; refreshKey: number; onChanged: () => void }> = ({ taskId, canComment, refreshKey, onChanged }) => {
  const { allMembers: members } = useWork();
  const [comments, setComments] = useState<Comment[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [show, setShow] = useState<'all' | 'comments'>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const viewer = useMe();
  const load = useCallback(async () => {
    const [c, a] = await Promise.all([collabApi.comments(taskId), collabApi.activity(taskId)]);
    setComments(c);
    setActivity(a);
  }, [taskId]);
  useEffect(() => { load().catch(() => undefined); }, [load, refreshKey]);
  const name = (id: string) => { const m = members.find((x) => x.user.id === id); return m ? m.user.display_name || m.user.email : 'someone'; };

  const threads = comments.filter((c) => !c.parent_id);
  const replies = (id: string) => comments.filter((c) => c.parent_id === id);
  const span = windowFor(period, from, to);
  const within = (iso: string) => {
    if (!span) return true;
    const at = new Date(iso);
    return at >= span[0] && at < span[1];
  };
  const all = [
    ...threads.map((c) => ({ at: c.created_at, key: `c:${c.id}`, comment: c })),
    ...(show === 'all' ? activity.filter((a) => a.kind !== 'comment').map((a) => ({ at: a.created_at, key: `a:${a.id}`, activity: a })) : []),
  ].sort((x, y) => x.at.localeCompare(y.at));
  const feed = all.filter((item) => within(item.at));
  const hidden = all.length - feed.length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50/80">
      <div className="border-b border-gray-200 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <MessageSquare size={15} className="text-gray-500" />
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Activity</h3>
          <select aria-label="When" value={period} onChange={(e) => setPeriod(e.target.value as Period)}
            className="ml-auto rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-600">
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as 'all' | 'comments')} className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-600">
            <option value="all">Comments and history</option><option value="comments">Comments only</option>
          </select>
        </div>
        {period === 'custom' && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <label className="flex items-center gap-1">From
              <input type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)}
                className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs" />
            </label>
            <label className="flex items-center gap-1">to
              <input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)}
                className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs" />
            </label>
            {(from || to) && <button type="button" onClick={() => { setFrom(''); setTo(''); }} className="rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-200">Clear</button>}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-label="Activity feed">
        {feed.length === 0 && all.length > 0 && (
          <p className="px-1 py-2 text-xs text-gray-500">
            Nothing in that period. {hidden} {hidden === 1 ? 'entry is' : 'entries are'} outside it.
          </p>
        )}
        {feed.map((item) => ('comment' in item && item.comment ? (
          <CommentCard key={item.key} comment={item.comment} replies={replies(item.comment.id)} me={viewer} canComment={canComment}
            onChanged={() => { load(); onChanged(); }} />
        ) : 'activity' in item && item.activity ? (
          <p key={item.key} className="px-1 text-xs text-gray-500">
            <span className="font-medium text-gray-700">{item.activity.user?.display_name || item.activity.user?.email || ((item.activity.data as Record<string, unknown>)?.automation ? 'Automation' : 'Someone')}</span>{' '}
            {describeActivity(item.activity, name)} <span className="text-gray-400">· {when(item.activity.created_at)}</span>
          </p>
        ) : null))}
        <div ref={bottom} />
      </div>
      {canComment ? (
        <div className="border-t border-gray-200 p-3">
          <Composer allowAssign placeholder="Write a comment…" onSend={async (body) => {
            await collabApi.addComment(taskId, body);
            await load();
            onChanged();
            setTimeout(() => bottom.current?.scrollIntoView({ block: 'end' }), 50);
          }} />
        </div>
      ) : <p className="border-t border-gray-200 p-3 text-xs text-gray-400">You need comment access to comment on this task.</p>}
    </div>
  );
};

