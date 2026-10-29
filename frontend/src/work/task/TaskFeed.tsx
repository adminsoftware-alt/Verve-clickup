import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Check, CornerDownRight, MessageSquare, MoreHorizontal, Paperclip, Pencil, SmilePlus, Trash2, UserCheck, Users, X } from 'lucide-react';
import { useWork, useMe } from '../WorkContext';
import { collabApi, type Activity, type Comment } from '../collabApi';
import { Avatar, Menu, SearchSelect, formatDuration, useClickAway } from '../ui';
import { notify } from '../../components/notify';
import { ask } from '../../components/ask';
import { CommentBody, CommentFiles, toTokens, useEditable, type MentionPick } from './commentText';

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

/** Send a new comment's files after it, one at a time; a file that fails is said, the rest still go. */
export async function sendCommentFiles(commentId: string, files: File[]): Promise<void> {
  for (const f of files) {
    try {
      await collabApi.addCommentFile(commentId, f);
    } catch (e) {
      notify.error(e);
    }
  }
}

export interface ComposerOutput { body: string; mention_user_ids: string[]; mention_team_ids: string[]; assignee_id: string | null; files: File[] }

/**
 * The composer: text with light formatting, @mentions picked from a list (people and Teams),
 * files attached, pasted or dropped, and an optional assignee that turns the comment into a to-do.
 */
export const Composer: React.FC<{
  placeholder: string; autoFocus?: boolean; allowAssign?: boolean; onCancel?: () => void;
  onSend: (body: ComposerOutput) => Promise<void>;
}> = ({ placeholder, autoFocus, allowAssign, onCancel, onSend }) => {
  const { members, teams } = useWork();
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<{ users: Set<string>; teams: Set<string> }>({ users: new Set(), teams: new Set() });
  const [query, setQuery] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const addFiles = (list: FileList | File[] | null) => { if (list && list.length) setFiles((f) => [...f, ...Array.from(list)].slice(0, 10)); };
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
      // Keep only mentions still present in the text, and store them as tokens.
      const picks: MentionPick[] = [
        ...[...mentions.users].flatMap((id) => { const m = members.find((x) => x.user.id === id); return m ? [{ kind: 'user' as const, id, label: m.user.display_name || m.user.email }] : []; }),
        ...[...mentions.teams].flatMap((id) => { const t = teams.find((x) => x.id === id); return t ? [{ kind: 'team' as const, id, label: t.name }] : []; }),
      ].filter((p) => text.includes(`@${p.label}`));
      await onSend({
        body: toTokens(text.trim(), picks),
        mention_user_ids: picks.filter((p) => p.kind === 'user').map((p) => p.id),
        mention_team_ids: picks.filter((p) => p.kind === 'team').map((p) => p.id),
        assignee_id: assignee || null, files,
      });
      setText(''); setMentions({ users: new Set(), teams: new Set() }); setAssignee(''); setFiles([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`relative rounded-lg border bg-white focus-within:border-brand-400 ${dragging ? 'border-brand-400 ring-2 ring-brand-100' : 'border-gray-200'}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } setDragging(false); }}
    >
      <textarea
        ref={box}
        autoFocus={autoFocus}
        aria-label={placeholder}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
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
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-2 pb-1.5" aria-label="Files to send">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex max-w-[12rem] items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-700">
              <Paperclip size={11} className="shrink-0 text-gray-400" /><span className="truncate">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))} className="text-gray-400 hover:text-gray-700"><X size={11} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 border-t border-gray-100 px-2 py-1.5">
        <input ref={picker} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <button type="button" aria-label="Attach files" onClick={() => picker.current?.click()} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Paperclip size={14} /></button>
        <span className="hidden text-[11px] text-gray-400 sm:inline">@ to mention · **bold** · - list · Ctrl+Enter to send</span>
        {allowAssign && (
          <label className="ml-auto flex items-center gap-1 text-xs text-gray-500">
            <UserCheck size={13} />
            <SearchSelect label="Assign comment" value={assignee} onChange={setAssignee} placeholder="Assign to…" width={240}
              size="sm" className="max-w-40"
              options={[
                // Taking it back is only offered once someone has been picked.
                ...(assignee ? [{ value: '', label: "Don't assign" }] : []),
                ...members.map((m) => ({ value: m.user.id, label: m.user.display_name || m.user.email, hint: m.user.email })),
              ]} />
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
  /** Comments after this moment, by someone else, are marked New. */
  lastSeen: string | null; highlight: string | null;
}> = ({ comment, replies, me, canComment, onChanged, lastSeen, highlight }) => {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const editable = useEditable();
  const { allMembers, teams } = useWork();
  const run = (action: Promise<unknown>) => action.then(onChanged).catch((e) => notify.error(e));
  // Saving an edit: mentions that were there stay tokens, and typing @Full Name mentions them anew.
  const saveEdit = (c: Comment) => {
    const everyone: MentionPick[] = [
      ...allMembers.map((m) => ({ kind: 'user' as const, id: m.user.id, label: m.user.display_name || m.user.email })),
      ...teams.map((t) => ({ kind: 'team' as const, id: t.id, label: t.name })),
    ];
    run(collabApi.updateComment(c.id, { body: toTokens(draft, [...editable(c.body).picks, ...everyone]) }));
    setEditing(false);
  };
  const one = (c: Comment, isReply: boolean) => (
    <div key={c.id} id={`comment-${c.id}`} aria-label={isReply ? 'Reply' : 'Comment'}
      className={`group rounded-md transition-colors duration-700 ${isReply ? 'ml-7 mt-2' : ''} ${highlight === c.id ? 'bg-amber-50 ring-2 ring-amber-300 ring-offset-2' : ''}`}>
      <div className="flex items-center gap-2">
        {c.user ? <Avatar user={c.user} size={22} /> : <span className="h-[22px] w-[22px] rounded-full bg-gray-200" />}
        <span className="text-sm font-medium text-gray-900">{c.user?.display_name || c.user?.email || 'Someone'}</span>
        <span className="text-xs text-gray-400">{when(c.created_at)}{c.edited_at ? ' · edited' : ''}</span>
        {lastSeen && c.user?.id !== me && Date.parse(c.created_at) > Date.parse(lastSeen) && (
          <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold uppercase text-white">New</span>
        )}
        {(c.user?.id === me || c.can_edit) && (
          <span className="ml-auto hidden group-hover:inline">
            <Menu align="right" label="Comment actions" items={[
              ...(c.user?.id === me ? [{ label: 'Edit', icon: <Pencil size={14} />, onClick: () => { setDraft(editable(c.body).text); setEditing(true); } }] : []),
              { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: async () => await ask.confirm({ danger: true, title: 'Delete this comment?' }) && run(collabApi.deleteComment(c.id)) },
            ]} trigger={<span className="rounded p-0.5 text-gray-400 hover:bg-gray-100"><MoreHorizontal size={14} /></span>} />
          </span>
        )}
      </div>
      {editing && c.id === comment.id ? (
        <div className="mt-1 pl-7">
          <textarea aria-label="Edit comment" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="w-full rounded border border-brand-300 px-2 py-1 text-sm" />
          <div className="mt-1 flex gap-2">
            <button type="button" disabled={!draft.trim()} onClick={() => saveEdit(c)} className="rounded bg-brand-600 px-2 py-0.5 text-xs text-white disabled:opacity-40">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500">Cancel</button>
          </div>
        </div>
      ) : <div className="mt-0.5 pl-7"><CommentBody comment={c} /></div>}
      {c.attachments.length > 0 && <div className="pl-7"><CommentFiles files={c.attachments} /></div>}
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
          <button key={r.emoji} type="button" aria-label={r.users.join(', ')} onClick={() => run(collabApi.react(c.id, r.emoji))}
            className={`rounded-full border px-1.5 py-px text-xs ${r.mine ? 'border-brand-300 bg-brand-50' : 'border-gray-200'}`}>{r.emoji} {r.count}</button>
        ))}
        {canComment && (
          <span className="hidden gap-0.5 group-hover:inline-flex">
            <Menu label="Add reaction" items={EMOJIS.map((e) => ({ label: e, onClick: () => run(collabApi.react(c.id, e)) }))}
              trigger={<span className="rounded p-0.5 text-gray-400 hover:bg-gray-100" aria-label="React"><SmilePlus size={13} /></span>} />
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
            onSend={async ({ files, ...body }) => {
              const sent = await collabApi.addComment(comment.task_id, { ...body, parent_id: comment.id });
              await sendCommentFiles(sent.id, files);
              setReplying(false); onChanged();
            }} />
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
export const TaskFeed: React.FC<{
  taskId: string; canComment: boolean; refreshKey: number; onChanged: () => void;
  /** Scroll to this comment and light it up -- where an Inbox item about it leads. */
  focusCommentId?: string | null;
}> = ({ taskId, canComment, refreshKey, onChanged, focusCommentId }) => {
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
  // While the task is open and on screen, someone else's comment shows up within 10 s.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load().catch(() => undefined); }, 10_000);
    return () => clearInterval(t);
  }, [load]);
  // When you last looked is fetched once per opening: the New marks stay put while you read,
  // and the next opening starts from now.
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  useEffect(() => {
    setLastSeen(null);
    collabApi.seen(taskId).then((r) => setLastSeen(r.previous)).catch(() => undefined);
  }, [taskId]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focusCommentId || focused.current === focusCommentId) return;
    const el = document.getElementById(`comment-${focusCommentId}`);
    if (!el) return; // not loaded yet; this runs again when the comments arrive
    focused.current = focusCommentId;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlight(focusCommentId);
    const t = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(t);
  }, [focusCommentId, comments]);
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
            lastSeen={lastSeen} highlight={highlight} onChanged={() => { load(); onChanged(); }} />
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
          <Composer allowAssign placeholder="Write a comment…" onSend={async ({ files, ...body }) => {
            const sent = await collabApi.addComment(taskId, body);
            await sendCommentFiles(sent.id, files);
            await load();
            onChanged();
            setTimeout(() => bottom.current?.scrollIntoView({ block: 'end' }), 50);
          }} />
        </div>
      ) : <p className="border-t border-gray-200 p-3 text-xs text-gray-400">You need comment access to comment on this task.</p>}
    </div>
  );
};

