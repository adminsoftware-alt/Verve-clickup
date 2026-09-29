import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, Zap } from 'lucide-react';
import { workApi, type LocationKind, type Status } from './api';
import { useWork } from './WorkContext';
import { Modal } from './dashboards/dialogs';
import { planningApi, type Automation, type AutomationAction, type AutomationIn, type AutomationTrigger } from './planningApi';
import { ask } from '../components/ask';

const PRIORITIES: [number, string][] = [[1, 'Urgent'], [2, 'High'], [3, 'Normal'], [4, 'Low']];
const field = 'rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none';

/** Plain-English summary of a rule, e.g. "When status changes to Done, notify Asha". */
export function useDescribeRule() {
  const { members } = useWork();
  const person = (id: string) => { const m = members.find((x) => x.user.id === id); return m ? m.user.display_name || m.user.email : 'someone'; };
  return (r: Pick<Automation, 'trigger' | 'trigger_config' | 'action' | 'action_config'>) => {
    const t = r.trigger_config;
    const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
    const when = r.trigger === 'task_created' ? 'When a task is created'
      : r.trigger === 'status_changed' ? (t.status ? `When status changes to ${t.status}` : 'When status changes')
        : r.trigger === 'due_soon' ? (t.days_before ? `${plural(t.days_before)} before the due date` : 'On the due date')
          : r.trigger === 'overdue' ? (t.days_after ? `When a task is ${plural(t.days_after)} overdue` : 'When a task becomes overdue')
            : r.trigger === 'priority_changed' ? (t.priority ? `When priority changes to ${PRIORITIES.find(([v]) => v === t.priority)?.[1]}` : 'When priority changes')
              : 'When someone is assigned';
    const c = t.conditions ?? {};
    const only = [
      c.priorities?.length ? `priority is ${c.priorities.map((p) => PRIORITIES.find(([v]) => v === p)?.[1] ?? 'none').join(' or ')}` : '',
      c.tags?.length ? `tagged ${c.tags.join(' or ')}` : '',
      c.assignees?.length ? `assigned to ${c.assignees.map(person).join(' or ')}` : '',
    ].filter(Boolean);
    const people = (r.action_config.user_ids ?? []).map(person).join(', ');
    const does = r.action === 'assign' ? `assign ${people}` : r.action === 'notify' ? `notify ${people}`
      : r.action === 'set_priority' ? `set priority to ${PRIORITIES.find(([v]) => v === r.action_config.priority)?.[1] ?? ''}`
        : r.action === 'escalate' ? `tell the assignees' manager${r.action_config.levels === 2 ? 's and the managers above them' : ''}`
          : r.action === 'add_tag' ? `add the tag ${r.action_config.tag}`
            : `move it to ${r.action_config.status_name}`;
    return `${when}${only.length ? ` (only if ${only.join(' and ')})` : ''}, ${does}`;
  };
}

/** ClickUp Automations, kept to a few fixed rules: "when this happens here, do that". */
export const AutomationsDialog: React.FC<{ kind: LocationKind; id: string; name: string; canManage: boolean; onClose: () => void }> = ({ kind, id, name, canManage, onClose }) => {
  const { members } = useWork();
  const describe = useDescribeRule();
  const [rules, setRules] = useState<Automation[] | null>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trigger, setTrigger] = useState<AutomationTrigger>('status_changed');
  const [triggerStatus, setTriggerStatus] = useState('');
  const [action, setAction] = useState<AutomationAction>('notify');
  const [people, setPeople] = useState<string[]>([]);
  const [priority, setPriority] = useState(2);
  const [statusName, setStatusName] = useState('');
  const [days, setDays] = useState(1);
  const [triggerPriority, setTriggerPriority] = useState(0);
  const [levels, setLevels] = useState(1);
  const [message, setMessage] = useState('');
  const [tag, setTag] = useState('');
  const [condPriorities, setCondPriorities] = useState<number[]>([]);
  const [condTags, setCondTags] = useState('');

  const load = useCallback(() => planningApi.automations(kind, id).then(setRules).catch((e) => setError(e.message)), [kind, id]);
  useEffect(() => { load(); workApi.statuses(kind, id).then((s) => setStatuses(s.statuses)).catch(() => undefined); }, [load, kind, id]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  };
  const conditions = {
    ...(condPriorities.length ? { priorities: condPriorities } : {}),
    ...(condTags.trim() ? { tags: condTags.split(',').map((x) => x.trim()).filter(Boolean) } : {}),
  };
  const triggerConfig = trigger === 'status_changed' ? (triggerStatus ? { status: triggerStatus } : {})
    : trigger === 'due_soon' ? { days_before: days } : trigger === 'overdue' ? { days_after: days }
      : trigger === 'priority_changed' && triggerPriority ? { priority: triggerPriority } : {};
  const draft: AutomationIn = {
    trigger, trigger_config: Object.keys(conditions).length ? { ...triggerConfig, conditions } : triggerConfig,
    action, action_config: action === 'assign' || action === 'notify' ? { user_ids: people } : action === 'set_priority' ? { priority }
      : action === 'escalate' ? { levels, ...(message.trim() ? { message: message.trim() } : {}) } : action === 'add_tag' ? { tag: tag.trim() } : { status_name: statusName },
  };
  const ready = (action === 'assign' || action === 'notify') ? people.length > 0 : action === 'set_status' ? !!statusName.trim() : action === 'add_tag' ? !!tag.trim() : true;
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    if (await act(() => planningApi.addAutomation(kind, id, draft))) { setPeople([]); setStatusName(''); }
  };
  const where = kind === 'space' ? 'Space' : kind === 'folder' ? 'Folder' : 'List';

  return (
    <Modal label="Automations" title={<span className="flex items-center gap-2"><Zap size={16} className="text-amber-500" /> Automations · {name}</span>} onClose={onClose} width="w-[40rem]">
      <p className="mb-3 text-xs text-gray-500">Rules run on every task in this {where}{kind !== 'list' ? ' and everything inside it' : ''}. Changes they make show in the task's activity as “Automation”.</p>
      <ul className="mb-4 space-y-1.5" aria-label="Rules">
        {rules === null ? <li className="text-sm text-gray-400">Loading…</li> : rules.length === 0 ? <li className="text-sm text-gray-400">No Automations yet.</li> : rules.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm">
            <Zap size={14} className={r.active ? 'text-amber-500' : 'text-gray-300'} />
            <div className="min-w-0 flex-1">
              <div className={r.active ? 'text-gray-800' : 'text-gray-400 line-through'}>{describe(r)}</div>
              <div className="text-xs text-gray-400">
                {r.inherited ? `From the ${r.location_kind} above · ` : ''}ran {r.run_count} time{r.run_count === 1 ? '' : 's'}{r.created_by ? ` · by ${r.created_by.display_name || r.created_by.email}` : ''}
              </div>
            </div>
            {canManage && !r.inherited && (
              <>
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  <input type="checkbox" checked={r.active} disabled={busy} aria-label={`Turn ${r.active ? 'off' : 'on'}: ${describe(r)}`}
                    onChange={(e) => { const on = e.target.checked; setRules((rs) => rs && rs.map((x) => (x.id === r.id ? { ...x, active: on } : x))); act(() => planningApi.updateAutomation(r.id, { active: on })); }} /> On
                </label>
                <button type="button" title="Delete rule" disabled={busy} onClick={async () => await ask.confirm({ danger: true, title: `Delete “${describe(r)}”?` }) && act(() => planningApi.removeAutomation(r.id))}
                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
              </>
            )}
          </li>
        ))}
      </ul>

      {canManage ? (
        <form onSubmit={add} aria-label="New Automation" className="space-y-3 rounded-lg border border-dashed border-gray-300 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-gray-700">When</span>
            <select aria-label="Trigger" value={trigger} onChange={(e) => setTrigger(e.target.value as AutomationTrigger)} className={field}>
              <option value="status_changed">status changes</option>
              <option value="task_created">a task is created</option>
              <option value="due_soon">a due date is coming up</option>
              <option value="overdue">a task is overdue</option>
              <option value="priority_changed">priority changes</option>
              <option value="assignee_added">someone is assigned</option>
            </select>
            {(trigger === 'due_soon' || trigger === 'overdue') && (
              <>
                <input type="number" min={0} max={60} aria-label="Days" value={days} onChange={(e) => setDays(Math.max(0, Math.min(60, Number(e.target.value) || 0)))} className={`w-16 ${field}`} />
                <span className="text-gray-500">{trigger === 'due_soon' ? 'days before' : 'days after the due date'}</span>
              </>
            )}
            {trigger === 'priority_changed' && (
              <select aria-label="Priority that triggers" value={triggerPriority} onChange={(e) => setTriggerPriority(Number(e.target.value))} className={field}>
                <option value={0}>to anything</option>
                {PRIORITIES.map(([v, l]) => <option key={v} value={v}>to {l}</option>)}
              </select>
            )}
            {trigger === 'status_changed' && (
              <>
                <span className="text-gray-500">to</span>
                <select aria-label="Status that triggers" value={triggerStatus} onChange={(e) => setTriggerStatus(e.target.value)} className={field}>
                  <option value="">any status</option>
                  {statuses.map((st) => <option key={st.id} value={st.name}>{st.name}</option>)}
                </select>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-gray-700">Then</span>
            <select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value as AutomationAction)} className={field}>
              <option value="notify">notify people</option>
              <option value="assign">assign people</option>
              <option value="set_priority">set priority</option>
              <option value="set_status">change status</option>
              <option value="escalate">escalate to their manager</option>
              <option value="add_tag">add a tag</option>
            </select>
            {action === 'escalate' && (
              <select aria-label="Escalate to" value={levels} onChange={(e) => setLevels(Number(e.target.value))} className={field}>
                <option value={1}>reporting manager</option><option value={2}>manager and the manager above</option>
              </select>
            )}
            {action === 'add_tag' && <input aria-label="Tag to add" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. at-risk" className={`w-36 ${field}`} />}
            {action === 'set_priority' && (
              <select aria-label="Priority" value={priority} onChange={(e) => setPriority(Number(e.target.value))} className={field}>
                {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
            {action === 'set_status' && (
              <select aria-label="New status" value={statusName} onChange={(e) => setStatusName(e.target.value)} className={field}>
                <option value="">Pick a status</option>
                {statuses.filter((st) => st.name !== triggerStatus).map((st) => <option key={st.id} value={st.name}>{st.name}</option>)}
              </select>
            )}
          </div>
          {action === 'escalate' && (
            <input aria-label="Escalation message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message for the manager (optional)" className={`w-full ${field}`} />
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-gray-500">Only if… {Object.keys(conditions).length ? '(set)' : ''}</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">Priority is</span>
              {PRIORITIES.map(([v, l]) => (
                <label key={v} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={condPriorities.includes(v)} onChange={(e) => setCondPriorities(e.target.checked ? [...condPriorities, v] : condPriorities.filter((x) => x !== v))} /> {l}</label>
              ))}
              <span className="ml-3 text-xs text-gray-500">Tagged</span>
              <input aria-label="Only for tags" value={condTags} onChange={(e) => setCondTags(e.target.value)} placeholder="gst, urgent-client" className={`w-40 ${field}`} />
            </div>
          </details>
          {(action === 'assign' || action === 'notify') && (
            <fieldset>
              <legend className="mb-1 text-xs text-gray-500">{action === 'assign' ? 'Assign' : 'Notify'}</legend>
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {members.filter((m) => m.role !== 'guest').map((m) => {
                  const on = people.includes(m.user.id);
                  return (
                    <label key={m.user.id} className={`flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${on ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600'}`}>
                      <input type="checkbox" className="sr-only" checked={on} onChange={() => setPeople((p) => (on ? p.filter((x) => x !== m.user.id) : [...p, m.user.id]))} />
                      {m.user.display_name || m.user.email}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">{ready ? describe(draft) : ''}</span>
            <button type="submit" disabled={busy || !ready} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">Add Automation</button>
          </div>
        </form>
      ) : <p className="text-xs text-gray-400">You need full access to this {where} to add or change Automations.</p>}
      {error && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
};
