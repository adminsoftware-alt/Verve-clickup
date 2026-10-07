import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, Building2, Cake, Calendar, Camera, ClipboardCheck, Copy, Crown, Hash, Heart, LogOut, Mail, MapPin, Phone, Power, Send, Trash2, UserPlus, Users, X } from 'lucide-react';
import { JoinerDialog, OffboardDialog } from './AdminDialogs';
import type { Role, Task } from '../api';
import { Avatar, Portal, StatusDot, formatDue, useEscapeToClose } from '../ui';
import { peopleApi, personName, type Person, type PersonInput, type TeamFull } from './peopleApi';
import { ask } from '../../components/ask';
import { FEATURES } from '../../config/features';
import { PersonHistory, PersonHistoryHeading } from './PersonHistory';

/** The three rungs the firm uses. The API refuses anything outside them, so a spreadsheet
 *  carrying a 4 is an error rather than a quietly invented fourth level. */
export const LEVELS = [1, 2, 3];

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', limited: 'Limited member', guest: 'Guest' };

const Modal: React.FC<{ title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }> = ({ title, onClose, wide, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEscapeToClose(ref, onClose);
  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div ref={ref} role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
          className={`flex max-h-[90vh] ${wide ? 'w-[40rem]' : 'w-[30rem]'} max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white p-5 shadow-xl`}>
          <div className="mb-3 flex items-center">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <button type="button" title="Close" onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
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
}> = ({ form, set, people, teams, self, roles, showEmail, showRole, adminFields }) => (
  <div className="grid grid-cols-2 gap-3">
    <Field label="Full name *"><input autoFocus aria-label="Full name" value={form.name ?? ''} onChange={(e) => set({ name: e.target.value })} className={inputCls} /></Field>
    {showEmail && <Field label="Work email *"><input aria-label="Work email" type="email" value={form.email ?? ''} onChange={(e) => set({ email: e.target.value })} placeholder="name@verveadvisory.com" className={inputCls} /></Field>}
    {adminFields && (
      <>
        <Field label="Designation"><input aria-label="Designation" value={form.designation ?? ''} onChange={(e) => set({ designation: e.target.value })} placeholder="e.g. HR Business Partner" className={inputCls} /></Field>
        {/* The rung, apart from the title: "Executive" and "Senior Executive" are two
            designations at two levels, and only the number sorts the same way everywhere. */}
        <Field label="Level">
          <select aria-label="Level" value={form.level ?? ''} onChange={(e) => set({ level: e.target.value ? Number(e.target.value) : null })} className={inputCls}>
            <option value="">No level</option>
            {LEVELS.map((n) => <option key={n} value={n}>Level {n}</option>)}
          </select>
        </Field>
        <Field label="Department"><input aria-label="Department" value={form.department ?? ''} onChange={(e) => set({ department: e.target.value })} placeholder="e.g. HR" className={inputCls} /></Field>
        <Field label="Reporting manager">
          <select aria-label="Reporting manager" value={form.manager_id ?? ''} onChange={(e) => set({ manager_id: e.target.value || null })} className={inputCls}>
            <option value="">No manager</option>
            {people.filter((p) => p.user.id !== self && !p.deactivated_at).map((p) => <option key={p.user.id} value={p.user.id}>{personName(p)}{p.designation ? ` — ${p.designation}` : ''}</option>)}
          </select>
        </Field>
        {showRole && (
          <Field label="Role">
            <select aria-label="Role" value={form.role ?? 'member'} onChange={(e) => set({ role: e.target.value as Role })} className={inputCls}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Field>
        )}
        <Field label="Employee code"><input aria-label="Employee code" value={form.employee_code ?? ''} onChange={(e) => set({ employee_code: e.target.value })} className={inputCls} /></Field>
        <Field label="Date of joining"><input aria-label="Date of joining" type="date" value={form.date_of_joining ?? ''} onChange={(e) => set({ date_of_joining: e.target.value || null })} className={inputCls} /></Field>
        {/* Date of birth, marriage anniversary and the interview flag were here. The
            fields still exist on a person and still import from a spreadsheet; they are just
            not asked for when someone is added. */}

      </>
    )}
    <Field label="Phone"><input aria-label="Phone" value={form.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} className={inputCls} /></Field>
    <Field label="Location"><input aria-label="Location" value={form.location ?? ''} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Bengaluru" className={inputCls} /></Field>
    {adminFields && (
      <div className="col-span-2 text-xs font-medium text-gray-600" role="group" aria-label="Teams">Teams
        <TeamPicker teams={teams} value={form.team_ids ?? []} onChange={(team_ids) => set({ team_ids })} />
      </div>
    )}
  </div>
);

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
  const [form, setForm] = useState<PersonInput>({ role: 'member', team_ids: [], send_invite: false });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ person: Person; emailed: boolean; email_problem: string | null; link: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = !!form.name?.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email?.trim() ?? '');
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
          {done.emailed && <p className="mt-2 text-emerald-700">An invitation email is on its way.</p>}
          {done.email_problem && <p className="mt-2 text-amber-700">{done.email_problem}</p>}
          <div className="mt-4 flex items-center justify-between">
            <SignInLink link={done.link} />
            <div className="flex gap-2">
              <button type="button" onClick={() => { setDone(null); setForm({ role: 'member', team_ids: [], send_invite: false }); }} className="rounded-md px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50">Add another</button>
              <button type="button" onClick={onClose} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">Done</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 overflow-auto">
          <p className="mb-3 text-xs text-gray-500">Add someone who's joining, with their details. No email is needed to get started — they appear as “Pending” until they first sign in.</p>
          <ProfileFields form={form} set={(p) => setForm((f) => ({ ...f, ...p }))} people={people} teams={teams} roles={roles} showEmail showRole adminFields />
          <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={!!form.send_invite} onChange={(e) => setForm((f) => ({ ...f, send_invite: e.target.checked }))} />
            Also email them an invitation
          </label>
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

// --- invite by email ----------------------------------------------------------------------------------

export const InviteDialog: React.FC<{ ws: string; teams: TeamFull[]; roles: Role[]; onClose: () => void; onDone: () => void }> = ({ ws, teams, roles, onClose, onDone }) => {
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof peopleApi.invite>> | null>(null);
  const list = emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const bad = list.filter((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  const send = async () => {
    setError(null);
    try {
      const out = await peopleApi.invite(ws, { emails: list, role, team_ids: teamIds, message: message.trim() || undefined });
      setResult(out);
      onDone();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title="Invite by email" onClose={onClose}>
      {result ? (
        <div className="text-sm text-gray-700" role="status">
          <p>{result.people.length} {result.people.length === 1 ? 'person' : 'people'} invited.{result.emailed ? ' Invitations are on their way.' : ''}</p>
          {result.email_problem && <p className="mt-2 text-amber-700">{result.email_problem}</p>}
          {result.problems.map((p) => <p key={p} className="mt-1 text-xs text-red-700">{p}</p>)}
          <div className="mt-4 flex items-center justify-between"><SignInLink link={result.link} />
            <button type="button" onClick={onClose} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">Done</button></div>
        </div>
      ) : (
        <>
          <label className="block text-xs font-medium text-gray-600">Email addresses
            <textarea aria-label="Email addresses" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="one@verveadvisory.com, two@verveadvisory.com" className={inputCls} />
          </label>
          {bad.length > 0 && <p className="mt-1 text-xs text-red-600">Not an email: {bad.join(', ')}</p>}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-gray-600">Role
              <select aria-label="Invite role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputCls}>
                {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 text-xs font-medium text-gray-600" role="group" aria-label="Add to teams">Add to teams<TeamPicker teams={teams} value={teamIds} onChange={setTeamIds} /></div>
          <label className="mt-3 block text-xs font-medium text-gray-600">Personal note (optional)
            <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls} />
          </label>
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="button" disabled={!list.length || bad.length > 0} onClick={send} className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"><Send size={14} /> Send invitations</button>
          </div>
        </>
      )}
    </Modal>
  );
};

// --- a person's profile -------------------------------------------------------------------------------

export const PersonPanel: React.FC<{
  ws: string; person: Person; people: Person[]; teams: TeamFull[]; me: string; isAdmin: boolean; roles: Role[];
  onClose: () => void; onChanged: () => void; onOpenPerson: (id: string) => void;
}> = ({ ws, person, people, teams, me, isAdmin, roles, onClose, onChanged, onOpenPerson }) => {
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
      date_of_joining: person.date_of_joining, location: person.location ?? '', team_ids: person.team_ids, role: person.role,
      date_of_birth: person.date_of_birth, marriage_anniversary: person.marriage_anniversary, takes_interviews: person.takes_interviews,
    });
    setEditing(true);
  };
  const save = async () => {
    setError(null);
    const body: PersonInput = isAdmin ? { ...form } : { name: form.name, phone: form.phone, location: form.location };
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
                  <button type="button" title="Change photo" onClick={() => photoRef.current?.click()}
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
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">{ROLE_LABEL[person.role]}</span>
                {person.pending && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Pending — hasn't signed in yet</span>}
                {left && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">Access turned off</span>}
              </div>
            </div>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-5">
            {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {note && <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{note}</p>}
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
                {info(<MapPin size={14} />, 'Location', person.location)}
                {info(<Building2 size={14} />, 'Department', person.department)}
                {info(<Cake size={14} />, 'Birthday', person.date_of_birth ? new Date(`${person.date_of_birth}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : null)}
                {info(<Heart size={14} />, 'Anniversary', person.marriage_anniversary ? new Date(`${person.marriage_anniversary}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : null)}
                {isAdmin && info(<ClipboardCheck size={14} />, 'Joiner checklist', person.joiner_tasks ? `${person.joiner_tasks} tasks created` : 'Not started')}
                {info(<Users size={14} />, 'Teams', (
                  <span className="flex flex-wrap items-center gap-1">
                    {person.team_ids.map((id) => { const t = teams.find((x) => x.id === id); return t ? <Link key={id} to={`/people/teams/${id}`} onClick={onClose} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 no-underline">{t.name}</Link> : null; })}
                    {person.team_ids.length === 0 && <span className="text-xs text-gray-400">No team</span>}
                    {canEdit && !left && (
                      <button type="button" onClick={() => { setMovingTeam(!movingTeam); setMoveNote(null); }}
                        className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
                        {movingTeam ? 'Cancel' : 'Move…'}
                      </button>
                    )}
                  </span>
                ))}
                {movingTeam && canEdit && (
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
                {tasks === null ? <p className="text-sm text-gray-400">Loading…</p> : tasks.length === 0 ? <p className="text-sm text-gray-400">No open tasks you can see.</p> : (
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
