// The first thing a new joiner sees, on the day nothing has happened yet.
//
// Their Dashboard carries nine cards. On day one every one of them reads zero, which tells a
// person nothing except that the tool might be broken. The cards are right -- there is nothing
// to count -- but a wall of noughts is the wrong answer to "what am I supposed to do here?".
//
// So until there is something to show, the board leads with this instead: where work will
// appear, who put it there, and the two things they can do without waiting for anyone.
import { ArrowRight, CalendarClock, CircleCheck, Clock, Users } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';

import { Avatar } from '../ui';
import type { UserRef } from '../api';

const Step: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <li className="flex gap-3">
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 shadow-sm ring-1 ring-black/[0.04]">{icon}</span>
    <span className="min-w-0">
      <span className="block text-[13px] font-semibold text-gray-900">{title}</span>
      <span className="block text-[13px] leading-relaxed text-gray-600">{children}</span>
    </span>
  </li>
);

export const FirstRun: React.FC<{
  name: string;
  /** Who to go to when nothing has arrived yet -- their reporting manager, if they have one. */
  manager?: UserRef | null;
  /** Whether this workspace records hours, so we only mention it where it is true. */
  tracksTime?: boolean;
}> = ({ name, manager, tracksTime = true }) => (
  <section
    aria-label="Getting started"
    className="mb-5 overflow-hidden rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50/80 via-white to-white"
  >
    <div className="px-6 py-5">
      <h2 className="text-base font-semibold text-gray-900">Welcome, {name}</h2>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-gray-600">
        Nothing has been assigned to you yet, so the figures below are all zero — that is expected on your
        first day, not a fault. Here is where things will turn up.
      </p>

      <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Step icon={<CircleCheck size={15} />} title="Your work arrives in My Tasks">
          When someone puts your name on a task it appears there, and on these cards. You will also get
          a notification.
        </Step>
        {tracksTime && (
          <Step icon={<Clock size={15} />} title="Record your hours as you go">
            Open a task and press Track time, or fill in the week on your timesheet. Both end up in the
            same place.
          </Step>
        )}
        <Step icon={<CalendarClock size={15} />} title="Nothing to do yet?">
          {manager
            ? <>Your work normally comes through <b>{manager.display_name || manager.email}</b>. Ask them what to pick up first.</>
            : <>Ask whoever you report to what to pick up first — once they assign it, it lands here.</>}
        </Step>
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link
          to="/my-tasks"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white no-underline shadow-sm transition-colors hover:bg-brand-700"
        >
          Go to My Tasks <ArrowRight size={14} />
        </Link>
        {tracksTime && (
          <Link
            to="/timesheets"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-700 no-underline transition-colors hover:bg-gray-50"
          >
            <Clock size={14} className="text-gray-400" /> Open my timesheet
          </Link>
        )}
        {manager && (
          <span className="ml-1 flex items-center gap-1.5 text-xs text-gray-500">
            <Users size={13} className="text-gray-400" /> You report to
            <Avatar user={manager} size={20} />
            {manager.display_name || manager.email}
          </span>
        )}
      </div>
    </div>
  </section>
);
