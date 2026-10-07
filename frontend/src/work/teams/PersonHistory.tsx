// What has happened to this person: promotions, transfers, role changes, access turned on and off.
//
// The audit log could only be asked who *did* things. "What has happened to this colleague" --
// when were they promoted, which team were they in before, who moved them -- had no answer, and
// it is most of what anyone wants from a log about a person.
import { History } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { peopleApi, type AuditEvent } from './peopleApi';

const FIELD_NAMES: Record<string, string> = {
  designation: 'Designation', level: 'Level', department: 'Department', manager_id: 'Reporting manager',
};

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** The one line that says what actually moved. */
function detail(e: AuditEvent): React.ReactNode {
  const d = e.data as Record<string, unknown>;

  if (e.action === 'person.role_changed') return <>{String(d.from)} → <b>{String(d.to)}</b></>;

  if (e.action === 'person.teams_changed') {
    const from = (d.from as string[]) ?? [];
    const to = (d.to as string[]) ?? [];
    return <>{from.length ? from.join(', ') : 'no team'} → <b>{to.length ? to.join(', ') : 'no team'}</b></>;
  }

  // A promotion: the values, not just the field names, which is the whole point of looking.
  const moved = d.moved as Record<string, { from: unknown; to: unknown }> | undefined;
  if (moved && Object.keys(moved).length) {
    return (
      <>
        {Object.entries(moved).map(([field, v], i) => (
          <span key={field}>
            {i > 0 && ' · '}
            {FIELD_NAMES[field] ?? field}: {v.from == null || v.from === '' ? '—' : String(v.from)} → <b>{v.to == null || v.to === '' ? '—' : String(v.to)}</b>
          </span>
        ))}
      </>
    );
  }

  if (Array.isArray(d.fields)) return <>{(d.fields as string[]).map((f) => FIELD_NAMES[f] ?? f.replace(/_/g, ' ')).join(', ')}</>;
  if (e.action === 'person.offboarded') {
    const handed = Number(d.tasks_handed_over ?? 0);
    return <>{handed} task{handed === 1 ? '' : 's'} handed over{d.email_blocked ? ', address blocked' : ''}</>;
  }
  return null;
}

export const PersonHistory: React.FC<{ ws: string; userId: string; refreshKey?: number }> = ({ ws, userId, refreshKey }) => {
  const [rows, setRows] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    peopleApi.audit(ws, { target_id: userId, limit: 25 }).then(setRows).catch((e) => setError(e.message));
  }, [ws, userId, refreshKey]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (rows === null) return <p className="text-sm text-gray-400">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-gray-400">Nothing has changed for them yet.</p>;

  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
      {rows.map((e) => (
        <li key={e.id} className="px-3 py-2">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 text-sm text-gray-800">
              <b className="font-medium">{e.actor?.display_name || e.actor?.email || 'Someone'}</b> {e.verb} them
            </span>
            <span className="shrink-0 text-[11px] text-gray-400">{when(e.created_at)}</span>
          </span>
          {detail(e) && <span className="mt-0.5 block text-xs text-gray-500">{detail(e)}</span>}
        </li>
      ))}
    </ul>
  );
};

export const PersonHistoryHeading: React.FC = () => (
  <h3 className="mb-1 mt-6 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
    <History size={13} /> What has changed
  </h3>
);
