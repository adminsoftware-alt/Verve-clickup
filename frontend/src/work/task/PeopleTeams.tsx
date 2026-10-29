// People or Teams, in every place work is handed out: the task's assignee picker, the List and
// Table assignee cells, and the bulk bar. Picking a Team puts everyone in it on the task in one
// go (a task belongs to people, so a Team is a quick way to pick several); picking it again, when
// they are all on, takes them all off.
import React, { useMemo } from 'react';
import { Check, Users } from 'lucide-react';

import { useMe, useWork } from '../WorkContext';
import type { Team, UserRef } from '../api';

export type PickMode = 'people' | 'teams';

/** A two-way switch whose white thumb slides to the side that is chosen. */
export const PeopleTeamsSwitch: React.FC<{ mode: PickMode; onChange: (m: PickMode) => void }> = ({ mode, onChange }) => (
  <div role="tablist" aria-label="Assign to" className="relative grid grid-cols-2 rounded-md bg-[#EEF1F5] p-0.5 text-xs font-medium">
    <span aria-hidden
      className={`absolute bottom-0.5 left-0.5 top-0.5 w-[calc(50%-2px)] rounded-md bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200 ease-out ${mode === 'teams' ? 'translate-x-full' : ''}`} />
    {(['people', 'teams'] as const).map((m) => (
      <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => onChange(m)}
        className={`relative z-10 flex items-center justify-center gap-1 py-0.5 transition-colors ${mode === m ? 'text-[#1C3A70]' : 'text-gray-500 hover:text-gray-700'}`}>
        {m === 'people' ? 'People' : <><Users size={12} />Teams</>}
      </button>
    ))}
  </div>
);

/**
 * The Teams someone may hand work to as a whole: every Team for an admin; for anyone else the
 * Teams they lead or belong to.
 */
export function useAssignTeams(query = ''): Team[] {
  const { teams, hierarchy } = useWork();
  const me = useMe();
  const isAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    return teams
      .filter((t) => isAdmin || t.lead_ids.includes(me) || t.members.some((u) => u.id === me))
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [teams, isAdmin, me, query]);
}

export const teamIsOn = (team: Team, chosen: Set<string>) => team.members.length > 0 && team.members.every((u: UserRef) => chosen.has(u.id));

/** One Team in a picker: its letter, its name, how many people, and a tick when they are all on. */
export const TeamRow: React.FC<{ team: Team; on: boolean; onPick: () => void; compact?: boolean }> = ({ team, on, onPick, compact }) => (
  <button type="button" aria-pressed={on} onClick={onPick}
    className={`flex w-full items-center gap-3 rounded-lg px-2.5 text-left text-gray-800 hover:bg-gray-100 ${compact ? 'py-1 text-sm' : 'py-1.5 text-[15px]'} ${on ? 'bg-gray-100' : ''}`}>
    <span className={`relative flex shrink-0 items-center justify-center rounded-full bg-[#667085] font-semibold text-white ${compact ? 'h-6 w-6 text-[11px]' : 'h-7 w-7 text-xs'}`}>
      {team.name[0]?.toUpperCase()}
      <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-gray-500"><Users size={9} /></span>
    </span>
    <span className="min-w-0 flex-1 truncate">{team.name}</span>
    <span className="shrink-0 text-[13px] text-gray-500">{team.members.length} {team.members.length === 1 ? 'person' : 'people'}</span>
    {on && <Check size={15} className="shrink-0 text-brand-600" aria-label="All assigned" />}
  </button>
);
