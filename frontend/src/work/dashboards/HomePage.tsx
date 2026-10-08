// What the app opens on: your own "My work" Dashboard, drawn by the same engine as every other one.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useIsAdmin, useWork } from '../WorkContext';
import { useMyTasks } from '../MyTasksContext';
import { peopleApi } from '../teams/peopleApi';
import type { UserRef } from '../api';
import { dashApi } from './api';
import { DashboardPage } from './DashboardPage';
import { DailyThought } from './DailyThought';
import { FirstRun } from './FirstRun';

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
  const isAdmin = useIsAdmin();
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Nothing assigned, and we have finished looking: this is somebody's first day, not a blip
  // while the list loads. The tasks are already fetched for the sidebar, so this costs nothing.
  const { tasks, loading: tasksLoading } = useMyTasks();
  // An admin lands on the Company board, which is not about their own tasks -- a "nothing is
  // assigned to you yet" welcome above the whole firm's figures would be answering a question
  // nobody asked.
  const firstRun = !isAdmin && !tasksLoading && tasks.length === 0;
  const [manager, setManager] = useState<UserRef | null>(null);

  useEffect(() => {
    if (!workspace) return;
    let current = true;
    setError(null);
    dashApi.home(workspace.id)
      .then((dash) => { if (current) setId(dash.id); })
      .catch((e) => { if (current) setError((e as Error).message); });
    return () => { current = false; };
  }, [workspace]);

  // Only looked up when the band will actually show, which is once in someone's working life.
  useEffect(() => {
    if (!workspace || !firstRun || !me) return;
    let live = true;
    peopleApi.list(workspace.id)
      .then((people) => {
        if (!live) return;
        const self = people.find((p) => p.user.id === me);
        const boss = self?.manager_id ? people.find((p) => p.user.id === self.manager_id) : null;
        setManager(boss?.user ?? null);
      })
      .catch(() => undefined);  // the band is worth showing without a name on it
    return () => { live = false; };
  }, [workspace, firstRun, me]);

  // An admin used to be sent to the list of boards from here. The board itself is what they
  // came for -- dashApi.home already returns the Company one for them -- so this page renders
  // it, and the list stays one click away under Dashboards.
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
  return (
    <DashboardPage
      dashboardId={id}
      heading={false}
      intro={(
        <>
          <DailyThought greeting={hello} />
          {firstRun && <FirstRun name={firstName(mine?.user.display_name, mine?.user.email ?? '')} manager={manager} />}
        </>
      )}
    />
  );
};
