// "+ Add Task" on a List: the new task is written in the row itself, not in a pop-up.
//
// The name comes first, then a small tool for each thing a task cannot be made without -- who,
// when, how urgent, how big. Typing "tomorrow !high @aditi 2h" in the name fills those tools as
// well. There is no Save button: the task saves itself on Enter or when you click anywhere outside
// the row, as long as everything is there; otherwise the missing tools turn red and the row says
// what is still needed, and the draft stays. Escape cancels.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Flag } from 'lucide-react';

import { useMe } from '../WorkContext';
import type { Status, TaskInput, UserRef } from '../api';
import { DateField } from '../DateField';
import { DurationInput } from '../DurationInput';
import { Menu, PRIORITIES, StatusDot } from '../ui';
import { parseQuickAdd } from '../views/quickAdd';
import type { ColumnKey } from '../views/viewSettings';
import { AssigneePicker } from './AssigneePicker';

const tool = (bad: boolean) =>
  `flex h-7 items-center rounded-md border bg-white text-xs ${bad ? 'border-red-400' : 'border-gray-200 hover:border-[#B3C3DF]'}`;

/** The List's column grid. Given, each tool sits in its own column, under its header. */
export interface ComposerGrid {
  template: string;
  columns: ColumnKey[];
  /** Custom-field columns after the standard ones: left empty here. */
  extra: number;
}

export const InlineComposer: React.FC<{
  status: Status | null;
  people: UserRef[];
  onSave: (name: string, input: TaskInput) => Promise<void>;
  onCancel: () => void;
  grid?: ComposerGrid;
}> = ({ status, people, onSave, onCancel, grid }) => {
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

  // `refocus`: after Enter the name box is ready for the next task; after a click elsewhere the
  // focus stays where the person clicked.
  const save = async (refocus: boolean) => {
    setTried(true);
    if (Object.values(missing).some(Boolean) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { name, ...input } = final;
      await onSave(name, { ...typed, ...input });
      // Ready for the next one, with the same person and dates: the usual next task is a sibling.
      setText(''); setEstimate(null); setTried(false);
      if (refocus) nameBox.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Clicking away saves. The date, person and priority pickers open in a layer at the end of the
  // page, outside this row's box, but React still passes their clicks through the row: a press
  // the row saw first is one of its own, and only a press it never saw is a click elsewhere.
  const pressedInside = useRef(false);
  const latestSave = useRef(save);
  latestSave.current = save;
  const hasDraft = text.trim() !== '';
  useEffect(() => {
    const onPress = () => {
      const inside = pressedInside.current;
      pressedInside.current = false;
      if (!inside && hasDraft) latestSave.current(false);
    };
    document.addEventListener('pointerdown', onPress);
    return () => document.removeEventListener('pointerdown', onPress);
  }, [hasDraft]);

  const p = PRIORITIES[final.priority];
  const chosen = people.filter((u) => final.assignees.includes(u.id));

  const nameInput = (
    <input
      ref={nameBox} autoFocus value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(true); } }}
      aria-label="New task name" aria-invalid={tried && missing.name}
      placeholder="Task name — try “tomorrow !high @name 2h”"
      className="min-w-[12rem] flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
    />
  );
  const dot = status ? <StatusDot status={status} /> : <span className="h-3 w-3" />;
  // Each tool fills its cell in the grid; on its own (phone) it keeps its natural width.
  const fill = grid ? 'w-full' : '';
  // A date column is 96px: the picker's own padding is trimmed so "Nov 24" fits beside its icon.
  const dateBox = grid ? 'w-full [&_button]:gap-1 [&_button]:px-1' : 'w-[5.5rem] px-0.5';
  const tools: Partial<Record<ColumnKey, React.ReactNode>> = {
    assignee: (
      <span className={`${tool(tried && missing.assignees)} ${fill} px-0.5`}>
        <AssigneePicker listId="" assignable={null} editable canShare={false} multiple
          assignees={chosen} onChange={setAssignees} onShared={() => undefined} />
      </span>
    ),
    start_date: (
      <span className={`${tool(tried && missing.dates)} ${dateBox}`}>
        <DateField label="Start date" placeholder="Start" format="compact" value={final.start_date} onChange={setStart} />
      </span>
    ),
    due_date: (
      <span className={`${tool(tried && missing.dates)} ${dateBox}`}>
        <DateField label="Due date" placeholder="Due" format="compact" value={final.due_date} overdue={backwards} onChange={setDue} />
      </span>
    ),
    priority: (
      <Menu label="Priority" triggerClassName={grid ? 'flex w-full' : 'inline-flex'}
        items={Object.entries(PRIORITIES).map(([v, pr]) => ({ label: pr.label, icon: <Flag size={13} style={{ color: pr.color }} />, onClick: () => setPriority(Number(v)) }))}
        trigger={<span className={`${tool(false)} ${fill} gap-1 px-2`} style={{ color: p?.color }}><Flag size={12} />{p?.label}</span>} />
    ),
    time_estimate: (
      <DurationInput label="Time estimate" value={final.time_estimate_seconds} placeholder="Estimate"
        onChange={setEstimate}
        className={`${tool(tried && missing.estimate)} ${grid ? 'w-full' : 'w-20'} px-2 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none`} />
    ),
  };
  // What the name was read as, then -- once a save was tried -- what is still missing.
  const notes = (q && q.chips.length > 0) || (tried && needed.length) || error || busy ? (
    <div className={`mt-1 flex flex-wrap items-center gap-1 text-[11px] ${grid ? 'pl-[3.25rem]' : 'pl-5'}`}>
      {q?.chips.map((c) => <span key={c} className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">{c}</span>)}
      {busy && <span className="text-gray-500">Saving…</span>}
      {tried && needed.length > 0 && <span className="text-red-600">Still needed: {needed.join(', ')}.</span>}
      {error && <span className="text-red-600">{error}</span>}
    </div>
  ) : null;
  const rowEvents = {
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } },
    onPointerDownCapture: () => { pressedInside.current = true; },
  };

  if (!grid) {
    return (
      <div className="border-b border-gray-100 bg-[#FAFBFD] py-1.5 pl-9 pr-4" {...rowEvents}>
        <div className="flex flex-wrap items-center gap-2">
          {dot}{nameInput}
          {tools.assignee}
          <span className="flex items-center gap-0.5">{tools.start_date}<span className="text-gray-300">→</span>{tools.due_date}</span>
          {tools.priority}{tools.time_estimate}
        </div>
        {notes}
      </div>
    );
  }

  // Laid out exactly like a task row, so every tool sits under its own column header. A tool
  // whose column is hidden in this view still has to be filled in, so it stays beside the name.
  const hidden = (Object.keys(tools) as ColumnKey[]).filter((k) => !grid.columns.includes(k));
  return (
    <div className="border-b border-gray-100 bg-[#FAFBFD] py-1.5 pr-4" {...rowEvents}>
      <div className="grid items-center" style={{ gridTemplateColumns: grid.template }}>
        <span />
        <div className="flex min-w-0 items-center gap-2 pr-3 pl-6">
          {dot}{nameInput}
          {hidden.map((k) => <React.Fragment key={k}>{tools[k]}</React.Fragment>)}
        </div>
        {grid.columns.map((k) => (
          <div key={k} className={`min-w-0 ${k === 'start_date' || k === 'due_date' ? 'pr-1' : 'pr-2'}`}>{tools[k] ?? null}</div>
        ))}
        {Array.from({ length: grid.extra }, (_, i) => <span key={`f${i}`} />)}
        <span />
      </div>
      {notes}
    </div>
  );
};
