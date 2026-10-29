// Taking someone off the system, as a deliberate piece of work rather than a red button.
//
// It used to be one menu item on a person's panel, next to the buttons you press every day, with
// a single "are you sure?". Offboarding is not that kind of action: it hands over live work, moves
// other people's reporting lines and can bar an address permanently. So it is its own section,
// and it asks three questions in order -- who, what happens to their work, and are you certain --
// showing what you are about to do to at each step rather than after.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Search, UserX, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { workApi, type Task } from '../api';
import { Avatar, Portal, StatusDot, formatDue } from '../ui';
import { peopleApi, personName, type OffboardPreview, type Person, type TeamFull } from './peopleApi';
import { accessOf } from './PersonDialogs';
import { LinesSkeleton } from '../Skeleton';

// Offboarding, and nothing else.
//
// There were three choices here and two had to go. "Turn off their access" is a different job with
// a different name -- it lives on the person's own panel, where somebody going on leave is dealt
// with -- and as the first option on a page headed "Removing someone" it put the reversible thing
// and the permanent thing one mis-click apart.
//
// "Offboard and block the address" went with the blocking feature itself: barring an email was a
// second way of saying "this person has left", and the only way to lift it was a list in Admin
// that existed for nothing else.

/** The value a task's dropdown takes when the answer is "nobody -- it goes". */
const DELETE_TASK = '__delete__';

const card = 'rounded-xl border border-[#E4E8F0] bg-white p-5';

/** The numbered step heading, so the three questions read as a sequence. */
const Step: React.FC<{ n: number; title: string; done?: boolean; children: React.ReactNode }> = ({ n, title, done, children }) => (
  <section className="flex gap-3">
    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
      done ? 'bg-[#234788] text-white' : 'bg-[#EEF2F8] text-[#234788]'}`}>
      {done ? <Check size={13} strokeWidth={3} /> : n}
    </span>
    <div className="min-w-0 flex-1">
      <h4 className="mb-2.5 text-[14px] font-semibold text-[#142B57]">{title}</h4>
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

/** Past this many tasks the list gets a search box and an "undecided only" switch. */
const FILTER_FROM = 8;

/** Their open tasks, each with its decision on the same row, in a box that scrolls on its own so
 *  a long workload doesn't push the rest of the page -- the team lead hand-over, the
 *  confirmation -- out of reach.
 *
 *  This is the only list of their tasks on the page. There used to be a second, read-only one
 *  under step 1 that you opened to see which tasks they were, and then this one to say what
 *  happens to them: the same tasks twice, one screen apart. */
const TaskDecisions: React.FC<{
  tasks: Task[];
  perTask: Record<string, string>;
  setPerTask: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  candidates: Person[];
  managerId?: string;
}> = ({ tasks, perTask, setPerTask, candidates, managerId }) => {
  const [filter, setFilter] = useState('');
  const [onlyUndecided, setOnlyUndecided] = useState(false);
  // Tasks ticked to be decided together: give them all to one person, or delete them.
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const decided = tasks.filter((t) => perTask[t.id]).length;
  const undecided = tasks.length - decided;
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return tasks.filter((t) => (!q || t.name.toLowerCase().includes(q)) && (!onlyUndecided || !perTask[t.id]));
  }, [tasks, filter, onlyUndecided, perTask]);

  const allPicked = shown.length > 0 && shown.every((t) => picked.has(t.id));
  const togglePick = (id: string) => setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePickAll = () => setPicked(allPicked ? new Set() : new Set(shown.map((t) => t.id)));
  const decidePicked = (to: string) => {
    if (!to || !picked.size) return;
    setPerTask((m) => ({ ...m, ...Object.fromEntries([...picked].map((id) => [id, to])) }));
    setPicked(new Set());
  };
  const box = (on: boolean, onClick: () => void, label: string) => (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} onClick={onClick}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors ${on ? 'border-[#234788] bg-[#234788] text-white' : 'border-gray-300 bg-white hover:border-[#234788]'}`}>
      {on && <Check size={11} strokeWidth={3.5} />}
    </button>
  );

  const giveAll = (to: string) => {
    // Applies to what is on screen, so "filter, then give all" sorts out one batch at a time.
    if (to) setPerTask((m) => ({ ...m, ...Object.fromEntries(shown.map((t) => [t.id, to])) }));
  };

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="space-y-2.5 border-b border-gray-200 bg-gray-50/80 px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5">{box(allPicked, togglePickAll, allPicked ? 'Untick every task shown' : 'Tick every task shown')}</span>
            <div>
            <p className="text-[13px] font-semibold text-gray-900">
              Open tasks <span className="font-normal text-gray-400">{tasks.length}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-gray-500">Give each to someone, or delete it. Tick several to decide them together.</p>
            </div>
          </div>
          <select
            aria-label="Give every shown task to the same person" value=""
            onChange={(e) => giveAll(e.target.value)}
            className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-[12px] text-gray-700 hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
          >
            <option value="">
              {shown.length === tasks.length ? 'Give all to...' : `Give these ${shown.length} to...`}
            </option>
            {candidates.map((c) => (
              <option key={c.user.id} value={c.user.id}>
                {personName(c)}{c.user.id === managerId ? ' (their manager)' : ''}
              </option>
            ))}
          </select>
        </div>
        {tasks.length > FILTER_FROM && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a task"
                aria-label="Find a task"
                className="h-8 w-full rounded-lg border border-gray-300 bg-white pl-7 pr-2 text-[12px] hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              />
            </div>
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-[12px] text-gray-600">
              <input
                type="checkbox" checked={onlyUndecided} onChange={(e) => setOnlyUndecided(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 accent-brand-600"
              />
              Undecided only
            </label>
          </div>
        )}
      </div>

      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#D9E1EF] bg-[#F3F6FB] px-3.5 py-2">
          <span className="text-[12.5px] font-semibold text-[#142B57]">{picked.size} ticked</span>
          <select aria-label="Give the ticked tasks to" value="" onChange={(e) => decidePicked(e.target.value)}
            className="h-8 rounded-lg border border-[#C9D3E6] bg-white px-2 text-[12px] text-gray-800 focus:border-[#234788] focus:outline-none">
            <option value="">Give to…</option>
            {candidates.map((c) => (
              <option key={c.user.id} value={c.user.id}>{personName(c)}{c.user.id === managerId ? ' (their manager)' : ''}</option>
            ))}
          </select>
          <button type="button" onClick={() => decidePicked(DELETE_TASK)}
            className="h-8 rounded-lg border border-red-200 bg-white px-2.5 text-[12px] font-medium text-red-700 hover:bg-red-50">Delete them</button>
          <button type="button" onClick={() => setPicked(new Set())} className="ml-auto text-[12px] font-medium text-gray-500 hover:text-gray-800">Clear</button>
        </div>
      )}

      <ul className="max-h-[22rem] divide-y divide-gray-100 overflow-y-auto overscroll-contain">
        {shown.map((t) => {
          const choice = perTask[t.id] ?? '';
          return (
            <li key={t.id} className={`group flex items-center gap-3 px-3.5 py-2 ${picked.has(t.id) ? 'bg-[#F7F9FC]' : 'hover:bg-gray-50/70'}`}>
              {box(picked.has(t.id), () => togglePick(t.id), `Tick ${t.name}`)}
              <StatusDot status={t.status} size={10} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800" aria-label={t.name}>{t.name}</span>
              <span className="hidden w-14 shrink-0 text-right text-[11px] tabular-nums text-gray-400 sm:block">
                {t.due_date ? formatDue(t.due_date) : ''}
              </span>
              <select
                aria-label={'What happens to ' + t.name} value={choice}
                onChange={(e) => setPerTask((m) => ({ ...m, [t.id]: e.target.value }))}
                className={`h-8 w-44 shrink-0 truncate rounded-lg border px-2 text-[12px] focus:outline-none focus:ring-2 ${
                  choice === DELETE_TASK ? 'border-red-300 bg-red-50 text-red-700 focus:ring-red-500/15'
                  : choice ? 'border-gray-300 bg-white text-gray-800 focus:border-brand-500 focus:ring-brand-500/15'
                  : 'border-dashed border-gray-300 bg-white text-gray-500 focus:border-brand-500 focus:ring-brand-500/15'}`}
              >
                <option value="">Decide...</option>
                {candidates.map((c) => (
                  <option key={c.user.id} value={c.user.id}>
                    Give to {personName(c)}{c.user.id === managerId ? ' (manager)' : ''}
                  </option>
                ))}
                <option value={DELETE_TASK}>Delete it</option>
              </select>
              <Link
                to={`/l/${t.list_id}?task=${t.id}`} target="_blank" rel="noreferrer"
                aria-label={'Open ' + t.name} title="Open in a new tab"
                className="shrink-0 rounded p-1 text-gray-300 no-underline hover:bg-gray-100 hover:text-gray-700 group-hover:text-gray-400"
              >
                <ChevronRight size={14} />
              </Link>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="px-3.5 py-6 text-center text-[12px] text-gray-500">
            {onlyUndecided && !filter ? 'Every task has an answer.' : 'No task matches.'}
          </li>
        )}
      </ul>

      <div className="flex items-center gap-3 border-t border-gray-200 bg-gray-50/80 px-3.5 py-2">
        <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full rounded-full transition-all ${undecided ? 'bg-amber-500' : 'bg-[#234788]'}`}
            style={{ width: `${(decided / tasks.length) * 100}%` }}
          />
        </div>
        <p className={`text-[11px] ${undecided ? 'text-amber-800' : 'text-[#234788]'}`}>
          {undecided ? `${decided} of ${tasks.length} decided` : `All ${tasks.length} decided`}
        </p>
      </div>
    </div>
  );
};

export const RemovePersonSection: React.FC<{
  ws: string; people: Person[]; teams: TeamFull[]; me: string; onChanged: () => void;
}> = ({ ws, people, teams, me, onChanged }) => {
  const [chosen, setChosen] = useState<Person | null>(null);
  const [preview, setPreview] = useState<OffboardPreview | null>(null);
  const [handTo, setHandTo] = useState('');
  // Task id -> the person who takes it, or DELETE_TASK. Empty until somebody decides.
  const [perTask, setPerTask] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState('');
  const [theirTasks, setTheirTasks] = useState<Task[] | null>(null);
  const [movingTeam, setMovingTeam] = useState(false);
  const [moveNote, setMoveNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Their details arrive on their own as soon as they are picked -- what work is on them and
  // which teams. Nobody should have to go and look that up in another tab, or click to see it.
  useEffect(() => {
    setPreview(null);
    setTyped('');
    setError(null);
    setDone(null);
    setTheirTasks(null);
    setPerTask({});
    setMovingTeam(false);
    setMoveNote(null);
    setConfirming(false);
    if (!chosen) return;
    let live = true;
    peopleApi.offboardPreview(ws, chosen.user.id)
      .then((p) => { if (live) { setPreview(p); setHandTo(p.hand_over_to?.id ?? ''); } })
      .catch((e) => { if (live) setError((e as Error).message); });
    peopleApi.tasks(ws, chosen.user.id)
      .then((t) => { if (live) setTheirTasks(t); })
      .catch(() => { if (live) setTheirTasks([]); });
    return () => { live = false; };
  }, [ws, chosen]);

  const theirTeams = chosen ? teams.filter((t) => chosen.team_ids.includes(t.id)) : [];
  const manager = chosen?.manager_id ? people.find((p) => p.user.id === chosen.manager_id) : null;
  const candidates = people.filter((p) => p.user.id !== chosen?.user.id && !p.deactivated_at && p.role !== 'guest');
  const confirmed = !!chosen && typed.trim().toLowerCase() === personName(chosen).trim().toLowerCase();
  /** Tasks with nobody named and no decision to delete. */
  const undecided = (theirTasks ?? []).filter((t) => !perTask[t.id]).length;

  // The server decides; this only repeats what it already said, so nobody types a name into a
  // confirmation for something that was never going to be allowed.
  const blocked = preview?.blocked
    ?? (theirTasks === null ? 'Loading their open tasks…'
      : undecided > 0 ? `Say what happens to ${undecided} more task${undecided === 1 ? '' : 's'}.`
      : preview?.sole_lead_of.length && !handTo
        ? `Choose who takes over — they are the only lead of ${preview.sole_lead_of.join(', ')}.`
        : null);

  const go = async () => {
    if (!chosen || !confirmed || blocked) return;
    setBusy(true);
    setError(null);
    try {
      // Each task as it was decided, before the offboard itself, so the server has nothing left
      // to hand anywhere. Done one at a time and counted, because a failure half way through
      // should say what it managed rather than leaving somebody to guess.
      let given = 0;
      let removed = 0;
      for (const task of theirTasks ?? []) {
        const choice = perTask[task.id];
        if (!choice) continue;
        if (choice === DELETE_TASK) {
          await workApi.deleteTask(task.id);
          removed += 1;
        } else {
          await workApi.updateTask(task.id, { assignees: [choice] });
          given += 1;
        }
      }

      const out = await peopleApi.offboard(ws, chosen.user.id, {
        // Nothing to hand over in bulk: every task already has its answer above. The lead of a
        // Team still passes to one person, which is the one thing that cannot be split up.
        hand_over_to: handTo || null,
        keep_tasks: true,
        apply_leaver_rules: true,
        block_email: false,
        block_reason: null,
      });
      const led = out.teams_led_moved ? `, ${out.teams_led_moved} team${out.teams_led_moved === 1 ? '' : 's'} they led handed on` : '';
      setDone(`${personName(chosen)} is offboarded: ${given} task${given === 1 ? '' : 's'} handed over, `
        + `${removed} deleted, ${out.direct_reports_moved} direct report${out.direct_reports_moved === 1 ? '' : 's'} moved, `
        + `${out.joiner_tasks_deleted} joiner task${out.joiner_tasks_deleted === 1 ? '' : 's'} cleared${led}.`);
      onChanged();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className={card}>
        <p role="status" className="flex items-start gap-2 rounded-lg bg-[#F3F6FB] px-3 py-2.5 text-sm text-[#142B57] ring-1 ring-[#D9E1EF]">
          <Check size={16} className="mt-0.5 shrink-0" /> {done}
        </p>
        <button type="button" onClick={() => { setChosen(null); setDone(null); }} className="mt-4 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50">
          Remove someone else
        </button>
      </div>
    );
  }

  const stage = !chosen ? 1 : confirming ? 3 : 2;
  // What will be done, told once more on the confirmation page.
  const giving = Object.values(perTask).filter((v) => v && v !== DELETE_TASK).length;
  const deleting = Object.values(perTask).filter((v) => v === DELETE_TASK).length;
  const leadTo = handTo ? people.find((p) => p.user.id === handTo) : null;
  return (
    <div className={`${card} space-y-6`}>
      <ol className="flex items-center gap-2 border-b border-[#EEF1F5] pb-4 text-[12px] font-semibold" aria-label="Steps">
        {['Person', 'Their work', 'Confirm'].map((label, i) => {
          const n = i + 1;
          const on = n === stage;
          const past = n < stage;
          return (
            <li key={label} className="flex items-center gap-2">
              {i > 0 && <span className={`h-px w-8 ${past || on ? 'bg-[#234788]' : 'bg-[#E4E8F0]'}`} aria-hidden />}
              <span className={`flex items-center gap-1.5 ${on ? 'text-[#142B57]' : past ? 'text-[#234788]' : 'text-gray-400'}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${on || past ? 'bg-[#234788] text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {past ? <Check size={11} strokeWidth={3} /> : n}
                </span>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      <Step n={1} title="Who are you removing?" done={!!chosen}>
        <PersonPicker people={people.filter((p) => p.user.id !== me)} chosen={chosen} onPick={setChosen} />
        {chosen && (
          <div className="mt-3 space-y-2 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] p-3.5 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-[#EEF2F8] px-1.5 py-px font-semibold text-[#234788]">{accessOf(chosen.role, chosen.user.id, teams)}</span>
              {chosen.designation && <span className="text-gray-600">{chosen.designation}</span>}
              {chosen.department && <span className="text-gray-400">· {chosen.department}</span>}
              {chosen.deactivated_at && <span className="rounded-md bg-gray-100 px-1.5 py-px text-gray-600">Access already off</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-600">
              <span>Reports to <b className="font-semibold text-gray-800">{manager ? personName(manager) : 'nobody'}</b></span>
              <button type="button" onClick={() => setMovingTeam(!movingTeam)} className="inline-flex items-center gap-1 text-left hover:text-[#234788]">
                Teams: <b className="font-semibold text-gray-800">{theirTeams.length ? theirTeams.map((t) => t.name).join(', ') : 'none'}</b>
                <span className="font-semibold text-[#234788]">· Change</span>
              </button>
              {!!preview?.sole_lead_of.length && <span className="text-amber-700">Only lead of <b className="font-semibold">{preview.sole_lead_of.join(', ')}</b></span>}
            </div>
            {movingTeam && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#E4E8F0] bg-white p-2.5">
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
                {moveNote && <span className="w-full text-xs text-[#234788]">{moveNote}</span>}
              </div>
            )}
            {/* Their open tasks and their direct reports were counted here too. The tasks are
                listed, each with its decision, in step 2; the reports move up to this person's
                manager without anyone choosing, so a number for them asked nothing of you. */}
          </div>
        )}
      </Step>

      {chosen && !confirming && (
        <Step n={2} title="What should happen?">
          <div className="rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-3.5 py-3">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-gray-500">Done for you</p>
            <ul className="grid gap-x-6 gap-y-1 text-[12.5px] text-gray-700 sm:grid-cols-2">
              {['Their access is turned off', 'Their reports move up to their manager', 'They leave every Team', 'Joiner tasks follow the leaver rules'].map((line) => (
                <li key={line} className="flex items-center gap-2"><Check size={13} strokeWidth={2.5} className="shrink-0 text-[#234788]" /> {line}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-gray-500">Their comments, logged time and history stay.</p>
          </div>

          {/* A decision for each task, not one for all of them.
              Handing somebody's whole workload to a single colleague is almost never what happens:
              two go to one person, two to another, and one was only ever a note to themselves. The
              old control asked for one name and applied it to everything, so the real sorting out
              happened afterwards, by hand, from memory. */}
          {theirTasks === null ? (
            <p className="mt-4 text-sm text-gray-400"><LinesSkeleton /></p>
          ) : theirTasks.length > 0 ? (
            <TaskDecisions
              key={chosen.user.id} tasks={theirTasks} perTask={perTask} setPerTask={setPerTask}
              candidates={candidates} managerId={preview?.hand_over_to?.id}
            />
          ) : (
            <p className="mt-4 text-sm text-gray-500">They have no open tasks to hand over.</p>
          )}

          {!!preview?.sole_lead_of.length && (
            <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-700">
              Hand the lead of {preview.sole_lead_of.join(', ')} to
              <select
                aria-label="Hand the team lead to" value={handTo} onChange={(e) => setHandTo(e.target.value)}
                className="h-9 rounded-lg border border-gray-300 px-2 text-sm hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              >
                <option value="">Choose someone</option>
                {candidates.map((c) => (
                  <option key={c.user.id} value={c.user.id}>
                    {personName(c)}{c.user.id === preview?.hand_over_to?.id ? ' (their manager)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Everything but the name check: Continue opens the confirmation once each task has an answer. */}
          {blocked && <p className="mt-3 text-xs text-amber-700">{blocked}</p>}
          <div className="mt-4 flex items-center gap-2">
            <button type="button" onClick={() => setConfirming(true)} disabled={!!blocked}
              className="flex items-center gap-1.5 rounded-lg bg-[#234788] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1B3A72] disabled:cursor-not-allowed disabled:opacity-40">
              Continue <ChevronRight size={15} />
            </button>
            <button type="button" onClick={() => setChosen(null)} className="rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100">Cancel</button>
          </div>
        </Step>
      )}

      {chosen && confirming && (
        <Step n={3} title="Confirm">
          <ul className="mb-3 space-y-1 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-3.5 py-3 text-[12.5px] text-gray-700">
            <li><b className="font-semibold text-[#142B57]">{personName(chosen)}</b> is offboarded and their access turned off.</li>
            {giving > 0 && <li>{giving} task{giving === 1 ? '' : 's'} handed over to the people you chose.</li>}
            {deleting > 0 && <li className="text-red-700">{deleting} task{deleting === 1 ? '' : 's'} deleted.</li>}
            {leadTo && !!preview?.sole_lead_of.length && <li>The lead of {preview.sole_lead_of.join(', ')} goes to {personName(leadTo)}.</li>}
          </ul>
          <p className="mb-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            Hand-overs and deleted tasks can't be undone. Access can be turned back on later from their profile.
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
                    ? 'border-[#234788] focus:border-[#234788] focus:ring-[#234788]/15'
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
              <UserX size={15} /> {busy ? 'Working…' : 'Offboard them'}
            </button>
            <button type="button" onClick={() => { setConfirming(false); setTyped(''); }} className="rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100">Back</button>
          </div>
        </Step>
      )}
    </div>
  );
};
