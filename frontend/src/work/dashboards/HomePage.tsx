// What the app opens on: your own "My work" Dashboard, drawn by the same engine as every other one.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useWork } from '../WorkContext';
import { dashApi } from './api';
import { DashboardPage } from './DashboardPage';
import { DailyThought } from './DailyThought';

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** First name only: "Good morning, Harish" reads better than the full name. */
function firstName(name: string | null | undefined, email: string): string {
  const source = (name || email.split('@')[0] || '').trim();
  return source.split(/[\s._-]+/)[0] || 'there';
}

export const HomePage: React.FC = () => {
  const { workspace, me, allMembers, loading } = useWork();
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    let current = true;
    setError(null);
    dashApi.home(workspace.id)
      .then((dash) => { if (current) setId(dash.id); })
      .catch((e) => { if (current) setError((e as Error).message); });
    return () => { current = false; };
  }, [workspace]);

  const mine = allMembers.find((m) => m.user.id === me);
  const hello = `${greeting(new Date())}, ${firstName(mine?.user.display_name, mine?.user.email ?? '')}`;

  if (error) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <p className="text-sm text-red-700">{error}</p>
        <Link to="/dashboards" className="mt-3 inline-block text-sm font-medium text-brand-600">Open Dashboards</Link>
      </div>
    );
  }
  if (!id) return <p className="p-10 text-center text-sm text-gray-400">{loading || workspace ? 'Loading…' : ''}</p>;
  // The greeting moves into the band, where it has something to sit beside; the header keeps
  // the Dashboard's own name so the page still says what you are looking at.
  // No title: this is your own Dashboard, and "My work" above your own work says nothing.
  return <DashboardPage dashboardId={id} heading={false} intro={<DailyThought greeting={hello} />} />;
};
