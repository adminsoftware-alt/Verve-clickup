// Signing in as someone else while testing locally.
//
// The backend accepts "Bearer dev:<user id>" only where DEV_LOGIN is switched on, and this file
// only does anything while the app runs from `npm run dev` -- in a production build `import.meta.env.DEV`
// is false, so the picker never renders, nothing is read from storage and no dev token is ever sent.

const KEY = 'timetriq.devUser';

export interface DevPerson {
  id: string;
  name: string | null;
  email: string;
  role: string;
  designation: string | null;
  leads: string[];
  workspace: string;
}

export const devLoginPossible = (): boolean => import.meta.env.DEV;

/** Who you are pretending to be, if anyone. */
export function devUser(): DevPerson | null {
  if (!devLoginPossible()) return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DevPerson) : null;
  } catch {
    return null;
  }
}

export function signInAs(person: DevPerson): void {
  localStorage.setItem(KEY, JSON.stringify(person));
  window.location.assign('/');
}

export function signOutOfDev(): void {
  try { localStorage.removeItem(KEY); } catch { /* storage can be unavailable */ }
}

/** The people on offer, or [] when the backend has DEV_LOGIN off (it answers 404 then). */
export async function peopleToSignInAs(apiV2: string): Promise<DevPerson[]> {
  if (!devLoginPossible()) return [];
  try {
    const res = await fetch(`${apiV2}/dev/people`);
    return res.ok ? ((await res.json()) as DevPerson[]) : [];
  } catch {
    return [];
  }
}
