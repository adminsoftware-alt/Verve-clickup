import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, UserCog, X } from 'lucide-react';
import { useWork } from '../WorkContext';
import { Avatar, Portal } from '../ui';
import { STATUS_CLASS, STATUS_LABEL, sheetApi, type ApproverRow, type SheetSettings, type Submission } from './api';
import { hours, rangeLabel } from './pieces';
import { useLeadership } from '../dashboards/dialogs';

type Scope = 'to_review' | 'changes_requested' | 'approved' | 'all' | 'mine';
const SCOPES: { key: Scope; label: string }[] = [
  { key: 'to_review', label: 'To review' },
  { key: 'changes_requested', label: 'Changes requested' },
  { key: 'approved', label: 'Approved' },
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'My submissions' },
];

export const Approvals: React.FC<{ settings: SheetSettings | null }> = ({ settings }) => {
  const { workspace } = useWork();
  const { isAdmin } = useLeadership();
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope>('to_review');
  const [items, setItems] = useState<Submission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);

  const load = useCallback(() => {
    if (!workspace) return;
    sheetApi.submissions(workspace.id, scope).then((x) => { setItems(x); setError(null); }).catch((e) => setError(e.message));
  }, [workspace, scope]);
  useEffect(() => { load(); }, [load]);

  const approve = (sub: Submission) => sheetApi.decide(sub.id, 'approve').then(load).catch((e) => setError(e.message));
  const approveAll = async () => {
    for (const sub of items ?? []) if (sub.status === 'pending' && sub.can_review) await sheetApi.decide(sub.id, 'approve').catch(() => undefined);
    load();
  };

  return (
    <div className="mx-auto max-w-6xl">
      {settings && !settings.approvals_enabled && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
          Timesheet approvals are off. {isAdmin ? 'Turn them on in Settings, then set approvers here.' : 'An admin can turn them on.'}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {SCOPES.map((s) => (
          <button key={s.key} type="button" onClick={() => setScope(s.key)} className={`rounded-full px-3 py-1 text-sm ${scope === s.key ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'}`}>
            {s.label}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          {scope === 'to_review' && !!items?.some((x) => x.can_review) && (
            <button type="button" onClick={approveAll} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Approve all</button>
          )}
          {isAdmin && (
            <button type="button" onClick={() => setSetup(true)} className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><UserCog size={14} /> Approvers</button>
          )}
        </div>
      </div>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-sm" aria-label="Timesheet submissions">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Person</th><th className="px-3 py-2 font-medium">Week</th>
              <th className="px-3 py-2 text-right font-medium">Tracked</th><th className="px-3 py-2 text-right font-medium">Billable</th>
              <th className="px-3 py-2 text-right font-medium">Non-billable</th><th className="px-3 py-2 text-right font-medium">Capacity</th>
              <th className="px-3 py-2 text-right font-medium">Over</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {!items ? (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Nothing here.</td></tr>
            ) : items.map((sub) => {
              const over = Math.max(0, sub.tracked_seconds - sub.capacity_seconds);
              const open = () => navigate(scope === 'mine' ? `/timesheets?week=${sub.period_start}` : `/timesheets/people/${encodeURIComponent(sub.user.id)}?week=${sub.period_start}`);
              return (
                <tr key={sub.id} onClick={open} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5"><span className="flex items-center gap-2"><Avatar user={sub.user} size={24} /> {sub.user.display_name || sub.user.email}</span></td>
                  <td className="px-3 py-2.5 text-gray-600">{rangeLabel(sub.period_start, sub.period_end)}</td>
                  <td className="px-3 py-2.5 text-right">{hours(sub.tracked_seconds)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-600">{hours(sub.billable_seconds)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-600">{hours(sub.tracked_seconds - sub.billable_seconds)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-600">{hours(sub.capacity_seconds)}</td>
                  <td className={`px-3 py-2.5 text-right ${over ? 'text-red-600' : 'text-gray-400'}`}>{over ? hours(over) : '—'}</td>
                  <td className="px-3 py-2.5"><span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[sub.status]}`}>{STATUS_LABEL[sub.status]}</span></td>
                  <td className="px-3 py-2.5 text-right">
                    {sub.can_review && sub.status === 'pending' && (
                      <button type="button" title="Approve" onClick={(e) => { e.stopPropagation(); approve(sub); }} className="rounded p-1 text-emerald-600 hover:bg-emerald-50"><Check size={16} /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {setup && <ApproversDialog onClose={() => setSetup(false)} />}
    </div>
  );
};

const ApproversDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { workspace, members } = useWork();
  const [rows, setRows] = useState<ApproverRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { if (workspace) sheetApi.approvers(workspace.id).then(setRows).catch((e) => setError(e.message)); }, [workspace]);
  useEffect(() => { load(); }, [load]);
  const candidates = members.filter((m) => m.role !== 'guest');
  const save = (submitter: string, ids: string[]) => sheetApi.setApprovers(workspace!.id, submitter, ids).then(load).catch((e) => setError(e.message));
  return (
    <Portal>
      <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div role="dialog" aria-label="Approvers" onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-[44rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <h3 className="font-semibold text-gray-900">Who approves whose timesheet</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </header>
          <p className="px-5 pt-3 text-xs text-gray-500">By default a person's Team leads approve their timesheet. Pick approvers here to override that. Owners and admins can always approve.</p>
          {error && <p className="mx-5 mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="overflow-y-auto px-5 py-3">
            {!rows ? <p className="text-sm text-gray-400">Loading…</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500"><tr><th className="py-1 font-medium">Submitter</th><th className="py-1 font-medium">Approvers</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.submitter.id} className="border-t border-gray-100 align-top">
                      <td className="py-2 pr-3"><span className="flex items-center gap-2"><Avatar user={r.submitter} size={22} /> {r.submitter.display_name || r.submitter.email}</span></td>
                      <td className="py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {r.approvers.map((a) => (
                            <span key={a.id} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${r.is_custom ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                              {a.display_name || a.email}
                              {r.is_custom && <button type="button" aria-label={`Remove ${a.display_name || a.email}`} onClick={() => save(r.submitter.id, r.approvers.filter((x) => x.id !== a.id).map((x) => x.id))}><X size={11} /></button>}
                            </span>
                          ))}
                          {!r.is_custom && r.approvers.length === 0 && <span className="text-xs text-gray-400">Admins only</span>}
                          {!r.is_custom && r.approvers.length > 0 && <span className="text-[11px] text-gray-400">(Team leads)</span>}
                          <select
                            aria-label={`Add approver for ${r.submitter.display_name || r.submitter.email}`}
                            value=""
                            onChange={(e) => e.target.value && save(r.submitter.id, [...(r.is_custom ? r.approvers.map((x) => x.id) : []), e.target.value])}
                            className="rounded border border-gray-200 px-1 py-0.5 text-xs text-gray-600"
                          >
                            <option value="">Add…</option>
                            {candidates.filter((m) => m.user.id !== r.submitter.id && !(r.is_custom && r.approvers.some((a) => a.id === m.user.id))).map((m) => (
                              <option key={m.user.id} value={m.user.id}>{m.user.display_name || m.user.email}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
};
