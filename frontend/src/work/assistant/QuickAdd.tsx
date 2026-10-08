// Say or type a sentence; see what it understood; press Create.
//
// The preview is the feature. Anything that reads a sentence will sometimes read it wrongly, and
// a task created from a misheard name is worse than no task at all -- so nothing is ever created
// without a person seeing the fields first. That rule is what makes dictation safe enough to put
// in front of a firm whose task names carry client names.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Mic, Sparkles, Square } from 'lucide-react';

import { workApi, type ListNode } from '../api';
import { useMe, useWork } from '../WorkContext';
import { Avatar, PRIORITIES, formatDuration } from '../ui';
import { compactDate } from '../dates';
import { Sheet } from '../Sheet';
import { parseCommand, type ParsedCommand } from './parseCommand';
import { useVoice } from './useVoice';

const EXAMPLES = [
  'Workup meeting as normal for today to tomorrow and assign to me',
  'File the GSTR-3B by the 20th, high priority',
  'Call the auditor tomorrow, should take 1h',
];

/** Every List the person can put a task in, flattened out of the sidebar tree. */
function useLists(): ListNode[] {
  const { hierarchy } = useWork();
  return useMemo(() => {
    const out: ListNode[] = [];
    const walk = (node: { lists?: ListNode[]; folders?: { lists?: ListNode[] }[] }) => {
      for (const l of node.lists ?? []) out.push(l);
      for (const f of node.folders ?? []) walk(f);
    };
    for (const space of hierarchy?.spaces ?? []) walk(space);
    walk(hierarchy?.shared_with_me ?? {});
    if (hierarchy?.personal_list) out.unshift(hierarchy.personal_list);
    return out;
  }, [hierarchy]);
}

export const QuickAdd: React.FC<{ onClose: () => void; onCreated?: (taskId: string) => void }> = ({ onClose, onCreated }) => {
  const { members, hierarchy } = useWork();
  const me = useMe();
  const lists = useLists();
  const [text, setText] = useState('');
  const [listId, setListId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const voice = useVoice((final) => setText(final));
  useEffect(() => { if (voice.listening && voice.heard) setText(voice.heard); }, [voice.listening, voice.heard]);
  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => { if (!listId) setListId(hierarchy?.personal_list?.id ?? lists[0]?.id ?? ''); }, [lists, hierarchy, listId]);

  const people = useMemo(
    () => members.filter((m) => !m.deactivated).map((m) => ({ id: m.user.id, display_name: m.user.display_name, email: m.user.email })),
    [members],
  );
  const parsed: ParsedCommand | null = text.trim() ? parseCommand(text, people, me ?? undefined) : null;
  const named = (id: string) => {
    const m = members.find((x) => x.user.id === id);
    return m ? m.user.display_name || m.user.email : id;
  };

  const create = async () => {
    if (!parsed?.name || !listId) return;
    setBusy(true);
    setError(null);
    try {
      const task = await workApi.createTask(listId, {
        name: parsed.name,
        priority: parsed.priority,
        start_date: parsed.start_date,
        due_date: parsed.due_date,
        time_estimate_seconds: parsed.time_estimate_seconds,
        assignees: parsed.assignees,
      });
      onCreated?.(task.id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chip = 'inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] ring-1 ring-gray-200';

  return (
    <Sheet
      onClose={onClose}
      title={<span className="flex items-center gap-2"><Sparkles size={16} className="text-brand-600" /> Add a task by saying it</span>}
      width="w-[34rem]"
      footer={
        <div className="flex items-center gap-2">
          {/* Said out loud, because the default is whatever List came first and a task that
              lands somewhere nobody looks is worse than one that was never created. */}
          <span className="shrink-0 text-sm text-gray-500">in</span>
          <select
            aria-label="Which list it goes in" value={listId} onChange={(e) => setListId(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button
            type="button" onClick={create} disabled={busy || !parsed?.name || !listId}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Create task
          </button>
        </div>
      }
    >
      <div className="relative">
        <textarea
          ref={box} rows={2} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create(); }}
          aria-label="Say or type what you want to add"
          placeholder="Call the auditor tomorrow, high priority, assign to me"
          className="w-full resize-none rounded-xl border border-gray-300 py-2.5 pl-3 pr-12 text-[15px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
        />
        {voice.supported && (
          <button
            type="button"
            onClick={voice.listening ? voice.stop : voice.start}
            aria-label={voice.listening ? 'Stop listening' : 'Dictate'}
            className={`tap absolute right-1.5 top-1.5 rounded-lg ${voice.listening ? 'bg-red-50 text-red-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'}`}
          >
            {voice.listening ? <Square size={16} /> : <Mic size={18} />}
          </button>
        )}
      </div>

      {voice.listening && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Listening — say it in one sentence
        </p>
      )}
      {voice.error && <p className="mt-1.5 text-xs text-amber-700">{voice.error}</p>}

      {/* What it understood, before anything exists. */}
      {parsed && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/70 p-3">
          {parsed.name ? (
            <p className="text-[15px] font-medium text-gray-900">{parsed.name}</p>
          ) : (
            <p className="text-sm text-gray-400">No task name yet.</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {parsed.priority && (
              <span className={chip}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITIES[parsed.priority].color }} />
                {PRIORITIES[parsed.priority].label}
              </span>
            )}
            {parsed.start_date && <span className={chip}>Starts {compactDate(parsed.start_date)}</span>}
            {parsed.due_date && <span className={chip}>Due {compactDate(parsed.due_date)}</span>}
            {parsed.time_estimate_seconds != null && <span className={chip}>{formatDuration(parsed.time_estimate_seconds)}</span>}
            {parsed.assignees.map((id) => {
              const m = members.find((x) => x.user.id === id);
              return (
                <span key={id} className={chip}>
                  {m && <Avatar user={m.user} size={14} />}{named(id)}
                </span>
              );
            })}
            {parsed.found.length === 0 && parsed.name && <span className="text-[11px] text-gray-400">Name only — no dates, priority or assignee understood.</span>}
          </div>

          {/* Which words each field came from, so a mishearing is obvious rather than buried. */}
          {parsed.found.length > 0 && (
            <p className="mt-2 text-[11px] text-gray-500">
              From what you said: {parsed.found.map((f) => `${f.field} — “${f.from}”`).join(' · ')}
            </p>
          )}

          {parsed.unknown.length > 0 && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{parsed.unknown.join('; ')}. Edit the sentence above, or create it and fix the task afterwards.</span>
            </p>
          )}
        </div>
      )}

      {!text.trim() && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-gray-500">Try one of these:</p>
          <div className="flex flex-col items-start gap-1">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" onClick={() => setText(e)} className="rounded-lg px-2 py-1 text-left text-[13px] text-brand-700 hover:bg-brand-50">
                “{e}”
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
      <p className="mt-3 text-[11px] text-gray-400">
        Nothing is created until you press Create. Dictation uses your browser's own speech recognition.
      </p>
    </Sheet>
  );
};
