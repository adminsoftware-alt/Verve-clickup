import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DrawInPlace } from './inlineDialog';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, Building2, Cake, Calendar, Camera, ChevronDown, ClipboardCheck, Clock, Copy, Crown, Hash, Heart, LayoutDashboard, LogOut, Mail, MapPin, Phone, Power, Search, Send, Trash2, UserPlus, Users, X } from 'lucide-react';
import { JoinerDialog, OffboardDialog } from './AdminDialogs';
import type { Role, Task } from '../api';
import { Avatar, Portal, StatusDot, formatDue, useEscapeToClose } from '../ui';
import { peopleApi, personName, type Person, type PersonInput, type TeamFull } from './peopleApi';
import { ask } from '../../components/ask';
import { FEATURES } from '../../config/features';
import { PersonHistory, PersonHistoryHeading } from './PersonHistory';
import { AddressField } from './AddressField';

/** The six rungs the firm uses, L1 at the top. The API refuses anything outside them, so a
 *  spreadsheet carrying a 7 is an error rather than a quietly invented seventh level. */
import { EMPLOYMENT_TYPES, LEVELS, levelLabel } from './levels';
export { LEVELS };

export { ROLE_LABEL, accessOf, type Access } from './access';
import { ROLE_LABEL, accessOf } from './access';
import { LinesSkeleton } from '../Skeleton';

const Modal: React.FC<{ title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }> = ({ title, onClose, wide, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEscapeToClose(ref, onClose);
  // Inside the Admin window, which carries the title and the close button itself.
  if (useContext(DrawInPlace)) return <div ref={ref} role="region" aria-label={title} className="mx-auto w-full max-w-2xl">{children}</div>;
  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div ref={ref} role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
          className={`flex max-h-[90vh] ${wide ? 'w-[40rem]' : 'w-[30rem]'} max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white p-5 shadow-xl`}>
          <div className="mb-3 flex items-center">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <button aria-label="Close" type="button" onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>
          {children}
        </div>
      </div>
    </Portal>
  );
};

const inputCls = 'mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal text-gray-800';
const Field: React.FC<{ label: string; children: React.ReactNode; wide?: boolean }> = ({ label, children, wide }) => (
  <label className={`block text-xs font-medium text-gray-600 ${wide ? 'col-span-2' : ''}`}>{label}{children}</label>
);

/**
 * Who someone reports to: only the people who run things -- Admins and Managers -- with a search,
 * since a firm of seventy made the plain list a long scroll of interns and executives. Someone
 * already set as the manager stays offered even if they are neither, so editing never loses them.
 */
const ManagerPicker: React.FC<{ people: Person[]; teams: TeamFull[]; self?: string; value: string | null | undefined; onChange: (id: string | null) => void }> = ({
  people, teams, self, value, onChange,
}) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  const leaders = people
    .filter((p) => p.user.id !== self && !p.deactivated_at && (['Admin', 'Manager'].includes(accessOf(p.role, p.user.id, teams)) || p.user.id === value))
    .sort((a, b) => personName(a).localeCompare(personName(b)));
  const text = q.trim().toLowerCase();
  const shown = leaders.filter((p) => !text || `${personName(p)} ${p.designation ?? ''}`.toLowerCase().includes(text));
  const chosen = people.find((p) => p.user.id === value);
  const pick = (id: string | null) => { onChange(id); setOpen(false); setQ(''); };
  return (
    <div ref={box} className="relative mt-1">
      <button type="button" aria-label="Reporting manager" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-left text-sm font-normal ${open ? 'border-[#234788] ring-4 ring-[#234788]/10' : 'border-gray-300'}`}>
        {chosen ? <><Avatar user={chosen.user} size={20} /><span className="min-w-0 flex-1 truncate text-gray-800">{personName(chosen)}</span></>
          : <span className="flex-1 text-gray-400">No manager</span>}
        <ChevronDown size={14} className="shrink-0 text-gray-400" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-[#D9E1EF] bg-white shadow-[0_18px_40px_-12px_rgba(16,24,40,0.3)]">
          <label className="flex items-center gap-2 border-b border-[#EEF1F5] px-3 py-2">
            <Search size={14} className="shrink-0 text-gray-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search managers" aria-label="Search managers"
              className="w-full bg-transparent text-sm font-normal text-gray-800 outline-none placeholder:text-gray-400" />
          </label>
          <ul role="listbox" aria-label="Managers" className="max-h-60 overflow-y-auto p-1">
            {!text && (
              <li>
                <button type="button" role="option" aria-selected={!value} onClick={() => pick(null)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-normal ${!value ? 'bg-[#F3F6FB] font-semibold text-[#142B57]' : 'text-gray-500 hover:bg-gray-50'}`}>
                  No manager
                </button>
              </li>
            )}
            {shown.map((p) => {
              const on = p.user.id === value;
              const access = accessOf(p.role, p.user.id, teams);
              return (
                <li key={p.user.id}>
                  <button type="button" role="option" aria-selected={on} onClick={() => pick(p.user.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left font-normal ${on ? 'bg-[#F3F6FB]' : 'hover:bg-gray-50'}`}>
                    <Avatar user={p.user} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] ${on ? 'font-semibold text-[#142B57]' : 'text-gray-800'}`}>{personName(p)}</span>
                      {p.designation && <span className="block truncate text-[11px] text-gray-400">{p.designation}</span>}
                    </span>
                    <span className="shrink-0 rounded-md bg-[#EEF2F8] px-1.5 py-px text-[10.5px] font-semibold text-[#234788]">{access}</span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-3 py-4 text-center text-xs text-gray-400">{leaders.length ? `No manager called “${q}”.` : 'There are no Admins or Managers yet.'}</li>}
          </ul>
        </div>
      )}
    </div>
  );
};

/** A part of the profile form: a small spaced heading over a rule, then its fields. */
const Part: React.FC<{ title: string }> = ({ title }) => (
  <div className="col-span-2 mt-2 border-t border-[#EEF1F5] pt-3 first:mt-0 first:border-t-0 first:pt-0">
    <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#6B7FA8]">{title}</p>
  </div>
);

const TeamPicker: React.FC<{ teams: TeamFull[]; value: string[]; onChange: (v: string[]) => void }> = ({ teams, value, onChange }) => (
  <div className="mt-1 flex flex-wrap gap-1">
    {teams.length === 0 && <span className="text-xs text-gray-400">No teams yet.</span>}
    {teams.map((t) => {
      const on = value.includes(t.id);
      return (
        <button key={t.id} type="button" role="checkbox" aria-checked={on} onClick={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])}
          className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          {t.name}
        </button>
      );
    })}
  </div>
);

/** The profile form shared by "Add person" and editing someone. */
const ProfileFields: React.FC<{
  form: PersonInput; set: (p: Partial<PersonInput>) => void; people: Person[]; teams: TeamFull[];
  self?: string; roles: Role[]; showEmail: boolean; showRole: boolean; adminFields: boolean;
  /** Said under the email as it is typed: already in the firm, or blocked. */
  emailNote?: React.ReactNode;
}> = ({ form, set, people, teams, self, roles, showEmail, showRole, adminFields, emailNote }) => {
  // Departments already in use, offered as one-click chips so "HR" and "Hr" do not both appear.
  const departments = Array.from(new Set(people.map((p) => p.department?.trim()).filter((d): d is string => !!d))).sort();
  const typed = (form.department ?? '').trim().toLowerCase();
  const deptChips = departments.filter((d) => d.toLowerCase() !== typed && (!typed || d.toLowerCase().includes(typed))).slice(0, 6);
  // Ticking a Team suggests its lead as the reporting manager, when none is chosen yet.
  const pickTeams = (team_ids: string[]) => {
    const added = team_ids.find((id) => !(form.team_ids ?? []).includes(id));
    const lead = teams.find((t) => t.id === added)?.lead_ids.find((id) => id !== self);
    set({ team_ids, ...(lead && !form.manager_id ? { manager_id: lead } : {}) });
  };
  return (
  <div className="grid grid-cols-2 gap-3">
    <Part title="Who they are" />
    <Field label="Full name *"><input autoFocus aria-label="Full name" value={form.name ?? ''} onChange={(e) => set({ name: e.target.value })} className={inputCls} /></Field>
    {showEmail && (
      <Field label="Work email *">
        <input aria-label="Work email" type="email" value={form.email ?? ''} onChange={(e) => set({ email: e.target.value })} placeholder="name@verveadvisory.com" className={inputCls} />
        {emailNote && <span className="mt-1 block text-[11.5px] font-normal">{emailNote}</span>}
      </Field>
    )}
    {showRole && adminFields && (
      <Field label="Role">
        <select aria-label="Role" value={form.role ?? 'member'} onChange={(e) => set({ role: e.target.value as Role })} className={inputCls}>
          {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </Field>
    )}
    {adminFields && (
      <>
        <Part title="Their job" />
        <Field label="Designation"><input aria-label="Designation" value={form.designation ?? ''} onChange={(e) => set({ designation: e.target.value })} placeholder="e.g. HR Business Partner" className={inputCls} /></Field>
        {/* The rung, apart from the title: "Executive" and "Senior Executive" are two
            designations at two levels, and only the number sorts the same way everywhere. */}
        <Field label="Level">
          <select aria-label="Level" value={form.level ?? ''} onChange={(e) => set({ level: e.target.value ? Number(e.target.value) : null })} className={inputCls}>
            <option value="">No level</option>
            {LEVELS.map((n) => <option key={n} value={n}>{levelLabel(n)}</option>)}
          </select>
        </Field>
        <Field label="Employment type">
          <select aria-label="Employment type" value={form.employment_type ?? ''} onChange={(e) => set({ employment_type: e.target.value || null })} className={inputCls}>
            <option value="">Not set</option>
            {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <input aria-label="Department" value={form.department ?? ''} onChange={(e) => set({ department: e.target.value })} placeholder="e.g. HR" className={inputCls} />
          {deptChips.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {deptChips.map((d) => (
                <button key={d} type="button" onClick={() => set({ department: d })}
                  className="rounded-md border border-[#DCE3EF] bg-[#F5F8FD] px-1.5 py-px text-[11px] font-medium text-[#234788] hover:border-[#B9C7E2]">{d}</button>
              ))}
            </span>
          )}
        </Field>
        <div className="block text-xs font-medium text-gray-600">Reporting manager
          <ManagerPicker people={people} teams={teams} self={self} value={form.manager_id} onChange={(manager_id) => set({ manager_id })} />
        </div>
        <Field label="Employee code"><input aria-label="Employee code" value={form.employee_code ?? ''} onChange={(e) => set({ employee_code: e.target.value })} className={inputCls} /></Field>
        <Field label="Date of joining"><input aria-label="Date of joining" type="date" value={form.date_of_joining ?? ''} onChange={(e) => set({ date_of_joining: e.target.value || null })} className={inputCls} /></Field>
        {/* Date of birth, marriage anniversary and the interview flag were here. The
            fields still exist on a person and still import from a spreadsheet; they are just
            not asked for when someone is added. */}
        <div className="col-span-2 text-xs font-medium text-gray-600" role="group" aria-label="Teams">Teams
          <TeamPicker teams={teams} value={form.team_ids ?? []} onChange={pickTeams} />
        </div>
      </>
    )}
    <Part title="Contact" />
    <Field label="Phone"><input aria-label="Phone" value={form.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} className={inputCls} /></Field>
    {/* Private like a birthday: only Admins and the person see it. The person can keep it up to date. */}
    <Field label="Emergency contact name"><input aria-label="Emergency contact name" value={form.emergency_contact_name ?? ''} onChange={(e) => set({ emergency_contact_name: e.target.value || null })} className={inputCls} /></Field>
    <Field label="Emergency contact phone"><input aria-label="Emergency contact phone" value={form.emergency_contact_phone ?? ''} onChange={(e) => set({ emergency_contact_phone: e.target.value || null })} placeholder="+91 …" className={inputCls} /></Field>
    <div className="col-span-2 text-xs font-medium text-gray-600">Address
      <div className="mt-1"><AddressField value={form.address} onChange={(address, city) => set({ address, location: city })} /></div>
    </div>
  </div>
  );
};

const SignInLink: React.FC<{ link: string }> = ({ link }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); }}
      className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50">
      <Copy size={12} /> {copied ? 'Copied' : 'Copy sign-in link'}
    </button>
  );
};

// --- add a person -----------------------------------------------------------------------------------

export const AddPersonDialog: React.FC<{
  ws: string; people: Person[]; teams: TeamFull[]; roles: Role[]; onClose: () => void; onDone: (p: Person) => void;
}> = ({ ws, people, teams, roles, onClose, onDone }) => {
  // Most people are added on the day they join, so the date starts as today.
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fresh = (): PersonInput => ({ role: 'member', team_ids: [], date_of_joining: today() });
  const [form, setForm] = useState<PersonInput>(fresh);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  // Emails that may not be added back, to say so while the address is typed rather than on save.
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  useEffect(() => { peopleApi.blocked(ws).then((rows) => setBlocked(new Set(rows.map((b) => b.email.toLowerCase())))).catch(() => undefined); }, [ws]);
  const email = (form.email ?? '').trim().toLowerCase();
  const existing = email ? people.find((p) => p.user.email.toLowerCase() === email) : undefined;
  const emailNote = !email ? null
    : existing ? <span className="text-amber-700">Already in the firm: <b className="font-semibold">{personName(existing)}</b>{existing.deactivated_at ? ' (left; turn them back on from their profile)' : ''}.</span>
      : blocked.has(email) ? <span className="text-red-700">This email is blocked and can’t be added back. Remove it from Blocked addresses first.</span>
        : null;
  const [done, setDone] = useState<{ person: Person; emailed: boolean; email_problem: string | null; link: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = !!form.name?.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email?.trim() ?? '') && !existing && !blocked.has(email);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await peopleApi.add(ws, { ...form, name: form.name?.trim(), email: form.email?.trim() });
      setDone(out);
      onDone(out.person);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a person" onClose={onClose} wide>
      {done ? (
        <div className="text-sm text-gray-700" role="status">
          <p><b>{personName(done.person)}</b> is added{done.person.designation ? ` as ${done.person.designation}` : ''}. You can put them in teams and give them tasks now.</p>
          <p className="mt-2 text-gray-600">They sign in with Google using <b>{done.person.user.email}</b>; their account links up automatically.</p>
          <div className="mt-4 flex items-center justify-between">
            <SignInLink link={done.link} />
            <div className="flex gap-2">
              <button type="button" onClick={() => { onClose(); navigate(`/people?person=${encodeURIComponent(done.person.user.id)}`); }} className="rounded-md px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50">Open their profile</button>
              <button type="button" onClick={() => { setDone(null); setForm(fresh()); }} className="rounded-md px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50">Add another</button>
              <button type="button" onClick={onClose} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">Done</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 overflow-auto">
          <p className="mb-3 text-xs text-gray-500">Add someone who's joining, with their details. No email is needed to get started — they appear as “Pending” until they first sign in.</p>
          <ProfileFields form={form} set={(p) => setForm((f) => ({ ...f, ...p }))} people={people} teams={teams} roles={roles} showEmail showRole adminFields emailNote={emailNote} />
          {/* The joiner checklist is not a decision to make while typing someone's name in --
              it is HR's, afterwards, from the person's own page. The plan, the tasks it makes and
              the leaver rules that match it are all untouched. */}
          {FEATURES.joinerChecklistOnAdd && (
            <label className="mt-1 flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={!!form.start_joiner_checklist} onChange={(e) => setForm((f) => ({ ...f, start_joiner_checklist: e.target.checked }))} />
              Start the joiner checklist (induction, learning, reviews and HR reminders, as in the SOP)
            </label>
          )}
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="button" disabled={!ok || busy} onClick={save} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">Add person</button>
          </div>
        </div>
      )}
    </Modal>
  );
};

// --- a person's profile -------------------------------------------------------------------------------

export const PersonPanel: React.FC<{
  ws: string; person: Person; people: Person[]; teams: TeamFull[]; me: string; isAdmin: boolean; roles: Role[];
  onClose: () => void; onChanged: () => void; onOpenPerson: (id: string) => void;
}> = ({ ws, person, people, teams, me, isAdmin, roles, onClose, onChanged, onOpenPerson }) => {
  const navigate = useNavigate();
  // 'idle' until asked, then 'looking', then 'none' if they have not got one yet.
  const [board, setBoard] = useState<'idle' | 'looking' | 'none'>('idle');

  /** Open the Dashboard this person sees when they open the app.
   *
   *  Found by owner rather than by a route of its own: the server already shares every personal
   *  Dashboard with admins at view, and the list it returns names who each one belongs to. There
   *  was nothing to add on the server -- only a way in from the person.
   */
  const openDashboard = async (userId: string) => {
    // Their board as they see it, under the "Viewing" bar -- made there if they never opened it,
    // so there is no longer a "they have not got one yet" to say.
    setBoard('idle');
    onClose();
    navigate(`/dashboards/people/${encodeURIComponent(userId)}`);
  };

  const ref = useRef<HTMLElement>(null);
  useEscapeToClose(ref, onClose);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<PersonInput>({});
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Bumped after anything that moves them, so the history below reflects what just happened
  // rather than needing the panel closed and reopened.
  const [historyKey, setHistoryKey] = useState(0);
  const [movingTeam, setMovingTeam] = useState(false);
  const [moveNote, setMoveNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'offboard' | 'joiner' | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const isMe = person.user.id === me;
  const left = !!person.deactivated_at;
  const myRole = people.find((p) => p.user.id === me)?.role;
  const canEdit = isAdmin || isMe;
  // Reload after offboarding or the joiner checklist changes what they are assigned.
  useEffect(() => { peopleApi.tasks(ws, person.user.id).then(setTasks).catch(() => setTasks([])); }, [ws, person.user.id, person.deactivated_at, person.joiner_tasks]);
  const manager = people.find((p) => p.user.id === person.manager_id);
  const reports = useMemo(() => people.filter((p) => p.manager_id === person.user.id), [people, person.user.id]);
  const startEdit = () => {
    setForm({
      name: person.user.display_name ?? '', designation: person.designation ?? '', level: person.level, department: person.department ?? '',
      manager_id: person.manager_id, phone: person.phone ?? '', employee_code: person.employee_code ?? '',
      date_of_joining: person.date_of_joining, location: person.location ?? '', address: person.address ?? '', team_ids: person.team_ids, role: person.role,
      date_of_birth: person.date_of_birth, marriage_anniversary: person.marriage_anniversary, takes_interviews: person.takes_interviews,
      employment_type: person.employment_type, emergency_contact_name: person.emergency_contact_name, emergency_contact_phone: person.emergency_contact_phone,
    });
    setEditing(true);
  };
  const save = async () => {
    setError(null);
    const body: PersonInput = isAdmin ? { ...form } : {
      name: form.name, phone: form.phone, location: form.location, address: form.address,
      emergency_contact_name: form.emergency_contact_name, emergency_contact_phone: form.emergency_contact_phone,
    };
    if (!isAdmin || person.role === 'owner' || body.role === person.role) delete body.role;
    try { await peopleApi.update(ws, person.user.id, body); setEditing(false); setHistoryKey((k) => k + 1); onChanged(); } catch (e) { setError((e as Error).message); }
  };
  const resend = async () => {
    const out = await peopleApi.resend(ws, person.user.id);
    setNote(out.emailed ? 'Invitation sent.' : out.email_problem ?? 'Not sent.');
    onChanged();
  };
  const remove = async () => {
    // The weakest of the three, and the one that looks strongest. It deletes the membership --
    // including the record that they were ever turned off -- so nothing afterwards says they
    // should not be added again. Say so, and point at the two that do more.
    if (!(await ask.confirm({
      danger: true,
      title: `Remove ${personName(person)} from the workspace?`,
      body: 'Their tasks, comments and time stay. They lose access now — but nothing stops them being added again later. To keep them out, use Offboard… and tick "Block this address", or block it under Admin → Blocked addresses.',
      confirmLabel: 'Remove anyway',
    }))) return;
    try { await peopleApi.remove(ws, person.user.id); onChanged(); onClose(); } catch (e) { setError((e as Error).message); }
  };
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    try {
      await fn();
      if (done) { setNote(done); setMoveNote(done); }
      setHistoryKey((k) => k + 1);
      onChanged();
    } catch (e) { setError((e as Error).message); setMoveNote(null); }
  };
  const photo = (file: File | undefined) => file && act(() => peopleApi.setAvatar(ws, person.user.id, file), 'Photo updated.');
  const makeOwner = async () => await ask.confirm(`Make ${personName(person)} the owner of this workspace? You become an admin.`)
    && act(() => peopleApi.transferOwnership(ws, person.user.id), `${personName(person)} now owns the workspace.`);
  const turnOff = async () => await ask.confirm({ danger: true, title: `Turn off access for ${personName(person)}? Their tasks stay as they are.` })
    && act(() => peopleApi.setActive(ws, person.user.id, false), 'Access turned off.');
  const info = (icon: React.ReactNode, label: string, value: React.ReactNode) => value ? (
    <div className="flex items-start gap-2 py-1 text-sm"><span className="mt-0.5 text-gray-400">{icon}</span><span className="w-28 shrink-0 text-gray-500">{label}</span><span className="min-w-0 text-gray-800">{value}</span></div>
  ) : null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[110] flex justify-end bg-black/20" onMouseDown={onClose}>
        <aside ref={ref} role="dialog" aria-label={`Profile of ${personName(person)}`} onMouseDown={(e) => e.stopPropagation()}
          className="flex h-full w-[32rem] max-w-full flex-col overflow-hidden bg-white shadow-2xl">
          <header className="flex items-start gap-3 border-b border-gray-100 p-5">
            <span className="relative">
              <Avatar user={person.user} size={48} />
              {canEdit && (
                <>
                  <button aria-label="Change photo" type="button" onClick={() => photoRef.current?.click()}
                    className="absolute -bottom-1 -right-1 rounded-full border border-gray-200 bg-white p-1 text-gray-500 shadow-sm hover:text-gray-800"><Camera size={11} /></button>
                  <input ref={photoRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload photo" className="hidden"
                    onChange={(e) => { photo(e.target.files?.[0]); e.target.value = ''; }} />
                </>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-gray-900">{personName(person)}</h2>
              <p className="text-sm text-gray-500">{person.designation || 'No designation'}{person.department ? ` · ${person.department}` : ''}</p>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">{accessOf(person.role, person.user.id, teams)}</span>
                {person.pending && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Pending — hasn't signed in yet</span>}
                {left && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">Access turned off</span>}
              </div>
            </div>
            <button aria-label="Close" type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-5">
            {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {note && <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{note}</p>}
            {/* Their work, from here.
                An admin could already open anybody's personal Dashboard -- the server shares every
                one of them at view -- but only by finding it among ten rows in the Dashboards list
                all called "My work". The way in was missing, not the permission. Opening it shows
                exactly what that person sees on their own home page, read-only. */}
            {!editing && isAdmin && person.user.id !== me && (
              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button" onClick={() => openDashboard(person.user.id)} disabled={board === 'looking'}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-brand-300 hover:bg-brand-50/50 disabled:opacity-50"
                >
                  <LayoutDashboard size={14} className="text-brand-600" />
                  {board === 'looking' ? 'Opening…' : 'Their Dashboard'}
                </button>
                <Link
                  to={`/timesheets/people/${encodeURIComponent(person.user.id)}`} onClick={onClose}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 no-underline hover:border-brand-300 hover:bg-brand-50/50"
                >
                  <Clock size={14} className="text-brand-600" /> Their timesheet
                </Link>
              </div>
            )}
            {board === 'none' && (
              <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                They have no personal Dashboard yet. It is made the first time they open the app.
              </p>
            )}
            {editing ? (
              <>
                <ProfileFields form={form} set={(p) => setForm((f) => ({ ...f, ...p }))} people={people} teams={teams} self={person.user.id}
                  roles={roles} showEmail={false} showRole={isAdmin && person.role !== 'owner'} adminFields={isAdmin} />
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setEditing(false)} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
                  <button type="button" onClick={save} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Save</button>
                </div>
              </>
            ) : (
              <>
                {info(<Mail size={14} />, 'Email', person.user.email)}
                {info(<Briefcase size={14} />, 'Reports to', manager ? <button type="button" onClick={() => onOpenPerson(manager.user.id)} className="text-brand-700 hover:underline">{personName(manager)}</button> : null)}
                {info(<Hash size={14} />, 'Employee code', person.employee_code)}
                {info(<Calendar size={14} />, 'Joining date', person.date_of_joining ? new Date(`${person.date_of_joining}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null)}
                {info(<Phone size={14} />, 'Phone', person.phone)}
                {info(<MapPin size={14} />, 'Address', person.address ? <span className="whitespace-pre-line">{person.address}</span> : null)}
                {info(<Building2 size={14} />, 'Department', person.department)}
                {info(<Briefcase size={14} />, 'Level', person.level != null ? levelLabel(person.level) : null)}
                {info(<Briefcase size={14} />, 'Employment type', person.employment_type)}
                {info(<Phone size={14} />, 'Emergency contact', person.emergency_contact_name || person.emergency_contact_phone
                  ? [person.emergency_contact_name, person.emergency_contact_phone].filter(Boolean).join(' · ') : null)}
                {info(<Cake size={14} />, 'Birthday', person.date_of_birth ? new Date(`${person.date_of_birth}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : null)}
                {info(<Heart size={14} />, 'Anniversary', person.marriage_anniversary ? new Date(`${person.marriage_anniversary}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : null)}
                {isAdmin && info(<ClipboardCheck size={14} />, 'Joiner checklist', person.joiner_tasks ? `${person.joiner_tasks} tasks created` : 'Not started')}
                {info(<Users size={14} />, 'Teams', (
                  <span className="flex flex-wrap items-center gap-1">
                    {person.team_ids.map((id) => { const t = teams.find((x) => x.id === id); return t ? <Link key={id} to={`/people/teams/${id}`} onClick={onClose} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 no-underline">{t.name}</Link> : null; })}
                    {person.team_ids.length === 0 && <span className="text-xs text-gray-400">No team</span>}
                    {/* An admin's: the server refuses a change of Team from anyone else, the person
                        themselves included, so offering it to them only ended in an error. */}
                    {isAdmin && !left && (
                      <button type="button" onClick={() => { setMovingTeam(!movingTeam); setMoveNote(null); }}
                        className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
                        {movingTeam ? 'Cancel' : 'Move…'}
                      </button>
                    )}
                  </span>
                ))}
                {movingTeam && isAdmin && (
                  <div className="mb-2 ml-6 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/70 p-2.5">
                    <span className="text-xs text-gray-600">Move to</span>
                    <select
                      aria-label={`Move ${personName(person)} to a team`}
                      defaultValue={person.team_ids[0] ?? ''}
                      onChange={(e) => {
                        const id = e.target.value;
                        act(
                          () => peopleApi.update(ws, person.user.id, { team_ids: id ? [id] : [] }),
                          id ? `Moved to ${teams.find((t) => t.id === id)?.name}.` : 'Taken out of every team.',
                        ).then(() => setMovingTeam(false));
                      }}
                      className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-sm transition-colors hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
                    >
                      <option value="">No team</option>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    {/* The one thing people are unsure about, said before they pick. */}
                    <span className="text-[11px] text-gray-500">They leave the team they are in now.</span>
                    {moveNote && <span className="w-full text-xs text-emerald-700">{moveNote}</span>}
                  </div>
                )}
                {reports.length > 0 && info(<UserPlus size={14} />, 'Direct reports', (
                  <span className="flex flex-wrap gap-1">{reports.map((r) => <button key={r.user.id} type="button" onClick={() => onOpenPerson(r.user.id)} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200">{personName(r)}</button>)}</span>
                ))}
                <div className="mt-3 flex flex-wrap gap-2">
                  {canEdit && <button type="button" onClick={startEdit} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Edit profile</button>}
                  {isAdmin && person.pending && <button type="button" onClick={resend} className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><Send size={13} /> {person.invite_sent_at ? 'Resend invitation' : 'Email invitation'}</button>}
                  {isAdmin && !left && <button type="button" onClick={() => setDialog('joiner')} className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><ClipboardCheck size={13} /> Joiner checklist</button>}
                  {myRole === 'owner' && !isMe && !left && person.role !== 'guest' && person.role !== 'limited' && !person.pending && (
                    <button type="button" onClick={makeOwner} className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><Crown size={13} /> Make owner</button>
                  )}
                  {isAdmin && person.role !== 'owner' && !isMe && !left && <button type="button" onClick={() => setDialog('offboard')} className="flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"><LogOut size={13} /> Offboard…</button>}
                  {isAdmin && person.role !== 'owner' && !isMe && (left
                    ? <button type="button" onClick={() => act(() => peopleApi.setActive(ws, person.user.id, true), 'Access turned back on.')} className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><Power size={13} /> Turn access back on</button>
                    : <button type="button" onClick={turnOff} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"><Power size={13} /> Turn off access</button>)}
                  {isAdmin && person.role !== 'owner' && !isMe && <button type="button" onClick={remove} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"><Trash2 size={13} /> Remove from workspace</button>}
                </div>
                {isAdmin && (
                  <>
                    <PersonHistoryHeading />
                    <PersonHistory ws={ws} userId={person.user.id} refreshKey={historyKey} />
                  </>
                )}
                <h3 className="mb-1 mt-6 text-xs font-semibold uppercase tracking-wide text-gray-400">Assigned work {tasks ? tasks.length : ''}</h3>
                {tasks === null ? <p className="text-sm text-gray-400"><LinesSkeleton /></p> : tasks.length === 0 ? <p className="text-sm text-gray-400">No open tasks you can see.</p> : (
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {tasks.slice(0, 30).map((t) => (
                      <li key={t.id}>
                        <Link to={`/l/${t.list_id}?task=${t.id}`} onClick={onClose} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-800 no-underline hover:bg-gray-50">
                          <StatusDot status={t.status} size={11} /><span className="min-w-0 flex-1 truncate">{t.name}</span>
                          {t.due_date && <span className={`text-xs ${t.is_overdue ? 'text-red-600' : 'text-gray-400'}`}>{formatDue(t.due_date)}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
      {dialog === 'offboard' && <OffboardDialog ws={ws} person={person} people={people} onClose={() => setDialog(null)} onDone={onChanged} />}
      {dialog === 'joiner' && <JoinerDialog ws={ws} person={person} onClose={() => setDialog(null)} onDone={onChanged} />}
    </Portal>
  );
};
