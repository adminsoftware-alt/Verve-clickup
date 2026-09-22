import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../../components/AuthContext';
import { useWork, useMe } from '../WorkContext';
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
  const { workspace } = useWork();
  const { user } = useAuth();
  const meId = useMe();
  const [mine, setMine] = useState<number[] | null>(null);
  const [custom, setCustom] = useState(false);
  const [weekStart, setWeekStart] = useState(settings.week_start);
  const [approvals, setApprovals] = useState(settings.approvals_enabled);
  const [schedule, setSchedule] = useState(settings.capacity_seconds);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspace && user) sheetApi.capacity(workspace.id, meId).then((c) => { setMine(c.capacity_seconds); setCustom(c.is_custom); }).catch((e) => setError(e.message));
  }, [workspace, user]);

  const save = async () => {
    if (!workspace || !user) return;
    try {
      // Your hours may still be loading; the workspace settings save regardless.
      if (mine) await sheetApi.setCapacity(workspace.id, meId, custom ? mine : null);
      if (settings.can_manage) await sheetApi.updateSettings(workspace.id, { week_start: weekStart, approvals_enabled: approvals, capacity_seconds: schedule });
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
              <h4 className="text-sm font-semibold text-gray-800">My working hours</h4>
              <p className="mb-2 text-xs text-gray-500">Your daily capacity: the bars in your timesheet fill up against it.</p>
              <label className="mb-2 flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={custom} onChange={(e) => { setCustom(e.target.checked); if (!e.target.checked) setMine(schedule); }} />
                Use my own hours instead of the workspace schedule
              </label>
              {mine && <HoursRow label="My hours" value={custom ? mine : schedule} onChange={(v) => { setCustom(true); setMine(v); }} />}
              {mine && <p className="mt-1 text-xs text-gray-400">{weekly(custom ? mine : schedule)}</p>}
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
              </section>
            )}
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
          <footer className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="button" onClick={save} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Save</button>
          </footer>
        </div>
      </div>
    </Portal>
  );
};
