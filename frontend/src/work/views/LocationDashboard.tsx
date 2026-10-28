import React, { useEffect, useState } from 'react';
import type { View } from '../api';
import { dashApi, type Dashboard } from '../dashboards/api';
import { DashboardPage } from '../dashboards/DashboardPage';
import { LinesSkeleton } from '../Skeleton';

/**
 * A Space/Folder/List Dashboard view: the standard summary of this location. A view that was
 * customised earlier into a card Dashboard keeps showing that board; there is no longer a
 * "Customise" banner offering to make new ones.
 */
export const LocationDashboard: React.FC<{ view: View; canEdit: boolean; standard: React.ReactNode }> = ({ view, standard }) => {
  const [dash, setDash] = useState<Dashboard | null | undefined>(undefined);
  useEffect(() => {
    setDash(undefined);
    dashApi.forView(view.id).then(setDash).catch(() => setDash(null));
  }, [view.id]);

  if (dash === undefined) return <div className="p-6 text-sm text-gray-400"><LinesSkeleton /></div>;
  if (dash) return <DashboardPage key={dash.id} dashboardId={dash.id} embedded={{ onReset: () => setDash(null) }} />;
  return <div>{standard}</div>;
};
