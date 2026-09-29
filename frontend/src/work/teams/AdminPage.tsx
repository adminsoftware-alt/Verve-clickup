import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { History, KeyRound, ListChecks, Mail, RotateCcw, Save } from 'lucide-react';
import { Avatar } from '../ui';
import { peopleApi, type AuditEvent, type JoinerPlan, type JoinerRule, type SignInRules } from './peopleApi';
import { useHub } from './TeamsHub';
import { ask } from '../../components/ask';

const card = 'rounded-xl border border-gray-200 bg-white p-5';
const input = 'rounded-md border border-gray-300 px-2 py-1.5 text-sm';
const primary = 'flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';

const Section: React.FC<{ id: string; icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }> = ({ id, icon, title, hint, children }) => (
  <section id={id} aria-label={title} className={card}>
    <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">{icon}{title}</h3>
    <p className="mb-4 mt-0.5 text-sm text-gray-500">{hint}</p>
    {children}
  </section>
);

/** Workspace administration for owners and admins. */
export const AdminPage: React.FC = () => {
  const { ws, isAdmin } = useHub();
  if (!isAdmin) return <p className="p-10 text-center text-sm text-gray-500">Only owners and admins can see this page.</p>;
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <h2 className="text-lg font-semibold text-gray-900">Admin</h2>
      <EmailSection ws={ws} />
      <SignInSection ws={ws} />
      <JoinerPlanSection ws={ws} />
      <AuditSection ws={ws} />
    </div>
  );
};

// --- email ---------------------------------------------------------------------------------------------------

const EmailSection: React.FC<{ ws: string }> = ({ ws }) => {
  const [status, setStatus] = useState<{ configured: boolean; host: string | null; sender: string | null } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { peopleApi.emailStatus(ws).then(setStatus).catch(() => undefined); }, [ws]);
  const test = async () => {
    setMsg(null);
    try { await peopleApi.emailTest(ws); setMsg({ ok: true, text: 'Test email sent to you. Check your inbox.' }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  return (
    <Section id="email" icon={<Mail size={17} className="text-brand-600" />} title="Email" hint="Invitations, scheduled reports, reminders and digests are sent from the company mail server.">
      {status && (
        <p className="text-sm text-gray-700">
          {status.configured
            ? <>Sending through <b>{status.host}</b> as <b>{status.sender ?? 'the configured account'}</b>.</>
            : <>Email is <b>not set up</b>. Ask whoever runs the server to add <code className="rounded bg-gray-100 px-1">SMTP_HOST</code>, <code className="rounded bg-gray-100 px-1">SMTP_PORT</code>, <code className="rounded bg-gray-100 px-1">SMTP_USER</code>, <code className="rounded bg-gray-100 px-1">SMTP_PASSWORD</code> and <code className="rounded bg-gray-100 px-1">SMTP_FROM</code> to the backend settings, then restart it. Until then, copy the sign-in link to share invitations.</>}
        </p>
      )}
      <button type="button" onClick={test} className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Send me a test email</button>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`} role="status">{msg.text}</p>}
    </Section>
  );
};

// --- sign-in rules ------------------------------------------------------------------------------------------

const SignInSection: React.FC<{ ws: string }> = ({ ws }) => {
  const [rules, setRules] = useState<SignInRules | null>(null);
  const [domains, setDomains] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { peopleApi.signInRules(ws).then((r) => { setRules(r.rules); setDomains(r.rules.allowed_email_domains.join(', ')); }).catch(() => undefined); }, [ws]);
  if (!rules) return null;
  const save = async () => {
    setMsg(null);
    const body = { ...rules, allowed_email_domains: domains.split(/[\s,;]+/).map((d) => d.trim()).filter(Boolean) };
    try {
      const out = await peopleApi.saveSignInRules(ws, body);
      setRules(out.rules);
      setDomains(out.rules.allowed_email_domains.join(', '));
      setMsg({ ok: true, text: out.locked_out.length ? `Saved. These people can't get in until they meet the rules: ${out.locked_out.join(', ')}.` : 'Saved. Everyone meets the rules.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const box = (key: keyof Omit<SignInRules, 'allowed_email_domains'>, label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm text-gray-700">
      <input type="checkbox" className="mt-1" checked={rules[key]} onChange={(e) => setRules({ ...rules, [key]: e.target.checked })} />
      <span>{label}<span className="block text-xs text-gray-500">{hint}</span></span>
    </label>
  );
  return (
    <Section id="sign-in" icon={<KeyRound size={17} className="text-brand-600" />} title="Sign-in rules" hint="Who may use this workspace, and how they must sign in. You can't save rules that would lock yourself out.">
      <label className="block text-sm font-medium text-gray-700">Allowed email domains
        <input aria-label="Allowed email domains" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="verveadvisory.com" className={`mt-1 block w-full ${input}`} />
        <span className="text-xs font-normal text-gray-500">Leave empty to allow any address an admin adds.</span>
      </label>
      <div className="mt-3 space-y-2">
        {box('allow_outside_guests', 'Guests may use other domains', 'e.g. a client or consultant with their own email.')}
        {box('require_google_sign_in', 'Require signing in with Google', 'Blocks email-and-password sign-ins.')}
        {box('require_two_step', 'Require two-step verification', 'Needs Firebase multi-factor sign-in turned on for the project; people without it are blocked.')}
      </div>
      <button type="button" onClick={save} className={`mt-4 ${primary}`}><Save size={14} /> Save rules</button>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`} role="status">{msg.text}</p>}
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

const RuleRow: React.FC<{ rule: JoinerRule; onChange: (r: JoinerRule) => void }> = ({ rule: raw, onChange }) => {
  const rule = { ...raw, checklist: raw.checklist ?? [], assignees: raw.assignees ?? [] };
  const set = (p: Partial<JoinerRule>) => onChange({ ...rule, ...p });
  const whereKind = rule.where.folder !== undefined ? 'folder' : 'list';
  return (
    <li className={`rounded-lg border p-3 ${rule.enabled ? 'border-gray-200' : 'border-dashed border-gray-200 opacity-60'}`} aria-label={`Rule ${rule.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={rule.enabled} aria-label={`Use ${rule.key}`} onChange={(e) => set({ enabled: e.target.checked })} />
        <input aria-label={`Task name for ${rule.key}`} value={rule.name} onChange={(e) => set({ name: e.target.value })} className={`min-w-60 flex-1 ${input}`} />
        <select aria-label={`Who gets ${rule.key}`} value={rule.when} onChange={(e) => set({ when: e.target.value })} className={input}>{WHEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
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
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-gray-500">Checklist ({rule.checklist.length})</summary>
        <textarea aria-label={`Checklist for ${rule.key}`} rows={Math.max(3, rule.checklist.length)} value={rule.checklist.join('\n')}
          onChange={(e) => set({ checklist: e.target.value.split('\n').map((l) => l.trimStart()).filter((l, i, all) => l || i < all.length - 1) })}
          className={`mt-1 block w-full ${input}`} placeholder="One item per line" />
      </details>
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
      <div className="mb-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <label className="font-medium text-gray-700">Space<input aria-label="Joiner Space" value={plan.space_name} onChange={(e) => setPlan({ ...plan, space_name: e.target.value })} className={`mt-1 block w-full ${input}`} /></label>
        <label className="font-medium text-gray-700">HR team<input aria-label="HR team" value={plan.hr_team_name} onChange={(e) => setPlan({ ...plan, hr_team_name: e.target.value })} className={`mt-1 block w-full ${input}`} /></label>
        <label className="font-medium text-gray-700">Reviewer designations<input aria-label="Reviewer designations" value={plan.reviewer_designations.join(', ')} onChange={(e) => setPlan({ ...plan, reviewer_designations: e.target.value.split(',').map((d) => d.trim()) })} className={`mt-1 block w-full ${input}`} /></label>
      </div>
      <ul className="space-y-2">
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

const FILTERS: [string, string][] = [['', 'Everything'], ['person.', 'People'], ['workspace.', 'Workspace'], ['space.', 'Spaces'], ['share.', 'Sharing'], ['team.', 'Teams'], ['automation.', 'Automations']];

const detail = (e: AuditEvent): string => {
  const d = e.data as Record<string, unknown>;
  if (e.action === 'person.role_changed') return `${d.from} → ${d.to}`;
  if (e.action === 'share.granted') return `with ${d.with} (${d.level})`;
  if (e.action === 'share.revoked') return `from ${d.with}`;
  if (e.action === 'person.offboarded') return `${d.tasks_handed_over} tasks handed over, ${d.joiner_tasks_deleted} deleted`;
  if (e.action === 'person.updated' && Array.isArray(d.fields)) return (d.fields as string[]).join(', ').replace(/_/g, ' ');
  if (e.action.startsWith('automation.')) return String(d.rule ?? '');
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
