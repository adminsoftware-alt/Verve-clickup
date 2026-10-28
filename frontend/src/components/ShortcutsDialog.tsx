// Every keyboard shortcut the app has, in one place. Each one is wired up where it works -- this
// only lists them, so keep it in step when a key is added or changed.
import React, { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';
import { Portal } from '../work/ui';

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  { title: 'Anywhere', keys: [
    [['Ctrl', 'K'], 'Search tasks, Lists and people'],
    [['Ctrl', 'J'], 'Open the Assistant'],
    [['Esc'], 'Close a panel, menu or dialog'],
  ] },
  { title: 'Dashboard', keys: [
    [['R'], 'Refresh the numbers'],
    [['F'], 'Filter all cards'],
    [['Ctrl', 'Z'], 'Undo a layout change, while arranging cards'],
  ] },
  { title: 'Timesheet', keys: [
    [['←'], 'Previous week'],
    [['→'], 'Next week'],
  ] },
  { title: 'Planner', keys: [
    [['D'], 'Day'],
    [['W'], 'Week'],
    [['M'], 'Month'],
  ] },
  { title: 'Writing', keys: [
    [['Ctrl', 'B'], 'Bold, in a task description'],
    [['Ctrl', 'I'], 'Italic, in a task description'],
    [['Ctrl', 'Enter'], 'Send a comment'],
  ] },
];

export const ShortcutsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <Portal>
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
        <div role="dialog" aria-label="Keyboard shortcuts" onMouseDown={(e) => e.stopPropagation()}
          className="max-h-[90vh] w-[34rem] max-w-full overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base font-semibold text-[#1B2A4A]"><Keyboard size={18} className="text-[#234788]" /> Keyboard shortcuts</h3>
            <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {GROUPS.map((g) => (
              <section key={g.title}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{g.title}</p>
                {g.keys.map(([keys, what]) => (
                  <div key={what} className="flex items-center justify-between gap-3 py-1.5 text-sm text-gray-700">
                    <span>{what}</span>
                    <span className="flex shrink-0 gap-1">
                      {keys.map((k) => <kbd key={k} className="min-w-[1.6rem] rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-center font-sans text-[11px] font-semibold text-gray-600 shadow-[0_1px_0_#E3E8F0]">{k}</kbd>)}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </Portal>
  );
};
