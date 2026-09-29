// Choosing the List a task should go to.
//
// A plain <select> of every List is fine in a workspace with six of them and useless in one with
// two hundred: the names repeat across clients ("PMS - Dev" under four Spaces), the path is what
// tells them apart, and a native list shows neither the path nor a way to search. So this is a
// search box over the full paths, with the Space and Folder greyed and the List's own name in
// front of you.
import React, { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';

export interface ListChoice { id: string; label: string }

export const ListPicker: React.FC<{
  lists: ListChoice[];
  value: string;
  onChange: (id: string) => void;
  /** The List the task is in now, marked so nobody moves it to where it already is. */
  currentId?: string;
  label?: string;
}> = ({ lists, value, onChange, currentId, label = 'List' }) => {
  const [q, setQ] = useState('');

  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    if (!text) return lists;
    // Every word has to appear somewhere in the path, so "dev pms" finds "PMS - Dev" too.
    const words = text.split(/\s+/);
    return lists.filter((l) => {
      const hay = l.label.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [lists, q]);

  const split = (path: string) => {
    const parts = path.split(' / ');
    return { where: parts.slice(0, -1).join(' / '), name: parts[parts.length - 1] };
  };

  return (
    <div>
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <div className="mt-1 overflow-hidden rounded-lg border border-gray-300">
        <label className="flex items-center gap-1.5 border-b border-gray-200 bg-gray-50/70 px-2.5 py-1.5">
          <Search size={13} className="shrink-0 text-gray-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Lists…"
            aria-label="Search Lists"
            className="w-full bg-transparent text-[13px] text-gray-800 outline-none placeholder:text-gray-400"
          />
        </label>
        <div className="max-h-56 overflow-y-auto py-1" role="listbox" aria-label={label}>
          {shown.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-gray-400">No List matches “{q}”.</p>
          ) : shown.map((l) => {
            const { where, name } = split(l.label);
            const on = l.id === value;
            return (
              <button
                key={l.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onChange(l.id)}
                className={`flex w-full items-start gap-2 px-3 py-1.5 text-left ${
                  on ? 'bg-teal-50/70' : 'hover:bg-gray-50'}`}
              >
                <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                  on ? 'border-teal-500 bg-teal-500 text-white' : 'border-gray-300'}`}>
                  {on && <Check size={9} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[13px] ${on ? 'font-medium text-teal-900' : 'text-gray-800'}`}>
                    {name}
                    {l.id === currentId && <span className="ml-1.5 text-[11px] font-normal text-gray-400">current</span>}
                  </span>
                  {where && <span className="block truncate text-[11px] text-gray-400">{where}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
