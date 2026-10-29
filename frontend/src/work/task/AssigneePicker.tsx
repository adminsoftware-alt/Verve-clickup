// Who is on this task. Everyone in the workspace is offered, then the Teams: search, click people
// on or off, and anyone who cannot open the List yet is shared in as you pick them.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Lock, Search } from 'lucide-react';

import { useWork, useMe } from '../WorkContext';
import { workApi, type PersonLoadRow, type UserRef } from '../api';
import { Avatar, Portal, formatDuration, useEscapeToClose } from '../ui';
import { PeopleTeamsSwitch, TeamRow, teamIsOn, useAssignTeams, type PickMode } from './PeopleTeams';

interface Props {
  listId: string;
  assignees: UserRef[];
  /** Everyone who can already open the List; null while it loads. */
  assignable: UserRef[] | null;
  editable: boolean;
  /** Whether this person may share the List, so someone without access can still be given work. */
  canShare: boolean;
  multiple: boolean;
  onChange: (ids: string[]) => void;
  /** Called after sharing, so the caller can reload who may be assigned. */
  onShared: () => void;
}

export const AssigneePicker: React.FC<Props> = ({
  listId, assignees, assignable, editable, canShare, multiple, onChange, onShared,
}) => {
  const { members, workspace } = useWork();
  const meId = useMe();
  const [open, setOpen] = useState(false);
  // Assigning is where overload gets created, and it is the one moment nobody can see it: you
  // are looking at a task, not at the other person's week. So bring the week to the picker.
  const [load, setLoad] = useState<Record<string, PersonLoadRow> | null>(null);
  const [query, setQuery] = useState('');
  // People, or Teams: a Team picked here puts everyone in it on the task in one go.
  const [mode, setMode] = useState<PickMode>('people');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number }>({ top: 96, left: 0 });
  const openPanel = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (r) {
      const width = 272;
      const below = r.bottom + 6;
      const height = 400;
      setAt({
        top: below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 6) : below,
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      });
    }
    setOpen(true);
  };
  useEscapeToClose(panel, () => setOpen(false));

  const chosen = useMemo(() => new Set(assignees.map((a) => a.id)), [assignees]);
  const allowed = useMemo(() => (assignable ? new Set(assignable.map((u) => u.id)) : null), [assignable]);

  // Everyone in the firm is offered. It used to be only the people who could already open the
  // List -- for an employee in the New task dialog that was nobody but themselves. Someone who
  // cannot open the List yet is marked, and shared in when picked (where allowed).

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => m.role !== 'guest' && !m.deactivated)
      .filter((m) => !q || (m.user.display_name ?? m.user.email).toLowerCase().includes(q)
        || m.user.email.toLowerCase().includes(q))
      .sort((a, b) => {
        const mine = (x: typeof a) => (x.user.id === meId ? 0 : 1);
        return mine(a) - mine(b) || (a.user.display_name ?? a.user.email).localeCompare(b.user.display_name ?? b.user.email);
      });
  }, [members, query, meId]);

  const shownTeams = useAssignTeams(query);

  useEffect(() => {
    if (!open || !workspace || load) return;
    const ids = members.filter((m) => m.role !== 'guest' && !m.deactivated).map((m) => m.user.id).slice(0, 20);
    if (!ids.length) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    workApi.peopleLoad(workspace.id, ids, today, 7)
      .then((r) => setLoad(Object.fromEntries(r.rows.map((row) => [row.user_id, row]))))
      .catch(() => undefined);
  }, [open, workspace, members, load]);

  /** How full the next week already is for this person, or null while it is unknown. */
  const weekFor = (userId: string): { text: string; tone: string } | null => {
    const row = load?.[userId];
    if (!row || !row.capacity_total) return null;
    const full = row.planned_total / row.capacity_total;
    const left = row.capacity_total - row.planned_total;
    if (full > 1) {
      return { text: `${formatDuration(row.planned_total - row.capacity_total)} over this week`, tone: 'text-red-600' };
    }
    if (full > 0.85) return { text: `nearly full — ${formatDuration(left)} left this week`, tone: 'text-amber-600' };
    // Room to spare says nothing worth reading beside a name.
    return null;
  };

  /** Give work to someone, sharing the List with them first if they cannot open it yet. */
  const pick = async (user: UserRef) => {
    if (chosen.has(user.id)) {
      onChange(assignees.filter((a) => a.id !== user.id).map((a) => a.id));
      return;
    }
    if (allowed && !allowed.has(user.id)) {
      if (!canShare) {
        setNote(`${user.display_name || user.email} can't open this List, and you can't share it. Ask someone with full access.`);
        return;
      }
      setBusy(user.id);
      try {
        await workApi.share('list', listId, { user_id: user.id }, 'edit');
        onShared();
        setNote(`${user.display_name || user.email} was given access to this List.`);
      } catch (e) {
        setNote((e as Error).message);
        setBusy(null);
        return;
      }
      setBusy(null);
    }
    onChange(multiple ? [...chosen, user.id] : [user.id]);
  };

  const pickTeam = async (members: UserRef[]) => {
    if (!multiple) return;
    if (members.length > 0 && members.every((u) => chosen.has(u.id))) {
      const off = new Set(members.map((u) => u.id));
      onChange([...chosen].filter((id) => !off.has(id)));
      return;
    }
    const next = new Set(chosen);
    for (const user of members) {
      if (next.has(user.id)) continue;
      if (allowed && !allowed.has(user.id)) {
        if (!canShare) continue;
        await workApi.share('list', listId, { user_id: user.id }, 'edit').catch(() => undefined);
      }
      next.add(user.id);
    }
    onShared();
    onChange([...next]);
  };

  const row = 'flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-sm text-gray-800 hover:bg-gray-100';
  const toggleOpen = () => { if (open) setOpen(false); else openPanel(); setNote(null); };
  return (
    <div className="px-1">
      {/* The whole field opens the picker: the people on the task as small name chips, or
          "Add people" when there is nobody yet. Someone comes off by clicking them in the list. */}
      <div
        ref={trigger}
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
        aria-label={editable ? 'Choose assignees' : undefined}
        aria-expanded={editable ? open : undefined}
        onClick={editable ? toggleOpen : undefined}
        onKeyDown={editable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOpen(); } } : undefined}
        className={`flex min-h-7 w-full flex-wrap items-center gap-1.5 rounded-md px-1 ${editable ? 'cursor-pointer' : ''}`}
      >
        {assignees.map((user) => (
          <span key={user.id} className="inline-flex items-center gap-1.5 rounded-full bg-[#F2F4F7] py-0.5 pl-0.5 pr-2.5 text-[13px] text-gray-800">
            <Avatar user={user} size={22} />
            {user.id === meId ? 'Me' : (user.display_name || user.email).split(' ')[0]}
          </span>
        ))}
        {assignees.length === 0 && <span className="text-sm text-gray-400">{editable ? 'Add people' : 'Empty'}</span>}
      </div>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-[130]" onMouseDown={() => setOpen(false)}>
            <div
              ref={panel}
              role="dialog"
              aria-label="Choose assignees"
              onMouseDown={(e) => e.stopPropagation()}
              style={{ top: at.top, left: at.left }}
              className="absolute w-[17rem] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
            >
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                <Search size={14} className="shrink-0 text-gray-400" />
                <input
                  autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search or enter email…" aria-label="Search people and Teams"
                  className="w-full text-sm placeholder:text-gray-400 focus:outline-none"
                />
              </div>
              {multiple && <div className="border-b border-gray-100 px-2 py-1.5"><PeopleTeamsSwitch mode={mode} onChange={setMode} /></div>}
              <div className="max-h-56 overflow-auto p-1.5">
                {mode === 'people' && people.length > 0 && <p className="px-2 pb-0.5 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">People</p>}
                {mode === 'people' && [...people].sort((a, b) => Number(chosen.has(b.user.id)) - Number(chosen.has(a.user.id))).map((m) => {
                  const on = chosen.has(m.user.id);
                  const blind = !!allowed && !allowed.has(m.user.id);
                  const week = weekFor(m.user.id);
                  return (
                    <button key={m.user.id} type="button" aria-pressed={on} className={`${row} ${on ? 'bg-gray-100' : ''}`} onClick={() => pick(m.user)} disabled={busy === m.user.id}>
                      <span className={`shrink-0 rounded-full ${on ? 'ring-2 ring-brand-600 ring-offset-1' : ''}`}><Avatar user={m.user} size={22} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{m.user.id === meId ? 'Me' : (m.user.display_name || m.user.email)}</span>
                        {(blind || week) && (
                          <span className="block truncate text-xs text-gray-400">
                            {blind
                              ? (canShare ? 'Not on this List yet — picking them shares it' : "Can't open this List")
                              : week && <span className={week.tone}>{week.text}</span>}
                          </span>
                        )}
                      </span>
                      {blind && <Lock size={12} className="shrink-0 text-amber-500" />}
                      {on && <Check size={14} className="shrink-0 text-brand-600" aria-label="Assigned" />}
                    </button>
                  );
                })}
                {mode === 'people' && people.length === 0 && <p className="px-3 py-4 text-center text-sm text-gray-400">Nobody matches that.</p>}
                {mode === 'teams' && (
                  <>
                    <p className="px-2 pb-0.5 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Teams <span className="normal-case tracking-normal">— picks everyone in it</span></p>
                    {shownTeams.length === 0 && <p className="px-3 py-4 text-center text-sm text-gray-400">No Teams to pick from.</p>}
                    {shownTeams.map((team) => <TeamRow key={team.id} team={team} on={teamIsOn(team, chosen)} onPick={() => pickTeam(team.members)} compact />)}
                  </>
                )}
              </div>
              {note && <p className="border-t border-gray-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">{note}</p>}
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
};
