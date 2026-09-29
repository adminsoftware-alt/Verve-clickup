// Local testing: sign in as anyone in the workspace, to see the app as a manager, an admin or a
// member. It renders only from `npm run dev` and only while the backend has DEV_LOGIN switched on.
import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, UserRound, Users } from 'lucide-react';

import { API_V2 } from '../work/api';
import { devLoginPossible, peopleToSignInAs, signInAs, type DevPerson } from '../core/devSession';

const ROLE_STYLE: Record<string, string> = {
  owner: 'bg-amber-100 text-amber-800',
  admin: 'bg-brand-100 text-brand-700',
  member: 'bg-gray-100 text-gray-600',
  guest: 'bg-gray-100 text-gray-500',
};

/** What this person is here to test: the label on the left of each row. */
function kindOf(person: DevPerson): { label: string; icon: React.ReactNode } {
  if (person.role === 'owner' || person.role === 'admin') return { label: 'Admin', icon: <ShieldCheck size={15} /> };
  if (person.leads.length) return { label: 'Manager', icon: <Users size={15} /> };
  return { label: 'Employee', icon: <UserRound size={15} /> };
}

export const DevSignIn: React.FC = () => {
  const [people, setPeople] = useState<DevPerson[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!devLoginPossible()) return;
    peopleToSignInAs(API_V2).then(setPeople);
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (people ?? []).filter((p) => !q || (p.name ?? p.email).toLowerCase().includes(q) || (p.designation ?? '').toLowerCase().includes(q));
    const rank = (p: DevPerson) => (p.role === 'owner' || p.role === 'admin' ? 0 : p.leads.length ? 1 : 2);
    return [...rows].sort((a, b) => rank(a) - rank(b) || (a.name ?? a.email).localeCompare(b.name ?? b.email));
  }, [people, query]);

  if (!devLoginPossible() || !people || people.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-4 text-left">
      <p className="text-sm font-semibold text-amber-900">Testing sign-in</p>
      <p className="mb-3 text-xs text-amber-800">
        Local only. Pick someone in {people[0].workspace} and the app opens as them — an admin, a manager
        who leads a Team, or an employee.
      </p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or designation"
        aria-label="Search people to sign in as"
        className="mb-2 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
      />
      <ul className="max-h-64 space-y-1 overflow-auto" aria-label="People you can sign in as">
        {shown.map((person) => {
          const kind = kindOf(person);
          return (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => signInAs(person)}
                className="flex w-full items-center gap-3 rounded-lg bg-white px-3 py-2 text-left text-sm hover:bg-amber-100/60"
              >
                <span className="flex w-20 shrink-0 items-center gap-1.5 text-xs font-medium text-gray-500">{kind.icon} {kind.label}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-800">{person.name || person.email}</span>
                  <span className="block truncate text-xs text-gray-500">
                    {person.designation || person.email}{person.leads.length ? ` · leads ${person.leads.join(', ')}` : ''}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_STYLE[person.role] ?? 'bg-gray-100 text-gray-600'}`}>
                  {person.role}
                </span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-3 py-4 text-center text-xs text-gray-500">Nobody matches that.</li>}
      </ul>
    </div>
  );
};
