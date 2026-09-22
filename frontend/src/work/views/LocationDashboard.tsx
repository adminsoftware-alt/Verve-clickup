import React, { useEffect, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import type { View } from '../api';
import { dashApi, type Dashboard } from '../dashboards/api';
import { DashboardPage } from '../dashboards/DashboardPage';

/**
 * A Space/Folder/List Dashboard view. It shows the standard summary until an editor customises it; then it is a
 * full card Dashboard (cards, filters, discussion, email reports) whose cards read from this location.
 */
export const LocationDashboard: React.FC<{ view: View; canEdit: boolean; standard: React.ReactNode }> = ({ view, canEdit, standard }) => {
  const [dash, setDash] = useState<Dashboard | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDash(undefined);
    dashApi.forView(view.id).then(setDash).catch(() => setDash(null));
  }, [view.id]);

  const customise = async () => {
    setBusy(true);
    setError(null);
    try { setDash(await dashApi.customiseView(view.id)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (dash === undefined) return <div className="p-6 text-sm text-gray-400">Loading dashboard…</div>;
  if (dash) return <DashboardPage key={dash.id} dashboardId={dash.id} embedded={{ onReset: () => setDash(null) }} />;
  return (
    <div>
      {canEdit && (
        <div className="flex items-center gap-3 border-b border-gray-100 bg-indigo-50/40 px-6 py-2 text-sm">
          <LayoutDashboard size={15} className="text-indigo-600" />
          <span className="text-gray-600">This is the standard dashboard. Customise it to choose your own cards, charts and filters.</span>
          <button type="button" disabled={busy} onClick={customise} className="ml-auto rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">Customise</button>
        </div>
      )}
      {error && <p className="mx-6 mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {standard}
    </div>
  );
};
