// What a Manager can do to several people of their team at once, from My team: remind them, give
// them a Space, Folder or List, or hand their open work to someone else (cover for leave).
//
// Each is a short dialog that names who it is for, so nothing happens to the wrong people by a
// stray click. The server checks every step again -- a Manager can only hand work around inside
// their own team, and only share places they may share.
import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, Bell, Check, Folder, KeyRound, List as ListIcon, Search, X } from 'lucide-react';
import { Modal } from '../dashboards/dialogs';
import { Avatar } from '../ui';
import { useWork } from '../WorkContext';
import { workApi, type FolderNode, type Level, type LocationKind } from '../api';
import { collabApi } from '../collabApi';
import { notify } from '../../components/notify';
import { peopleApi, personName, type Person } from './peopleApi';

/** The people a dialog is about, as a row of faces and a name or a count. */
const Who: React.FC<{ people: Person[] }> = ({ people }) => (
  <div className="flex items-center gap-2 rounded-lg border border-[#E4E8F0] bg-[#F7F9FC] px-3 py-2">
    <span className="flex -space-x-1.5">{people.slice(0, 5).map((p) => <Avatar key={p.user.id} user={p.user} size={22} />)}</span>
    <span className="min-w-0 truncate text-[13px] text-gray-700">
      {people.length === 1 ? <b className="font-semibold text-gray-900">{personName(people[0])}</b>
        : <><b className="font-semibold text-gray-900">{people.length} people</b>: {people.slice(0, 3).map(personName).join(', ')}{people.length > 3 ? ` and ${people.length - 3} more` : ''}</>}
    </span>
  </div>
);

const Footer: React.FC<{ onCancel: () => void; onGo: () => void; label: string; busy: boolean; disabled?: boolean }> = ({ onCancel, onGo, label, busy, disabled }) => (
  <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
    <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
    <button type="button" onClick={onGo} disabled={busy || disabled}
      className="rounded-lg bg-[#234788] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#1B3A72] disabled:opacity-50">{busy ? 'Working…' : label}</button>
  </div>
);

/** Run the dialog's action once, with its error shown rather than lost. */
function useRun(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await work(); onDone(); } catch (e) { notify.error(e); } finally { setBusy(false); }
  };
  return { busy, run };
}

// --- remind ---------------------------------------------------------------------------------------

const NUDGES = [
  "Please log yesterday's time in your timesheet",
  "Please send last week's timesheet",
  'Please update the status of your open tasks',
  'Please complete your monthly review on the PMS (pms.verveadvisory.com) and mark it done in Verveflow',
];

export const RemindDialog: React.FC<{ ws: string; people: Person[]; onClose: () => void }> = ({ ws, people, onClose }) => {
  const [pick, setPick] = useState(NUDGES[0]);
  const [own, setOwn] = useState('');
  const title = pick === 'own' ? own.trim() : pick;
  const { busy, run } = useRun(onClose);
  const send = () => run(async () => {
    // A minute from now, so it arrives as a reminder rather than one already past.
    const at = new Date(Date.now() + 60_000).toISOString();
    await Promise.all(people.map((p) => collabApi.addReminder(ws, { title, remind_at: at, user_id: p.user.id })));
    notify.ok(people.length === 1 ? `Reminded ${personName(people[0])}` : `Reminded ${people.length} people`);
  });
  return (
    <Modal label="Send a reminder" title={<span className="flex items-center gap-2"><Bell size={16} className="text-[#234788]" /> Send a reminder</span>} onClose={onClose}
      footer={<Footer onCancel={onClose} onGo={send} label="Send reminder" busy={busy} disabled={!title} />}>
      <div className="space-y-3 px-5 py-4">
        <Who people={people} />
        <div className="space-y-1" role="radiogroup" aria-label="Reminder">
          {[...NUDGES, 'own'].map((n) => (
            <label key={n} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-colors ${pick === n ? 'border-[#B9C7E2] bg-[#F3F6FB] text-gray-900' : 'border-transparent text-gray-700 hover:bg-gray-50'}`}>
              <input type="radio" name="nudge" checked={pick === n} onChange={() => setPick(n)} className="accent-[#234788]" />
              {n === 'own' ? 'Write your own' : n}
            </label>
          ))}
          {pick === 'own' && (
            <input autoFocus value={own} onChange={(e) => setOwn(e.target.value)} maxLength={200} placeholder="What should they do?"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-[#234788] focus:outline-none" />
          )}
        </div>
      </div>
    </Modal>
  );
};

// --- give access ----------------------------------------------------------------------------------

type Place = { kind: LocationKind; id: string; name: string; path: string };

/** Every Space, Folder and List the viewer may share, with where it sits. */
function usePlaces(): Place[] {
  const { hierarchy } = useWork();
  return useMemo(() => {
    const out: Place[] = [];
    const can = (level: Level) => level === 'full';
    const folder = (f: FolderNode, path: string) => {
      if (f.archived) return;
      if (can(f.permission_level)) out.push({ kind: 'folder', id: f.id, name: f.name, path });
      f.lists.forEach((l) => !l.archived && can(l.permission_level) && out.push({ kind: 'list', id: l.id, name: l.name, path: `${path} / ${f.name}` }));
      f.folders.forEach((c) => folder(c, `${path} / ${f.name}`));
    };
    (hierarchy?.spaces ?? []).forEach((s) => {
      if (s.archived) return;
      if (can(s.permission_level)) out.push({ kind: 'space', id: s.id, name: s.name, path: '' });
      s.folders.forEach((f) => folder(f, s.name));
      s.lists.forEach((l) => !l.archived && can(l.permission_level) && out.push({ kind: 'list', id: l.id, name: l.name, path: s.name }));
    });
    return out;
  }, [hierarchy]);
}

const KIND_ICON: Record<LocationKind, React.ElementType> = { space: KeyRound, folder: Folder, list: ListIcon };

export const AccessDialog: React.FC<{ people: Person[]; onClose: () => void }> = ({ people, onClose }) => {
  const places = usePlaces();
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<Place | null>(null);
  const [level, setLevel] = useState<Level>('edit');
  const { busy, run } = useRun(onClose);
  const shown = places.filter((p) => `${p.name} ${p.path}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60);
  const give = () => run(async () => {
    if (!chosen) return;
    await Promise.all(people.map((p) => workApi.share(chosen.kind, chosen.id, { user_id: p.user.id }, level)));
    notify.ok(`${people.length === 1 ? personName(people[0]) : `${people.length} people`} can now open ${chosen.name}`);
  });
  return (
    <Modal label="Give access" title={<span className="flex items-center gap-2"><KeyRound size={16} className="text-[#234788]" /> Give access</span>} onClose={onClose}
      footer={<Footer onCancel={onClose} onGo={give} label="Give access" busy={busy} disabled={!chosen} />}>
      <div className="space-y-3 px-5 py-4">
        <Who people={people} />
        <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 focus-within:border-[#234788]">
          <Search size={14} className="text-gray-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a Space, Folder or List" aria-label="Find a place" className="w-full text-sm focus:outline-none" />
        </label>
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-gray-100" role="listbox" aria-label="Places">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-xs text-gray-400">{places.length ? 'Nothing matches.' : 'There is nowhere you can share yet.'}</li>}
          {shown.map((p) => {
            const on = chosen?.id === p.id;
            const Icon = KIND_ICON[p.kind];
            return (
              <li key={`${p.kind}-${p.id}`}>
                <button type="button" role="option" aria-selected={on} onClick={() => setChosen(p)}
                  className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] ${on ? 'bg-[#F3F6FB]' : 'hover:bg-gray-50'}`}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#EEF2F8] text-[#234788]"><Icon size={13} /></span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${on ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{p.name}</span>
                    <span className="block truncate text-[11px] text-gray-400">{p.path || 'Space'}</span>
                  </span>
                  {on && <Check size={14} className="shrink-0 text-[#234788]" />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-2 text-[13px] text-gray-600">
          They can
          <span className="flex rounded-lg border border-gray-200 bg-white p-0.5" role="radiogroup" aria-label="Access level">
            {([['view', 'View'], ['comment', 'Comment'], ['edit', 'Edit']] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={level === v} onClick={() => setLevel(v)}
                className={`rounded-md px-2.5 py-0.5 text-xs font-medium ${level === v ? 'bg-[#234788] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{l}</button>
            ))}
          </span>
        </div>
      </div>
    </Modal>
  );
};

// --- hand over work -------------------------------------------------------------------------------

export const HandOverDialog: React.FC<{ ws: string; people: Person[]; team: Person[]; week: Map<string, { planned?: number; capacity?: number }>; onClose: () => void; onDone: () => void }> = ({
  ws, people, team, week, onClose, onDone,
}) => {
  const from = new Set(people.map((p) => p.user.id));
  // Who can take it: the rest of the team, the freest first, so the obvious choice is on top.
  const takers = team.filter((p) => !from.has(p.user.id) && !p.deactivated_at).sort((a, b) => {
    const room = (p: Person) => { const w = week.get(p.user.id); return w && w.capacity ? (w.capacity - (w.planned ?? 0)) / w.capacity : -1; };
    return room(b) - room(a);
  });
  const [to, setTo] = useState<string | null>(null);
  const { busy, run } = useRun(() => { onDone(); onClose(); });
  const go = () => run(async () => {
    if (!to) return;
    const out = await peopleApi.handOver(ws, [...from], to);
    const name = personName(team.find((p) => p.user.id === to)!);
    notify.ok(out.moved ? `Moved ${out.moved} open task${out.moved === 1 ? '' : 's'} to ${name}` : 'There was no open work to move');
    if (out.skipped.length) notify.info(`${out.skipped.length} task${out.skipped.length === 1 ? ' was' : 's were'} left where they are: you can't edit ${out.skipped.length === 1 ? 'it' : 'them'}.`);
  });
  return (
    <Modal label="Hand over open work" title={<span className="flex items-center gap-2"><ArrowRightLeft size={16} className="text-[#234788]" /> Hand over open work</span>} onClose={onClose}
      footer={<Footer onCancel={onClose} onGo={go} label="Move their open tasks" busy={busy} disabled={!to} />}>
      <div className="space-y-3 px-5 py-4">
        <Who people={people} />
        <p className="text-[13px] text-gray-600">Every open task of theirs moves to the person you pick. Finished work and their logged time stay with them.</p>
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-gray-100" role="listbox" aria-label="Who takes it over">
          {takers.map((p) => {
            const w = week.get(p.user.id);
            const on = to === p.user.id;
            return (
              <li key={p.user.id}>
                <button type="button" role="option" aria-selected={on} onClick={() => setTo(p.user.id)}
                  className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] ${on ? 'bg-[#F3F6FB]' : 'hover:bg-gray-50'}`}>
                  <Avatar user={p.user} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${on ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{personName(p)}</span>
                    <span className="block truncate text-[11px] text-gray-400">{p.designation ?? ''}</span>
                  </span>
                  {w && (w.capacity ?? 0) > 0 && <WeekLabel planned={w.planned ?? 0} capacity={w.capacity ?? 0} />}
                  {on && <Check size={14} className="shrink-0 text-[#234788]" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
};

// --- the week, as a word ----------------------------------------------------------------------------

/** How full someone's week is: free (under 60%), busy, nearly full (90%+) or over. */
export type Load = 'free' | 'busy' | 'full' | 'over' | 'none';
export const loadOf = (planned: number, capacity: number): Load => {
  if (!capacity) return 'none';
  const r = planned / capacity;
  return r > 1 ? 'over' : r >= 0.9 ? 'full' : r >= 0.6 ? 'busy' : 'free';
};
const hrs = (s: number) => `${Math.round(s / 360) / 10}h`.replace('.0h', 'h');

export const WeekLabel: React.FC<{ planned: number; capacity: number }> = ({ planned, capacity }) => {
  const load = loadOf(planned, capacity);
  const text = load === 'over' ? `Over by ${hrs(planned - capacity)}` : load === 'free' ? `${hrs(capacity - planned)} free` : `${hrs(capacity - planned)} left`;
  const tone = load === 'over' ? 'bg-red-50 text-red-700' : load === 'full' ? 'bg-amber-50 text-amber-700' : load === 'free' ? 'bg-sky-50 text-sky-700' : 'bg-[#EEF2F8] text-[#234788]';
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`}>{text}</span>;
};

/** The bar in the table: planned against what they can work, with the word beside it. */
export const WeekBar: React.FC<{ planned: number; capacity: number }> = ({ planned, capacity }) => {
  if (!capacity) return <span className="text-xs text-gray-300">No hours set</span>;
  const load = loadOf(planned, capacity);
  const fill = load === 'over' ? '#DC2626' : load === 'full' ? '#D97706' : load === 'free' ? '#0284C7' : '#234788';
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center justify-between gap-2 text-[12px]">
        <span className="tabular-nums text-gray-700"><b className="font-semibold text-gray-900">{hrs(planned)}</b> of {hrs(capacity)}</span>
        <WeekLabel planned={planned} capacity={capacity} />
      </span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.round((planned / capacity) * 100))}%`, backgroundColor: fill }} />
      </span>
    </span>
  );
};

// --- the bar along the bottom -----------------------------------------------------------------------

export const BulkBar: React.FC<{ count: number; onRemind: () => void; onAccess: () => void; onHandOver: () => void; onClear: () => void }> = ({
  count, onRemind, onAccess, onHandOver, onClear,
}) => (
  <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
    <div role="toolbar" aria-label="With the selected people"
      className="pointer-events-auto flex items-center gap-1 rounded-xl border border-[#1B3A72] bg-[#234788] p-1.5 pl-3 text-sm text-white shadow-[0_12px_32px_-12px_rgba(20,43,87,0.55)]">
      <span className="mr-2 font-semibold tabular-nums">{count} selected</span>
      {([[onRemind, Bell, 'Remind'], [onAccess, KeyRound, 'Give access'], [onHandOver, ArrowRightLeft, 'Hand over work']] as const).map(([fn, Icon, label]) => (
        <button key={label} type="button" onClick={fn} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium text-white/95 hover:bg-white/10">
          <Icon size={14} /> {label}
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-white/20" />
      <button type="button" onClick={onClear} aria-label="Clear the selection" className="rounded-lg p-1.5 text-white/80 hover:bg-white/10"><X size={15} /></button>
    </div>
  </div>
);
