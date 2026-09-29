import React, { useEffect, useRef, useState } from 'react';
import { Repeat } from 'lucide-react';
import type { Recurrence } from './api';
import { Portal } from './ui';
import { Select } from './Select';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
type Preset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function describeRecurrence(r: Recurrence | null): string {
  if (!r) return 'Does not repeat';
  const every = (unit: string) => (r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`);
  let text = '';
  if (r.frequency === 'weekly' && r.weekdays?.length) {
    text = r.interval === 1 && r.weekdays.join() === '0,1,2,3,4' ? 'Every weekday' : `${every('week')} on ${r.weekdays.map((d) => DAYS[d]).join(', ')}`;
  } else if (r.frequency === 'monthly') {
    text = `${every('month')}${r.month_day ? ` on day ${r.month_day}` : ''}`;
  } else {
    text = every(r.frequency === 'daily' ? 'day' : r.frequency === 'weekly' ? 'week' : 'year');
  }
  text += r.trigger === 'on_schedule' ? ', on schedule' : r.action === 'reopen' ? ', reopens when done' : ', when done';
  if (r.until) text += `, until ${r.until}`;
  if (r.count != null) text += `, ${r.count} more`;
  return text;
}

function presetOf(r: Recurrence | null): Preset {
  if (!r) return 'none';
  if (r.interval !== 1) return 'custom';
  if (r.frequency === 'weekly' && r.weekdays?.join() === '0,1,2,3,4') return 'weekdays';
  if (r.frequency === 'weekly' && (r.weekdays?.length ?? 0) > 1) return 'custom';
  return r.frequency;
}

/** The "Repeat" field of a task, like ClickUp's recurring-task menu. */
export const RecurrenceEditor: React.FC<{
  value: Recurrence | null; dueDate: string | null; disabled: boolean; onSave: (value: Recurrence | null) => Promise<void>;
}> = ({ value, dueDate, disabled, onSave }) => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [rule, setRule] = useState<Recurrence | null>(value);
  const [preset, setPreset] = useState<Preset>(presetOf(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setRule(value); setPreset(presetOf(value)); }, [value]);

  const due = dueDate ? new Date(dueDate) : new Date();
  const base: Recurrence = { frequency: 'daily', interval: 1, trigger: 'on_done', action: 'new_task', tz: tz(), ...(value ?? {}) };
  const choose = (p: Preset) => {
    setPreset(p);
    const keep = { trigger: base.trigger, action: base.action, until: base.until ?? null, count: base.count ?? null, tz: tz() };
    if (p === 'none') setRule(null);
    else if (p === 'daily') setRule({ ...keep, frequency: 'daily', interval: 1 });
    else if (p === 'weekdays') setRule({ ...keep, frequency: 'weekly', interval: 1, weekdays: [0, 1, 2, 3, 4] });
    else if (p === 'weekly') setRule({ ...keep, frequency: 'weekly', interval: 1, weekdays: [(due.getDay() + 6) % 7] });
    else if (p === 'monthly') setRule({ ...keep, frequency: 'monthly', interval: 1, month_day: due.getDate() });
    else if (p === 'yearly') setRule({ ...keep, frequency: 'yearly', interval: 1 });
    else setRule({ ...(rule ?? { ...keep, frequency: 'weekly', interval: 1, weekdays: [(due.getDay() + 6) % 7] }) });
  };
  const set = (patch: Partial<Recurrence>) => setRule((r) => (r ? { ...r, ...patch } : r));
  const toggleDay = (d: number) => {
    if (!rule) return;
    const days = new Set(rule.weekdays ?? []);
    if (days.has(d)) days.delete(d); else days.add(d);
    set({ weekdays: [...days].sort() });
  };

  const openEditor = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (r) setPos({ top: Math.min(r.bottom + 6, window.innerHeight - 440), left: Math.max(8, Math.min(r.left, window.innerWidth - 340)) });
    setRule(value); setPreset(presetOf(value)); setError(null);
    setOpen(true);
  };
  const save = async () => {
    try {
      setError(null);
      const cleaned = rule && rule.frequency !== 'weekly' ? { ...rule, weekdays: null } : rule;
      await onSave(cleaned && cleaned.frequency !== 'monthly' ? { ...cleaned, month_day: null } : cleaned);
      setOpen(false);
    } catch (e) { setError((e as Error).message); }
  };

  const input = 'rounded border border-gray-300 px-1.5 py-1 text-sm';
  return (
    <>
      <button ref={anchor} type="button" disabled={disabled} onClick={openEditor} className={`flex w-full items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-left text-sm hover:border-gray-200 ${value ? 'text-brand-700' : 'text-gray-500'}`}>
        <Repeat size={14} /> {describeRecurrence(value)}
      </button>
      {open && (
        <Portal>
          <div className="fixed inset-0 z-[125]" onMouseDown={() => setOpen(false)}>
            <div role="dialog" aria-label="Repeat" onMouseDown={(e) => e.stopPropagation()} className="fixed w-80 space-y-3 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-lg" style={pos}>
              <div className="flex flex-wrap gap-1.5">
                {(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'] as Preset[]).map((p) => (
                  <button key={p} type="button" onClick={() => choose(p)} className={`rounded-full px-2.5 py-0.5 text-xs ${preset === p ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                    {p === 'none' ? "Don't repeat" : p === 'weekdays' ? 'Weekdays' : p[0].toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
              {rule && (
                <>
                  {preset === 'custom' && (
                    <div className="flex items-center gap-2">
                      Every
                      <input type="number" min={1} max={365} aria-label="Interval" value={rule.interval} onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })} className={`${input} w-16`} />
                      <span className="w-28">
                        <Select
                          label="Unit"
                          value={rule.frequency}
                          onChange={(v) => set({ frequency: v as Recurrence['frequency'], weekdays: v === 'weekly' ? [(due.getDay() + 6) % 7] : null, month_day: v === 'monthly' ? due.getDate() : null })}
                          choices={[
                            { value: 'daily', label: 'days' }, { value: 'weekly', label: 'weeks' },
                            { value: 'monthly', label: 'months' }, { value: 'yearly', label: 'years' },
                          ]}
                        />
                      </span>
                    </div>
                  )}
                  {rule.frequency === 'weekly' && preset !== 'weekdays' && (
                    <div className="flex gap-1" role="group" aria-label="Days">
                      {DAYS.map((d, i) => (
                        <button key={d} type="button" aria-pressed={!!rule.weekdays?.includes(i)} onClick={() => toggleDay(i)}
                          className={`h-7 w-9 rounded text-xs ${rule.weekdays?.includes(i) ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{d}</button>
                      ))}
                    </div>
                  )}
                  {rule.frequency === 'monthly' && (
                    <label className="flex items-center gap-2">On day
                      <input type="number" min={1} max={31} aria-label="Day of month" value={rule.month_day ?? due.getDate()} onChange={(e) => set({ month_day: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })} className={`${input} w-16`} />
                      <span className="text-xs text-gray-400">(last day in shorter months)</span>
                    </label>
                  )}
                  <fieldset className="space-y-1">
                    <legend className="text-xs font-medium text-gray-500">Create the next one</legend>
                    <label className="flex items-center gap-2"><input type="radio" checked={rule.trigger === 'on_done' && rule.action === 'new_task'} onChange={() => set({ trigger: 'on_done', action: 'new_task' })} /> When this one is done</label>
                    <label className="flex items-center gap-2"><input type="radio" checked={rule.trigger === 'on_schedule'} onChange={() => set({ trigger: 'on_schedule', action: 'new_task' })} /> On schedule, when it falls due</label>
                    <label className="flex items-center gap-2"><input type="radio" checked={rule.action === 'reopen'} onChange={() => set({ trigger: 'on_done', action: 'reopen' })} /> Reopen this task when done</label>
                  </fieldset>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600">Until <input type="date" value={rule.until ?? ''} onChange={(e) => set({ until: e.target.value || null })} className={`${input} text-xs`} /></label>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600">or <input type="number" min={1} max={1000} placeholder="∞" aria-label="Times" value={rule.count ?? ''} onChange={(e) => set({ count: e.target.value ? Number(e.target.value) : null })} className={`${input} w-14 text-xs`} /> times</label>
                  </div>
                  <p className="text-xs text-gray-500">{describeRecurrence(rule)}. Missed dates are skipped, so a late finish doesn't pile up old copies.</p>
                </>
              )}
              {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2.5 py-1 text-gray-600 hover:bg-gray-100">Cancel</button>
                <button type="button" onClick={save} className="rounded-md bg-brand-600 px-2.5 py-1 font-medium text-white hover:bg-brand-700">Save</button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
};
