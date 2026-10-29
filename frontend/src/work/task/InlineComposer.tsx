// "+ Add Task" on a List: the new task is written in the row itself, not in a pop-up.
//
// The name comes first, then a small tool for each thing a task cannot be made without -- who,
// when, how urgent, how big -- and Save. Typing "tomorrow !high @aditi 2h" in the name fills those
// tools as well. Save makes the task when everything is there; otherwise the missing tools turn
// red and the row says what is still needed. Escape cancels; clicking away keeps the draft.
import React, { useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Flag } from 'lucide-react';

import { useMe } from '../WorkContext';
import type { Status, TaskInput, UserRef } from '../api';
import { DateField } from '../DateField';
import { DurationInput } from '../DurationInput';
import { Menu, PRIORITIES, StatusDot } from '../ui';
import { parseQuickAdd } from '../views/quickAdd';
import { AssigneePicker } from './AssigneePicker';

const tool = (bad: boolean) =>
  `flex h-7 items-center rounded-md border bg-white text-xs ${bad ? 'border-red-400' : 'border-gray-200 hover:border-[#B3C3DF]'}`;

export const InlineComposer: React.FC<{
  status: Status | null;
  people: UserRef[];
  onSave: (name: string, input: TaskInput) => Promise<void>;
  onCancel: () => void;
}> = ({ status, people, onSave, onCancel }) => {
  const me = useMe();
  const [text, setText] = useState('');
  const [assignees, setAssignees] = useState<string[]>([me]);
  const [start, setStart] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [priority, setPriority] = useState<number>(3);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameBox = useRef<HTMLInputElement>(null);

  // What the typed name says, merged under what the tools say: a tool set by hand wins.
  const q = useMemo(() => (text.trim() ? parseQuickAdd(text, people) : null), [text, people]);
  const typed = q?.input ?? {};
  const final = {
    name: (q?.name ?? text).trim(),
    assignees: typed.assignees?.length ? [...new Set([...assignees, ...typed.assignees])] : assignees,
    start_date: start ?? typed.start_date ?? null,
    due_date: due ?? typed.due_date ?? null,
    priority: typed.priority ?? priority,
    time_estimate_seconds: estimate ?? typed.time_estimate_seconds ?? null,
  };
  const backwards = !!final.start_date && !!final.due_date && new Date(final.due_date) < new Date(final.start_date);
  const missing = {
    name: !final.name,
    assignees: !final.assignees.length,
    dates: !final.start_date || !final.due_date || backwards,
    estimate: !(final.time_estimate_seconds && final.time_estimate_seconds > 0),
  };
  const needed = [
    missing.assignees && 'an assignee', missing.dates && (backwards ? 'a due date after the start' : 'start and due dates'),
    missing.estimate && 'an estimate',
  ].filter(Boolean) as string[];

  const save = async () => {
    setTried(true);
    if (Object.values(missing).some(Boolean) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { name, ...input } = final;
      await onSave(name, { ...typed, ...input });
      // Ready for the next one, with the same person and dates: the usual next task is a sibling.
      setText(''); setEstimate(null); setTried(false);
      nameBox.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const p = PRIORITIES[final.priority];
  const chosen = people.filter((u) => final.assignees.includes(u.id));

  return (
    <div className="border-b border-gray-100 bg-[#FAFBFD] py-1.5 pl-9 pr-4"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
      <div className="flex flex-wrap items-center gap-2">
        {status ? <StatusDot status={status} /> : <span className="h-3 w-3" />}
        <input
          ref={nameBox} autoFocus value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
          aria-label="New task name" aria-invalid={tried && missing.name}
          placeholder="Task name — try “tomorrow !high @name 2h”"
          className="min-w-[12rem] flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
        />

        <span className={`${tool(tried && missing.assignees)} px-0.5`}>
          <AssigneePicker listId="" assignable={null} editable canShare={false} multiple
            assignees={chosen} onChange={setAssignees} onShared={() => undefined} />
        </span>

        <span className={`${tool(tried && missing.dates)} gap-0.5 px-0.5`}>
          <span className="w-[5.5rem]"><DateField label="Start date" placeholder="Start" format="compact" value={final.start_date} onChange={setStart} /></span>
          <span className="text-gray-300">→</span>
          <span className="w-[5.5rem]"><DateField label="Due date" placeholder="Due" format="compact" value={final.due_date} overdue={backwards} onChange={setDue} /></span>
        </span>

        <Menu label="Priority" triggerClassName="inline-flex"
          items={Object.entries(PRIORITIES).map(([v, pr]) => ({ label: pr.label, icon: <Flag size={13} style={{ color: pr.color }} />, onClick: () => setPriority(Number(v)) }))}
          trigger={<span className={`${tool(false)} gap-1 px-2`} style={{ color: p?.color }}><Flag size={12} />{p?.label}</span>} />

        <DurationInput label="Time estimate" value={final.time_estimate_seconds} placeholder="Estimate"
          onChange={setEstimate}
          className={`${tool(tried && missing.estimate)} w-20 px-2 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none`} />

        <button type="button" onClick={save} disabled={busy}
          className="flex h-7 items-center gap-1 rounded-md bg-[#234788] px-2.5 text-xs font-semibold text-white hover:bg-[#1C3A70] disabled:opacity-60">
          {busy ? 'Saving…' : <>Save <CornerDownLeft size={12} /></>}
        </button>
      </div>

      {/* What the name was read as, then -- once Save was tried -- what is still missing. */}
      {(q && q.chips.length > 0) || (tried && needed.length) || error ? (
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-5 text-[11px]">
          {q?.chips.map((c) => <span key={c} className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">{c}</span>)}
          {tried && needed.length > 0 && <span className="text-red-600">Still needed: {needed.join(', ')}.</span>}
          {error && <span className="text-red-600">{error}</span>}
        </div>
      ) : null}
    </div>
  );
};
