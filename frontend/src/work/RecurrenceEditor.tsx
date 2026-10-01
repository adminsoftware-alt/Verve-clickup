// How a task repeats, laid out the way ClickUp lays it out.
//
// The old version offered a row of preset chips, which read quickly but hid the two questions
// people actually get wrong: what makes the next one appear, and what state it appears in. This
// asks them in order -- how often, what triggers it, what the copy looks like -- so the rule can
// be read back as a sentence before it is saved.
import { Calendar, Repeat } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import type { Recurrence, Status } from './api';
import { Select } from './Select';
import { Portal } from './ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** The unit name for the "Every N …" row. */
const UNIT = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year', days_after: 'day' } as const;

export function describeRecurrence(r: Recurrence | null): string {
  if (!r) return 'Does not repeat';
  let text: string;
  if (r.frequency === 'days_after') {
    text = `${r.interval} day${r.interval === 1 ? '' : 's'} after it is done`;
  } else {
    const unit = UNIT[r.frequency];
    const every = r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`;
    text = every;
    if (r.frequency === 'weekly' && r.weekdays?.length) {
      text = r.interval === 1 && r.weekdays.join() === '0,1,2,3,4'
        ? 'Every weekday'
        : `${every} on ${r.weekdays.map((d) => DAYS[d]).join(', ')}`;
    } else if (r.frequency === 'monthly' && r.month_day) {
      text = `${every} on day ${r.month_day}`;
    }
    text += r.trigger === 'on_schedule' ? ', on schedule' : r.action === 'reopen' ? ', reopening this task when done' : ', when done';
  }
  if (r.until) text += `, until ${r.until}`;
  if (r.count != null) text += `, ${r.count} more`;
  return text;
}

/** The dropdown value: a frequency, or "custom" when the interval is doing the talking. */
type Choice = Recurrence['frequency'] | 'custom';

function choiceOf(r: Recurrence): Choice {
  if (r.frequency === 'days_after') return 'days_after';
  return r.interval === 1 ? r.frequency : 'custom';
}

const LABEL = 'w-[6.5rem] shrink-0 pt-1.5 text-xs font-medium text-gray-500';
const NUMBER = 'h-8 w-16 rounded-md border border-gray-300 px-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none';

const Toggle: React.FC<{ checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; children: React.ReactNode }> = ({ checked, disabled, onChange, children }) => (
  <label className={`flex items-center gap-2 text-sm ${disabled ? 'text-gray-400' : 'cursor-pointer text-gray-700'}`}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 rounded border-gray-300 text-brand-600 accent-brand-600 focus:ring-brand-500"
    />
    {children}
  </label>
);

/**
 * The panel itself, without a trigger, so it can be dropped into the Repeat field or opened from
 * the bottom of a date picker.
 */
export const RecurrencePanel: React.FC<{
  value: Recurrence | null;
  dueDate: string | null;
  statuses?: Status[] | null;
  onCancel: () => void;
  onSave: (value: Recurrence | null) => Promise<void>;
}> = ({ value, dueDate, statuses, onCancel, onSave }) => {
  const due = dueDate ? new Date(dueDate) : new Date();
  const fresh = (): Recurrence => ({
    frequency: 'weekly', interval: 1, weekdays: [(due.getDay() + 6) % 7],
    trigger: 'on_done', action: 'new_task', sync_to_due: true, tz: tz(),
  });
  // A task with no rule yet starts on the weekday it is already due, which is what people mean
  // by "and again next week" more often than anything else.
  const [rule, setRule] = useState<Recurrence>(value ?? fresh());
  const [choice, setChoice] = useState<Choice>(() => choiceOf(value ?? fresh()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<Recurrence>) => setRule((r) => ({ ...r, ...patch }));
  const forever = rule.until == null && rule.count == null;

  const pickChoice = (next: Choice) => {
    setChoice(next);
    if (next === 'custom') { set({ interval: Math.max(2, rule.interval) }); return; }
    if (next === 'weekly') { set({ frequency: 'weekly', interval: 1, weekdays: rule.weekdays?.length ? rule.weekdays : [(due.getDay() + 6) % 7] }); return; }
    if (next === 'monthly') { set({ frequency: 'monthly', interval: 1, month_day: rule.month_day ?? due.getDate() }); return; }
    if (next === 'days_after') { set({ frequency: 'days_after', interval: Math.max(1, rule.interval), trigger: 'on_done' }); return; }
    set({ frequency: next, interval: 1 });
  };

  const toggleDay = (d: number) => {
    const days = new Set(rule.weekdays ?? []);
    if (days.has(d)) days.delete(d); else days.add(d);
    if (!days.size) return; // a weekly rule with no days would never come round
    set({ weekdays: [...days].sort((a, b) => a - b) });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only send the parts that apply to the chosen frequency; the server rejects the rest.
      await onSave({
        ...rule,
        weekdays: rule.frequency === 'weekly' ? rule.weekdays ?? [(due.getDay() + 6) % 7] : null,
        month_day: rule.frequency === 'monthly' ? rule.month_day ?? due.getDate() : null,
        tz: tz(),
      });
      onCancel();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onSchedule = rule.trigger === 'on_schedule';
  return (
    <div className="w-96 text-sm">
      <header className="flex items-center gap-2 border-b border-gray-100 px-3.5 py-2.5">
        <Repeat size={14} className="text-brand-600" />
        <span className="font-semibold text-gray-800">Recurring</span>
        {value && (
          <button
            type="button"
            onClick={async () => { setSaving(true); try { await onSave(null); onCancel(); } catch (e) { setError((e as Error).message); setSaving(false); } }}
            className="ml-auto rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-red-600"
          >
            Remove
          </button>
        )}
      </header>

      <div className="space-y-3 px-3.5 py-3">
        <div className="flex items-start gap-2">
          <span className={LABEL}>Frequency</span>
          <span className="min-w-0 flex-1">
            <Select
              label="Frequency"
              value={choice}
              onChange={(v) => pickChoice(v as Choice)}
              choices={[
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly' },
                { value: 'days_after', label: 'Days after…' },
                { value: 'custom', label: 'Custom…' },
              ]}
            />
          </span>
        </div>

        {choice === 'custom' && (
          <div className="flex items-center gap-2">
            <span className={`${LABEL} pt-0`}>Every</span>
            <input
              type="number" min={1} max={365} aria-label="Interval" value={rule.interval}
              onChange={(e) => set({ interval: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
              className={NUMBER}
            />
            <span className="min-w-0 flex-1">
              <Select
                label="Unit"
                value={rule.frequency === 'days_after' ? 'daily' : rule.frequency}
                onChange={(v) => set({
                  frequency: v as Recurrence['frequency'],
                  weekdays: v === 'weekly' ? rule.weekdays ?? [(due.getDay() + 6) % 7] : null,
                  month_day: v === 'monthly' ? rule.month_day ?? due.getDate() : null,
                })}
                choices={[
                  { value: 'daily', label: rule.interval === 1 ? 'day' : 'days' },
                  { value: 'weekly', label: rule.interval === 1 ? 'week' : 'weeks' },
                  { value: 'monthly', label: rule.interval === 1 ? 'month' : 'months' },
                  { value: 'yearly', label: rule.interval === 1 ? 'year' : 'years' },
                ]}
              />
            </span>
          </div>
        )}

        {rule.frequency === 'days_after' && (
          <div className="flex items-center gap-2">
            <span className={`${LABEL} pt-0`}>Days after</span>
            <input
              type="number" min={1} max={365} aria-label="Days after it is done" value={rule.interval}
              onChange={(e) => set({ interval: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
              className={NUMBER}
            />
            <span className="text-xs text-gray-500">day{rule.interval === 1 ? '' : 's'} after it is done</span>
          </div>
        )}

        {rule.frequency === 'weekly' && (
          <div className="flex items-start gap-2">
            <span className={LABEL}>On</span>
            <div className="flex flex-1 justify-between" role="group" aria-label="Days of the week">
              {INITIALS.map((letter, i) => {
                const on = !!rule.weekdays?.includes(i);
                return (
                  <button
                    key={DAYS[i]}
                    type="button"
                    title={DAYS[i]}
                    aria-label={DAYS[i]}
                    aria-pressed={on}
                    onClick={() => toggleDay(i)}
                    className={`h-7 w-7 rounded-full text-xs font-semibold transition-colors ${
                      on ? 'bg-brand-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {rule.frequency === 'monthly' && (
          <div className="flex items-center gap-2">
            <span className={`${LABEL} pt-0`}>On day</span>
            <input
              type="number" min={1} max={31} aria-label="Day of the month" value={rule.month_day ?? due.getDate()}
              onChange={(e) => set({ month_day: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })}
              className={NUMBER}
            />
            <span className="text-xs text-gray-400">the last day, in shorter months</span>
          </div>
        )}

        <div className="flex items-start gap-2">
          <span className={LABEL}>Repeat</span>
          <span className="min-w-0 flex-1">
            <Select
              label="What makes the next one"
              value={rule.trigger}
              onChange={(v) => set(v === 'on_schedule'
                ? { trigger: 'on_schedule', action: 'new_task' } // a scheduled repeat is always a new task
                : { trigger: 'on_done' })}
              choices={[
                { value: 'on_done', label: 'On status change: Done' },
                ...(rule.frequency === 'days_after' ? [] : [{ value: 'on_schedule', label: 'On a schedule' }]),
              ]}
            />
          </span>
        </div>

        <div className="space-y-2 rounded-lg bg-gray-50 px-3 py-2.5">
          <Toggle
            checked={rule.action === 'new_task'}
            disabled={onSchedule}
            onChange={(on) => set({ action: on ? 'new_task' : 'reopen' })}
          >
            Create new task
            <span className="text-xs text-gray-400">{rule.action === 'new_task' ? '' : '(this one moves forward instead)'}</span>
          </Toggle>

          <Toggle
            checked={forever}
            onChange={(on) => set(on ? { until: null, count: null } : { count: 10 })}
          >
            Recur forever
          </Toggle>
          {!forever && (
            <div className="flex flex-wrap items-center gap-2 pl-6 text-xs text-gray-600">
              <label className="flex items-center gap-1.5">
                Until
                <input
                  type="date" aria-label="Repeat until" value={rule.until ?? ''}
                  onChange={(e) => set({ until: e.target.value || null, count: e.target.value ? null : rule.count })}
                  className="h-7 rounded border border-gray-300 px-1.5 text-xs"
                />
              </label>
              <span>or</span>
              <label className="flex items-center gap-1.5">
                <input
                  type="number" min={1} max={1000} aria-label="How many more times" placeholder="10" value={rule.count ?? ''}
                  onChange={(e) => set({ count: e.target.value ? Number(e.target.value) : null, until: e.target.value ? null : rule.until })}
                  className="h-7 w-14 rounded border border-gray-300 px-1.5 text-xs"
                />
                more times
              </label>
            </div>
          )}

          <Toggle
            checked={rule.reset_status_id != null}
            disabled={!statuses?.length}
            onChange={(on) => set({ reset_status_id: on ? statuses?.[0]?.id ?? null : null })}
          >
            Update status to:
          </Toggle>
          {rule.reset_status_id != null && !!statuses?.length && (
            <div className="pl-6">
              <Select
                label="Status the next one starts in"
                value={rule.reset_status_id}
                onChange={(v) => set({ reset_status_id: v })}
                choices={statuses.map((st) => ({
                  value: st.id,
                  label: st.name,
                  icon: <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: st.color }} />,
                }))}
              />
            </div>
          )}

          {rule.frequency !== 'days_after' && (
            <Toggle checked={rule.sync_to_due !== false} onChange={(on) => set({ sync_to_due: on })}>
              Sync recurrence to due date
            </Toggle>
          )}
        </div>

        <p className="text-xs leading-relaxed text-gray-500">
          {describeRecurrence(rule)}.{' '}
          {rule.frequency === 'days_after'
            ? 'Counted from the day this one is finished, not from its due date.'
            : rule.sync_to_due === false
              ? 'Each one is measured from the day the one before it was finished.'
              : 'Dates that have already passed are skipped, so a late finish does not pile up old copies.'}
        </p>
        {error && <p role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      </div>

      <footer className="flex justify-end gap-2 border-t border-gray-100 px-3.5 py-2.5">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        <button
          type="button" onClick={save} disabled={saving}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </div>
  );
};

/** The "Repeat" field of a task: the rule in words, and the panel behind it. */
export const RecurrenceEditor: React.FC<{
  value: Recurrence | null;
  dueDate: string | null;
  disabled: boolean;
  statuses?: Status[] | null;
  onSave: (value: Recurrence | null) => Promise<void>;
}> = ({ value, dueDate, disabled, statuses, onSave }) => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  const openEditor = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (r) {
      const width = 384;
      setPos({
        top: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 520)),
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      });
    }
    setOpen(true);
  };

  return (
    <>
      <button
        ref={anchor} type="button" disabled={disabled} onClick={openEditor}
        className={`flex w-full items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-left text-sm hover:border-gray-200 ${value ? 'text-brand-700' : 'text-gray-500'}`}
      >
        <Repeat size={14} /> {describeRecurrence(value)}
      </button>
      {open && (
        <Portal>
          <div className="fixed inset-0 z-[125]" onMouseDown={() => setOpen(false)}>
            <div
              role="dialog" aria-label="Recurring" onMouseDown={(e) => e.stopPropagation()}
              className="fixed overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl" style={pos}
            >
              <RecurrencePanel value={value} dueDate={dueDate} statuses={statuses} onCancel={() => setOpen(false)} onSave={onSave} />
            </div>
          </div>
        </Portal>
      )}
    </>
  );
};

/** The row a date picker shows at its foot to reach the panel above. */
export const SetRecurringRow: React.FC<{ value: Recurrence | null; onClick: () => void }> = ({ value, onClick }) => (
  <button
    type="button" onClick={onClick}
    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
  >
    <Calendar size={14} className="text-gray-400" />
    <span className="flex-1 truncate">{value ? describeRecurrence(value) : 'Set Recurring'}</span>
    <Repeat size={13} className={value ? 'text-brand-600' : 'text-gray-400'} />
  </button>
);
