// Who is on this task. Everyone in the workspace is offered, plus the Teams, the way ClickUp does
// it: search, tick people, and anyone who cannot open the List yet is shared in as you pick them.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Plus, Search, Users, X } from 'lucide-react';

import { useWork, useMe } from '../WorkContext';
import { workApi, type PersonLoadRow, type UserRef } from '../api';
import { Avatar, Portal, formatDuration, useEscapeToClose } from '../ui';

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
  const { members, teams, hierarchy, workspace } = useWork();
  const meId = useMe();
  const [open, setOpen] = useState(false);
  // Assigning is where overload gets created, and it is the one moment nobody can see it: you
  // are looking at a task, not at the other person's week. So bring the week to the picker.
  const [load, setLoad] = useState<Record<string, PersonLoadRow> | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ top: number; left: number }>({ top: 96, left: 0 });
  const openPanel = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (r) {
      const width = 320;
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

  // Everyone in the firm is offered, as in ClickUp. It used to be only the people who could already
  // open the List -- for an employee in the New task dialog that was nobody but themselves.
  // Someone who cannot open the List yet is marked, and shared in when picked (where allowed).
  const isAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';

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

  const shownTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teams
      .filter((t) => isAdmin || t.lead_ids.includes(meId))
      .filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [teams, query, isAdmin, meId]);

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
    return { text: `${formatDuration(left)} free this week`, tone: 'text-gray-400' };
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

  const row = 'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-gray-50';
  return (
    <div className="px-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Photos, or initials where there is none ("HK"), as ClickUp shows them: the name is on
            hover, and a small × appears there to take someone off. */}
        {assignees.map((user) => (
          <span key={user.id} title={user.display_name || user.email} className="group/chip relative rounded-full ring-2 ring-white">
            <Avatar user={user} size={26} />
            {editable && (
              <button type="button" aria-label={`Remove ${user.display_name || user.email}`} onClick={() => onChange(assignees.filter((a) => a.id !== user.id).map((a) => a.id))}
                className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-gray-700 text-white shadow group-hover/chip:flex focus:flex">
                <X size={10} strokeWidth={3} />
              </button>
            )}
          </span>
        ))}
        {assignees.length === 0 && <span className="text-sm text-gray-400">Empty</span>}
        {editable && (
          <button
            ref={trigger}
            type="button"
            onClick={() => { if (open) setOpen(false); else openPanel(); setNote(null); }}
            aria-expanded={open}
            className="flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-gray-400 hover:text-gray-800"
          >
            <Plus size={12} /> Assign
          </button>
        )}
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
              className="absolute w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
            >
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                <Search size={14} className="text-gray-400" />
                <input
                  autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search or enter email…" aria-label="Search people and Teams"
                  className="w-full text-sm focus:outline-none"
                />
              </div>
              <div className="max-h-80 overflow-auto py-1">
                {shownTeams.length > 0 && multiple && (
                  <>
                    <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Teams</p>
                    {shownTeams.map((team) => (
                      <button key={team.id} type="button" className={row} onClick={() => pickTeam(team.members)}>
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gray-100 text-gray-500"><Users size={13} /></span>
                        <span className="min-w-0 flex-1 truncate text-gray-800">{team.name}</span>
                        <span className="text-xs text-gray-400">{team.members.length}</span>
                      </button>
                    ))}
                  </>
                )}
                {(['Assignees', 'People'] as const).map((section) => {
                  // Who is on it already, first; then everyone else, you at the top.
                  const shown = people.filter((m) => (section === 'Assignees') === chosen.has(m.user.id));
                  if (!shown.length) return null;
                  return (
                    <React.Fragment key={section}>
                      <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{section}</p>
                      {shown.map((m) => {
                        const on = chosen.has(m.user.id);
                        const blind = !!allowed && !allowed.has(m.user.id);
                        const week = weekFor(m.user.id);
                        return (
                          <button key={m.user.id} type="button" className={`${row} ${on ? 'bg-brand-50/60' : ''}`} onClick={() => pick(m.user)} disabled={busy === m.user.id}>
                            <Avatar user={m.user} size={24} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-gray-800">
                                {m.user.id === meId ? 'Me' : (m.user.display_name || m.user.email)}
                              </span>
                              {(blind || week) && (
                                <span className="block truncate text-xs text-gray-400">
                                  {blind
                                    ? (canShare ? 'Not on this List yet — picking them shares it' : "Can't open this List")
                                    : week && <span className={week.tone}>{week.text}</span>}
                                </span>
                              )}
                            </span>
                            {blind && <Lock size={12} className="shrink-0 text-amber-500" />}
                            {on && <X size={14} className="shrink-0 text-gray-400" aria-label="Remove" />}
                          </button>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
                {people.length === 0 && <p className="px-3 py-4 text-center text-sm text-gray-400">Nobody matches that.</p>}
              </div>
              {note && <p className="border-t border-gray-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">{note}</p>}
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
};
