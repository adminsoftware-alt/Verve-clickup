import React, { useState } from 'react';
import { Clock, X } from 'lucide-react';
import { useAuth } from '../../components/AuthContext';
import { useWork } from '../WorkContext';
import { Portal } from '../ui';
import { sheetApi, type SheetSettings } from './api';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const SettingsDialog: React.FC<{ settings: SheetSettings; onClose: () => void; onSaved: () => void }> = ({ settings, onClose, onSaved }) => {
  const { workspace } = useWork();
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState(settings.week_start);
  const [approvals, setApprovals] = useState(settings.approvals_enabled);
  const [reminders, setReminders] = useState({ enabled: settings.reminders_enabled, weekday: settings.reminder_weekday, hour: settings.reminder_hour });
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!workspace || !user) return;
    try {
      if (settings.can_manage) {
        await sheetApi.updateSettings(workspace.id, {
          week_start: weekStart, approvals_enabled: approvals,
          reminders_enabled: reminders.enabled, reminder_weekday: reminders.weekday, reminder_hour: reminders.hour,
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div role="dialog" aria-label="Timesheet settings" onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[88vh] w-[34rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <h3 className="font-semibold text-gray-900">Timesheet settings</h3>
            <button aria-label="Close" type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </header>
          <div className="space-y-5 overflow-y-auto px-5 py-4">
            {/* Working hours -- the company's week, a Team's, one person's -- moved to Admin, where
                an admin sees everybody at once instead of picking one person at a time. */}
            <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
              <Clock size={15} className="mt-0.5 shrink-0 text-gray-400" />
              <span>Working hours and work days, for the company, a Team or one person, are set in <b className="font-semibold text-gray-800">Admin → Working hours</b>.</span>
            </p>
            {settings.can_manage && (
              <section className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-800">Workspace <span className="font-normal text-gray-400">(owners and admins)</span></h4>
                <label className="block text-xs font-medium text-gray-600">Week starts on
                  <select value={weekStart} onChange={(e) => setWeekStart(Number(e.target.value))} className="mt-1 block w-48 rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal">
                    {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </label>
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
