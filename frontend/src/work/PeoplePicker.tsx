// Choosing people, several at a time.
//
// Used wherever work is handed to more than one person -- sharing a task, duplicating one to a
// few desks. Search narrows, the tick boxes stack up, and "Everyone" is one click rather than
// sixty. People already holding the thing are shown ticked and disabled, so it is obvious who
// would be added rather than who would end up with it.
import { Check, Search, Users } from 'lucide-react';
import React, { useMemo, useState } from 'react';

import { useWork } from './WorkContext';
import { Avatar } from './ui';

export const PeoplePicker: React.FC<{
  chosen: string[];
  onChange: (ids: string[]) => void;
  /** People who already have it: ticked, and not yours to untick. */
  already?: string[];
  /** Leave someone out of the list entirely, e.g. the person doing the choosing. */
  exclude?: string[];
  label?: string;
  /** How tall the list may grow before it scrolls. */
  maxHeight?: number;
}> = ({ chosen, onChange, already = [], exclude = [], label = 'People', maxHeight = 240 }) => {
  const { members } = useWork();
  const [q, setQ] = useState('');

  const people = useMemo(() => {
    const out = members.filter((m) => !m.deactivated && !exclude.includes(m.user.id));
    const needle = q.trim().toLowerCase();
    if (!needle) return out;
    return out.filter((m) =>
      (m.user.display_name || '').toLowerCase().includes(needle) || m.user.email.toLowerCase().includes(needle));
  }, [members, q, exclude]);

  const held = new Set(already);
  const pickable = people.filter((m) => !held.has(m.user.id)).map((m) => m.user.id);
  const allOn = pickable.length > 0 && pickable.every((id) => chosen.includes(id));

  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  return (
    <div role="group" aria-label={label}>
      <div className="flex items-center gap-2">
        <span className="flex flex-1 items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1.5 focus-within:border-brand-500">
          <Search size={13} className="shrink-0 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people"
            aria-label="Search people"
            className="w-full bg-transparent text-sm focus:outline-none"
          />
        </span>
        {/* Sixty ticks is not a choice anyone should have to make by hand. */}
        <button
          type="button"
          onClick={() => onChange(allOn ? chosen.filter((id) => !pickable.includes(id)) : [...new Set([...chosen, ...pickable])])}
          disabled={pickable.length === 0}
          className="flex shrink-0 items-center gap-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <Users size={13} />
          {allOn ? 'Clear' : q.trim() ? 'All shown' : 'Everyone'}
        </button>
      </div>

      <ul className="mt-2 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200" style={{ maxHeight }}>
        {people.length === 0 && <li className="px-3 py-4 text-center text-xs text-gray-400">Nobody matches “{q.trim()}”.</li>}
        {people.map((m) => {
          const has = held.has(m.user.id);
          const on = has || chosen.includes(m.user.id);
          return (
            <li key={m.user.id}>
              <label className={`flex items-center gap-2.5 px-2.5 py-1.5 ${has ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}>
                <input type="checkbox" checked={on} disabled={has} onChange={() => toggle(m.user.id)} aria-label={m.user.display_name || m.user.email} />
                <Avatar user={m.user} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-900">{m.user.display_name || m.user.email}</span>
                  <span className="block truncate text-[11px] text-gray-500">{m.user.email}</span>
                </span>
                {has && <span className="flex shrink-0 items-center gap-1 text-[11px] text-gray-500"><Check size={11} /> has it</span>}
              </label>
            </li>
          );
        })}
      </ul>

      <p className="mt-1.5 text-[11px] text-gray-500">
        {chosen.length === 0 ? 'Nobody chosen yet.' : `${chosen.length} chosen${already.length ? `, ${already.length} already have it` : ''}.`}
      </p>
    </div>
  );
};
