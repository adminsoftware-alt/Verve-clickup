// Taking someone off the system, as a deliberate piece of work rather than a red button.
//
// It used to be one menu item on a person's panel, next to the buttons you press every day, with
// a single "are you sure?". Offboarding is not that kind of action: it hands over live work, moves
// other people's reporting lines and can bar an address permanently. So it is its own section,
// and it asks three questions in order -- who, what happens to their work, and are you certain --
// showing what you are about to do to at each step rather than after.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Power, Search, ShieldBan, UserMinus, UserX, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { Task } from '../api';
import { Avatar, Portal, StatusDot, formatDue } from '../ui';
import { peopleApi, personName, type OffboardPreview, type Person, type TeamFull } from './peopleApi';
import { ROLE_LABEL } from './PersonDialogs';

type Action = 'turn_off' | 'offboard' | 'offboard_block';

const CHOICES: { value: Action; title: string; hint: string; Icon: React.ElementType; danger?: boolean }[] = [
  {
    value: 'turn_off', Icon: Power,
    title: 'Turn off their access',
    hint: 'They cannot open the workspace. Their tasks, teams and reporting line stay exactly as they are, and you can turn it back on in one click. For someone on leave, or where you are not sure yet.',
  },
  {
    value: 'offboard', Icon: UserMinus,
    title: 'Offboard them',
    hint: 'Access off, open tasks handed to their manager, direct reports moved up, out of every team, and the joiner tasks resolved by the leaver rules. Their comments, time and history stay. For an ordinary leaver.',
  },
  {
    value: 'offboard_block', Icon: ShieldBan, danger: true,
    title: 'Offboard and block the address',
    hint: 'Everything above, and their email is barred so nobody can add them back — by hand, by invitation or by a spreadsheet import — and their sign-in is disabled. An admin can lift the block later.',
  },
];

const card = 'rounded-xl border border-red-200 bg-white p-5';

/** The numbered step heading, so the three questions read as a sequence. */
const Step: React.FC<{ n: number; title: string; done?: boolean; children: React.ReactNode }> = ({ n, title, done, children }) => (
  <section className="flex gap-3">
    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
      done ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
      {done ? <Check size={13} /> : n}
    </span>
    <div className="min-w-0 flex-1">
      <h4 className="mb-2 text-[13px] font-semibold text-gray-800">{title}</h4>
      {children}
    </div>
  </section>
);

/** Pick someone by name, not by typing an address and hoping. */
const PersonPicker: React.FC<{ people: Person[]; chosen: Person | null; onPick: (p: Person | null) => void }> = ({ people, chosen, onPick }) => {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const [cursor, setCursor] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const open = at !== null;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => !q || `${personName(p)} ${p.user.email} ${p.designation ?? ''}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [people, query]);

  // The list is drawn outside the section, not inside it. In a panel with its own rounded,
  // clipped edges -- which the red "careful" frame is -- an absolutely positioned dropdown is
  // cut off at the border, which is exactly what it was doing.
  const place = () => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    setAt({ top: r.bottom + 4, left: r.left, width: r.width });
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !list.current?.contains(t)) setAt(null);
    };
    const move = () => place();
    document.addEventListener('mousedown', away, true);
    window.addEventListener('resize', move);
    window.addEventListener('scroll', move, true);
    return () => {
      document.removeEventListener('mousedown', away, true);
      window.removeEventListener('resize', move);
      window.removeEventListener('scroll', move, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { setCursor(0); }, [query]);

  const choose = (p: Person) => { onPick(p); setAt(null); setQuery(''); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setAt(null); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { place(); return; }
      setCursor((c) => Math.max(0, Math.min(shown.length - 1, c + (e.key === 'ArrowDown' ? 1 : -1))));
      return;
    }
    if (e.key === 'Enter' && open && shown[cursor]) { e.preventDefault(); choose(shown[cursor]); }
  };

  if (chosen) {
    return (
      <button
        type="button" onClick={() => { onPick(null); setQuery(''); }}
        className="flex w-full items-center gap-3 rounded-lg border border-gray-300 px-3 py-2 text-left transition-colors hover:border-gray-400 hover:bg-gray-50"
      >
        <Avatar user={chosen.user} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900">{personName(chosen)}</span>
          <span className="block truncate text-xs text-gray-500">{chosen.user.email}</span>
        </span>
        <span className="shrink-0 text-xs text-brand-600">Change</span>
      </button>
    );
  }

  return (
    <div ref={wrap}>
      <label className="flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 transition-colors hover:border-gray-400 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/15">
        <Search size={15} className="shrink-0 text-gray-400" />
        <input
          aria-label="Find the person to remove"
          role="combobox"
          aria-expanded={open}
          aria-controls="remove-person-results"
          value={query}
          onFocus={place}
          onChange={(e) => { setQuery(e.target.value); place(); }}
          onKeyDown={onKey}
          placeholder="Search by name…"
          className="min-w-0 flex-1 text-sm focus:outline-none"
        />
        {query && (
          <button type="button" aria-label="Clear the search" onClick={() => { setQuery(''); setAt(null); }} className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={14} />
          </button>
        )}
      </label>
      {open && at && (
        <Portal>
          <div
            ref={list}
            id="remove-person-results"
            role="listbox"
            aria-label="People"
            style={{ position: 'fixed', top: at.top, left: at.left, width: at.width }}
            className="z-[200] max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-xl ring-1 ring-black/[0.03]"
          >
            {shown.length === 0 && <p className="px-3 py-2.5 text-sm text-gray-500">Nobody matches that.</p>}
            {shown.map((p, i) => (
              <button
                key={p.user.id} type="button" role="option" aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(p)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors ${i === cursor ? 'bg-gray-100' : ''}`}
              >
                <Avatar user={p.user} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-900">{personName(p)}</span>
                  <span className="block truncate text-xs text-gray-500">{p.designation || p.user.email}</span>
                </span>
                {p.deactivated_at && <span className="shrink-0 rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-600">Access off</span>}
              </button>
            ))}
          </div>
        </Portal>
      )}
    </div>
  );
};

// The value wraps to its own line when the column is narrow, rather than breaking mid-name.
const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-wrap gap-x-2 text-sm">
    <span className="w-32 shrink-0 text-gray-500">{label}</span>
    <span className="min-w-[9rem] flex-1 text-gray-800">{children}</span>
  </div>
);

/** The same row, but the value opens something. */
const ActionFact: React.FC<{ label: string; onClick: () => void; open?: boolean; children: React.ReactNode }> = ({ label, onClick, open, children }) => (
  <div className="flex flex-wrap gap-x-2 text-sm">
    <span className="w-32 shrink-0 text-gray-500">{label}</span>
    <button type="button" onClick={onClick} className="flex min-w-[9rem] flex-1 items-center gap-1 rounded text-left text-gray-800 underline-offset-2 hover:text-brand-700 hover:underline">
      {children}
      <ChevronRight size={13} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
    </button>
  </div>
);

export const RemovePersonSection: React.FC<{
  ws: string; people: Person[]; teams: TeamFull[]; me: string; onChanged: () => void;
}> = ({ ws, people, teams, me, onChanged }) => {
  const [chosen, setChosen] = useState<Person | null>(null);
  const [preview, setPreview] = useState<OffboardPreview | null>(null);
  const [action, setAction] = useState<Action>('offboard');
  const [handTo, setHandTo] = useState('');
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [showTasks, setShowTasks] = useState(false);
  const [theirTasks, setTheirTasks] = useState<Task[] | null>(null);
  const [movingTeam, setMovingTeam] = useState(false);
  const [moveNote, setMoveNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Their details arrive on their own as soon as they are picked -- what work is on them, who
  // reports to them, which teams. Nobody should have to go and look that up in another tab.
  useEffect(() => {
    setPreview(null);
    setTyped('');
    setError(null);
    setDone(null);
    setShowTasks(false);
    setTheirTasks(null);
    setMovingTeam(false);
    setMoveNote(null);
    if (!chosen) return;
    let live = true;
    peopleApi.offboardPreview(ws, chosen.user.id)
      .then((p) => { if (live) { setPreview(p); setHandTo(p.hand_over_to?.id ?? ''); } })
      .catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [ws, chosen]);

  const theirTeams = chosen ? teams.filter((t) => chosen.team_ids.includes(t.id)) : [];
  const manager = chosen?.manager_id ? people.find((p) => p.user.id === chosen.manager_id) : null;
  const candidates = people.filter((p) => p.user.id !== chosen?.user.id && !p.deactivated_at && p.role !== 'guest');
  const needsHandover = action !== 'turn_off' && !!preview?.open_tasks;
  const confirmed = !!chosen && typed.trim().toLowerCase() === personName(chosen).trim().toLowerCase();
  // The server decides; this only repeats what it already said, so nobody types a name into a
  // confirmation for something that was never going to be allowed.
  const blocked = preview?.blocked
    ?? (needsHandover && !handTo ? 'Choose who takes over their open tasks.'
      : action !== 'turn_off' && preview?.sole_lead_of.length && !handTo
        ? `Choose who takes over — they are the only lead of ${preview.sole_lead_of.join(', ')}.`
        : null);

  const go = async () => {
    if (!chosen || !confirmed || blocked) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'turn_off') {
        await peopleApi.setActive(ws, chosen.user.id, false);
        setDone(`${personName(chosen)} can no longer open the workspace. Turn it back on from their profile whenever you like.`);
      } else {
        const out = await peopleApi.offboard(ws, chosen.user.id, {
          hand_over_to: handTo || null,
          keep_tasks: !preview?.open_tasks,
          apply_leaver_rules: true,
          block_email: action === 'offboard_block',
          block_reason: reason.trim() || null,
        });
        const barred = out.email_blocked
          ? ` ${chosen.user.email} is blocked, so nobody can add them back${out.sign_in_revoked ? ', and their sign-in is disabled' : ''}.`
          : '';
        const led = out.teams_led_moved ? `, ${out.teams_led_moved} team${out.teams_led_moved === 1 ? '' : 's'} they led handed on` : '';
        setDone(`${personName(chosen)} is offboarded: ${out.tasks_handed_over} task${out.tasks_handed_over === 1 ? '' : 's'} handed over, `
          + `${out.direct_reports_moved} direct report${out.direct_reports_moved === 1 ? '' : 's'} moved, `
          + `${out.joiner_tasks_deleted} joiner task${out.joiner_tasks_deleted === 1 ? '' : 's'} cleared${led}.${barred}`);
      }
      onChanged();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className={card}>
        <p role="status" className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <Check size={16} className="mt-0.5 shrink-0" /> {done}
        </p>
        <button type="button" onClick={() => { setChosen(null); setDone(null); }} className="mt-4 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50">
          Remove someone else
        </button>
      </div>
    );
  }

  return (
    <div className={`${card} space-y-6`}>
      <Step n={1} title="Who are you removing?" done={!!chosen}>
        <PersonPicker people={people.filter((p) => p.user.id !== me)} chosen={chosen} onPick={setChosen} />
        {chosen && (
          <div className="mt-3 space-y-1.5 rounded-xl border border-gray-200 bg-gray-50/70 p-3.5">
            <Fact label="Role">{ROLE_LABEL[chosen.role]}{chosen.designation ? ` · ${chosen.designation}` : ''}</Fact>
            {chosen.department && <Fact label="Department">{chosen.department}</Fact>}
            <Fact label="Reporting manager">{manager ? personName(manager) : <span className="text-gray-400">None</span>}</Fact>
            {/* Changing their team is the thing an admin often came here to do, having reached
                for "remove" because it was the only control on the page. */}
            <ActionFact label="Teams" open={movingTeam} onClick={() => setMovingTeam(!movingTeam)}>
              {theirTeams.length ? theirTeams.map((t) => t.name).join(', ') : <span className="text-gray-400">None</span>}
            </ActionFact>
            {movingTeam && (
              <div className="ml-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2.5 sm:ml-32">
                <span className="text-xs text-gray-500">Move them to</span>
                <select
                  aria-label="Move to team" defaultValue={theirTeams[0]?.id ?? ''}
                  onChange={async (e) => {
                    const id = e.target.value;
                    setMoveNote(null);
                    try {
                      await peopleApi.update(ws, chosen.user.id, { team_ids: id ? [id] : [] });
                      setMoveNote(id ? `Moved to ${teams.find((t) => t.id === id)?.name}.` : 'Taken out of every team.');
                      onChanged();
                    } catch (err) { setMoveNote((err as Error).message); }
                  }}
                  className="h-8 rounded-lg border border-gray-300 px-2 text-sm transition-colors hover:border-gray-400 focus:border-brand-500 focus:outline-none"
                >
                  <option value="">No team</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <span className="text-[11px] text-gray-500">They leave the team they are in now.</span>
                {moveNote && <span className="w-full text-xs text-emerald-700">{moveNote}</span>}
              </div>
            )}
            {/* Five open tasks is a number nobody can act on. Which five is the question. */}
            {preview && preview.open_tasks > 0 ? (
              <ActionFact
                label="Open tasks" open={showTasks}
                onClick={() => {
                  setShowTasks(!showTasks);
                  if (!theirTasks) peopleApi.tasks(ws, chosen.user.id).then(setTheirTasks).catch(() => setTheirTasks([]));
                }}
              >
                {preview.open_tasks}
              </ActionFact>
            ) : (
              <Fact label="Open tasks">{preview ? preview.open_tasks : <span className="text-gray-400">Counting…</span>}</Fact>
            )}
            {showTasks && (
              <div className="ml-4 rounded-lg border border-gray-200 bg-white sm:ml-32">
                {theirTasks === null ? <p className="px-3 py-2 text-sm text-gray-400">Loading…</p> : (
                  <ul className="divide-y divide-gray-100">
                    {theirTasks.slice(0, 20).map((t) => (
                      <li key={t.id}>
                        <Link to={`/l/${t.list_id}?task=${t.id}`} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-800 no-underline hover:bg-gray-50">
                          <StatusDot status={t.status} size={11} />
                          <span className="min-w-0 flex-1 truncate">{t.name}</span>
                          {t.due_date && <span className="shrink-0 text-[11px] text-gray-400">{formatDue(t.due_date)}</span>}
                        </Link>
                      </li>
                    ))}
                    {theirTasks.length > 20 && <li className="px-3 py-1.5 text-xs text-gray-400">and {theirTasks.length - 20} more</li>}
                    {theirTasks.length === 0 && <li className="px-3 py-2 text-sm text-gray-400">None you can see.</li>}
                  </ul>
                )}
              </div>
            )}
            <Fact label="Direct reports">{preview ? preview.direct_reports : <span className="text-gray-400">Counting…</span>}</Fact>
            {!!preview?.sole_lead_of.length && (
              <Fact label="Only lead of">
                <span className="text-amber-700">{preview.sole_lead_of.join(', ')}</span>
              </Fact>
            )}
            {chosen.deactivated_at && <Fact label="Access">Already turned off</Fact>}
          </div>
        )}
      </Step>

      {chosen && (
        <Step n={2} title="What should happen?" done={confirmed}>
          <div className="space-y-2">
            {CHOICES.map((c) => (
              <label
                key={c.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                  action === c.value ? 'border-brand-400 bg-brand-50/50 ring-1 ring-brand-200' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
              >
                <input type="radio" name="removal" className="mt-1" checked={action === c.value} onChange={() => { setAction(c.value); setTyped(''); }} />
                <span className="min-w-0 flex-1">
                  <span className={`flex items-center gap-1.5 text-sm font-medium ${c.danger ? 'text-red-700' : 'text-gray-900'}`}>
                    <c.Icon size={14} /> {c.title}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-gray-600">{c.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {(needsHandover || (action !== 'turn_off' && !!preview?.sole_lead_of.length)) && (
            <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-700">
              Hand {[
                preview?.open_tasks ? `their ${preview.open_tasks} open task${preview.open_tasks === 1 ? '' : 's'}` : '',
                preview?.sole_lead_of.length ? `the lead of ${preview.sole_lead_of.join(', ')}` : '',
              ].filter(Boolean).join(' and ')} to
              <select
                aria-label="Hand over to" value={handTo} onChange={(e) => setHandTo(e.target.value)}
                className="h-9 rounded-lg border border-gray-300 px-2 text-sm transition-colors hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              >
                <option value="">Choose someone</option>
                {candidates.map((p) => (
                  <option key={p.user.id} value={p.user.id}>
                    {personName(p)}{p.user.id === preview?.hand_over_to?.id ? ' (their manager)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          {action === 'offboard_block' && (
            <input
              aria-label="Why they are blocked" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
              placeholder="Why they are blocked (optional) — shown to whoever tries to add them"
              className="mt-3 h-9 w-full rounded-lg border border-gray-300 px-3 text-sm transition-colors hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            />
          )}
        </Step>
      )}

      {chosen && (
        <Step n={3} title="Confirm">
          <p className="mb-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {action === 'turn_off'
              ? 'This is reversible — their access can be turned back on from their profile.'
              : action === 'offboard'
                ? 'Their work moves to someone else and their reporting line changes. Access can be turned back on, but the hand-over is not undone automatically.'
                : 'As well as offboarding them, the address is barred and their sign-in is disabled. Lifting the block later is an admin job and does not restore their access.'}
          </p>
          {/* Typing the name is the second step of the check: it is the one thing that cannot be
              done by clicking through a dialog you have stopped reading. */}
          <label className="block text-[13px] text-gray-700">
            Type <b>{personName(chosen)}</b> to confirm
            <input
              aria-label="Type their name to confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              placeholder={personName(chosen)}
              className={`mt-1.5 h-10 w-full rounded-lg border px-3 text-sm transition-colors focus:outline-none focus:ring-2 ${
                typed && !confirmed
                  ? 'border-amber-300 focus:border-amber-500 focus:ring-amber-500/15'
                  : confirmed
                    ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/15'
                    : 'border-gray-300 hover:border-gray-400 focus:border-brand-500 focus:ring-brand-500/15'}`}
            />
          </label>

          {blocked && <p className="mt-2 text-xs text-amber-700">{blocked}</p>}
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button" onClick={go} disabled={!confirmed || !!blocked || busy}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <UserX size={15} /> {busy ? 'Working…' : action === 'turn_off' ? 'Turn off access' : action === 'offboard' ? 'Offboard them' : 'Offboard and block'}
            </button>
            <button type="button" onClick={() => setChosen(null)} className="rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100">Cancel</button>
          </div>
        </Step>
      )}
    </div>
  );
};
