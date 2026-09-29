import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, Pause, Play, Send, Trash2, Users, X } from 'lucide-react';
import { useAuth } from '../../components/AuthContext';
import { useWork, useMe } from '../WorkContext';
import type { Task } from '../api';
import { Avatar, AvatarStack, Portal, StatusDot, formatDue, useEscapeToClose } from '../ui';
import {
  dashApi, viewerTimezone,
  type DashLevel, type DashboardSharing, type Frequency, type ReportRun, type Schedule, type ScheduleIn, type Source, type Template,
} from './api';
import { SourcePicker } from './pickers';
import { ask } from '../../components/ask';

export const Modal: React.FC<{ label: string; title: React.ReactNode; onClose: () => void; width?: string; children: React.ReactNode; footer?: React.ReactNode }> = ({
  label, title, onClose, width = 'w-[34rem]', children, footer,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEscapeToClose(ref, onClose);
  return (
  <Portal>
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div ref={ref} role="dialog" aria-label={label} onMouseDown={(e) => e.stopPropagation()} className={`flex max-h-[88vh] ${width} max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white shadow-xl`}>
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h3 className="truncate font-semibold text-gray-900">{title}</h3>
          <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  </Portal>
  );
};

const primary = 'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';
const secondary = 'rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100';

// --- the Teams you can make dashboards for ----------------------------------------------

export function useLeadership() {
  const { teams, hierarchy } = useWork();
  const { user } = useAuth();
  const meId = useMe();
  const isAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
  const led = teams.filter((t) => user && t.lead_ids.includes(meId));
  return { isAdmin, led, creatableTeams: isAdmin ? teams : led, isGuest: hierarchy?.role === 'guest' };
}

// --- new Dashboard -----------------------------------------------------------------------

const TEMPLATES: { value: Template; label: string; hint: string }[] = [
  { value: 'blank', label: 'Start from scratch', hint: 'An empty Dashboard; add the cards you want.' },
  { value: 'vapl_review', label: 'VAPL Review', hint: 'The SOP review Dashboard: totals, overdue, unassigned, unscheduled, no estimates, work done today, timesheet, actual vs budgeted time.' },
  { value: 'simple', label: 'Simple', hint: 'Open, due today, overdue and done this week, with status and assignee charts.' },
  { value: 'time_tracking', label: 'Time tracking', hint: 'Timesheet, time by person, billable time by List, estimated vs tracked.' },
  { value: 'monthly_review', label: 'Monthly review', hint: 'The SOP monthly review: done this month (on time or late), overdue, hours by List and per day. Filter it to one person.' },
];

export const NewDashboardDialog: React.FC<{ onClose: () => void; onCreated: (id: string) => void; defaultTeam?: string }> = ({ onClose, onCreated, defaultTeam }) => {
  const { workspace } = useWork();
  const { creatableTeams } = useLeadership();
  const [name, setName] = useState('');
  const [owner, setOwner] = useState(defaultTeam ?? '');
  const [template, setTemplate] = useState<Template>('vapl_review');
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!workspace || !name.trim() || busy) return;
    setBusy(true);
    try {
      const dash = await dashApi.create(workspace.id, { name: name.trim(), team_id: owner || null, template, sources });
      onCreated(dash.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal label="New Dashboard" title="New Dashboard" onClose={onClose} width="w-[40rem]"
      footer={<><button type="button" onClick={onClose} className={secondary}>Cancel</button><button type="button" disabled={!name.trim() || busy} onClick={create} className={primary}>Create Dashboard</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-2 block text-xs font-medium text-gray-600">
            Name
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="e.g. HR weekly review" className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Belongs to
            <select aria-label="Belongs to" value={owner} onChange={(e) => setOwner(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal">
              <option value="">Me (personal)</option>
              {creatableTeams.map((t) => <option key={t.id} value={t.id}>Team: {t.name}</option>)}
            </select>
          </label>
        </div>
        <p className="-mt-2 text-xs text-gray-500">
          {owner
            ? 'A Team dashboard shows the Team\'s people as one view. Its Team leads manage it; admins can see it.'
            : 'Only you can see a personal Dashboard, plus your Team lead and admins (view only). Share it to give others access.'}
        </p>
        <div>
          <span className="text-xs font-medium text-gray-600">Template</span>
          <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <label key={t.value} className={`flex cursor-pointer gap-2 rounded-lg border p-3 ${template === t.value ? 'border-brand-400 bg-brand-50/50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input type="radio" name="template" checked={template === t.value} onChange={() => setTemplate(t.value)} className="mt-0.5" />
                <span><span className="block text-sm font-medium text-gray-900">{t.label}</span><span className="block text-xs text-gray-500">{t.hint}</span></span>
              </label>
            ))}
          </div>
        </div>
        {template !== 'blank' && (
          <div>
            <span className="text-xs font-medium text-gray-600">Data from</span>
            <SourcePicker value={sources} onChange={setSources} />
          </div>
        )}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </Modal>
  );
};

// --- change locations ----------------------------------------------------------------------

export const RepointDialog: React.FC<{ dashboardId: string; onClose: () => void; onDone: () => void }> = ({ dashboardId, onClose, onDone }) => {
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal label="Change locations" title="Change locations" onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={secondary}>Cancel</button>
        <button type="button" className={primary} onClick={() => dashApi.repoint(dashboardId, sources).then(onDone).catch((e) => setError(e.message))}>Apply to every card</button></>}>
      <p className="mb-3 text-sm text-gray-600">Point every card on this Dashboard at these locations — the quick way to reuse a Dashboard for another team or client after duplicating it.</p>
      <SourcePicker value={sources} onChange={setSources} />
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
};

// --- drill-down -----------------------------------------------------------------------------

export const DrillDialog: React.FC<{ dashboardId: string; cardId: string; segment?: string; title: string; onClose: () => void; onOpenTask: (id: string) => void }> = ({
  dashboardId, cardId, segment, title, onClose, onOpenTask,
}) => {
  const { locate } = useWork();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dashApi.cardTasks(dashboardId, cardId, segment).then((page) => { setTasks(page.tasks); setTotal(page.total); }).catch((e) => setError(e.message));
  }, [dashboardId, cardId, segment]);
  const where = (listId: string) => (locate('list', listId)?.path ?? []).map((c) => c.name).join(' / ');
  return (
    <Modal label="Tasks behind this card" title={<>{title} <span className="font-normal text-gray-400">{tasks ? total : ''}</span></>} onClose={onClose} width="w-[46rem]">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!tasks ? <p className="text-sm text-gray-400">Loading…</p> : tasks.length === 0 ? <p className="text-sm text-gray-400">No tasks.</p> : (
        <ul className="divide-y divide-gray-100">
          {tasks.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => onOpenTask(t.id)} className="flex w-full items-center gap-3 px-1 py-2 text-left text-sm hover:bg-gray-50">
                <StatusDot status={t.status} size={12} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-gray-800">{t.name}</span>
                  <span className="block truncate text-xs text-gray-400">{where(t.list_id)}</span>
                </span>
                <AvatarStack users={t.assignees} />
                <span className={`w-20 text-right text-xs ${t.is_overdue ? 'text-red-600' : 'text-gray-500'}`}>{formatDue(t.due_date)}</span>
              </button>
            </li>
          ))}
          {total > tasks.length && <li className="py-2 text-center text-xs text-gray-400">Showing the first {tasks.length} of {total}.</li>}
        </ul>
      )}
    </Modal>
  );
};

// --- sharing ------------------------------------------------------------------------------

const LEVELS: { value: DashLevel; label: string; hint: string }[] = [
  { value: 'view', label: 'View only', hint: 'See the Dashboard and drill into cards' },
  { value: 'edit', label: 'Edit', hint: 'Add, change and arrange cards; share; set up email reports' },
  { value: 'full', label: 'Full', hint: 'Everything, including deleting the Dashboard' },
];
const RANK: Record<DashLevel, number> = { view: 1, edit: 2, full: 3 };

export const ShareDashboardDialog: React.FC<{ dashboardId: string; name: string; onClose: () => void; onChanged: () => void }> = ({ dashboardId, name, onClose, onChanged }) => {
  const { members, teams } = useWork();
  const [info, setInfo] = useState<DashboardSharing | null>(null);
  const [grantee, setGrantee] = useState('');
  const [level, setLevel] = useState<DashLevel>('view');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => dashApi.sharing(dashboardId).then(setInfo).catch((e) => setError(e.message)), [dashboardId]);
  useEffect(() => { load(); }, [load]);
  const run = async (action: () => Promise<unknown>) => {
    try { setError(null); await action(); await load(); onChanged(); } catch (e) { setError((e as Error).message); }
  };
  const mine = info ? RANK[info.your_level] : 0;
  const canShare = mine >= RANK.edit;
  const sharedUsers = new Set(info?.shares.filter((s) => s.user).map((s) => s.user!.id));
  const sharedTeams = new Set(info?.shares.filter((s) => s.team).map((s) => s.team!.id));
  const target = (v: string) => (v.startsWith('team:') ? { team_id: v.slice(5) } : { user_id: v.slice(5) });

  return (
    <Modal label={`Share ${name}`} title={`Share “${name}”`} onClose={onClose}>
      <p className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
        Dashboards are private to their owner. Team leads can view their Team members' Dashboards and admins can view all of them.
        Sharing gives anyone else access. Each person sees card numbers based on their own access to the tasks behind them.
      </p>
      {canShare && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (grantee) run(() => dashApi.share(dashboardId, target(grantee), level)).then(() => setGrantee('')); }}>
          <select aria-label="Person or Team" value={grantee} onChange={(e) => setGrantee(e.target.value)} className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">Add a person or Team…</option>
            <optgroup label="Teams">{teams.filter((t) => !sharedTeams.has(t.id)).map((t) => <option key={t.id} value={`team:${t.id}`}>{t.name} ({t.members.length})</option>)}</optgroup>
            <optgroup label="People">{members.filter((m) => !sharedUsers.has(m.user.id)).map((m) => <option key={m.user.id} value={`user:${m.user.id}`}>{m.user.display_name || m.user.email}{m.role === 'guest' ? ' (guest)' : ''}</option>)}</optgroup>
          </select>
          <select aria-label="Access level" value={level} onChange={(e) => setLevel(e.target.value as DashLevel)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            {LEVELS.filter((l) => RANK[l.value] <= mine).map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <button type="submit" disabled={!grantee} className={primary}>Share</button>
        </form>
      )}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <h4 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Shared with</h4>
      {!info ? <p className="text-sm text-gray-400">Loading…</p> : info.shares.length === 0 ? <p className="py-2 text-sm text-gray-400">Not shared with anyone.</p> : (
        <ul className="divide-y divide-gray-100">
          {info.shares.map((sh) => {
            const editable = canShare && RANK[sh.level as DashLevel] <= mine;
            const g = sh.team ? `team:${sh.team.id}` : `user:${sh.user!.id}`;
            return (
              <li key={sh.id} className="flex items-center gap-3 py-2">
                {sh.team ? <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-brand-700"><Users size={14} /></span> : <Avatar user={sh.user!} size={28} />}
                <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{sh.team ? `${sh.team.name}` : sh.user!.display_name || sh.user!.email}{sh.team && <span className="ml-1.5 text-xs text-gray-400">Team</span>}</span>
                <select aria-label="Change access" value={sh.level} disabled={!editable} onChange={(e) => run(() => dashApi.share(dashboardId, target(g), e.target.value as DashLevel))} className="rounded-md border border-gray-200 px-1.5 py-1 text-sm disabled:bg-gray-50">
                  {LEVELS.map((l) => <option key={l.value} value={l.value} disabled={RANK[l.value] > mine}>{l.label}</option>)}
                </select>
                {editable && <button type="button" title="Remove access" onClick={() => run(() => dashApi.unshare(dashboardId, sh.id))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>}
              </li>
            );
          })}
        </ul>
      )}
      <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-gray-500">
        {LEVELS.map((l) => <li key={l.value}><b>{l.label}</b>: {l.hint}</li>)}
      </ul>
    </Modal>
  );
};

// --- email reports -----------------------------------------------------------------------------

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const describe = (s: Pick<Schedule, 'frequency' | 'weekday' | 'day_of_month' | 'send_time' | 'timezone'>) =>
  `${s.frequency === 'daily' ? 'Every day' : s.frequency === 'weekdays' ? 'Every weekday' : s.frequency === 'weekly' ? `Every ${WEEKDAYS[s.weekday ?? 0]}` : `Monthly on day ${s.day_of_month}`} at ${s.send_time} (${s.timezone})`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export const ReportsDialog: React.FC<{ dashboardId: string; name: string; canEdit: boolean; onClose: () => void }> = ({ dashboardId, name, canEdit, onClose }) => {
  const [tab, setTab] = useState<'schedules' | 'activity'>('schedules');
  const [info, setInfo] = useState<{ email_configured: boolean; schedules: Schedule[] } | null>(null);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const [preview, setPreview] = useState<{ title: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await dashApi.reports(dashboardId));
      if (canEdit) setRuns(await dashApi.runs(dashboardId));
    } catch (e) { setError((e as Error).message); }
  }, [dashboardId, canEdit]);
  useEffect(() => { load(); }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    try { setError(null); await action(); await load(); } catch (e) { setError((e as Error).message); }
  };
  const sendNow = (s: Schedule) => run(async () => {
    const result = await dashApi.sendNow(s.id);
    setNotice(result.status === 'sent' ? `Sent to ${result.recipients.join(', ')}.` : result.error ?? 'Not sent.');
  });
  const toInput = (s: Schedule, active: boolean): ScheduleIn => ({
    recipient_ids: s.recipients.map((r) => r.id), subject: s.subject, frequency: s.frequency, weekday: s.weekday,
    day_of_month: s.day_of_month, send_time: s.send_time, timezone: s.timezone, active,
  });

  if (editing) {
    return <ScheduleForm dashboardId={dashboardId} schedule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />;
  }
  if (preview) {
    return (
      <Modal label="Report preview" title={preview.title} onClose={() => setPreview(null)} width="w-[52rem]">
        <iframe title="Report preview" srcDoc={preview.html} sandbox="" className="h-[65vh] w-full rounded border border-gray-200" />
      </Modal>
    );
  }

  return (
    <Modal label="Email reports" title={<span className="flex items-center gap-2"><Mail size={16} /> Email reports — {name}</span>} onClose={onClose} width="w-[44rem]">
      {info && !info.email_configured && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Email sending isn't set up on the server yet (SMTP settings), so reports are built and kept under Activity but not delivered.
        </p>
      )}
      <p className="mb-3 text-xs text-gray-500">A report emails this Dashboard's cards to workspace members on a schedule. The numbers are what the person who set it up can see.</p>
      <div className="mb-3 flex gap-4 border-b border-gray-100 text-sm">
        <button type="button" onClick={() => setTab('schedules')} className={`-mb-px border-b-2 pb-2 ${tab === 'schedules' ? 'border-brand-600 font-medium text-gray-900' : 'border-transparent text-gray-500'}`}>Schedules</button>
        {canEdit && <button type="button" onClick={() => setTab('activity')} className={`-mb-px border-b-2 pb-2 ${tab === 'activity' ? 'border-brand-600 font-medium text-gray-900' : 'border-transparent text-gray-500'}`}>Activity</button>}
        <button type="button" onClick={() => dashApi.preview(dashboardId).then((p) => setPreview({ title: 'Preview (as you see it now)', html: p.html })).catch((e) => setError(e.message))} className="ml-auto pb-2 text-brand-600 hover:underline">Preview email</button>
      </div>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mb-3 rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800">{notice}</p>}

      {tab === 'schedules' ? (
        <>
          {!info ? <p className="text-sm text-gray-400">Loading…</p> : info.schedules.length === 0 ? <p className="py-3 text-sm text-gray-400">No email reports yet.</p> : (
            <ul className="space-y-2">
              {info.schedules.map((s) => (
                <li key={s.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900">{s.subject || `${name} — Dashboard report`}</div>
                      <div className="text-xs text-gray-500">{describe(s)}</div>
                      <div className="mt-1 text-xs text-gray-500">To {s.recipients.map((r) => r.display_name || r.email).join(', ')}</div>
                      <div className="mt-1 text-xs text-gray-400">{s.active ? `Next: ${when(s.next_run_at)}` : 'Paused'} · Last sent: {when(s.last_run_at)} · Set up by {s.created_by?.display_name || s.created_by?.email || 'someone who left'}</div>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button type="button" title="Send now" onClick={() => sendNow(s)} className="rounded p-1.5 text-gray-500 hover:bg-gray-100"><Send size={15} /></button>
                        <button type="button" title={s.active ? 'Pause' : 'Resume'} onClick={() => run(() => dashApi.updateReport(s.id, toInput(s, !s.active)))} className="rounded p-1.5 text-gray-500 hover:bg-gray-100">{s.active ? <Pause size={15} /> : <Play size={15} />}</button>
                        <button type="button" onClick={() => setEditing(s)} className="rounded px-2 py-1 text-xs text-brand-600 hover:bg-brand-50">Edit</button>
                        <button type="button" title="Delete" onClick={async () => await ask.confirm({ danger: true, title: 'Delete this email report?' }) && run(() => dashApi.removeReport(s.id))} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canEdit && <button type="button" onClick={() => setEditing('new')} className={`${primary} mt-3`}>New email report</button>}
          {!canEdit && <p className="mt-3 text-xs text-gray-400">You need edit access to set up email reports.</p>}
        </>
      ) : (
        runs.length === 0 ? <p className="py-3 text-sm text-gray-400">Nothing has been sent yet.</p> : (
          <ul className="divide-y divide-gray-100">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${r.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : r.status === 'not_sent' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`}>
                  {r.status === 'sent' ? 'Sent' : r.status === 'not_sent' ? 'Not sent' : 'Failed'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-gray-800">{when(r.created_at)} · {r.recipients.length} recipient{r.recipients.length === 1 ? '' : 's'}</span>
                  {r.error && <span className="block truncate text-xs text-gray-500" title={r.error}>{r.error}</span>}
                </span>
                <button type="button" onClick={() => dashApi.run(r.id).then((x) => setPreview({ title: `Report of ${when(r.created_at)}`, html: x.html })).catch((e) => setError(e.message))} className="text-xs text-brand-600 hover:underline">View</button>
              </li>
            ))}
          </ul>
        )
      )}
    </Modal>
  );
};

const ScheduleForm: React.FC<{ dashboardId: string; schedule: Schedule | null; onClose: () => void; onSaved: () => void }> = ({ dashboardId, schedule, onClose, onSaved }) => {
  const { members } = useWork();
  const { user } = useAuth();
  const meId = useMe();
  const [form, setForm] = useState<ScheduleIn>(() => schedule ? {
    recipient_ids: schedule.recipients.map((r) => r.id), subject: schedule.subject, frequency: schedule.frequency, weekday: schedule.weekday,
    day_of_month: schedule.day_of_month, send_time: schedule.send_time, timezone: schedule.timezone, active: schedule.active,
  } : { recipient_ids: user ? [meId] : [], subject: '', frequency: 'weekly', weekday: 0, day_of_month: 1, send_time: '09:00', timezone: viewerTimezone(), active: true });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ScheduleIn>(k: K, v: ScheduleIn[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (id: string) => set('recipient_ids', form.recipient_ids.includes(id) ? form.recipient_ids.filter((x) => x !== id) : [...form.recipient_ids, id]);
  const save = () => (schedule ? dashApi.updateReport(schedule.id, form) : dashApi.createReport(dashboardId, form)).then(onSaved).catch((e) => setError(e.message));
  const input = 'mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal';
  return (
    <Modal label={schedule ? 'Edit email report' : 'New email report'} title={schedule ? 'Edit email report' : 'New email report'} onClose={onClose} width="w-[38rem]"
      footer={<><button type="button" onClick={onClose} className={secondary}>Cancel</button><button type="button" disabled={!form.recipient_ids.length} onClick={save} className={primary}>{schedule ? 'Save' : 'Create'}</button></>}>
      <div className="space-y-3">
        <label className="block text-xs font-medium text-gray-600">Subject <span className="font-normal text-gray-400">(optional)</span>
          <input value={form.subject ?? ''} onChange={(e) => set('subject', e.target.value)} placeholder="e.g. HR weekly review" className={input} />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-xs font-medium text-gray-600">Repeat
            <select aria-label="Repeat" value={form.frequency} onChange={(e) => set('frequency', e.target.value as Frequency)} className={input}>
              <option value="daily">Every day</option><option value="weekdays">Every weekday</option><option value="weekly">Every week</option><option value="monthly">Every month</option>
            </select>
          </label>
          {form.frequency === 'weekly' && (
            <label className="block text-xs font-medium text-gray-600">On
              <select value={form.weekday ?? 0} onChange={(e) => set('weekday', Number(e.target.value))} className={input}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
            </label>
          )}
          {form.frequency === 'monthly' && (
            <label className="block text-xs font-medium text-gray-600">On day
              <select value={form.day_of_month ?? 1} onChange={(e) => set('day_of_month', Number(e.target.value))} className={input}>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select>
            </label>
          )}
          <label className="block text-xs font-medium text-gray-600">At
            <input type="time" aria-label="Send time" value={form.send_time} onChange={(e) => set('send_time', e.target.value)} className={input} />
          </label>
        </div>
        <label className="block text-xs font-medium text-gray-600">Timezone
          <input value={form.timezone} onChange={(e) => set('timezone', e.target.value)} className={input} />
        </label>
        <div>
          <span className="text-xs font-medium text-gray-600">Send to</span>
          <div className="mt-1 max-h-44 overflow-y-auto rounded-md border border-gray-200 px-2 py-1">
            {members.map((m) => (
              <label key={m.user.id} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                <input type="checkbox" checked={form.recipient_ids.includes(m.user.id)} onChange={() => toggle(m.user.id)} />
                <Avatar user={m.user} size={20} />
                <span className="truncate text-gray-800">{m.user.display_name || m.user.email}</span>
                <span className="ml-auto text-xs text-gray-400">{m.user.email}</span>
              </label>
            ))}
          </div>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </Modal>
  );
};
