import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Clock, FileSpreadsheet, History, ListChecks, RotateCcw, Save, ShieldBan, ShieldCheck, Trash2,
  UserMinus, UserPlus, Wallet, X,
} from 'lucide-react';
import { Avatar, Portal } from '../ui';
import { DrawInPlace } from './inlineDialog';
import { peopleApi, type AuditEvent, type BlockedEmail, type JoinerPlan, type JoinerRule, type Person, type TeamFull } from './peopleApi';
import { HubContext, useHub, type Hub } from './TeamsHub';
import { useMe, useWork } from '../WorkContext';
import type { Role } from '../api';
import { AddPersonDialog } from './PersonDialogs';
import { ImportPeopleDialog } from './AdminDialogs';
import { RemovePersonSection } from './RemovePerson';
import { RunningCosts } from './RunningCosts';
import { WorkingHoursSection } from './WorkingHours';
import { ask } from '../../components/ask';
import { FEATURES } from '../../config/features';

const card = 'rounded-xl border border-gray-200 bg-white p-5';
const input = 'rounded-md border border-gray-300 px-2 py-1.5 text-sm';
const primary = 'flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';

/** Set while a section is shown inside an Admin window, which already carries its title. */
const InWindow = React.createContext(false);

const Section: React.FC<{ id: string; icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }> = ({ id, icon, title, hint, children }) => {
  const inWindow = React.useContext(InWindow);
  if (inWindow) return <section id={id} aria-label={title}>{children}</section>;
  return (
    <section id={id} aria-label={title} className={card}>
      <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">{icon}{title}</h3>
      <p className="mb-4 mt-0.5 text-sm text-gray-500">{hint}</p>
      {children}
    </section>
  );
};

/**
 * The people, teams and roles the Admin sections read, for wherever Admin is opened from: the
 * /admin page, or the launcher in the sidebar. The sections were written against the Teams hub,
 * so this supplies the same shape.
 */
function useAdminHub(): { hub: Hub; error: string | null; ready: boolean } {
  const { workspace, hierarchy, refresh } = useWork();
  const me = useMe();
  const [people, setPeople] = useState<Person[]>([]);
  const [teams, setTeams] = useState<TeamFull[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ws = workspace?.id ?? '';
  const role = hierarchy?.role;
  const isAdmin = role === 'owner' || role === 'admin';

  const reload = useCallback(async () => {
    if (!ws || !isAdmin) return;
    try {
      const [p, t] = await Promise.all([peopleApi.list(ws), peopleApi.teams(ws)]);
      setPeople(p);
      setTeams(t);
    } catch (e) { setError((e as Error).message); }
  }, [ws, isAdmin]);
  useEffect(() => { reload(); }, [reload]);

  const hub: Hub = useMemo(() => ({
    ws, people, teams, me: me ?? '', isAdmin,
    // Only the owner makes admins; nobody makes a second owner.
    roles: (role === 'owner' ? ['member', 'admin'] : ['member']) as Role[],
    reload: async () => { await reload(); refresh(); },
    openPerson: () => undefined,
  }), [ws, people, teams, me, isAdmin, role, reload, refresh]);
  return { hub, error, ready: !!workspace };
}

/** Admin as its own page, for the /admin address and bookmarks to it. */
export const AdminStandalone: React.FC = () => {
  const { hub, error, ready } = useAdminHub();
  if (!ready) return null;
  if (!hub.isAdmin) return <p className="p-10 text-center text-sm text-gray-500">Only owners and admins can see this page.</p>;
  return (
    <HubContext.Provider value={hub}>
      {error && <p className="mx-auto mt-4 max-w-5xl rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <AdminPage />
    </HubContext.Provider>
  );
};

// --- the options ---------------------------------------------------------------------------------------------

/** Everything an admin can do, one option each. Each opens on its own, when it is wanted. */
type Action = 'add' | 'import' | 'remove' | 'hours' | 'costs' | 'audit' | 'blocked' | 'joiner';

interface Option {
  key: Action; title: string; line: string; Icon: React.ElementType;
  tone: 'brand' | 'sky' | 'emerald' | 'violet' | 'amber' | 'slate' | 'red';
  group: 'People' | 'Workspace';
}

const TONES: Record<Option['tone'], { chip: string; ring: string }> = {
  brand: { chip: 'bg-brand-50 text-brand-600', ring: 'hover:border-brand-300 hover:ring-brand-500/10' },
  sky: { chip: 'bg-sky-50 text-sky-600', ring: 'hover:border-sky-300 hover:ring-sky-500/10' },
  emerald: { chip: 'bg-emerald-50 text-emerald-600', ring: 'hover:border-emerald-300 hover:ring-emerald-500/10' },
  violet: { chip: 'bg-violet-50 text-violet-600', ring: 'hover:border-violet-300 hover:ring-violet-500/10' },
  amber: { chip: 'bg-amber-50 text-amber-600', ring: 'hover:border-amber-300 hover:ring-amber-500/10' },
  slate: { chip: 'bg-slate-100 text-slate-600', ring: 'hover:border-slate-300 hover:ring-slate-500/10' },
  red: { chip: 'bg-red-50 text-red-600', ring: 'hover:border-red-300 hover:ring-red-500/10' },
};

const OPTIONS: Option[] = [
  { key: 'add', title: 'Add a person', line: 'Set someone up with their profile', Icon: UserPlus, tone: 'brand', group: 'People' },
  { key: 'remove', title: 'Remove a person', line: 'Offboard someone and hand over their work', Icon: UserMinus, tone: 'red', group: 'People' },
  { key: 'import', title: 'Import from a spreadsheet', line: 'Add or update many people at once', Icon: FileSpreadsheet, tone: 'emerald', group: 'People' },
  { key: 'hours', title: 'Working hours', line: 'Days and hours for the company, Teams and people', Icon: Clock, tone: 'amber', group: 'People' },
  { key: 'audit', title: 'Audit logs', line: 'Who changed what, and when', Icon: History, tone: 'slate', group: 'Workspace' },
  { key: 'costs', title: 'Running costs', line: 'What the application costs to run', Icon: Wallet, tone: 'violet', group: 'Workspace' },
];

/** The options this workspace offers: the six, plus two that come back with their flags. */
const options = (): Option[] => [
  ...OPTIONS,
  ...(FEATURES.blockedAddresses ? [{ key: 'blocked', title: 'Blocked addresses', line: 'Emails that may not be added back', Icon: ShieldBan, tone: 'red', group: 'Workspace' } as Option] : []),
  ...(FEATURES.joinerChecklistSection ? [{ key: 'joiner', title: 'Joiner checklist', line: 'Tasks made for each new joiner', Icon: ListChecks, tone: 'emerald', group: 'Workspace' } as Option] : []),
];

// --- the full window -----------------------------------------------------------------------------------------

/**
 * One option, opened across nearly the whole screen: room for the audit log's history, the costs
 * tables and the offboarding steps, rather than a pop-up that scrolls inside itself.
 */
const AdminWindow: React.FC<{ action: Action; onBack: () => void; onClose: () => void }> = ({ action, onBack, onClose }) => {
  const { ws, people, teams, me, roles, reload } = useHub();
  const option = options().find((o) => o.key === action)!;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBack]);
  return (
    <Portal>
      <div className="admin-fade fixed inset-0 z-[125] bg-gray-900/40 backdrop-blur-sm" onMouseDown={onClose} />
      <div
        role="dialog" aria-modal="true" aria-label={option.title}
        className="admin-grow fixed inset-2 z-[126] flex flex-col overflow-hidden rounded-2xl bg-gray-50 shadow-2xl ring-1 ring-black/5 sm:inset-6 lg:inset-x-[max(1.5rem,calc((100vw-80rem)/2))]"
      >
        <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={onBack} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
            <ChevronLeft size={16} /> All options
          </button>
          <span className="h-5 w-px bg-gray-200" aria-hidden />
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TONES[option.tone].chip}`}><option.Icon size={17} /></span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-gray-900">{option.title}</h2>
            <p className="hidden truncate text-xs text-gray-500 sm:block">{option.line}</p>
          </div>
          <button type="button" aria-label="Close Admin" onClick={onClose} className="ml-auto rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={18} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          <div className="mx-auto max-w-5xl rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
            <DrawInPlace.Provider value>
              <InWindow.Provider value>
                {action === 'add' && <AddPersonDialog ws={ws} people={people} teams={teams} roles={roles} onClose={onBack} onDone={() => { reload(); }} />}
                {action === 'import' && <ImportPeopleDialog ws={ws} onClose={onBack} onDone={() => { reload(); }} />}
                {action === 'remove' && <RemovePersonSection ws={ws} people={people} teams={teams} me={me} onChanged={reload} />}
                {action === 'hours' && <WorkingHoursSection ws={ws} />}
                {action === 'costs' && <RunningCosts ws={ws} />}
                {action === 'audit' && <AuditSection ws={ws} />}
                {action === 'blocked' && <BlockedSection ws={ws} />}
                {action === 'joiner' && <JoinerPlanSection ws={ws} />}
              </InWindow.Provider>
            </DrawInPlace.Provider>
          </div>
        </div>
      </div>
    </Portal>
  );
};

// --- the launcher, from the sidebar --------------------------------------------------------------------------

/**
 * What "Admin" in the sidebar opens: the options in a pop-up, and the chosen one in a full window.
 * Choosing goes straight from one to the other; "All options" comes back.
 */
export const AdminLauncher: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { hub, error } = useAdminHub();
  const [action, setAction] = useState<Action | null>(null);
  if (!hub.isAdmin) return null;
  return (
    <HubContext.Provider value={hub}>
      {action
        ? <AdminWindow action={action} onBack={() => setAction(null)} onClose={onClose} />
        : <AdminMenu error={error} onPick={setAction} onClose={onClose} />}
    </HubContext.Provider>
  );
};

const AdminMenu: React.FC<{ error: string | null; onPick: (a: Action) => void; onClose: () => void }> = ({ error, onPick, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <Portal>
      <div className="admin-fade fixed inset-0 z-[125] flex items-center justify-center bg-gray-900/40 p-4 backdrop-blur-sm" onMouseDown={onClose}>
        <div
          role="dialog" aria-modal="true" aria-label="Admin"
          onMouseDown={(e) => e.stopPropagation()}
          className="admin-pop flex max-h-[90vh] w-[min(94vw,46rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        >
          <header className="bg-gradient-to-br from-brand-600 to-brand-700 px-6 pb-5 pt-5 text-white">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15"><ShieldCheck size={20} /></span>
              <div>
                <h2 className="text-lg font-semibold">Admin</h2>
                <p className="text-sm text-white/75">What would you like to do?</p>
              </div>
              <button type="button" aria-label="Close" onClick={onClose} className="ml-auto rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"><X size={18} /></button>
            </div>
          </header>
          {error && <p className="mx-6 mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6">
            {(['People', 'Workspace'] as const).map((group) => (
              <section key={group} aria-label={group} className="mb-3 last:mb-0">
                <h3 className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{group}</h3>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {options().filter((o) => o.group === group).map((o) => (
                    <li key={o.key}>
                      <button type="button" onClick={() => onPick(o.key)}
                        className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-gray-50">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONES[o.tone].chip}`}><o.Icon size={18} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-gray-900">{o.title}</span>
                          <span className="block truncate text-xs text-gray-500">{o.line}</span>
                        </span>
                        <ChevronRight size={16} className="shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-500" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </Portal>
  );
};

// --- the /admin page -----------------------------------------------------------------------------------------

/** The same options as a page, for the /admin address. Choosing one opens the same full window. */
export const AdminPage: React.FC = () => {
  const { isAdmin } = useHub();
  const [open, setOpen] = useState<Action | null>(null);
  if (!isAdmin) return <p className="p-10 text-center text-sm text-gray-500">Only owners and admins can see this page.</p>;
  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br from-white via-white to-brand-50/60 p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm"><ShieldCheck size={22} /></span>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-gray-900">Admin</h2>
            <p className="text-sm text-gray-500">Manage people, access and the workspace.</p>
          </div>
        </div>
      </div>

      {(['People', 'Workspace'] as const).map((group) => (
        <section key={group} aria-label={group} className="mt-7">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{group}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {options().filter((o) => o.group === group).map((o) => (
              <button
                key={o.key} type="button" onClick={() => setOpen(o.key)}
                className={`group flex flex-col items-start gap-3 rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-4 ${TONES[o.tone].ring}`}
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${TONES[o.tone].chip}`}><o.Icon size={19} /></span>
                <span>
                  <span className="block text-[15px] font-semibold text-gray-900">{o.title}</span>
                  <span className="mt-0.5 block text-[13px] text-gray-500">{o.line}</span>
                </span>
                <span className="mt-auto flex items-center gap-1 text-xs font-medium text-gray-400 group-hover:text-gray-700">Open <ChevronRight size={13} /></span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {open && <AdminWindow action={open} onBack={() => setOpen(null)} onClose={() => setOpen(null)} />}
    </div>
  );
};

// --- barred addresses ----------------------------------------------------------------------------------------

/**
 * Who may never be added back.
 *
 * Turning access off stops someone today and removing them takes away the row that said so.
 * Neither stops the next admin adding them again, or an old spreadsheet import doing it without
 * anyone noticing. A barred address is refused at all three, and the refusal names who barred it.
 */
const BlockedSection: React.FC<{ ws: string }> = ({ ws }) => {
  const [rows, setRows] = useState<BlockedEmail[] | null>(null);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { peopleApi.blocked(ws).then(setRows).catch((e) => setError(e.message)); }, [ws]);

  const add = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setRows(await peopleApi.block(ws, email.trim(), reason.trim() || null));
      setEmail('');
      setReason('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const lift = async (row: BlockedEmail) => {
    if (!await ask.confirm({
      title: `Lift the block on ${row.email}?`,
      body: 'They can be added to the workspace again. It does not restore their old access — they come back as a new person.',
      confirmLabel: 'Lift the block',
    })) return;
    try { setRows(await peopleApi.unblock(ws, row.id)); } catch (e) { setError((e as Error).message); }
  };

  return (
    <Section id="blocked" icon={<ShieldBan size={17} className="text-brand-600" />} title="Blocked addresses"
      hint="Addresses that may not be added to this workspace — by hand, by invitation or by spreadsheet import. Blocking someone still here also turns their access off and disables their sign-in.">
      <div className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Address to block" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com" className={`${input} w-64`}
          />
          <input
            aria-label="Why" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
            placeholder="Why (optional)" className={`${input} min-w-0 flex-1`}
          />
          <button type="button" onClick={add} disabled={busy || !email.trim()} className={primary}><ShieldBan size={14} /> Block</button>
        </div>
        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {rows === null ? <p className="mt-4 text-sm text-gray-400">Loading…</p>
          : rows.length === 0 ? <p className="mt-4 text-sm text-gray-500">Nobody is blocked. Offboarding someone offers to block them at the same time.</p> : (
            <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">{row.email}</span>
                    <span className="block truncate text-xs text-gray-500">
                      {row.reason ? `${row.reason} · ` : ''}
                      blocked {new Date(row.blocked_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                      {row.blocked_by ? ` by ${row.blocked_by.display_name || row.blocked_by.email}` : ''}
                    </span>
                  </span>
                  <button type="button" onClick={() => lift(row)} title={`Lift the block on ${row.email}`}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-red-600">
                    <Trash2 size={13} /> Lift
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </Section>
  );
};

// --- joiner checklist plan --------------------------------------------------------------------------------------

const WHEN: [string, string][] = [
  ['all', 'Everyone'], ['not_intern', 'Everyone except interns'], ['takes_interviews', 'People who take interviews'],
  ['reviewers', 'Reviewers (by designation)'], ['has_birthday', 'Has a date of birth'], ['married', 'Married (has an anniversary)'],
];
const SCHEDULE: [string, string][] = [
  ['monthly', 'Monthly, due month-end'], ['twice_monthly', 'Every two weeks'], ['induction', 'Once, the Tuesday after joining'], ['once', 'Once, a week after joining'],
  ['yearly_birthday', 'Yearly on their birthday'], ['yearly_joining', 'Yearly on their joining date'], ['yearly_marriage', 'Yearly on their anniversary'],
];
const LEAVER: [string, string][] = [['delete', 'Delete'], ['retain_birthday', 'Keep as “Ex – Name”'], ['keep', 'Keep as is']];
const WHO: [string, string][] = [['person', 'The joiner'], ['manager', 'Their manager'], ['hr', 'HR']];

/** What a rule does, in words, for the row you read rather than the row you edit. */
function describeRule(rule: JoinerRule): string {
  const when = SCHEDULE.find(([v]) => v === rule.schedule)?.[1] ?? rule.schedule;
  const place = rule.where.folder !== undefined
    ? `their team's List in ${rule.where.folder || '—'}`
    : rule.where.list || '—';
  const who = (rule.assignees ?? []).map((a) => ({ person: 'the joiner', manager: 'their manager', hr: 'HR' }[a] ?? a));
  const people = who.length === 0 ? 'nobody'
    : who.length === 1 ? who[0]
    : `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}`;
  return `${when}, in ${place} · for ${people}`;
}

/** Who it is for, when that is not everybody -- the reason a joiner might not get this one. */
function limitOf(rule: JoinerRule): string | null {
  if (rule.when === 'all') return null;
  return WHEN.find(([v]) => v === rule.when)?.[1] ?? rule.when;
}

const RuleRow: React.FC<{ rule: JoinerRule; onChange: (r: JoinerRule) => void }> = ({ rule: raw, onChange }) => {
  const [open, setOpen] = useState(false);
  const rule = { ...raw, checklist: raw.checklist ?? [], assignees: raw.assignees ?? [] };
  const set = (p: Partial<JoinerRule>) => onChange({ ...rule, ...p });
  const whereKind = rule.where.folder !== undefined ? 'folder' : 'list';
  const limit = limitOf(rule);
  return (
    <li className={`overflow-hidden rounded-xl border transition-colors ${
      rule.enabled ? 'border-gray-200 bg-white' : 'border-dashed border-gray-200 bg-gray-50/60'}`} aria-label={`Rule ${rule.key}`}>
      {/* The line you read. The tick turns the rule off without opening anything. */}
      <div className="flex items-start gap-3 px-3.5 py-2.5">
        <input
          type="checkbox" checked={rule.enabled} aria-label={`Use ${rule.key}`}
          onChange={(e) => set({ enabled: e.target.checked })}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-brand-600"
        />
        {/* The name has the line to itself. The detail sits under it and wraps, rather than
            squeezing the one thing you are scanning for into an ellipsis. */}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-sm font-medium ${rule.enabled ? 'text-gray-900' : 'text-gray-500'}`}>
              {rule.name.replace('{name}', 'their name')}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500">
              <span>{describeRule(rule)}</span>
              {rule.checklist.length > 0 && <span className="text-gray-400">· {rule.checklist.length} steps</span>}
              <span className="text-gray-400">
                · {rule.leaver === 'delete' ? 'deleted when they leave' : rule.leaver === 'retain_birthday' ? 'kept as “Ex – …”' : 'kept when they leave'}
              </span>
              {limit && (
                <span className="rounded-full bg-amber-50 px-1.5 py-px text-[11px] text-amber-800" title="Not everyone gets this one">
                  {limit}
                </span>
              )}
            </span>
          </span>
          <ChevronRight size={15} className={`mt-0.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {/* Everything else, only on the rule you opened. */}
      {open && (
      <div className="space-y-2 border-t border-gray-100 bg-gray-50/70 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={`Task name for ${rule.key}`} value={rule.name} onChange={(e) => set({ name: e.target.value })} className={`min-w-60 flex-1 ${input}`} />
        <select aria-label={`Who gets ${rule.key}`} value={rule.when} onChange={(e) => set({ when: e.target.value })} className={input}>{WHEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <select aria-label={`Where ${rule.key} goes`} value={whereKind} onChange={(e) => set({ where: e.target.value === 'folder' ? { folder: rule.where.list ?? '' } : { list: rule.where.folder ?? '' } })} className={input}>
          <option value="folder">In their team's List inside Folder</option><option value="list">In the List</option>
        </select>
        <input aria-label={`Folder or List for ${rule.key}`} value={rule.where.folder ?? rule.where.list ?? ''} onChange={(e) => set({ where: whereKind === 'folder' ? { folder: e.target.value } : { list: e.target.value } })} className={`w-56 ${input}`} />
        <select aria-label={`Schedule for ${rule.key}`} value={rule.schedule} onChange={(e) => set({ schedule: e.target.value })} className={input}>{SCHEDULE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <label className="flex items-center gap-1">Estimate <input type="number" min={0} aria-label={`Estimate for ${rule.key}`} value={rule.estimate_minutes ?? ''} onChange={(e) => set({ estimate_minutes: e.target.value ? Number(e.target.value) : null })} className={`w-20 ${input}`} /> min</label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-600">
        <span>Assign:</span>
        {WHO.map(([v, l]) => (
          <label key={v} className="flex items-center gap-1"><input type="checkbox" checked={rule.assignees.includes(v)} onChange={(e) => set({ assignees: e.target.checked ? [...rule.assignees, v] : rule.assignees.filter((a) => a !== v) })} /> {l}</label>
        ))}
        <label className="flex items-center gap-1"><input type="checkbox" checked={rule.private} onChange={(e) => set({ private: e.target.checked })} /> Only assignees can see it</label>
        <label className="flex items-center gap-1">When they leave:
          <select aria-label={`When ${rule.key}'s person leaves`} value={rule.leaver} onChange={(e) => set({ leaver: e.target.value })} className={input}>{LEAVER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-gray-500">Checklist inside the task — one per line</span>
        <textarea aria-label={`Checklist for ${rule.key}`} rows={Math.max(3, rule.checklist.length)} value={rule.checklist.join('\n')}
          onChange={(e) => set({ checklist: e.target.value.split('\n').map((l) => l.trimStart()).filter((l, i, all) => l || i < all.length - 1) })}
          className={`mt-1 block w-full ${input}`} placeholder="One item per line" />
      </label>
      </div>
      )}
    </li>
  );
};

const JoinerPlanSection: React.FC<{ ws: string }> = ({ ws }) => {
  const [plan, setPlan] = useState<JoinerPlan | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { peopleApi.joinerPlan(ws).then((r) => { setPlan(r.plan); setIsDefault(r.is_default); }).catch(() => undefined); }, [ws]);
  if (!plan) return null;
  const save = async (value: JoinerPlan | null) => {
    setMsg(null);
    try {
      const out = await peopleApi.saveJoinerPlan(ws, value ? { ...value, rules: value.rules.map((r) => ({ ...r, checklist: r.checklist.filter(Boolean) })) } : null);
      setPlan(out.plan);
      setIsDefault(out.is_default);
      setMsg({ ok: true, text: value ? 'Joiner checklist saved.' : 'Back to the SOP defaults.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  return (
    <Section id="joiner" icon={<ListChecks size={17} className="text-brand-600" />} title="Joiner checklist"
      hint="The tasks created for every new person, from the “Common Operational Tasks” SOP. Run it from a person's profile, when adding someone, or when importing.">
      <p className="mb-3 text-[13px] text-gray-600">
        A new person gets <b>{plan.rules.filter((r) => r.enabled).length} of these {plan.rules.length} tasks</b> — the ones that
        apply to them. Open a line to change it.
      </p>

      {/* Set once when the workspace is built, and then never again. Behind a disclosure. */}
      <details className="mb-3 rounded-lg border border-gray-200">
        <summary className="cursor-pointer px-3 py-2 text-[13px] text-gray-600">Where these tasks live</summary>
        <div className="grid grid-cols-1 gap-3 border-t border-gray-100 px-3 py-3 text-sm sm:grid-cols-3">
          <label className="font-medium text-gray-700">Space<input aria-label="Joiner Space" value={plan.space_name} onChange={(e) => setPlan({ ...plan, space_name: e.target.value })} className={`mt-1 block w-full ${input}`} /></label>
          <label className="font-medium text-gray-700">HR team<input aria-label="HR team" value={plan.hr_team_name} onChange={(e) => setPlan({ ...plan, hr_team_name: e.target.value })} className={`mt-1 block w-full ${input}`} /></label>
          <label className="font-medium text-gray-700">Reviewer designations<input aria-label="Reviewer designations" value={plan.reviewer_designations.join(', ')} onChange={(e) => setPlan({ ...plan, reviewer_designations: e.target.value.split(',').map((d) => d.trim()) })} className={`mt-1 block w-full ${input}`} /></label>
        </div>
      </details>

      <ul className="space-y-1.5">
        {plan.rules.map((r, i) => <RuleRow key={r.key} rule={r} onChange={(next) => setPlan({ ...plan, rules: plan.rules.map((x, j) => (j === i ? next : x)) })} />)}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => save({ ...plan, reviewer_designations: plan.reviewer_designations.filter(Boolean) })} className={primary}><Save size={14} /> Save checklist</button>
        {!isDefault && <button type="button" onClick={async () => await ask.confirm({ danger: true, title: 'Go back to the SOP defaults? Your changes are lost.' }) && save(null)} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"><RotateCcw size={14} /> Reset to the SOP</button>}
        {isDefault && <span className="text-xs text-gray-400">Using the SOP defaults.</span>}
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`} role="status">{msg.text}</p>}
      <QuizLine ws={ws} />
    </Section>
  );
};

/** The induction questionnaire: a Form in the Induction List that joiners fill in after their induction. */
const QuizLine: React.FC<{ ws: string }> = ({ ws }) => {
  const [viewId, setViewId] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { peopleApi.inductionQuiz(ws).then((r) => setViewId(r.view_id)).catch(() => setViewId(null)); }, [ws]);
  if (viewId === undefined) return null;
  const make = async () => {
    setError(null);
    try { setViewId((await peopleApi.createInductionQuiz(ws)).view_id); } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="mt-5 border-t border-gray-100 pt-4 text-sm text-gray-700" aria-label="Induction questionnaire">
      <b className="font-medium">Induction questionnaire</b>
      {viewId ? (
        <p className="mt-1">Joiners fill it in after their induction; answers arrive as a task for HR. The induction task links to it.{' '}
          <Link to={`/forms/${viewId}`} className="font-medium text-brand-700">Open the questionnaire</Link></p>
      ) : (
        <p className="mt-1">The SOP ends the induction with a short practical check.{' '}
          <button type="button" onClick={make} className="font-medium text-brand-700 hover:underline">Create the questionnaire form</button></p>
      )}
      {error && <p className="mt-1 text-red-700">{error}</p>}
    </div>
  );
};

// --- audit log ----------------------------------------------------------------------------------------------------

/**
 * What the log can be narrowed to, and only things this workspace actually does.
 *
 * "Automations" has gone: the feature is switched off, so the filter sat there promising a kind of
 * event that can no longer happen. And "Spaces" now covers Folders and Lists too -- deleting
 * either was recorded all along as folder.deleted and list.deleted, and the old single-prefix
 * filter matched neither, so the two most destructive things an admin can do were findable under
 * "Everything" and nowhere else.
 */
const FILTERS: [string, string][] = [
  ['', 'Everything'],
  ['person.', 'People'],
  ['space.,folder.,list.', 'Spaces & Lists'],
  ['share.', 'Sharing'],
  ['team.', 'Teams'],
  ['workspace.', 'Workspace'],
];

const detail = (e: AuditEvent): string => {
  const d = e.data as Record<string, unknown>;
  if (e.action === 'person.role_changed') return `${d.from} → ${d.to}`;
  if (e.action === 'share.granted') return `with ${d.with} (${d.level})`;
  if (e.action === 'share.revoked') return `from ${d.with}`;
  if (e.action === 'person.offboarded') return `${d.tasks_handed_over} tasks handed over, ${d.joiner_tasks_deleted} deleted`;
  if (e.action === 'person.updated' && Array.isArray(d.fields)) return (d.fields as string[]).join(', ').replace(/_/g, ' ');
  if (e.action === 'workspace.sign_in_rules' && Array.isArray(d.locked_out) && d.locked_out.length) return `${d.locked_out.length} people now blocked`;
  return '';
};

const AuditSection: React.FC<{ ws: string }> = ({ ws }) => {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [filter, setFilter] = useState('');
  const [more, setMore] = useState(false);
  const load = useCallback(async (before?: string) => {
    const rows = await peopleApi.audit(ws, { action: filter || undefined, before, limit: 50 });
    setEvents((cur) => (before ? [...(cur ?? []), ...rows] : rows));
    setMore(rows.length === 50);
  }, [ws, filter]);
  useEffect(() => { load().catch(() => setEvents([])); }, [load]);
  return (
    <Section id="audit" icon={<History size={17} className="text-brand-600" />} title="Audit log" hint="Who added, changed or removed people, access and structure, and when.">
      <div className="mb-3 flex flex-wrap gap-1" role="radiogroup" aria-label="Show in audit log">
        {FILTERS.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={filter === v} onClick={() => setFilter(v)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${filter === v ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{l}</button>
        ))}
      </div>
      {events === null ? <p className="text-sm text-gray-400">Loading…</p> : events.length === 0 ? <p className="text-sm text-gray-400">Nothing recorded yet.</p> : (
        <ul className="divide-y divide-gray-100" aria-label="Audit events">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-2.5 py-2 text-sm">
              {e.actor ? <Avatar user={e.actor} size={22} /> : <span className="h-[22px] w-[22px] rounded-full bg-gray-200" />}
              <div className="min-w-0 flex-1">
                <p className="text-gray-700"><b className="font-medium text-gray-900">{e.actor ? e.actor.display_name || e.actor.email : 'Someone'}</b> {e.verb} {e.target_label && <b className="font-medium text-gray-900">{e.target_label}</b>}</p>
                {detail(e) && <p className="text-xs text-gray-500">{detail(e)}</p>}
              </div>
              <span className="shrink-0 text-xs text-gray-400">{new Date(e.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
            </li>
          ))}
        </ul>
      )}
      {more && events && <button type="button" onClick={() => load(events[events.length - 1].created_at)} className="mt-2 w-full rounded-md border border-gray-200 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Load older</button>}
    </Section>
  );
};
