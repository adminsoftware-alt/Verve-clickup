// "+ Task": a task, or a reminder, made in one place.
//
// The Task tab is the name and description, then a details sheet -- one row per field, its name
// on the left and its value on the right -- asking for what a task cannot be made without: who,
// when, how big, how urgent. A required row carries a red star, and turns red if saving finds it
// empty.
// The Reminder tab sets a reminder for you or someone else, at a day and a time.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Calendar, ChevronDown, ChevronRight, CircleDot, Flag, Hourglass, List as ListIcon, Repeat, Users, X } from 'lucide-react';

import { useWork, useMe } from '../WorkContext';
import { workApi, type CustomField, type Recurrence, type Status, type TaskInput, type UserRef } from '../api';
import { collabApi } from '../collabApi';
import { DateField } from '../DateField';
import { DurationInput } from '../DurationInput';
import { FieldEditor } from '../fields/FieldValue';
import { RecurrenceEditor } from '../RecurrenceEditor';
import { Menu, PRIORITIES, Portal, StatusDot } from '../ui';
import { FEATURES } from '../../config/features';
import { notify } from '../../components/notify';
import { AssigneePicker } from './AssigneePicker';

type Props = {
  lists: { id: string; label: string }[];
  listId: string;
  onClose: () => void;
  onCreate: (listId: string, input: TaskInput & { name: string }) => Promise<void>;
  /** Who it starts assigned to (Me mode, the Assignee filter); you, when nobody is given. */
  startAssignees?: string[];
  /** What a quick-add row already said: the name, and any status, date, priority, people or size. */
  initial?: TaskInput & { name: string };
};

// One chip look for every field: a hairline, the field's icon, its value or its name.
const chip = (bad = false) =>
  `inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-[13px] text-gray-700 transition-colors hover:bg-[#F8F9FB] ${
    bad ? 'border-red-400' : 'border-gray-200 hover:border-[#B3C3DF]'}`;
const Star = () => <span className="text-red-500" aria-label="required">*</span>;
// The value side of a details row: quiet until pointed at, like the task panel's fields.
const value = 'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-gray-800 hover:bg-[#EEF2F8]';
const Row: React.FC<{ icon: React.ReactNode; label: string; required?: boolean; bad?: boolean; children: React.ReactNode }> = ({ icon, label, required, bad, children }) => (
  <div className={`flex min-h-12 items-center gap-3 border-b border-gray-100 px-4 py-1.5 ${bad ? 'bg-red-50/60' : ''}`}>
    <span className={`flex w-28 shrink-0 items-center gap-2 text-[13px] ${bad ? 'font-medium text-red-600' : 'text-gray-500'}`}>
      <span className={bad ? 'text-red-500' : 'text-gray-400'}>{icon}</span>{label}{required && <Star />}
    </span>
    {children}
  </div>
);
const ESTIMATE_PICKS: [string, number][] = [['30m', 1800], ['1h', 3600], ['2h', 7200], ['4h', 14400], ['1 day', 28800]];

export const NewTaskDialog: React.FC<Props> = (props) => {
  const [tab, setTab] = useState<'task' | 'reminder'>('task');
  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[8vh]" onMouseDown={props.onClose}>
        <div role="dialog" aria-label={tab === 'task' ? 'New task' : 'New reminder'} onMouseDown={(e) => e.stopPropagation()}
          className="flex max-h-[84vh] w-[42rem] max-w-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
          <header className="flex shrink-0 items-center gap-6 border-b border-gray-100 px-6">
            <div role="tablist" aria-label="Make a" className="flex gap-6">
              {(['task', 'reminder'] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 py-3.5 text-[15px] font-medium ${tab === t ? 'border-[#234788] text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                  {t === 'task' ? 'Task' : 'Reminder'}
                </button>
              ))}
            </div>
            <button type="button" aria-label="Close" onClick={props.onClose}
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600">
              <X size={18} />
            </button>
          </header>
          {tab === 'task' ? <TaskForm {...props} /> : <ReminderForm onClose={props.onClose} />}
        </div>
      </div>
    </Portal>
  );
};

// --- the task ---------------------------------------------------------------------------------

const TaskForm: React.FC<Props> = ({ lists, listId, onCreate, startAssignees, initial }) => {
  const meId = useMe();
  const { members: people, locate, taskTypes } = useWork();
  const [name, setName] = useState(initial?.name ?? '');
  const [target, setTarget] = useState(listId);
  const [start, setStart] = useState<string | null>(initial?.start_date ?? null);
  const [due, setDue] = useState<string | null>(initial?.due_date ?? null);
  const [estimateSeconds, setEstimateSeconds] = useState<number | null>(initial?.time_estimate_seconds ?? null);
  const [priority, setPriority] = useState<number>(initial?.priority ?? 3);
  const [assignees, setAssignees] = useState<string[]>(
    initial?.assignees?.length ? initial.assignees : startAssignees?.length ? startAssignees : [meId]);
  const [repeat, setRepeat] = useState<Recurrence | null>(null);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [statusId, setStatusId] = useState<string | null>(initial?.status_id ?? null);
  const [statuses, setStatuses] = useState<Status[] | null>(null);
  // Who can already open the List, so the picker can say who would need it shared first.
  const [assignable, setAssignable] = useState<UserRef[] | null>(null);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [more, setMore] = useState(false);
  // Set by the first try at saving: from then on each missing chip turns red.
  const [tried, setTried] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [touched, setTouched] = useState({ estimate: !!initial?.time_estimate_seconds, priority: !!initial?.priority });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameBox = useRef<HTMLTextAreaElement>(null);

  // What this List usually does, for priority and size; never the dates, which are the person's
  // to give. Anything the person has already edited is left alone.
  useEffect(() => {
    let live = true;
    workApi.taskDefaults(target, name.trim() || undefined)
      .then((d) => {
        if (!live) return;
        if (!touched.priority && d.priority) setPriority(d.priority);
        if (!touched.estimate && d.time_estimate_seconds) {
          setEstimateSeconds(d.time_estimate_seconds);
          setHint(d.estimate_basis === 'similar'
            ? `Suggested from ${d.estimate_from} similar task${d.estimate_from === 1 ? '' : 's'} in this List`
            : `Suggested from the ${d.estimate_from} sized tasks in this List`);
        } else if (!touched.estimate) setHint(null);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [target, name.trim()]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the List it is going into brings with it: its statuses, its Space's tags and fields.
  useEffect(() => {
    let live = true;
    workApi.statuses('list', target)
      .then((set) => { if (live) { setStatuses(set.statuses); setStatusId((prev) => (prev && set.statuses.some((s) => s.id === prev) ? prev : set.statuses[0]?.id ?? null)); } })
      .catch(() => undefined);
    workApi.assignable('list', target).then((a) => { if (live) setAssignable(a); }).catch(() => undefined);
    workApi.fields('list', target).then((f) => { if (live) setFields(f); }).catch(() => undefined);
    const space = locate('list', target)?.path?.[0];
    if (space) workApi.spaceTags(space.id).then((t) => { if (live) setKnownTags(t.map((x) => x.name)); }).catch(() => undefined);
    return () => { live = false; };
  }, [target, locate]);

  const backwards = !!start && !!due && new Date(due) < new Date(start);
  const missing = {
    name: !name.trim(),
    assignees: !assignees.length,
    dates: !start || !due || backwards,
    priority: !priority,
    estimate: !(estimateSeconds && estimateSeconds > 0),
  };
  const ready = !Object.values(missing).some(Boolean) && !!statusId;
  const bad = (key: keyof typeof missing) => tried && missing[key];
  const stillNeeded = [
    missing.name && 'a name', missing.assignees && 'an assignee', missing.dates && (backwards ? 'a due date after the start' : 'start and due dates'),
    missing.priority && 'a priority', missing.estimate && 'an estimate',
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (busy) return;
    setTried(true);
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(target, {
        // Anything the quick-add row set that this dialog has no field for (its group, say) goes too.
        ...(initial ?? {}),
        name: name.trim(), start_date: start, due_date: due, time_estimate_seconds: estimateSeconds,
        priority, assignees,
        ...(repeat ? { recurrence: repeat } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(statusId ? { status_id: statusId } : {}),
        ...(tags.length ? { tags } : {}),
        ...(typeId ? { type_id: typeId } : {}),
        ...(isPrivate ? { is_private: true } : {}),
        ...(Object.keys(fieldValues).length ? { custom_fields: fieldValues } : {}),
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const status = statuses?.find((st) => st.id === statusId) ?? null;
  const p = PRIORITIES[priority];
  const listLabel = lists.find((l) => l.id === target)?.label ?? locate('list', target)?.node.name ?? 'List';
  const typeName = taskTypes.find((t) => t.id === typeId)?.name ?? 'Task';

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); submit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-4 pt-4">
        {/* Where it goes, and what kind of thing it is. */}
        <div className="flex flex-wrap items-center gap-2">
          {lists.length > 1 ? (
            <Menu label="List" triggerClassName="inline-flex" width={280}
              items={lists.map((l) => ({ label: l.label, icon: <ListIcon size={13} />, onClick: () => setTarget(l.id) }))}
              trigger={<span className={chip()}><ListIcon size={14} className="text-gray-500" /><span className="max-w-[16rem] truncate">{listLabel}</span><ChevronDown size={13} className="text-gray-400" /></span>} />
          ) : (
            <span className={`${chip()} cursor-default hover:bg-white`}><ListIcon size={14} className="text-gray-500" /><span className="max-w-[16rem] truncate">{listLabel}</span></span>
          )}
          {taskTypes.length > 0 && (
            <Menu label="Task type" triggerClassName="inline-flex"
              items={[{ id: null as string | null, name: 'Task' }, ...taskTypes].map((t) => ({ label: t.name, onClick: () => setTypeId(t.id) }))}
              trigger={<span className={chip()}><span className="h-2.5 w-2.5 rounded-full border-2 border-gray-500" />{typeName}<ChevronDown size={13} className="text-gray-400" /></span>} />
          )}
        </div>

        {/* The name, large, and the description under it with no box of its own. */}
        <textarea
          ref={nameBox} autoFocus rows={1} value={name}
          onChange={(e) => setName(e.target.value.replace(/\n/g, ' '))}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) e.preventDefault(); }}
          aria-label="Task name" aria-required aria-invalid={bad('name')}
          placeholder="Task name"
          className={`block w-full resize-none border-0 border-b-2 bg-transparent px-1 pb-2 pt-1 text-xl font-semibold text-gray-900 placeholder:font-medium placeholder:text-gray-400 focus:outline-none focus:ring-0 ${
            bad('name') ? 'border-red-400' : 'border-gray-200 hover:border-gray-300 focus:border-[#234788]'}`}
        />
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
          aria-label="Description" placeholder="Add a description — what needs doing, and what whoever picks it up will need"
          className="block w-full resize-none rounded-lg border border-transparent px-1 py-1 text-[15px] text-gray-700 placeholder:text-gray-400 hover:border-gray-200 focus:border-[#B3C3DF] focus:px-2 focus:outline-none"
        />

        {/* The details, one row each: what it is on the left, its value on the right. */}
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <Row icon={<CircleDot size={15} />} label="Status">
            <Menu label="Status" triggerClassName="inline-flex" width={220}
              items={(statuses ?? []).map((st) => ({ label: st.name, icon: <StatusDot status={st} size={11} />, onClick: () => setStatusId(st.id) }))}
              trigger={<span className={value}>
                {status && <StatusDot status={status} size={11} />}
                {/* The List's first status is chosen for you; nothing shows until it has loaded. */}
                {status && <span className="text-xs font-semibold uppercase tracking-wide text-gray-700">{status.name}</span>}
                <ChevronDown size={13} className="text-gray-400" />
              </span>} />
          </Row>

          <Row icon={<Users size={15} />} label="Assignee" required bad={bad('assignees')}>
            <div className="min-w-0 flex-1">
              <AssigneePicker
                listId={target}
                assignees={people.filter((m) => assignees.includes(m.user.id)).map((m) => m.user)}
                assignable={assignable}
                editable canShare multiple
                onChange={setAssignees}
                onShared={() => workApi.assignable('list', target).then(setAssignable).catch(() => undefined)}
              />
            </div>
          </Row>

          <Row icon={<Calendar size={15} />} label="Dates" required bad={bad('dates')}>
            {/* Each half opens the calendar, with its shortcuts (Today, Tomorrow, Next week...). */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span className="w-40"><DateField label="Start date" placeholder="Start date" value={start} onChange={setStart} /></span>
              <span className="text-gray-300">→</span>
              <span className="w-40"><DateField label="Due date" placeholder="Due date" value={due} overdue={backwards} onChange={setDue} /></span>
            </div>
          </Row>

          <Row icon={<Flag size={15} />} label="Priority" required bad={bad('priority')}>
            <Menu label="Priority" triggerClassName="inline-flex"
              items={Object.entries(PRIORITIES).map(([v, pr]) => ({
                label: pr.label, icon: <Flag size={13} style={{ color: pr.color }} />,
                onClick: () => { setPriority(Number(v)); setTouched((t) => ({ ...t, priority: true })); },
              }))}
              trigger={<span className={value}>
                <Flag size={14} style={{ color: p?.color ?? '#9CA3AF' }} />
                <span style={{ color: p?.color }}>{p?.label ?? 'Pick a priority'}</span>
                <ChevronDown size={13} className="text-gray-400" />
              </span>} />
          </Row>

          <Row icon={<Hourglass size={15} />} label="Estimate" required bad={bad('estimate')}>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {/* The same input as the task panel, so "3" offers 3h and 3m here too. */}
              <DurationInput label="Time estimate" value={estimateSeconds} placeholder="3, 2.30, 45m"
                onChange={(secs) => { setEstimateSeconds(secs); setTouched((t) => ({ ...t, estimate: true })); setHint(null); }}
                className="h-8 w-28 rounded-md border border-gray-200 bg-white px-2.5 text-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15" />
              {ESTIMATE_PICKS.map(([text, secs]) => (
                <button key={text} type="button"
                  onClick={() => { setEstimateSeconds(secs); setTouched((t) => ({ ...t, estimate: true })); setHint(null); }}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${estimateSeconds === secs ? 'bg-brand-600 text-white' : 'bg-[#EEF2F8] text-[#1C3A70] hover:bg-[#D9E1EF]'}`}>{text}</button>
              ))}
              {hint && <span className="basis-full text-[11px] text-gray-400">{hint}</span>}
            </div>
          </Row>

          <Row icon={<Repeat size={15} />} label="Repeat">
            <span className="inline-flex items-center gap-1">
              <RecurrenceEditor value={repeat} dueDate={due ?? start} statuses={statuses} disabled={false} onSave={async (v) => { setRepeat(v); }} />
              {repeat && <button type="button" aria-label="Stop recurring" onClick={() => setRepeat(null)} className="rounded px-1 text-gray-400 hover:text-red-600">&times;</button>}
            </span>
          </Row>

          {/* The rest a task can carry, opened in place. */}
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] text-gray-600 hover:bg-[#F8F9FB]">
            <ChevronRight size={14} className={`text-gray-400 ${more ? 'rotate-90' : ''}`} />
            {more ? 'Fewer details' : 'More details'}
            <span className="text-gray-400">— private{FEATURES.taskTagsField ? ', tags' : ''}{fields.length ? ', this Space’s own fields' : ''}</span>
          </button>
          {more && (
            <div className="space-y-3 border-t border-gray-100 bg-[#F8F9FB] px-4 py-3">
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="mt-0.5" />
                <span>Private<span className="block text-xs text-gray-500">Only you and the people on it will see this task.</span></span>
              </label>
              {FEATURES.taskTagsField && (
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-500">Tags</p>
                  <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2 py-1">
                    {tags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[#EEF2F8] px-2 py-0.5 text-xs text-[#1C3A70]">
                        {t}<button type="button" aria-label={`Remove ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))} className="hover:text-red-600">&times;</button>
                      </span>
                    ))}
                    <input aria-label="Add a tag" value={tagDraft} list="new-task-tags" placeholder="Type a tag, press Enter"
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter adds the tag rather than creating the task mid-word.
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          const t = tagDraft.trim();
                          if (t && !tags.includes(t)) setTags([...tags, t]);
                          setTagDraft('');
                        }
                      }}
                      className="min-w-24 flex-1 bg-transparent text-sm focus:outline-none" />
                    <datalist id="new-task-tags">{knownTags.filter((t) => !tags.includes(t)).map((t) => <option key={t} value={t} />)}</datalist>
                  </div>
                </div>
              )}
              {fields.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-500">This Space's own fields</p>
                  {fields.map((f) => (
                    <label key={f.id} className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-2 text-xs text-gray-600">
                      <span className="truncate">{f.name}</span>
                      <span className="rounded-md border border-gray-300 bg-white px-1.5 py-1">
                        <FieldEditor field={f} value={fieldValues[f.id]} people={people.map((m) => m.user)}
                          onChange={(v: unknown) => setFieldValues((prev) => ({ ...prev, [f.id]: v }))} />
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {tried && stillNeeded.length > 0 && (
          <p role="alert" className="text-xs text-red-600">Still needed: {stillNeeded.join(', ')}.</p>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-gray-100 px-6 py-3.5">
        <span className="text-[11px] text-gray-400"><Star /> required · Ctrl+Enter to create</span>
        <button type="submit" disabled={busy}
          className="ml-auto rounded-lg bg-[#234788] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1C3A70] disabled:opacity-60">
          {busy ? 'Creating…' : 'Create task'}
        </button>
      </footer>
    </form>
  );
};

// --- a reminder -------------------------------------------------------------------------------

/** The next whole hour, as the time box writes it ("15:00"). */
const nextHour = () => `${String((new Date().getHours() + 1) % 24).padStart(2, '0')}:00`;

const ReminderForm: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const meId = useMe();
  const { members, workspace } = useWork();
  const [title, setTitle] = useState('');
  const [day, setDay] = useState<string | null>(() => new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
  const [time, setTime] = useState(nextHour);
  const [forId, setForId] = useState(meId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const who = useMemo(() => members.find((m) => m.user.id === forId)?.user ?? null, [members, forId]);
  const when = useMemo(() => {
    if (!day || !time) return null;
    const d = new Date(day);
    const [h, m] = time.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  }, [day, time]);
  const past = !!when && when.getTime() < Date.now();

  const submit = async () => {
    setTried(true);
    if (!title.trim() || !when || past || !workspace) return;
    setBusy(true);
    setError(null);
    try {
      await collabApi.addReminder(workspace.id, { title: title.trim(), remind_at: when.toISOString(), ...(forId !== meId ? { user_id: forId } : {}) });
      notify.ok(`Reminder set for ${when.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="space-y-4 px-6 pb-5 pt-4">
        <input
          autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
          aria-label="Reminder" placeholder="What should you be reminded of?"
          className={`block w-full border-0 border-b-2 bg-transparent px-1 pb-2 pt-1 text-xl font-semibold text-gray-900 placeholder:font-medium placeholder:text-gray-400 focus:outline-none focus:ring-0 ${
            tried && !title.trim() ? 'border-red-400' : 'border-gray-200 hover:border-gray-300 focus:border-[#234788]'}`}
        />
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <Row icon={<Calendar size={15} />} label="When" required bad={tried && (!when || past)}>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span className="w-40"><DateField label="Day" placeholder="Pick a day" value={day} onChange={setDay} /></span>
              <input type="time" aria-label="Time" value={time} onChange={(e) => setTime(e.target.value)}
                className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15" />
            </div>
          </Row>
          <Row icon={<Bell size={15} />} label="Remind" required>
            <div className="min-w-0 flex-1">
              {/* The same people picker as a task's assignee, for one person. */}
              <AssigneePicker listId="" assignable={null} editable canShare={false} multiple={false}
                assignees={who ? [who] : []}
                onChange={(ids) => setForId(ids[0] ?? meId)}
                onShared={() => undefined} />
            </div>
          </Row>
        </div>
        {tried && past && <p role="alert" className="text-xs text-red-600">That time has already passed.</p>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
      <footer className="flex shrink-0 items-center border-t border-gray-100 px-6 py-3.5">
        <span className="text-[11px] text-gray-400"><Star /> required</span>
        <button type="submit" disabled={busy}
          className="ml-auto rounded-lg bg-[#234788] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1C3A70] disabled:opacity-60">
          {busy ? 'Setting…' : 'Create reminder'}
        </button>
      </footer>
    </form>
  );
};
