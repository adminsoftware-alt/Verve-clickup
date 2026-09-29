import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../../components/AuthContext';
import { useWork } from '../WorkContext';
import { Portal } from '../ui';
import { sheetApi, type SheetSettings } from './api';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const HoursRow: React.FC<{ value: number[]; onChange: (v: number[]) => void; label: string }> = ({ value, onChange, label }) => (
  <div className="grid grid-cols-7 gap-1.5" role="group" aria-label={label}>
    {DAYS.map((d, i) => (
      <label key={d} className="text-center text-[11px] text-gray-500">
        {d.slice(0, 3)}
        <input
          type="number" min={0} max={24} step={0.5}
          aria-label={`${label}: ${d}`}
          value={value[i] / 3600}
          onChange={(e) => { const next = [...value]; next[i] = Math.round(Math.max(0, Math.min(24, Number(e.target.value) || 0)) * 3600); onChange(next); }}
          className="mt-0.5 w-full rounded border border-gray-300 px-1 py-1 text-center text-sm text-gray-800"
        />
      </label>
    ))}
  </div>
);

export const SettingsDialog: React.FC<{ settings: SheetSettings; onClose: () => void; onSaved: () => void }> = ({ settings, onClose, onSaved }) => {
  const { workspace, members } = useWork();
  const { user } = useAuth();
  // Whose hours are being set. Everyone starts on the workspace schedule; an admin gives a
  // person their own only when their week genuinely differs -- part time, a different site.
  const [whose, setWhose] = useState('');
  const [mine, setMine] = useState<number[] | null>(null);
  const [custom, setCustom] = useState(false);
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(settings.week_start);
  const [approvals, setApprovals] = useState(settings.approvals_enabled);
  const [schedule, setSchedule] = useState(settings.capacity_seconds);
  const [reminders, setReminders] = useState({ enabled: settings.reminders_enabled, weekday: settings.reminder_weekday, hour: settings.reminder_hour });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace || !whose) { setMine(null); return; }
    setMine(null);
    sheetApi.capacity(workspace.id, whose)
      .then((c) => { setMine(c.capacity_seconds); setCustom(c.is_custom); })
      .catch((e) => setError(e.message));
  }, [workspace, whose]);

  const save = async () => {
    if (!workspace || !user) return;
    try {
      // A person's hours only save when one is picked; the workspace settings save either way.
      if (whose && mine) {
        await sheetApi.setCapacity(workspace.id, whose, custom ? mine : null);
        setSavedFor(whose);
      }
      if (settings.can_manage) {
        await sheetApi.updateSettings(workspace.id, {
          week_start: weekStart, approvals_enabled: approvals, capacity_seconds: schedule,
          reminders_enabled: reminders.enabled, reminder_weekday: reminders.weekday, reminder_hour: reminders.hour,
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const weekly = (v: number[]) => `${v.reduce((a, b) => a + b, 0) / 3600}h a week`;
  return (
    <Portal>
      <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div role="dialog" aria-label="Timesheet settings" onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[88vh] w-[34rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <h3 className="font-semibold text-gray-900">Timesheet settings</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </header>
          <div className="space-y-5 overflow-y-auto px-5 py-4">
            <section>
              <h4 className="text-sm font-semibold text-gray-800">Working hours for one person</h4>
              <p className="mb-2 text-xs text-gray-500">
                What their days are measured against — the bars in their timesheet, their capacity
                on the Workload, and every figure that says whether they are over.
              </p>
              <label className="block text-xs font-medium text-gray-600">
                Person
                <select
                  value={whose}
                  onChange={(e) => { setWhose(e.target.value); setSavedFor(null); }}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal"
                >
                  <option value="">Pick someone…</option>
                  {members.map((m) => (
                    <option key={m.user.id} value={m.user.id}>{m.user.display_name || m.user.email}</option>
                  ))}
                </select>
              </label>
              {whose && !mine && <p className="mt-2 text-xs text-gray-400">Loading their hours…</p>}
              {whose && mine && (
                <>
                  <label className="mb-2 mt-3 flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={custom} onChange={(e) => { setCustom(e.target.checked); if (!e.target.checked) setMine(schedule); }} />
                    Give this person their own hours instead of the workspace schedule
                  </label>
                  <HoursRow label="Their hours" value={custom ? mine : schedule} onChange={(v) => { setCustom(true); setMine(v); }} />
                  <p className="mt-1 text-xs text-gray-400">
                    {weekly(custom ? mine : schedule)}
                    {!custom && ' — the workspace schedule below'}
                  </p>
                  {savedFor === whose && <p className="mt-1 text-xs text-teal-700">Saved.</p>}
                </>
              )}
            </section>
            {settings.can_manage && (
              <section className="space-y-3 border-t border-gray-100 pt-4">
                <h4 className="text-sm font-semibold text-gray-800">Workspace <span className="font-normal text-gray-400">(owners and admins)</span></h4>
                <label className="block text-xs font-medium text-gray-600">Week starts on
                  <select value={weekStart} onChange={(e) => setWeekStart(Number(e.target.value))} className="mt-1 block w-48 rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal">
                    {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </label>
                <div>
                  <span className="text-xs font-medium text-gray-600">Work schedule (default hours for everyone)</span>
                  <HoursRow label="Work schedule" value={schedule} onChange={setSchedule} />
                  <p className="mt-1 text-xs text-gray-400">{weekly(schedule)}</p>
                </div>
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={approvals} onChange={(e) => setApprovals(e.target.checked)} className="mt-0.5" />
                  <span>Timesheet approvals<span className="block text-xs text-gray-500">People submit each week; their Team leads (or the approvers you set) approve. Submitted and approved weeks are locked.</span></span>
                </label>
                <div className="text-sm text-gray-700">
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={reminders.enabled} onChange={(e) => setReminders({ ...reminders, enabled: e.target.checked })} className="mt-0.5" />
                    <span>Remind people to fill in their timesheet<span className="block text-xs text-gray-500">An Inbox reminder (and an email, when email is set up) to anyone whose week so far is short of their working hours. Once a week each.</span></span>
                  </label>
                  {reminders.enabled && (
                    <div className="ml-6 mt-2 flex items-center gap-2 text-xs text-gray-600">
                      On
                      <select aria-label="Reminder day" value={reminders.weekday} onChange={(e) => setReminders({ ...reminders, weekday: Number(e.target.value) })} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
                        {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                      </select>
                      at
                      <select aria-label="Reminder time" value={reminders.hour} onChange={(e) => setReminders({ ...reminders, hour: Number(e.target.value) })} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                      </select>
                      <span className="text-gray-400">({settings.reminder_timezone})</span>
                    </div>
                  )}
                </div>
              </section>
            )}
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
          <footer className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="button" onClick={save} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Save</button>
          </footer>
        </div>
      </div>
    </Portal>
  );
};
