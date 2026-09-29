// Chat view: a conversation that lives next to a Space, Folder or List's tasks. @mention people to
// notify them; turn any message into a task.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, Pencil, Send, Trash2 } from 'lucide-react';
import type { UserRef } from '../api';
import { Avatar } from '../ui';
import { spacesApi, type ChatMessage } from '../spacesApi';
import { ask } from '../../components/ask';

const POLL_MS = 5000;
const nameOf = (u: UserRef) => u.display_name || u.email.split('@')[0];

export const ChatView: React.FC<{
  viewId: string; people: UserRef[]; canPost: boolean; canManage: boolean; listId: string | null; lists: { id: string; label: string }[];
  onOpenTask: (id: string) => void; onTaskCreated: () => void;
}> = ({ viewId, people, canPost, canManage, listId, lists, onOpenTask, onTaskCreated }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [mentions, setMentions] = useState<UserRef[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try { setMessages(await spacesApi.chat(viewId)); } catch (e) { setError((e as Error).message); }
  }, [viewId]);
  useEffect(() => { load(); const t = window.setInterval(load, POLL_MS); return () => window.clearInterval(t); }, [load]);
  const count = messages.length;
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'end' }); }, [count]);

  const matches = useMemo(
    () => (query === null ? [] : people.filter((p) => nameOf(p).toLowerCase().includes(query.toLowerCase())).slice(0, 6)),
    [query, people],
  );
  const onType = (value: string) => {
    setDraft(value);
    const m = value.slice(0, box.current?.selectionStart ?? value.length).match(/@([\w.-]*)$/);
    setQuery(m ? m[1] : null);
  };
  const pick = (p: UserRef) => {
    const pos = box.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, pos).replace(/@([\w.-]*)$/, `@${nameOf(p)} `);
    setDraft(before + draft.slice(pos));
    setMentions((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]));
    setQuery(null);
    box.current?.focus();
  };
  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    try {
      if (editing) { await spacesApi.editChat(editing, body); setEditing(null); }
      else await spacesApi.postChat(viewId, body, mentions.filter((p) => body.includes(`@${nameOf(p)}`)).map((p) => p.id));
      setDraft('');
      setMentions([]);
      load();
    } catch (e) { setError((e as Error).message); }
  };
  const makeTask = async (m: ChatMessage) => {
    let target = listId ?? undefined;
    if (!target) {
      const choice = await ask.prompt(`Which List? ${lists.map((l, i) => `${i + 1}. ${l.label}`).join('  ')}`, '1');
      const idx = Number(choice) - 1;
      if (!lists[idx]) return;
      target = lists[idx].id;
    }
    try { const t = await spacesApi.chatToTask(m.id, target); load(); onTaskCreated(); onOpenTask(t.id); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ol className="min-h-0 flex-1 space-y-3 overflow-auto px-6 py-4" aria-label="Messages">
        {messages.length === 0 && <li className="mt-10 text-center text-sm text-gray-400">No messages yet. Say hello — type @ to mention someone.</li>}
        {messages.map((m) => (
          <li key={m.id} className="group flex gap-2.5">
            {m.user ? <Avatar user={m.user} size={28} /> : <span className="h-7 w-7 rounded-full bg-gray-200" />}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500">
                <span className="font-medium text-gray-800">{m.user ? nameOf(m.user) : 'Someone who left'}</span>{' '}
                {new Date(m.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                {m.edited_at && ' · edited'}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm text-gray-800">
                {m.body.split(/(@[\w.-]+(?: [\w.-]+)?)/g).map((part, i) =>
                  part.startsWith('@') && people.some((p) => part.startsWith(`@${nameOf(p)}`))
                    ? <span key={i} className="rounded bg-brand-50 px-0.5 text-brand-700">{part}</span> : part)}
              </p>
              {m.task_id && (
                <button type="button" onClick={() => onOpenTask(m.task_id!)} className="mt-1 flex items-center gap-1 text-xs text-brand-600 hover:underline"><CheckSquare size={12} /> Open the task</button>
              )}
            </div>
            <span className="flex shrink-0 items-start gap-0.5 opacity-0 group-hover:opacity-100">
              {!m.task_id && canPost && (
                <button type="button" title="Make it a task" aria-label="Make it a task" onClick={() => makeTask(m)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><CheckSquare size={13} /></button>
              )}
              {m.mine && (
                <button type="button" title="Edit" aria-label="Edit message" onClick={() => { setEditing(m.id); setDraft(m.body); box.current?.focus(); }} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Pencil size={13} /></button>
              )}
              {(m.mine || canManage) && (
                <button type="button" title="Delete" aria-label="Delete message" onClick={async () => { if (await ask.confirm({ danger: true, title: 'Delete this message?' })) spacesApi.deleteChat(m.id).then(load); }}
                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
              )}
            </span>
          </li>
        ))}
        <div ref={bottom} />
      </ol>
      {error && <p className="mx-6 mb-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      {canPost ? (
        <div className="relative border-t border-gray-100 px-6 py-3">
          {matches.length > 0 && (
            <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full left-6 mb-1 w-64 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
              {matches.map((p) => (
                <li key={p.id}>
                  <button type="button" role="option" aria-selected="false" onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                    className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-gray-50"><Avatar user={p} size={18} /> {nameOf(p)}</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <textarea ref={box} value={draft} rows={Math.min(5, draft.split('\n').length)} aria-label="Message"
              placeholder={editing ? 'Edit your message' : 'Message — type @ to mention'}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && matches.length === 0) { e.preventDefault(); send(); }
                if (e.key === 'Enter' && matches.length > 0) { e.preventDefault(); pick(matches[0]); }
                if (e.key === 'Escape') { setQuery(null); if (editing) { setEditing(null); setDraft(''); } }
              }}
              className="min-h-[2.25rem] flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
            <button type="button" onClick={send} disabled={!draft.trim()} aria-label={editing ? 'Save message' : 'Send'}
              className="flex h-9 items-center gap-1 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"><Send size={14} /></button>
          </div>
        </div>
      ) : <p className="border-t border-gray-100 px-6 py-3 text-xs text-gray-400">You can read this chat but not post in it.</p>}
    </div>
  );
};
