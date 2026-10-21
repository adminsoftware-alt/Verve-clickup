import type { Role } from '../api';

// Three kinds of access, as the firm talks about them: Admin, Manager and Employee. "Manager" is
// not a stored role -- it is an employee who leads a Team -- so it is worked out from the Teams.
export const ROLE_LABEL: Record<Role, string> = { owner: 'Admin', admin: 'Admin', member: 'Employee', limited: 'Employee', guest: 'Guest' };
export type Access = 'Admin' | 'Manager' | 'Employee' | 'Guest';

/** Admin, Manager (leads a Team) or Employee -- the one label shown for a person's access. */
export function accessOf(role: Role, userId: string, teams: { lead_ids: string[] }[]): Access {
  if (role === 'owner' || role === 'admin') return 'Admin';
  if (role === 'guest') return 'Guest';
  return teams.some((t) => t.lead_ids.includes(userId)) ? 'Manager' : 'Employee';
}
