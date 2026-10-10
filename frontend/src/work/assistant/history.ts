// What was said to the assistant, and what it did about it.
//
// A panel that forgets the moment it closes is a panel nobody trusts with anything they would mind
// losing. Two things come out of keeping the exchange: you can see the answer you were given five
// minutes ago without asking again, and when it does something odd you can show somebody what you
// actually said rather than reconstructing it.
//
// Kept in this browser and nowhere else. These are questions about the firm's own work -- whose
// hours, whose overdue audits -- and putting them on a server would mean deciding who may read
// them back, how long they live and what happens when somebody leaves. None of that is worth it
// for a convenience, so it stays local, it is capped, and it can be cleared.

const KEY = 'verve.assistant.history';
/** Sessions kept. Past this, the oldest goes. */
const SESSIONS = 20;
/** Exchanges kept per session. A long session is almost always a stuck one. */
const TURNS = 40;

/** One thing said, and what came back. */
export interface Turn {
  /** What they typed or said, as they said it. */
  said: string;
  /** What the assistant replied, or did. One line. */
  reply: string;
  /** The working underneath, where there was any. */
  detail?: string;
  /** True where the reply is a refusal or a failure, so the transcript can show it as one. */
  failed?: boolean;
  /** Tasks the answer listed, kept so the reply reads the same tomorrow as it did today. */
  tasks?: { id: string; name: string; listId: string; due: string | null }[];
  /** Where to go and see it in full. */
  goTo?: { label: string; to: string };
  at: number;
}

export interface Session {
  id: string;
  startedAt: number;
  turns: Turn[];
}

function read(): Session[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A private window, a full disk, or something else wrote nonsense here. None of it is worth
    // breaking the assistant over: it works perfectly well with no memory of yesterday.
    return [];
  }
}

function write(sessions: Session[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, SESSIONS)));
  } catch {
    /* nothing to do, and nothing worth saying about it */
  }
}

/** Every session, newest first. */
export const sessions = (): Session[] => read().sort((a, b) => b.startedAt - a.startedAt);

/**
 * Add an exchange to a session, creating it the first time.
 *
 * Returns the session as stored, so the caller can keep showing it while the panel stays open.
 */
export function remember(id: string, startedAt: number, turn: Turn): Session {
  const all = read();
  const found = all.find((s) => s.id === id);
  const session: Session = found ?? { id, startedAt, turns: [] };
  session.turns = [...session.turns, turn].slice(-TURNS);
  write([session, ...all.filter((s) => s.id !== id)].sort((a, b) => b.startedAt - a.startedAt));
  return session;
}

export function forget(id?: string): void {
  write(id ? read().filter((s) => s.id !== id) : []);
}

/** "2:45 pm" for today, "Tue 2:45 pm" within the week, otherwise the date. */
export function when(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  const days = Math.round((now.getTime() - at) / 86_400_000);
  if (days < 7) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
